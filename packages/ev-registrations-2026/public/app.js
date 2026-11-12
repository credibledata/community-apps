import * as S from './scope.js'
import * as C from './charts.js'

const $ = (sel, root = document) => root.querySelector(sel)

/** h('div', { class: 'x', text: 'y', onclick }, ...children): a small element builder. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'text') el.textContent = v
    else if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v === true ? '' : v)
  }
  el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false))
  return el
}

// ---- Formatting only: every number shown comes from a query ----

const pct = (v) => C.pct(v, 1)
// Points to one decimal, or two where one would round a real gap to zero.
const pts = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(Math.abs(v * 100) < 0.1 ? 2 : 1)} pts` : 'n/a')
const ym = (v) => String(v).slice(0, 7)
const dateLabel = (v) => new Date(String(v).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const AFTER = 'After the credit'
const WITH = 'With the credit'

// ---- State: the route and the scope, both in the address ----

const known = {}
let route = { view: 'overview', id: null, compare: [] }
let scope = { ...S.DEFAULT_SCOPE }

// ---- Queries: one request per distinct text, at most four in flight ----

const cache = new Map()
const queue = []
let inFlight = 0
function pump() {
  while (inFlight < 4 && queue.length) {
    const job = queue.shift()
    inFlight++
    job().finally(() => {
      inFlight--
      pump()
    })
  }
}
export function query(q) {
  if (!cache.has(q)) {
    const p = new Promise((resolve, reject) => {
      queue.push(() => Publisher.query(S.MODEL, q).then(resolve, reject))
      pump()
    })
    p.catch(() => cache.delete(q))
    cache.set(q, p)
  }
  return cache.get(q)
}

// ---- Navigation ----

function go(nextRoute, nextScope = scope, { push = true } = {}) {
  route = nextRoute
  scope = nextScope
  const hash = S.buildHash(route, scope)
  if (hash !== location.hash) history[push ? 'pushState' : 'replaceState'](null, '', hash)
  render({ toTop: push })
}
const setScope = (patch) => go(route, { ...scope, ...patch }, { push: false })
const toggleScope = (key, value) => setScope({ [key]: scope[key] === value ? S.DEFAULT_SCOPE[key] : value })
const openEntity = (id) => go({ view: S.ENTITY.view, id, compare: [] })
const linkTo = (view, id = null, compare = []) => S.buildHash({ view, id, compare }, scope)
const inCompare = (id) => route.compare.includes(id) || compareSet.has(id)
const compareSet = new Set()
function toggleCompare(id) {
  if (compareSet.has(id)) compareSet.delete(id)
  else if (compareSet.size < S.COMPARE_MAX) compareSet.add(id)
  render()
}

window.addEventListener('popstate', () => {
  ;({ route, scope } = S.parseHash(location.hash, known))
  if (route.view === 'compare') route.compare.forEach((id) => compareSet.add(id))
  render({ toTop: true })
})

// ---- Hand-off to Credible's agent ----

function appOrigin(loc = location) {
  const parts = loc.host.split('.')
  if (parts.length >= 3) {
    parts[1] = parts[1].replace(/data$/, 'app')
    return `${loc.protocol}//${parts.join('.')}`
  }
  return `${loc.protocol}//${loc.host}`
}
function inCredibleViewer(loc = location) {
  const parts = loc.host.split('.')
  const plane = parts[1] || ''
  return window.parent !== window && parts.length >= 3 && (plane === 'data' || plane.endsWith('-data'))
}
function askCredibleAgent(prompt, queries = []) {
  const text = String(prompt ?? '').trim().slice(0, 4000)
  if (!text) return
  if (!inCredibleViewer()) {
    try {
      navigator.clipboard?.writeText(text)
    } catch {}
    window.open(location.href, '_blank', 'noopener')
    return
  }
  const origin = appOrigin()
  const context = {
    scope: { package: 'ev-registrations-2026', model: S.MODEL },
    view: { type: 'data-app', id: route.view, title: document.querySelector('.view-title')?.textContent?.slice(0, 120) || 'EVs in New York' },
    queries: queries.slice(0, 4).map((q) => q.slice(0, 900)),
  }
  window.parent.postMessage({ type: 'credible:chat-context', context }, origin)
  window.parent.postMessage({ type: 'credible:chat-message', prompt: text }, origin)
}
const askButton = (prompt, queries = () => []) =>
  h('button', { class: 'btn ask', type: 'button', text: 'Ask about this', title: prompt, onclick: () => askCredibleAgent(prompt, queries()) })

// ---- Tiles: a card that loads its queries when it comes near the screen ----

let epoch = 0
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      io.unobserve(e.target)
      e.target.__load()
    }
  },
  { rootMargin: '400px' }
)

/** The method note, plus the scope keys this card's source cannot filter by. */
function methodFor(source, text) {
  const ignored = S.ignoredKeys(source, scope, known)
  if (!ignored.length) return text
  return `${text} This card counts every make and body type: the ${ignored.join(' and ')} filter applies to electric records only.`
}

function tile(spec) {
  const { title, sub, cls = '', note } = spec
  let current = spec
  const body = h('div', { class: 'card__body' }, h('div', { class: 'state state--loading', text: 'Loading' }))
  const found = h('p', { class: 'card__finding' })
  const methodEl = h('p', { class: 'card__method', text: spec.method || '' })
  let results = []
  const details = h('details', {}, h('summary', {}, h('span', { class: 'when-closed', text: 'Show the working' }), h('span', { class: 'when-open', text: 'Hide the working' })))
  details.addEventListener('toggle', () => {
    details.querySelector('.working')?.remove()
    if (details.open) details.append(working(current.queries(), current.explain || [], results))
  })
  const card = h(
    'article',
    { class: `card ${cls}`, 'data-key': `${cls}|${title}` },
    h('h3', { class: 'card__title', text: title }),
    sub && h('p', { class: 'card__sub', text: sub }),
    body,
    found,
    spec.method && methodEl,
    h('div', { class: 'card__foot' }, h('span', { text: note || '' }), details)
  )
  card.__spec = spec
  const settle = (mine) => {
    // Every card on the view has answered, loaded or not: screenshots wait on this.
    if (mine === epoch && [...document.querySelectorAll('#main .card')].every((c) => c.dataset.loaded || c.querySelector('.state--error, .state:not(.state--loading)'))) $('#main').dataset.settled = String(epoch)
  }
  // Loaded once, a card is drawn again in place: its chart stays, dimmed, until the new rows arrive, then moves.
  const run = (updating) => {
    const mine = epoch
    const s = current
    card.__loaded = true
    if (updating) card.classList.add('is-updating')
    return Promise.all(s.queries().map(query))
      .then((rs) => {
        if (mine !== epoch) return
        results = rs
        const was = updating ? snapshot(body) : null
        if (updating) {
          // Emptying the body while a mark in it has focus makes the browser lay out a shorter page and clamp the
          // scroll; so the focus goes first, and the body keeps its height until the new chart is in.
          if (body.contains(document.activeElement)) document.activeElement.blur()
          body.style.minHeight = `${was.height}px`
          body.__pool = [...body.querySelectorAll('.chart')]
        }
        body.replaceChildren()
        if (!results[0]?.length) {
          body.style.minHeight = ''
          body.append(h('div', { class: 'state', text: 'Nothing matches these filters.' }))
          return
        }
        const drawn = s.draw(results, body)
        try {
          if (s.finding) found.replaceChildren(...prose(s.finding(results)))
        } catch (err) {
          found.replaceChildren()
          console.error(`[${title}] finding`, err)
        }
        return Promise.resolve(drawn).then(() => {
          body.__pool = null
          body.style.minHeight = ''
          if (was) settleInPlace(body, was)
        })
      })
      .then(() => {
        if (mine === epoch) card.dataset.loaded = '1'
      })
      .finally(() => {
        if (mine === epoch) card.classList.remove('is-updating')
        settle(mine)
      })
      .catch((err) => {
        if (mine !== epoch) return
        body.replaceChildren(h('div', { class: 'state state--error', text: `Could not load: ${err.message}` }))
        console.error(`[${title}]`, err)
      })
  }
  card.__load = () => run(false)
  // A card not loaded yet takes the new scope now and draws with it when it comes into view.
  card.__respec = (next) => {
    current = next
    card.__spec = next
    if (next.method) methodEl.textContent = next.method
  }
  card.__update = (next) => {
    current = next
    card.__spec = next
    if (next.method) methodEl.textContent = next.method
    details.open = false
    return run(true)
  }
  return card
}

/** What a card body showed before it is drawn again: its height, its numbers, and where each ranked row sat. */
function snapshot(body) {
  const rows = new Map()
  for (const tr of body.querySelectorAll('tr[data-id]')) {
    const bar = tr.querySelector('.rt__bar i')
    rows.set(tr.dataset.id, { top: tr.getBoundingClientRect().top, bar: bar ? bar.getBoundingClientRect().width : null, num: tr.querySelector('.rt__bar span')?.textContent })
  }
  return { height: body.offsetHeight, numbers: [...body.querySelectorAll('.kpi__value')].map((n) => n.textContent), rows }
}

/** After a card is drawn again: its height eases to the new one, numbers count to their new values, rows slide to their new places. */
function settleInPlace(body, was) {
  if (!C.MOTION) return
  const easing = 'cubic-bezier(.2,.7,.3,1)'
  const height = body.offsetHeight
  if (Math.abs(height - was.height) > 4) body.animate([{ height: `${was.height}px`, overflow: 'hidden' }, { height: `${height}px`, overflow: 'hidden' }], { duration: C.DUR, easing })
  ;[...body.querySelectorAll('.kpi__value')].forEach((n, i) => was.numbers[i] !== undefined && C.countTo(n, was.numbers[i], n.textContent))
  for (const tr of body.querySelectorAll('tr[data-id]')) {
    const old = was.rows.get(tr.dataset.id)
    if (!old) {
      tr.animate([{ opacity: 0 }, { opacity: 1 }], { duration: C.DUR, easing })
      continue
    }
    const dy = old.top - tr.getBoundingClientRect().top
    if (Math.abs(dy) > 1) tr.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: C.DUR, easing })
    const bar = tr.querySelector('.rt__bar i')
    if (bar && old.bar !== null) bar.animate([{ width: `${old.bar}px` }, { width: `${bar.getBoundingClientRect().width}px` }], { duration: C.DUR, easing })
    const num = tr.querySelector('.rt__bar span')
    if (num && old.num) C.countTo(num, old.num, num.textContent)
  }
}

function working(qs, explain, results) {
  const cell = (v) => (v === null || v === undefined ? '∅' : typeof v === 'number' ? String(Number.isInteger(v) ? v : Number(v.toPrecision(4))) : String(v))
  return h('div', { class: 'working' }, ...qs.map((q, i) => {
    const rows = results[i] || []
    const cols = rows.length ? Object.keys(rows[0]) : []
    return h('div', { class: 'working__item' },
      explain[i] && h('p', { text: explain[i] }),
      h('pre', { text: q }),
      h('span', { text: `${rows.length} row${rows.length === 1 ? '' : 's'}${rows.length > 100 ? ', the first 100 shown' : ''}` }),
      cols.length && h('button', { type: 'button', class: 'btn btn--small', text: 'Download CSV', onclick: () => downloadCsv(rows, cols, i) }),
      cols.length && h('div', { class: 'working__rows' }, h('table', {},
        h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', { text: c })))),
        h('tbody', {}, ...rows.slice(0, 100).map((r) => h('tr', {}, ...cols.map((c) => h('td', { class: typeof r[c] === 'number' ? 'num' : null, text: cell(r[c]) }))))))))
  }))
}

/** Every row a query returned, as a CSV file the reader saves: the numbers behind a card, unrounded. */
function downloadCsv(rows, cols, i) {
  const cell = (v) => {
    const t = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"` : t
  }
  const text = [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n')
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: `${(document.title || 'data').replace(/[^\w]+/g, '-').toLowerCase()}-${i + 1}.csv` })
  document.body.append(a)
  a.click()
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 0)
}

const prose = (parts) =>
  !parts ? [] : typeof parts === 'string' ? [parts] : parts.map((p) => (p && typeof p === 'object' ? h('strong', { text: String(p.b ?? '') }) : String(p ?? '')))

/** A chart's box in a card; drawn again in place, the card's earlier boxes are reused in order, so a chart can move. */
const chartBox = (body, size = '') => {
  const reuse = body.__pool?.shift()
  if (!reuse) return body.appendChild(h('div', { class: `chart ${size}` }))
  reuse.className = `chart ${size}`
  return body.appendChild(reuse)
}

const section = (title, sub, ...cards) =>
  h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h2', { text: title }), h('p', { text: sub })), h('div', { class: 'grid-2' }, ...cards))

// ---- The scope bar ----

const SCOPED = new Set(['explore', 'records', 'compare', S.ENTITY.view])

function renderScope() {
  const bar = $('#scope')
  bar.hidden = !SCOPED.has(route.view)
  if (bar.hidden) return
  const controls = []
  for (const [key, spec] of Object.entries(S.SCOPE)) {
    if (route.view === S.ENTITY.view && (key === 'county' || key === 'region')) continue
    const values = key === 'month' ? known.month : known[key]
    const blank = key === 'group' ? [] : [h('option', { value: '', text: key === 'period' ? 'both periods' : `any ${key === 'month' ? 'month' : key}` })]
    const sel = h('select', { 'aria-label': key, onchange: (e) => setScope({ [key]: e.target.value === '' ? null : e.target.value }) },
      ...blank,
      ...values.map((v) => h('option', { value: v, text: key === 'month' ? S.monthLabel(v) : key === 'group' && v === S.ALL_GROUPS ? 'all vehicles' : v.toLowerCase(), selected: scope[key] === v })))
    controls.push(h('label', {}, spec.word, sel))
  }
  const had = new Set([...document.querySelectorAll('#scope-bar .chip')].map((c) => c.dataset.label))
  const chips = h('div', { class: 'chips' }, ...S.scopeChips(scope).map((c) =>
    h('span', { class: `chip${had.has(c.label) || !C.MOTION ? '' : ' is-new'}`, 'data-label': c.label }, c.label, h('button', { type: 'button', 'aria-label': `Clear ${c.label}`, text: '×', onclick: () => setScope(c.clear) }))))
  const end = h('div', { class: 'scope__end' },
    h('button', { class: 'btn', type: 'button', text: 'Reset', onclick: () => setScope({ ...S.DEFAULT_SCOPE }) }),
    h('button', { class: 'btn btn--primary', type: 'button', text: 'Copy link', onclick: () => navigator.clipboard?.writeText(location.href) }))
  $('#scope-bar').replaceChildren(...controls, chips, end)
}

// ---- Search ----

function wireSearch() {
  const input = $('#search')
  const list = $('#search-list')
  let hits = []
  let active = -1
  const close = () => {
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
    active = -1
  }
  const show = () => {
    list.replaceChildren(...hits.map((id, i) =>
      h('li', { role: 'option', id: `opt-${i}`, 'aria-selected': String(i === active), text: S.ENTITY.label(id), onmousedown: (e) => (e.preventDefault(), pick(id)) })))
    list.hidden = !hits.length
    input.setAttribute('aria-expanded', String(!list.hidden))
    input.setAttribute('aria-activedescendant', active >= 0 ? `opt-${active}` : '')
  }
  const pick = (id) => {
    input.value = ''
    close()
    openEntity(id)
  }
  input.addEventListener('input', () => {
    const t = input.value.trim().toLowerCase()
    const label = (id) => S.ENTITY.label(id).toLowerCase()
    const starts = t ? known.entity.filter((id) => label(id).startsWith(t) || label(id).includes(` ${t}`) || label(id).includes(`(${t}`)) : []
    hits = t ? [...starts, ...known.entity.filter((id) => label(id).includes(t) && !starts.includes(id))].slice(0, 8) : []
    active = hits.length ? 0 : -1
    show()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length)
      show()
    } else if (e.key === 'Enter' && active >= 0) pick(hits[active])
    else if (e.key === 'Escape') close()
  })
  input.addEventListener('blur', close)
}

// ---- Render ----

// ---- Keeping the reader's place: what they clicked stays where it was on screen while cards above it change ----

let lastCard = null
addEventListener('pointerdown', (e) => { lastCard = e.target.closest?.('#main .card') || null }, true)
addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') lastCard = e.target.closest?.('#main .card') || null }, true)
let keeping = null
/** Hold `anchor` at its place on screen for a moment, as the cards around it draw again; the reader scrolling ends it. */
function keepInView(anchor, ms = 1600) {
  keeping?.()
  if (!anchor) return
  const want = anchor.getBoundingClientRect().top
  let live = true
  const stop = () => {
    live = false
    for (const t of ['wheel', 'touchmove', 'keydown']) removeEventListener(t, stop, true)
    keeping = null
  }
  for (const t of ['wheel', 'touchmove', 'keydown']) addEventListener(t, stop, { capture: true, passive: true })
  keeping = stop
  const t0 = performance.now()
  const hold = () => {
    if (!live || !anchor.isConnected) return
    const off = anchor.getBoundingClientRect().top - want
    if (Math.abs(off) > 0.5) scrollBy(0, off)
    if (performance.now() - t0 < ms) requestAnimationFrame(hold)
    else stop()
  }
  hold()
  requestAnimationFrame(hold)
}

let shownView = null
/** A filter change keeps the view and draws its cards again in place; another view fades in over the last one. */
function render({ toTop = false } = {}) {
  // The compare list is part of the view: adding or removing an entity redraws its picker and chips, not only its cards.
  const here = `${route.view}|${route.id ?? ''}|${(route.compare ?? []).join(',')}`
  const same = C.MOTION && shownView === here
  const first = shownView === null
  shownView = here
  if (!same && !first && C.MOTION && document.startViewTransition) {
    document.startViewTransition(() => paint({ toTop, same }))
    return
  }
  paint({ toTop, same })
}

function paint({ toTop, same }) {
  epoch++
  io.disconnect()
  delete $('#main').dataset.settled
  for (const a of document.querySelectorAll('.app-nav a')) {
    a.href = a.dataset.view === 'compare' ? linkTo('compare', null, [...compareSet]) : linkTo(a.dataset.view)
    const on = a.dataset.view === route.view || (a.dataset.view === 'explore' && route.view === S.ENTITY.view)
    if (on) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
  renderScope()
  const views = { overview, explore, records, compare, about, [S.ENTITY.view]: entity }
  const next = views[route.view]()
  // The same view with a new scope: every card stays where it is in the page and draws again in place. Nothing is
  // moved out of the document, which would drop the focus a click gave a mark and let the browser clamp the scroll.
  const here = [...document.querySelectorAll('#main .card')]
  const fresh = [...next.querySelectorAll('.card')]
  const byKey = new Map(here.map((c) => [c.dataset.key, c]))
  if (same && fresh.length === here.length && fresh.every((c) => c.__spec && byKey.has(c.dataset.key))) {
    const visible = here.find((c) => c.getBoundingClientRect().bottom > 0)
    const anchor = lastCard && here.includes(lastCard) && lastCard.getBoundingClientRect().bottom > 0 && lastCard.getBoundingClientRect().top < innerHeight ? lastCard : visible
    const want = anchor?.getBoundingClientRect().top
    for (const c of fresh) {
      const old = byKey.get(c.dataset.key)
      if (old.__loaded) old.__update(c.__spec)
      else old.__respec(c.__spec)
    }
    if (anchor) {
      scrollBy(0, anchor.getBoundingClientRect().top - want)
      keepInView(anchor)
    }
  } else {
    const y = scrollY
    $('#main').replaceChildren(next)
    if (!toTop) scrollTo(0, y)
  }
  const cards = [...document.querySelectorAll('#main .card')].filter((c) => c.__load && !c.__loaded)
  cards.forEach((c) => io.observe(c))
  // Cards further down load on their own once the first screen has had its turn,
  // so a section is ready by the time a reader scrolls to it.
  const settledEpoch = epoch
  setTimeout(() => {
    if (settledEpoch !== epoch) return
    cards.forEach((c) => {
      if (c.__loaded) return
      io.unobserve(c)
      c.__load()
    })
  }, 1500)
  if (!document.querySelector('#main .card') && route.view !== 'about') $('#main').dataset.settled = String(epoch)
  if (toTop) {
    $('.app-header').scrollIntoView({ block: 'start' })
    $('#main').focus({ preventScroll: true })
  }
}

// ---- The headline check: open the app at ?check=1#/ and the page says whether its headline is the model's ----

async function selfCheck() {
  const card = await new Promise((done) => {
    const look = () => { const c = $('#main .card'); if (c?.dataset.loaded) done(c); else setTimeout(look, 200) }
    look()
  })
  const fails = []
  const qs = card.__spec.queries()
  for (const q of qs) if (!/^run: \w+ -> \w+$/.test(q)) fails.push(`The headline card adds to a view: ${q}`)
  const values = (await Promise.all(qs.map(query))).flat().flatMap((r) => Object.values(r)).filter((v) => typeof v === 'number')
  // A number shown agrees with a model value when the value, or its percentage, rounds to it at the shown decimals.
  const agrees = (t) => {
    const m = /([−-]?)([\d,]*\.?\d+)/.exec(t)
    const n = Number(m[2].replace(/,/g, '')) * (m[1] ? -1 : 1)
    const d = (m[2].split('.')[1] || '').length
    const near = (v) => Math.abs(v - n) <= 0.5 * 10 ** -d + 1e-9 || Math.abs(Math.abs(v) - Math.abs(n)) <= 0.5 * 10 ** -d + 1e-9
    return values.some((v) => near(v) || near(v * 100))
  }
  const shown = [...document.querySelectorAll('.answer strong, .answer b')].concat([...card.querySelectorAll('.kpi__value, .kpi__sub strong')]).map((n) => n.textContent).filter((t) => /\d/.test(t))
  for (const t of shown) if (!agrees(t)) fails.push(`"${t}" is not a value the headline queries return`)
  const text = document.body.innerText
  for (const bad of [/\bundefined\b/, /\bNaN\b/, /\bTODO\b/, /placeholder/i, /returned no text/i]) if (bad.test(text)) fails.push(`The page says ${bad}`)
  if (!qs.length || !shown.length) fails.push('The headline card shows no queries or no numbers to check')
  document.body.dataset.check = fails.length ? 'fail' : 'ok'
  document.body.prepend(h('pre', { class: 'self-check', text: fails.length ? `Headline check failed:\n${fails.join('\n')}` : `Headline check passed: ${shown.length} numbers from ${qs.length} bare views of the model.` }))
}

async function boot() {
  wireSearch()
  try {
    const [groups, months, periods, regions, counties, makes, bodies] = await Promise.all([
      query(`run: ${S.REG} -> { group_by: vehicle_group; order_by: vehicle_group }`),
      query(`run: ${S.REG} -> { group_by: m is reg_month; order_by: m; limit: 100 }`),
      query(`run: ${S.REG} -> { group_by: credit_period; order_by: credit_period desc }`),
      query(`run: ${S.REG} -> { group_by: region; order_by: region }`),
      query(`run: ${S.REG} -> { group_by: county_name; order_by: county_name; limit: 200 }`),
      query(`run: ${S.EV} -> { group_by: make_name; aggregate: ev_count; order_by: ev_count desc; limit: 1000 }`),
      query(`run: ${S.EV} -> { group_by: body_type; aggregate: ev_count; order_by: ev_count desc; limit: 100 }`),
    ])
    const values = (rows, f) => rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined)
    known.group = [S.ALL_GROUPS, ...values(groups, 'vehicle_group').filter((g) => g !== 'Trailers')]
    known.month = values(months, 'm').map(ym)
    known.period = values(periods, 'credit_period')
    known.region = values(regions, 'region')
    known.county = values(counties, 'county_name')
    known.make = values(makes, 'make_name')
    known.body = values(bodies, 'body_type')
    known.entity = known.county
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  route.compare.forEach((id) => compareSet.add(id))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(...footer())
  // How fresh the page is, from the data itself: the latest month the model holds.
  if (known.month.length) $('#data-through').textContent = `Data through ${S.monthLabel(known.month.at(-1))}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Shared pieces ----

function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || (route.view === S.ENTITY.view ? 'County' : '')
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}

const monthIndexAfter = (labels) => labels.findIndex((l) => l >= '2025-10')

/** The monthly share as a line, the months after the credit shaded. */
function shareLine(body, rows, { extra = [], height, label, name = 'EV share' } = {}) {
  const labels = rows.map((r) => S.monthLabel(r.reg_month))
  const first = rows.find((r) => r.credit_period === AFTER)
  const band = first ? { from: S.monthLabel(first.reg_month), to: labels[labels.length - 1], label: 'After the credit' } : undefined
  return C.lines(chartBox(body), labels, [{ name, values: rows.map((r) => r.ev_share), color: '--accent', width: 2.5 }, ...extra], {
    format: pct, band, height, label: label || 'Electric share of new registrations by month',
    onPick: (l) => { const i = labels.indexOf(l); if (i >= 0) setScope({ month: ym(rows[i].reg_month) }) },
  })
}

function kpi(label, value, sub, spark, accent = false) {
  const svg = spark ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : null
  const el = h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), h('div', { class: 'kpi__sub' }, ...prose(sub)), svg)
  if (spark) requestAnimationFrame(() => C.sparkline(svg, spark.values, spark.color || '--accent', { band: spark.band }))
  return el
}

const COUNTY_MAP = './vendor/maps/ny-counties.json'

function countyMap(body, rows, field, { legendTitle, format = pct, onPick, selected, count: countField = 'ev_registrations' } = {}) {
  const evsOf = new Map(rows.map((r) => [r.county_map_name, r[countField]]))
  const byMap = new Map(rows.filter((r) => r.county_map_name && r.county_map_name !== 'Out-of-state' && r[field] !== null).map((r) => [r.county_map_name, r[field]]))
  const nameOf = new Map(rows.map((r) => [r.county_map_name, r.county_name]))
  const selMap = rows.find((r) => r.county_name === selected)?.county_map_name ?? null
  return C.loadTopo(COUNTY_MAP).then((topo) =>
    C.choropleth(chartBox(body), topo, byMap, {
      object: 'counties', key: (f) => f.properties.name, format, legendFormat: format, legendTitle, selected: selMap, label: 'Map of New York counties',
      onPick: (k) => onPick?.(nameOf.get(k) || k), linkOf: (k) => nameOf.get(k) || k, tip: (k) => [...(nameOf.get(k) && nameOf.get(k) !== k ? [nameOf.get(k)] : []), Number.isFinite(evsOf.get(k)) ? `${C.fmt(evsOf.get(k))} EVs` : ''],
    }))
}

function countyTable(body, rows, trends, { limit = 10, onOpen = openEntity, href = (id) => linkTo(S.ENTITY.view, id) } = {}) {
  return C.rankTable(body, rows.map((r) => ({ id: r.county_name, name: r.county_name, sub: r.region, value: r.ev_registrations, trend: trends.get(r.county_name) || [], change: r.has_enough_evs === false ? null : r.ev_share_change })), {
    valueLabel: 'EVs registered', trendLabel: 'Monthly EV share', changeLabel: 'Share change', changeFormat: (v) => (Number.isFinite(v) ? `${Math.abs(v * 100).toFixed(1)} pts` : 'n/a'), good: null, limit,
    band: trends.size ? [known.month.indexOf('2025-10'), known.month.length - 1] : undefined,
    selected: scope.county, onOpen, href, inCompare, onCompare: toggleCompare,
  })
}
const trendsOf = (rows) => {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.county_name)) m.set(r.county_name, [])
    m.get(r.county_name).push(r.ev_share)
  }
  return m
}

// ---- Overview: the brief's question and its answer ----

const ARTICLES = [
  { title: 'U.S. EV Market Slows in 2025 Despite Record Model Availability and Rising Infrastructure Challenges', outlet: 'EMobility+', date: '26 March 2026', url: 'https://emobilityplus.com/2026/03/26/u-s-ev-market-slows-in-2025-despite-record-model-availability-and-rising-infrastructure-challenges/' },
]

// ---- Saying what the rows say: every sentence on a card is written from its query's rows ----

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const count = (n, one, many = `${one}s`) => `${n < WORDS.length ? WORDS[n] : C.fmt(n)} ${n === 1 ? one : many}`
/** 'Nov 2024 to Sep 2025': the first and last month of the rows given. */
const span = (rows, field = 'reg_month') => (rows.length ? `${S.monthLabel(rows[0][field])} to ${S.monthLabel(rows[rows.length - 1][field])}` : '')
const ptsWord = (v) => `${Math.abs(v * 100).toFixed(Math.abs(v * 100) < 0.1 ? 2 : 1)} points`
const moved = (v) => (v < 0 ? 'fell' : v > 0 ? 'rose' : 'held')

function overview() {
  // The headline sources carry the question's scope (passenger cars); the app adds no filter to them.
  const run = (source, view) => `run: ${source} -> ${view}`
  const qK = run(S.HEADLINE, 'kpis')
  const qL = run(S.HEADLINE, 'like_for_like')
  const qY = run(S.HEADLINE, 'vs_year_before')
  const qP = run(S.HEADLINE, 'by_credit_period')
  const qM = run(S.HEADLINE, 'by_month')
  const qC = run(S.HEADLINE, 'by_county')
  const qT = run(S.HEADLINE, 'county_by_month')
  const qMk = `${run(S.HEADLINE_EV, 'by_make')} + { order_by: ev_count desc; limit: 12 }`
  const answer = h('p', { class: 'answer' })
  Promise.all([query(qK), query(qL)]).then(([[k], [l]]) => {
    const clean = l.clean_change
    const verdict = k.ev_share_change < 0 && clean < 0 ? 'Yes.' : k.ev_share_change > 0 && clean > 0 ? 'No.' : 'It depends on the comparison.'
    answer.replaceChildren(...prose([`${verdict} Battery-electric cars were `, { b: pct(k.ev_share_with_credit) }, ` of new passenger-car registrations in the ${count(k.months_with_credit, 'month')} with the credit and `, { b: pct(k.ev_share_after_credit) }, ` in the ${count(k.months_after_credit, 'month')} after it. `,
      `Against the same months a year earlier, leaving out the rush in the three months before the deadline, the share ${moved(clean)} by `, { b: ptsWord(clean) }, ` over ${count(l.clean_months, 'month')}.`]))
  }).catch(() => answer.replaceChildren())
  const [kicker, title, lede] = viewHead('Did New York’s EV registrations fall when the federal tax credit ended?',
    'The federal clean vehicle credit, up to $7,500 for a new EV and $4,000 for a used one, ended for vehicles bought after 30 September 2025. New York’s DMV publishes every registration, so the months either side of the deadline can be counted.').filter(Boolean)
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    h('p', {}, askButton('How did the battery-electric share of new passenger-car registrations in New York change after the federal EV tax credit ended on 30 September 2025, like for like against the same months a year earlier, and which counties changed most?', () => [qK, qL, qC])),
    tile({
      title: 'The answer in four numbers', cls: 'card--kpis',
      queries: () => [qK, qL, qM, qP],
      explain: ['The battery-electric share of new passenger-car registrations, with and after the credit, and the months each period holds.', 'The same months a year apart: the share after the credit against a year earlier, with and without the deadline quarter.', 'The share and counts month by month, for the sparklines and the periods.', 'Registrations per month in each period.'],
      draw: ([[k], [l], months, periods], body) => {
        const w = periods.find((r) => r.credit_period === WITH)
        const a = periods.find((r) => r.credit_period === AFTER)
        const withRows = months.filter((r) => r.credit_period === WITH)
        const afterRows = months.filter((r) => r.credit_period === AFTER)
        const iA = months.findIndex((r) => r.credit_period === AFTER)
        const share = months.map((r) => r.ev_share)
        const evs = months.map((r) => r.ev_registrations)
        const clean = l.clean_change
        body.append(h('div', { class: 'kpis' },
          kpi('EV share with the credit', pct(k.ev_share_with_credit), `of new passenger cars, ${span(withRows)}`, { values: share, band: [0, iA - 1], color: '--c3' }),
          kpi('EV share after it ended', pct(k.ev_share_after_credit), [{ b: pts(k.ev_share_change) }, ` on the months with the credit, ${span(afterRows)}`], { values: share, band: [iA, share.length - 1] }, true),
          kpi('Like for like', pts(clean), [`${count(l.clean_months, 'month')} after the credit against the same months a year earlier, the deadline quarter left out; `, { b: pts(l.matched_change) }, ' with it in']),
          kpi('EVs registered per month', `${C.fmt(Math.round(a.ev_per_month))}`, `after the credit, against ${C.fmt(Math.round(w.ev_per_month))} with it`, { values: evs, band: [iA, evs.length - 1], color: '--c-bar' })))
      },
      method: 'Passenger-car class only, battery-electric only: the DMV files plug-in hybrids under gasoline. A registration is a vehicle newly registered in New York, used cars brought in from another state included; the DMV publishes no new-or-used flag. The two periods differ in length and season, so the like-for-like number is the fairer size of the change.',
    }),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Each month against the same month a year earlier', cls: 'span-2',
        sub: 'The battery-electric share of new passenger cars after the credit, beside the same month a year before. Shaded: a year earlier was the rush before the deadline.',
        queries: () => [qY],
        explain: ['Each month’s share beside the share twelve months earlier, and whether that earlier month was in the deadline quarter.'],
        draw: ([rows], body) => {
          const both = rows.filter((r) => r.share_year_before !== null)
          const labels = both.map((r) => S.monthLabel(r.reg_month))
          const rush = both.filter((r) => r.year_before_in_deadline_quarter)
          return C.lines(chartBox(body), labels, [
            { name: 'After the credit', values: both.map((r) => r.ev_share), color: '--accent', width: 2.5 },
            { name: 'A year earlier', values: both.map((r) => r.share_year_before), color: '--c-bar', dashed: true },
          ], {
            format: pct, height: 300, label: 'Battery-electric share by month, after the credit and a year earlier',
            band: rush.length ? { from: S.monthLabel(rush[0].reg_month), to: S.monthLabel(rush[rush.length - 1].reg_month), label: 'A year earlier: the rush' } : undefined,
            onPick: (lb) => go({ view: 'explore', id: null, compare: [] }, { ...S.DEFAULT_SCOPE, month: ym(both[labels.indexOf(lb)].reg_month) }),
          })
        },
        finding: ([rows]) => {
          const both = rows.filter((r) => r.share_year_before !== null && !r.year_before_in_deadline_quarter)
          if (both.length < 2) return ''
          const gap = (r) => r.ev_share - r.share_year_before
          const widest = both.reduce((b, r) => (gap(r) < gap(b) ? r : b))
          const narrowest = both.reduce((b, r) => (Math.abs(gap(r)) < Math.abs(gap(b)) ? r : b))
          return ['Outside the rush, the gap to a year earlier was widest in ', { b: S.monthLabel(widest.reg_month) }, `, ${pts(gap(widest))}, and narrowest in `, { b: S.monthLabel(narrowest.reg_month) }, `, ${pts(gap(narrowest))}.`]
        },
        method: 'Each point compares one month with the same calendar month a year earlier, so the season is the same on both sides. The data begins in the first full month the DMV’s two-year window holds, so the earliest months after the credit have no year-earlier match.',
      }),
      tile({
        title: 'EV share of new passenger-car registrations, month by month', cls: 'span-2',
        sub: 'Click a month to explore it. The shaded months are after the credit ended.',
        queries: () => [qM, qK],
        explain: ['Battery-electric and all new passenger-car registrations and the share, per month.', 'The share with and after the credit, for the reference lines.'],
        draw: ([rows, [k]], body) => {
          const labels = rows.map((r) => S.monthLabel(r.reg_month))
          const iA = rows.findIndex((r) => r.credit_period === AFTER)
          return C.lines(chartBox(body), labels, [{ name: 'EV share', values: rows.map((r) => r.ev_share), color: '--accent', width: 2.5 }], {
            format: pct, band: iA >= 0 ? { from: labels[iA], to: labels[labels.length - 1], label: 'After the credit' } : undefined, height: 300,
            refs: [{ y: k.ev_share_with_credit, label: `With the credit, ${pct(k.ev_share_with_credit)}` }, { y: k.ev_share_after_credit, label: `After, ${pct(k.ev_share_after_credit)}` }],
            label: 'Battery-electric share of new passenger-car registrations by month',
            onPick: (l) => go({ view: 'explore', id: null, compare: [] }, { ...S.DEFAULT_SCOPE, month: ym(rows[labels.indexOf(l)].reg_month) }),
          })
        },
        finding: ([rows]) => {
          const peak = rows.reduce((b, r) => (r.ev_share > b.ev_share ? r : b), rows[0])
          const low = rows.reduce((b, r) => (r.ev_share < b.ev_share ? r : b), rows[0])
          const lastWith = rows.filter((r) => r.credit_period === WITH).at(-1)
          return ['The share peaked in ', { b: S.monthLabel(peak.reg_month) }, ` at ${pct(peak.ev_share)}${peak === lastWith ? ', the last month of the credit,' : ''} and was lowest in `, { b: S.monthLabel(low.reg_month) }, ` at ${pct(low.ev_share)}.`]
        },
        method: 'Months run from the first full month the DMV’s two-year window holds to the last complete month.',
      }),
      tile({
        title: 'Where: EV share after the credit, by county',
        sub: 'Click a county to open its page.',
        queries: () => [qC, qM],
        explain: ['Each county’s battery-electric share of new passenger-car registrations, with and after the credit, and its counts.', 'The months, for the legend’s period.'],
        draw: ([rows, months], body) => countyMap(body, rows, 'ev_share_after_credit', { legendTitle: `EV share, ${span(months.filter((r) => r.credit_period === AFTER))}`, onPick: openEntity, count: 'ev_after_credit' }),
        finding: ([rows]) => {
          const inState = rows.filter((r) => r.county_map_name !== 'Out-of-state' && r.has_enough_evs)
          const top = inState.reduce((b, r) => (r.ev_share_after_credit > b.ev_share_after_credit ? r : b), inState[0])
          return [{ b: top.county_name }, ` had the highest EV share after the credit, ${pct(top.ev_share_after_credit)}, of ${C.fmt(top.ev_after_credit)} EVs.`]
        },
        method: 'Colour classes are quintiles of the counties shown. The county is where the registrant lives; registrants living out of state are left off the map and kept in the table.',
      }),
      tile({
        title: 'Counties by EVs registered',
        sub: 'Each county’s EVs, its monthly share and how its share moved. Click a row to open the county.',
        queries: () => [qC, qT],
        explain: ['Each county’s battery-electric registrations, its share with and after the credit, and whether each period has enough EVs to compare.', 'Each county’s share month by month, for the trend lines.'],
        draw: ([rows, t], body) => countyTable(body, rows, trendsOf(t)),
        finding: ([rows]) => {
          const enough = rows.filter((r) => r.has_enough_evs)
          return [{ b: `${enough.filter((r) => r.ev_share_change < 0).length} of ${enough.length}` }, ' places with enough EVs to compare had a lower share after the credit than with it', enough.length < rows.length ? `; ${count(rows.length - enough.length, 'place')} had too few in a period, so no change is shown.` : '.']
        },
        method: 'The change is the share after the credit minus the share with it, in percentage points, shown only where each period has enough EVs for the change to mean something (the model’s has_enough_evs).',
      })),
    section('Where to look next', 'Two places the numbers lead.',
      tile({
        title: 'The largest make, with the credit and after',
        queries: () => [qMk],
        explain: ['Each make’s share of battery-electric passenger-car registrations, with and after the credit.'],
        draw: ([rows], body) => {
          const t = rows[0]
          body.append(h('p', { class: 'card__sub' }, ...prose([{ b: t.make_name }, ` was ${pct(t.share_with_credit)} of EVs registered with the credit and ${pct(t.share_after_credit)} after it: its share ${moved(t.share_after_credit - t.share_with_credit)}.`])),
            h('p', {}, h('a', { href: linkTo('explore') + '#what', text: 'Makes and body types →' })))
        },
        method: 'Shares of battery-electric passenger-car registrations in each period.',
      }),
      tile({
        title: 'The deadline rush, day by day',
        queries: () => [qY],
        explain: ['Battery-electric registrations per month, and which months were the three before the deadline.'],
        draw: ([rows], body) => {
          const peak = rows.reduce((b, r) => (r.ev_registrations > b.ev_registrations ? r : b), rows[0])
          const rush = rows.filter((r) => r.in_deadline_quarter)
          body.append(h('p', { class: 'card__sub' }, ...prose([{ b: C.fmt(peak.ev_registrations) }, ` EVs were registered in ${S.monthLabel(peak.reg_month)}, the most of any month${peak.in_deadline_quarter ? ', inside the three months before the deadline' : ''}.`])),
            h('p', {}, h('a', { href: S.buildHash({ view: 'explore' }, { ...S.DEFAULT_SCOPE, period: WITH }), text: `The calendar of registrations, ${span(rush)} →` })))
        },
        method: 'Passenger cars; dates are when the registration took effect.',
      }))
    ,
    h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h2', { text: 'In the news' }), h('p', { text: 'The article this app responds to.' })),
      h('ul', { class: 'articles' }, ...ARTICLES.map((a) => h('li', {}, h('a', { href: a.url, target: '_blank', rel: 'noopener', text: a.title }), h('span', { text: ` ${a.outlet}${a.date ? `, ${a.date}` : ''}` })))),
      h('p', { class: 'card__method', text: 'The EMobility+ article reports a national EV share of 9.6% of new light-duty sales in 2025, from the Alliance for Automotive Innovation. This app counts a different thing: battery-electric vehicles newly registered in New York, used cars included, from the state’s DMV, so its shares are lower and not comparable one to one.' })))
}

// ---- Explore ----

function explore() {
  const qBM = S.viewQuery(S.REG, 'by_month', scope, known, ['month', 'period'])
  const qDay = S.viewQuery(S.EV, 'by_day', scope, known, ['month', 'period'])
  const qC = S.viewQuery(S.REG, 'by_county', scope, known, ['county', 'region'])
  const qT = S.viewQuery(S.REG, 'county_by_month', scope, known, ['county', 'region', 'month', 'period'])
  const qR = S.viewQuery(S.REG, 'by_region', scope, known, ['region', 'period', 'month'])
  const qMk = S.viewQuery(S.EV, 'by_make', scope, known, ['make'], 'order_by: ev_count desc; limit: 15')
  const qB = S.viewQuery(S.EV, 'by_body', scope, known, ['body'])
  const qA = S.viewQuery(S.EV, 'by_model_year_age', scope, known)
  const qG = S.viewQuery(S.REG, 'by_vehicle_group', scope, known, ['group'])
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore the registrations', 'Click a bar, a month, a county or a make to filter every card; click it again to clear it. The sentence above the cards says what is in scope.'),
    h('p', {}, askButton('Which makes and counties drove the change in New York EV registrations after the federal credit ended?', () => [qMk, qC])),
    section('When', 'How registrations moved month by month and day by day.',
      tile({
        title: 'EVs registered per month', sub: 'Click a month to filter. The dashed line is the monthly average in the months with the credit.',
        queries: () => [qBM, S.viewQuery(S.REG, 'by_credit_period', scope, known, ['month', 'period'])],
        explain: ['Electric registrations per month under the scope (its month and period ignored).', 'Registrations per month in each period, for the reference lines.'],
        draw: ([rows, periods], body) => {
          const w = periods.find((r) => r.credit_period === WITH)
          const a = periods.find((r) => r.credit_period === AFTER)
          return C.bars(chartBox(body), rows.map((r) => ({ label: S.monthLabel(r.reg_month), value: r.ev_registrations, m: ym(r.reg_month) })), {
            color: '--c-bar', height: 260, selected: scope.month ? S.monthLabel(scope.month) : null,
            refs: w ? [{ value: w.ev_per_month, label: `Average with the credit, ${C.fmt(Math.round(w.ev_per_month))}` }] : [],
            onPick: (l) => toggleScope('month', rows.find((r) => S.monthLabel(r.reg_month) === l) ? ym(rows.find((r) => S.monthLabel(r.reg_month) === l).reg_month) : null),
            label: 'Electric registrations per month',
          })
        },
        finding: ([rows, periods]) => {
          const w = periods.find((r) => r.credit_period === WITH)
          const a = periods.find((r) => r.credit_period === AFTER)
          return w && a ? ['An average of ', { b: C.fmt(Math.round(w.ev_per_month)) }, ' a month with the credit, ', { b: C.fmt(Math.round(a.ev_per_month)) }, ' after it.'] : ''
        },
        method: methodFor(S.REG, 'Ignores the month and period filters, so every month stays in view and the selected one is highlighted. Averages are over the months each period holds: eleven with the credit, twelve after.'),
      }),
      tile({
        title: 'The calendar: EVs registered each day', sub: 'One row per month, one square per day. Click a month to filter.',
        queries: () => [qDay],
        explain: ['Electric registrations per day under the scope (its month and period ignored).'],
        draw: ([rows], body) => {
          const months = [...new Set(rows.map((r) => S.monthLabel(r.registration_date)))]
          const days = Array.from({ length: 31 }, (_, i) => String(i + 1))
          const cells = rows.map((r) => ({ row: S.monthLabel(r.registration_date), col: String(Number(String(r.registration_date).slice(8, 10))), value: r.ev_count }))
          const pickMonth = (row) => { const r = rows.find((x) => S.monthLabel(x.registration_date) === row); if (r) toggleScope('month', ym(r.registration_date)) }
          return C.heatmap(chartBox(body), months, days, cells, { onPick: (row) => pickMonth(row), onRow: pickMonth, selected: scope.month ? { row: S.monthLabel(scope.month) } : null, label: 'Electric registrations per day' })
        },
        finding: ([rows]) => {
          const top = rows.reduce((b, r) => (r.ev_count > b.ev_count ? r : b), rows[0])
          return ['The busiest day was ', { b: dateLabel(top.registration_date) }, `, with ${C.fmt(top.ev_count)} EVs registered.`]
        },
        method: 'Ignores the month and period filters, so the whole calendar stays in view. The date is when the registration took effect. Registrations recorded on weekends and holidays are few, so those squares are pale.',
      })),
    section('Where', 'Which counties register the most EVs, and where the share fell most.',
      tile({
        title: 'EV share by county', sub: 'Click a county to filter every card.',
        queries: () => [qC],
        explain: ['Each county’s electric share of new registrations under the scope (its county and region ignored).'],
        draw: ([rows], body) => countyMap(body, rows, 'ev_share', { legendTitle: 'EV share of new registrations', selected: scope.county, onPick: (c) => toggleScope('county', c) }),
        finding: ([rows]) => {
          const inState = rows.filter((r) => r.county_map_name !== 'Out-of-state' && r.ev_share !== null)
          const top = inState.reduce((b, r) => (r.ev_share > b.ev_share ? r : b), inState[0])
          const low = inState.reduce((b, r) => (r.ev_share < b.ev_share ? r : b), inState[0])
          return [{ b: top.county_name }, ` has the highest share in scope, ${pct(top.ev_share)}; `, { b: low.county_name }, ` the lowest, ${pct(low.ev_share)}.`]
        },
        method: methodFor(S.REG, 'Ignores the county and region filters, so the selected county is outlined among the rest. Colour classes are quintiles of the counties shown. Registrants living out of state have no shape.'),
      }),
      tile({
        title: 'Counties ranked', sub: 'Click a row to filter every card by that county; its name opens the county’s page, and + adds it to Compare.',
        queries: () => [qC, qT],
        explain: ['Each county’s electric registrations and share change under the scope.', 'Each county’s share by month, for the trend lines.'],
        draw: ([rows, t], body) => countyTable(body, rows, trendsOf(t), { onOpen: (id) => toggleScope('county', id) }),
        finding: ([rows]) => [{ b: rows[0].county_name }, ` registered the most EVs in scope, ${C.fmt(rows[0].ev_registrations)}.`],
        method: methodFor(S.REG, 'Ignores the county and region filters, so the selected county is marked among the rest. The change is the share after the credit minus the share with it, in percentage points; a month or period filter leaves one side empty.'),
      }),
      tile({
        title: 'Each county’s share, with the credit against after it', sub: 'Below the diagonal, the share fell. Click a county to filter every card.',
        queries: () => [S.viewQuery(S.REG, 'by_county', scope, known, ['county', 'region', 'month', 'period'])],
        explain: ['Each county’s electric share with the credit (x) and after it (y), under the scope (its month and period ignored: the card compares the two periods).'],
        draw: ([rows], body) => {
          const shown = rows.filter((r) => r.ev_share_with_credit !== null && r.ev_share_after_credit !== null && r.has_enough_evs !== false)
          C.scatterChange(chartBox(body), shown.map((r) => ({ id: r.county_name, label: r.county_name, x: r.ev_share_with_credit, y: r.ev_share_after_credit })), {
            xTitle: 'EV share with the credit', yTitle: 'EV share after it', format: pct, labelTop: 6, selected: scope.county, onPick: (c) => toggleScope('county', c), corners: { tl: '↖ higher after', br: 'lower after ↘' },
          })
          const few = rows.filter((r) => r.has_enough_evs === false).map((r) => r.county_name)
          if (few.length) body.append(h('p', { class: 'fx-left-out', text: `Too few EVs in a period to compare, so not drawn: ${few.join(', ')}.` }))
        },
        finding: ([rows]) => {
          const both = rows.filter((r) => r.ev_share_change !== null && r.has_enough_evs !== false)
          return both.length ? [{ b: `${both.filter((r) => r.ev_share_change < 0).length} of ${both.length}` }, ' places had a lower share after the credit than with it.'] : ''
        },
        method: methodFor(S.REG, 'Ignores the month and period filters. Associations in time, not causes: other things changed in these months too, such as new models and prices.'),
      }),
      tile({
        title: 'Regions, with and after the credit',
        queries: () => [qR],
        explain: ['Each region’s electric share with and after the credit.'],
        draw: ([rows], body) => C.dumbbell(chartBox(body), rows.map((r) => ({ id: r.region, label: r.region, a: r.ev_share_with_credit, b: r.ev_share_after_credit })), {
          aName: 'With the credit', bName: 'After', aColor: '--c3', bColor: '--c2', format: pct, diff: (r) => pts(rows.find((x) => x.region === r.id).ev_share_change), selected: scope.region, onPick: (id) => toggleScope('region', id),
        }),
        finding: ([rows]) => {
          const top = rows.reduce((b, r) => (r.ev_share_with_credit > b.ev_share_with_credit ? r : b), rows[0])
          return [{ b: top.region }, ` had the highest share with the credit, ${pct(top.ev_share_with_credit)}, and ${pct(top.ev_share_after_credit)} after it.`]
        },
        method: methodFor(S.REG, 'Ignores the region, month and period filters. Regions are this app’s grouping: the five boroughs, Nassau and Suffolk, the rest of the state, and registrants living out of state.'),
      })),
    h('div', { id: 'what' }),
    section('What was registered', 'Makes, body types and model years of the EVs, and who registered them.',
      tile({
        title: 'Makes', sub: 'The 15 makes with the most EVs in scope. Click a make to filter.',
        queries: () => [qMk],
        explain: ['Electric registrations per make under the scope (its make ignored), the 15 largest.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.make_name, value: r.ev_count })), { horizontal: true, direct: true, color: '--c-bar', selected: scope.make, onPick: (m) => toggleScope('make', m), label: 'Electric registrations by make' }),
        finding: ([rows]) => [{ b: rows[0].make_name }, ` is ${pct(rows[0].share_of_evs)} of the EVs in scope.`],
        method: 'Ignores the make filter, so the selected make is highlighted among the rest. Makes are the DMV’s codes spelled out for the common ones; rarer makes keep their code, such as BINTE.',
      }),
      tile({
        title: 'Each make’s share of EVs, with the credit and after', sub: 'The ten largest makes. Click a make to filter.',
        queries: () => [S.viewQuery(S.EV, 'by_make', scope, known, ['make', 'period', 'month'], 'order_by: ev_count desc; limit: 10')],
        explain: ['Each make’s share of electric registrations in the months with the credit and after.'],
        draw: ([rows], body) => C.slope(chartBox(body), rows.filter((r) => r.share_with_credit !== null && r.share_after_credit !== null).map((r) => ({ id: r.make_name, label: r.make_name, a: r.share_with_credit, b: r.share_after_credit })), {
          aName: 'With the credit', bName: 'After', format: pct, emph: [rows[0]?.make_name], selected: scope.make, onPick: (m) => toggleScope('make', m),
        }),
        finding: ([rows]) => {
          const t = rows[0]
          return t.share_with_credit !== null && t.share_after_credit !== null ? [{ b: t.make_name }, ` went from ${pct(t.share_with_credit)} of EVs with the credit to ${pct(t.share_after_credit)} after.`] : ''
        },
        method: 'Ignores the make, month and period filters. Shares of the EVs registered in each period, so the two periods’ different lengths do not matter.',
      }),
      tile({
        title: 'Body types', sub: 'Click a body type to filter.',
        queries: () => [qB],
        explain: ['Electric registrations per body type under the scope (its body type ignored).'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.slice(0, 8).map((r) => ({ label: r.body_type, value: r.ev_count })), { horizontal: true, direct: true, color: '--c-bar', selected: scope.body, onPick: (b) => toggleScope('body', b), label: 'Electric registrations by body type' }),
        finding: ([rows]) => [{ b: rows[0].body_type }, ` is the most common body, ${C.fmt(rows[0].ev_count)} EVs.`],
        method: 'Ignores the body filter, so the selected body is highlighted. The DMV’s SUBURBAN body covers SUVs and wagons. The eight largest body types are shown.',
      }),
      tile({
        title: 'Current or earlier model year', sub: 'A hundred squares: the EVs in scope by model year against the year registered.',
        queries: () => [qA],
        explain: ['Electric registrations whose model year is the registration year or later, and those older.'],
        draw: ([rows], body) => C.waffle(chartBox(body), rows.map((r, i) => ({ name: r.model_year_age, color: i === 0 ? '--accent' : '--c4', share: r.share_of_evs, value: r.ev_count })), { unit: 'EVs' }),
        finding: ([rows]) => {
          const old = rows.find((r) => r.model_year_age === 'Earlier model year')
          return old ? [{ b: pct(old.share_of_evs) }, ' of the EVs in scope carry an earlier model year than the year registered.'] : ''
        },
        method: 'Not a sign of a used car on its own: new stock of last year’s model year is still sold early in a year, so January runs high. The DMV does not say whether a vehicle is new or used.',
      }),
      tile({
        title: 'EV share by kind of vehicle', sub: 'Every registration class group. Click one to make it the scope.',
        queries: () => [qG],
        explain: ['Electric and all new registrations per class group, under the scope (its group ignored).'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.filter((r) => r.new_registrations > 0 && r.vehicle_group !== 'Trailers').map((r) => ({ label: r.vehicle_group, value: r.ev_share })), {
          horizontal: true, direct: true, format: pct, color: '--c-bar', selected: scope.group === S.ALL_GROUPS ? null : scope.group, onPick: (g) => setScope({ group: scope.group === g ? S.ALL_GROUPS : g }), label: 'Electric share by vehicle group',
        }),
        finding: ([rows]) => {
          const p = rows.find((r) => r.vehicle_group === 'Passenger cars')
          return p ? ['Passenger cars, the class the headline uses: ', { b: pct(p.ev_share) }, ' electric.'] : ''
        },
        method: methodFor(S.REG, 'Ignores the vehicle filter, so every group stays in view. In-transit permits let a vehicle be driven out of the state, and nearly all go to registrants living elsewhere, mostly buyers taking a car home, so they are kept apart from New York’s own cars. Trailers have no engine and are left out.'),
      })))
}

// ---- A county's page ----

function entity() {
  const id = route.id
  const qK = S.entityQuery(S.REG, 'kpis', id, scope, known)
  const qState = S.viewQuery(S.REG, 'kpis', scope, known, ['county', 'region'])
  const qM = S.entityQuery(S.REG, 'by_month', id, scope, known, '', ['month', 'period'])
  const qSM = S.viewQuery(S.REG, 'by_month', scope, known, ['county', 'region', 'month', 'period'])
  const qMk = S.entityQuery(S.EV, 'by_make', id, scope, known, 'order_by: ev_count desc; limit: 10', ['make'])
  const qRec = S.entityQuery(S.EV, 'records', id, scope, known, 'order_by: registration_date desc, county_name, make_name; limit: 10')
  const added = compareSet.has(id)
  return h('div', { class: 'view wrap' },
    ...viewHead(id, null, [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${id}`]),
    h('p', {},
      h('button', { class: 'btn', type: 'button', 'aria-pressed': String(added), text: added ? 'In Compare' : 'Add to compare', onclick: () => toggleCompare(id) }), ' ',
      compareSet.size ? h('a', { class: 'btn', href: linkTo('compare', null, [...compareSet]), text: `Compare ${compareSet.size} →` }) : null, ' ',
      askButton(`How did electric vehicle registrations in ${id} County, New York change after the federal EV tax credit ended, and how does it compare with the state?`, () => [qK, qState])),
    tile({
      title: `${id} against New York State`,
      queries: () => [qK, qState, qM],
      explain: ['This county’s electric share with and after the credit, under the scope.', 'The same for the whole state.', 'This county’s share by month, for the sparklines.'],
      draw: ([[k], [s], months], body) => {
        const iA = months.findIndex((r) => r.credit_period === AFTER)
        const share = months.map((r) => r.ev_share)
        body.append(h('div', { class: 'kpis' },
          kpi('EVs registered', C.fmt(k.ev_registrations), `of ${C.fmt(k.new_registrations)} new registrations`, { values: months.map((r) => r.ev_registrations), color: '--c-bar' }),
          kpi('EV share with the credit', pct(k.ev_share_with_credit), `state: ${pct(s.ev_share_with_credit)}`, { values: share, band: iA > 0 ? [0, iA - 1] : undefined, color: '--c3' }),
          kpi('EV share after it', pct(k.ev_share_after_credit), `state: ${pct(s.ev_share_after_credit)}`, { values: share, band: iA >= 0 ? [iA, share.length - 1] : undefined }, true),
          kpi('Change in share', pts(k.ev_share_change), `state: ${pts(s.ev_share_change)}`, null)))
      },
      finding: ([[k], [s]]) => [{ b: id }, `’s EV share went from ${pct(k.ev_share_with_credit)} to ${pct(k.ev_share_after_credit)}; the state’s from ${pct(s.ev_share_with_credit)} to ${pct(s.ev_share_after_credit)}.`],
      method: methodFor(S.REG, 'Registrations by where the registrant lives.'),
    }),
    h('div', { class: 'grid-2' },
      tile({
        title: 'EV share by month, against the state', cls: 'span-2', sub: 'Click a month to filter.',
        queries: () => [qM, qSM],
        explain: ['This county’s electric share by month.', 'The state’s, under the same scope.'],
        draw: ([rows, st], body) => {
          const byM = new Map(st.map((r) => [ym(r.reg_month), r.ev_share]))
          return shareLine(body, rows, { name: id, extra: [{ name: 'New York State', values: rows.map((r) => byM.get(ym(r.reg_month)) ?? null), color: '--c4', dashed: true }], label: `${id} and the state, electric share by month` })
        },
        finding: ([rows]) => {
          const peak = rows.reduce((b, r) => (r.ev_share > b.ev_share ? r : b), rows[0])
          return [{ b: id }, `’s share peaked in ${S.monthLabel(peak.reg_month)} at ${pct(peak.ev_share)}.`]
        },
        method: methodFor(S.REG, 'Small counties register few cars a month, so their share moves a lot from month to month.'),
      }),
      tile({
        title: 'Makes in this county', sub: 'Click a make to filter.',
        queries: () => [qMk],
        explain: ['Electric registrations per make in this county, the ten largest.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.make_name, value: r.ev_count })), { horizontal: true, direct: true, color: '--c-bar', selected: scope.make, onPick: (m) => toggleScope('make', m), label: `Electric registrations by make in ${id}` }),
        finding: ([rows]) => [{ b: rows[0].make_name }, ` leads, ${pct(rows[0].share_of_evs)} of the county’s EVs in scope.`],
        method: 'The ten makes with the most EVs.',
      }),
      tile({
        title: 'Latest registrations',
        queries: () => [qRec],
        explain: ['The ten latest electric registrations in this county under the scope.'],
        draw: ([rows], body) => body.append(recordsTable(rows, false), h('p', {}, h('a', { href: S.buildHash({ view: 'records' }, { ...scope, county: id }), text: 'All records for this county →' }))),
        method: 'One row per vehicle; VIN, city, ZIP code and owner are not kept.',
      })))
}

function recordsTable(rows, withCounty = true) {
  const cols = [['registration_date', 'Date'], ...(withCounty ? [['county_name', 'County']] : []), ['make_name', 'Make'], ['body_type', 'Body'], ['model_year', 'Model year'], ['registration_class', 'Class'], ['registrant_type', 'Registrant']]
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...cols.map(([, l]) => h('th', { class: l === 'Model year' ? 'num' : null, text: l })))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...cols.map(([f]) =>
      h('td', { class: f === 'model_year' ? 'num' : null },
        f === 'county_name' ? h('a', { href: linkTo(S.ENTITY.view, r.county_name), text: r.county_name }) : f === 'registration_date' ? dateLabel(r[f]) : f === 'model_year' || f === 'make_name' || f === 'body_type' ? String(r[f] ?? '') : String(r[f] ?? '').toLowerCase().replace(/^./, (c) => c.toUpperCase()))))))))
}

// ---- Records ----

let recordLimit = 50
function records() {
  const lim = recordLimit
  const qK = S.viewQuery(S.EV, 'kpis', scope, known)
  const qR = S.viewQuery(S.EV, 'records', scope, known, [], `order_by: registration_date desc, county_name, make_name; limit: ${lim}`)
  return h('div', { class: 'view wrap' },
    ...viewHead('Records', 'Every electric vehicle newly registered in scope, newest first. Click a county to open its page.'),
    tile({
      title: 'Electric registrations in scope',
      queries: () => [qR, qK],
      explain: [`The ${lim} latest electric registrations under the scope.`, 'How many there are in all.'],
      draw: ([rows, [k]], body) => {
        body.append(recordsTable(rows))
        const pager = h('div', { class: 'pager' }, h('span', { text: `${C.fmt(rows.length)} of ${C.fmt(k.ev_count)} shown` }))
        if (rows.length < k.ev_count) pager.append(h('button', { class: 'btn', type: 'button', text: 'Show 50 more', onclick: () => { recordLimit += 50; render() } }))
        body.append(pager)
      },
      finding: ([, [k]]) => [{ b: C.fmt(k.ev_count) }, ` electric registrations in scope, the latest on ${dateLabel(k.latest_date)}.`],
      method: 'VIN, city, ZIP code and owner are not kept. Makes without a common name keep the DMV’s code.',
    }))
}

// ---- Compare ----

function compare() {
  const ids = [...compareSet].filter((id) => known.entity.includes(id))
  if (!ids.length) {
    return h('div', { class: 'view wrap' }, ...viewHead('Compare counties', 'Add up to four counties with + in a ranked table or “Add to compare” on a county’s page.'),
      h('p', {}, 'Or start with ', ...['Nassau', 'Kings (Brooklyn)', 'Monroe', 'Erie'].filter((c) => known.entity.includes(c)).flatMap((c, i, a) => [h('a', { href: S.buildHash({ view: 'compare', compare: a }, scope), onclick: () => a.forEach((x) => compareSet.add(x)), text: c }), i < a.length - 1 ? ', ' : '.'])))
  }
  if (route.compare.join() !== ids.join()) history.replaceState(null, '', S.buildHash({ view: 'compare', compare: ids }, scope))
  const qC = S.compareQuery(S.REG, 'by_county', ids, scope, known)
  const qT = S.compareQuery(S.REG, 'county_by_month', ids, scope, known)
  const colors = ['--accent', '--c2', '--c3', '--c4']
  return h('div', { class: 'view wrap' },
    ...viewHead('Compare counties', `${ids.join(', ')}, side by side.`),
    h('p', {}, ...ids.map((id) => h('span', { class: 'chip' }, id, h('button', { type: 'button', 'aria-label': `Remove ${id}`, text: '×', onclick: () => { compareSet.delete(id); go({ view: 'compare', id: null, compare: [...compareSet] }) } })))),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Side by side', cls: 'span-2',
        queries: () => [qC],
        explain: ['Each county’s electric registrations and its share with and after the credit.'],
        draw: ([rows], body) => body.append(h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ...['County', 'EVs', 'New registrations', 'EV share', 'With credit', 'After', 'Change'].map((t, i) => h('th', { class: i ? 'num' : null, text: t })))),
          h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, h('a', { href: linkTo(S.ENTITY.view, r.county_name), text: r.county_name })),
            ...[C.fmt(r.ev_registrations), C.fmt(r.new_registrations), pct(r.ev_share), pct(r.ev_share_with_credit), pct(r.ev_share_after_credit), pts(r.ev_share_change)].map((v) => h('td', { class: 'num', text: v })))))))),
        finding: ([rows]) => {
          const top = rows.reduce((b, r) => (r.ev_share > b.ev_share ? r : b), rows[0])
          return [{ b: top.county_name }, ` has the highest EV share of these, ${pct(top.ev_share)}.`]
        },
        method: methodFor(S.REG, 'Registrations by where the registrant lives.'),
      }),
      tile({
        title: 'EV share by month', cls: 'span-2',
        queries: () => [qT],
        explain: ['Each county’s electric share by month.'],
        draw: ([rows], body) => {
          const labels = [...new Set(rows.map((r) => ym(r.reg_month)))].sort()
          const series = ids.map((id, i) => {
            const m = new Map(rows.filter((r) => r.county_name === id).map((r) => [ym(r.reg_month), r.ev_share]))
            return { name: id, values: labels.map((l) => m.get(l) ?? null), color: colors[i] }
          })
          const iA = labels.findIndex((l) => l >= '2025-10')
          return C.lines(chartBox(body), labels.map(S.monthLabel), series, { format: pct, band: iA >= 0 ? { from: S.monthLabel(labels[iA]), to: S.monthLabel(labels[labels.length - 1]), label: 'After the credit' } : undefined, height: 320, label: 'Electric share by month, compared' })
        },
        method: 'The shaded months are after the credit ended.',
      })))
}

// ---- About ----

function about() {
  const qK = S.viewQuery(S.EV, 'kpis', S.DEFAULT_SCOPE, known)
  const asOf = h('span', { text: '…' })
  const mine = epoch
  query(qK).then(([k]) => asOf.replaceChildren(dateLabel(k.latest_date))).catch(() => asOf.replaceChildren('not available')).finally(() => { if (mine === epoch) $('#main').dataset.settled = String(epoch) })
  const p = (...kids) => h('p', {}, ...kids)
  const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener', text })
  return h('div', { class: 'view wrap' },
    ...viewHead('About the data', 'Where the numbers come from, what was changed, and what they cannot tell you.'),
    h('div', { class: 'prose' },
      p('The latest registration in the data took effect on ', asOf, '.'),
      h('h2', { text: 'Source' }),
      p('Source: New York State Department of Motor Vehicles, ', a('https://data.ny.gov/d/s2dd-yksa', 'Department of Motor Vehicles Registration Transactions: Two Year Window'), ', on data.ny.gov, fetched on 3 November 2026. It lists every registration transaction of the last two years, refreshed weekly; the window fetched runs from exports of 2 November 2024 to 31 October 2026.'),
      p('License: the ', a('https://data.ny.gov/download/77gx-ii52/application/pdf', 'OPEN-NY Terms of Use'), ' say: “So long as you are not doing anything malicious with NYS data, you may use it as you wish, subject to no other requirements.” This is an independent app, not produced by New York State.'),
      p('County boundaries: ', a('https://github.com/topojson/us-atlas', 'us-atlas 3.0.1'), ' (US Census Bureau cartographic boundaries, public domain; ISC license), cut to New York’s 62 counties.'),
      h('h2', { text: 'What was reshaped' }),
      p('Only ORIGINAL transactions are kept: a vehicle registered in New York for the first time by its owner. Renewals, re-registrations, amendments and duplicates are left out. For electric vehicles, each registration is one row with its date, county of residence, registration class, make, body type, model year and registrant type; VIN, city, ZIP code and coordinates were never downloaded. For every fuel, registrations are counted by month, county, fuel and class on the portal, to give the share its denominator. Months run from November 2024 to September 2026; October 2026 is left out because registrations keep arriving for weeks after they take effect. Text values are coded to numbers in the files and decoded by the model.'),
      h('h2', { text: 'What the data cannot tell you' }),
      h('ul', {},
        h('li', { text: 'New or used. The DMV publishes no flag, so a used EV brought into New York counts as a new registration. A model year earlier than the year registered is not a sign of a used car on its own: new stock of last year’s model year is still sold early in a year.' }),
        h('li', { text: 'Battery-electric only. The DMV’s data dictionary files a vehicle that can also run on another fuel under that fuel, so plug-in hybrids and hybrids count as gasoline, and every share here is a battery-electric share.' }),
        h('li', { text: 'Re-registrations. Only first registrations by an owner (the DMV’s ORIGINAL transactions) are counted; re-registrations and renewals are left out.' }),
        h('li', { text: 'Why. The credit’s end is one change among several in these months, such as prices, models and interest rates. The comparison is before and after, not cause and effect.' }),
        h('li', { text: 'National figures. Articles quote national shares of new-vehicle sales from industry sources; this app counts New York registrations, used cars included, so its shares are not comparable one to one.' }))))
}

function footer() {
  return [
    h('div', {}, h('h2', { text: 'EVs in New York after the credit' }), h('p', { text: 'Source: New York State Department of Motor Vehicles, Registration Transactions (data.ny.gov), under the OPEN-NY Terms of Use. Reshaped for this app. An independent app, not produced by New York State.' })),
    h('div', {}, h('h2', { text: 'Views' }), ...['overview', 'explore', 'compare', 'records', 'about'].map((v) => h('a', { href: `#/${v === 'overview' ? '' : v}`, text: { overview: 'Overview', explore: 'Explore', compare: 'Compare', records: 'Records', about: 'About the data' }[v] }))),
    h('div', {}, h('h2', { text: 'In the news' }), ...ARTICLES.map((x) => h('a', { href: x.url, target: '_blank', rel: 'noopener', text: x.outlet }))),
  ]
}

boot()
