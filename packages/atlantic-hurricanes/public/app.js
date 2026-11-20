import * as S from './scope.js'
import * as C from './charts.js'
import { trackMap } from './tracks.js'

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

// ---- State: the route and the scope, both in the address ----

const known = {} // filled by boot() from distinct-value queries
let route = { view: 'overview', id: null, compare: [] }
let scope = { ...S.DEFAULT_SCOPE }

// ---- Queries: one request per distinct text, at most four in flight ----
// The managed-table connection has been seen to answer a query with an empty result now and then, status 200: an
// empty answer is asked again, up to four more times, before it is believed.

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
// The server now and then answers with no rows, fails, or never answers: wait a little and ask again, and give up on a
// request that has hung for 10 s.
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const ask = (q, tries = 5) => Promise.race([Publisher.query(S.MODEL, q), pause(10000).then(() => { throw new Error('The model took too long to answer') })])
  .then((rows) => (rows?.length || tries <= 1 ? rows : pause(400).then(() => ask(q, tries - 1))),
    (err) => (tries <= 1 ? Promise.reject(err) : pause(400).then(() => ask(q, tries - 1))))
export function query(q) {
  if (!cache.has(q)) {
    const p = new Promise((resolve, reject) => {
      queue.push(() => ask(q).then(resolve, reject))
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

window.addEventListener('popstate', () => {
  ;({ route, scope } = S.parseHash(location.hash, known))
  render({ toTop: true })
})

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

/**
 * tile({ title, sub, cls, queries: () => [q...], explain: [what each query counts, in plain words],
 *        draw: (results, body) => void or a promise, finding: (results) => sentence or prose() parts,
 *        method: what the card leaves out and why, note })
 * Once loaded, a card is drawn again in place when the scope changes: its chart stays, dimmed, until the new rows
 * arrive, then its marks move, its numbers count, and its body eases to its new height.
 */
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
          // Emptying the body while a mark in it has focus lets the browser lay out a shorter page and move the
          // scroll: the focus goes first, and the body keeps its height until the new chart is in.
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
        // The chart first: a finding that cannot be written for this scope leaves its line empty, never the card.
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
      .finally(() => mine === epoch && card.classList.remove('is-updating'))
      .catch((err) => {
        if (mine !== epoch) return
        body.replaceChildren(h('div', { class: 'state state--error', text: `Could not load: ${err.message}` }))
        console.error(`[${title}]`, err)
      })
  }
  card.__load = () => run(false)
  const respec = (next) => {
    current = card.__spec = next
    if (next.method) methodEl.textContent = next.method
  }
  card.__respec = respec // not loaded yet: it draws with the new scope when it comes into view
  card.__update = (next) => {
    respec(next)
    details.open = false
    return run(true)
  }
  return card
}

/** What a card body showed before it is drawn again: its height, its headline numbers, where each ranked row sat. */
function snapshot(body) {
  const rows = new Map()
  for (const tr of body.querySelectorAll('tr[data-id]')) {
    const bar = tr.querySelector('.rt__bar i')
    rows.set(tr.dataset.id, { top: tr.getBoundingClientRect().top, bar: bar?.getBoundingClientRect().width, num: tr.querySelector('.rt__bar span')?.textContent })
  }
  return { height: body.offsetHeight, numbers: [...body.querySelectorAll('.kpi__value')].map((n) => n.textContent), rows }
}

/** After a card is drawn again: its height eases to the new one, numbers count, rows slide to their new places. */
function settleInPlace(body, was) {
  if (!C.MOTION) return
  const ease = { duration: C.DUR, easing: 'cubic-bezier(.2,.7,.3,1)' }
  const height = body.offsetHeight
  if (Math.abs(height - was.height) > 4) body.animate([{ height: `${was.height}px`, overflow: 'hidden' }, { height: `${height}px`, overflow: 'hidden' }], ease)
  ;[...body.querySelectorAll('.kpi__value')].forEach((n, i) => was.numbers[i] !== undefined && C.countTo(n, was.numbers[i], n.textContent))
  for (const tr of body.querySelectorAll('tr[data-id]')) {
    const old = was.rows.get(tr.dataset.id)
    if (!old) {
      tr.animate([{ opacity: 0 }, { opacity: 1 }], ease)
      continue
    }
    const dy = old.top - tr.getBoundingClientRect().top
    if (Math.abs(dy) > 1) tr.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], ease)
    const bar = tr.querySelector('.rt__bar i')
    if (bar && old.bar !== undefined) bar.animate([{ width: `${old.bar}px` }, { width: `${bar.getBoundingClientRect().width}px` }], ease)
    const num = tr.querySelector('.rt__bar span')
    if (num && old.num) C.countTo(num, old.num, num.textContent)
  }
}

/** The working behind a card: for each query, what it counts, the query itself, and the rows it returned. */
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
  // Quoted where a spreadsheet would split or run it: commas, quotes, line breaks, a leading = + - @.
  const cell = (v) => {
    const t = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]|^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"` : t
  }
  const text = [cols, ...rows.map((r) => cols.map((c) => r[c]))].map((r) => r.map(cell).join(',')).join('\r\n')
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: `${document.title.replace(/\W+/g, '-').toLowerCase()}-${i + 1}.csv` })
  document.body.append(a)
  a.click()
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 0)
}

/**
 * Prose with bold entities: prose(['', { b: 'Idaho' }, ' grew fastest']) or a plain string. A lede or a finding is a
 * sentence built from the data, and the entity it names is bold.
 */
const prose = (parts) =>
  !parts ? [] : typeof parts === 'string' ? [parts] : parts.map((p) => (p && typeof p === 'object' ? h('strong', { text: String(p.b ?? '') }) : String(p ?? '')))

/**
 * A box for a chart from the chart module, which sizes itself to the box's width and redraws when it changes. A card
 * drawn again in place reuses its boxes in order, so its charts move rather than redraw.
 */
const chartBox = (body, size = '') => {
  const reuse = body.__pool?.shift()
  if (!reuse) return body.appendChild(h('div', { class: `chart ${size}` }))
  reuse.className = `chart ${size}`
  return body.appendChild(reuse)
}

const section = (title, sub, ...cards) =>
  h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h2', { text: title }), h('p', { text: sub })), h('div', { class: 'grid-2' }, ...cards))

// ---- The scope bar: shown on every view that the scope filters ----

const SCOPED = new Set(['explore', 'records', 'compare', S.ENTITY.view])

function renderScope() {
  const bar = $('#scope')
  bar.hidden = !SCOPED.has(route.view)
  if (bar.hidden) return
  // The sentence look reads "Showing <select> in <select>": each SCOPE entry's `word` goes before its select.
  const sentence = document.body.dataset.filters === 'sentence'
  // An entity's page and Compare pick the entity themselves: a scope key on its field would read "All" beside it.
  const skip = S.skipFor(route.view)
  const controls = []
  for (const [key, spec] of Object.entries(S.SCOPE)) {
    if (skip.includes(key)) continue
    if (spec.type === 'flag') {
      controls.push(h('button', { class: 'btn', type: 'button', 'aria-pressed': String(scope[key]), text: spec.label(true), onclick: () => setScope({ [key]: !scope[key] }) }))
      continue
    }
    const values = spec.type === 'pick' ? known[key] : range(...known[spec.range])
    const sel = h('select', { 'aria-label': key, onchange: (e) => setScope({ [key]: parse(spec, e.target.value) }) },
      h('option', { value: '', text: spec.type === 'pick' ? `All` : spec.type === 'from' ? 'Earliest' : 'Latest' }),
      ...values.map((v) => h('option', { value: v, text: v, selected: scope[key] !== null && String(scope[key]) === String(v) })))
    controls.push(h('label', {}, sentence ? spec.word ?? key : key[0].toUpperCase() + key.slice(1), sel))
  }
  const had = new Set([...document.querySelectorAll('#scope-bar .chip')].map((c) => c.dataset.label))
  const chips = h('div', { class: 'chips' }, ...S.scopeChips(scope, skip).map((c) =>
    h('span', { class: `chip${had.has(c.label) || !C.MOTION ? '' : ' is-new'}`, 'data-label': c.label }, c.label, h('button', { type: 'button', 'aria-label': `Clear ${c.label}`, text: '×', onclick: () => setScope(c.clear) }))))
  const end = h('div', { class: 'scope__end' },
    h('button', { class: 'btn', type: 'button', text: 'Reset', onclick: () => setScope({ ...S.DEFAULT_SCOPE }) }),
    h('button', { class: 'btn btn--primary', type: 'button', text: 'Copy link', onclick: () => navigator.clipboard?.writeText(location.href) }))
  $('#scope-bar').replaceChildren(...controls, chips, end)
}
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
const parse = (spec, v) => (v === '' ? null : spec.type === 'pick' ? v : Number(v))

// ---- Search: find an entity by name or id, open its page ----

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
    // Names that start with what was typed come first: "Ida" should find Idaho before Florida.
    const label = (id) => S.ENTITY.label(id).toLowerCase()
    const starts = t ? known.entity.filter((id) => label(id).startsWith(t) || label(id).includes(` ${t}`)) : []
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

// ---- Keeping the reader's place: what they clicked stays where it was on screen while cards around it change ----

let lastCard = null
addEventListener('pointerdown', (e) => (lastCard = e.target.closest?.('#main .card') || null), true)
addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (lastCard = e.target.closest?.('#main .card') || null), true)
let keeping = null
/** Hold `anchor` at its place on screen as the cards around it draw again; the reader scrolling ends it. */
function keepInView(anchor, ms = 1600) {
  keeping?.()
  const want = anchor.getBoundingClientRect().top
  const stops = ['wheel', 'touchmove', 'keydown']
  let live = true
  const stop = (keeping = () => {
    live = false
    keeping = null
    for (const t of stops) removeEventListener(t, stop, true)
  })
  for (const t of stops) addEventListener(t, stop, { capture: true, passive: true })
  const t0 = performance.now()
  const hold = () => {
    if (!live || !anchor.isConnected) return
    const off = anchor.getBoundingClientRect().top - want
    if (Math.abs(off) > 0.5) scrollBy(0, off)
    if (performance.now() - t0 < ms) requestAnimationFrame(hold)
    else stop()
  }
  requestAnimationFrame(hold)
}

// ---- Render: a new scope on the same view draws its cards again in place; another view fades in ----

let shown = null
function render({ toTop = false } = {}) {
  const here = `${route.view}|${route.id ?? ''}`
  const same = shown === here
  const first = shown === null
  shown = here
  if (!same && !first && C.MOTION && document.startViewTransition) document.startViewTransition(() => paint(toTop, same))
  else paint(toTop, same)
}

function paint(toTop, same) {
  epoch++
  io.disconnect()
  for (const a of document.querySelectorAll('.app-nav a')) {
    a.href = linkTo(a.dataset.view)
    const on = a.dataset.view === route.view || (a.dataset.view === 'explore' && route.view === S.ENTITY.view)
    if (on) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
  // Where the reader's card is, measured before anything above it changes: the scope bar gains or loses a row of chips.
  const here = [...document.querySelectorAll('#main .card')]
  const anchor = !same ? null : here.includes(lastCard) && lastCard.getBoundingClientRect().bottom > 0 && lastCard.getBoundingClientRect().top < innerHeight ? lastCard : here.find((c) => c.getBoundingClientRect().bottom > 0)
  const want = anchor?.getBoundingClientRect().top
  renderScope()
  const views = { overview, explore, records, compare, about, [S.ENTITY.view]: entity }
  const next = views[route.view]()
  // The same view: every card stays where it is in the page and is drawn again with its new spec. Moving a card out
  // of the document, even for a moment, drops the focus a click gave a mark and lets the browser move the scroll.
  const fresh = [...next.querySelectorAll('.card')]
  const byKey = new Map(here.map((c) => [c.dataset.key, c]))
  if (same && fresh.length === here.length && fresh.every((c) => c.__spec && byKey.has(c.dataset.key))) {
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
  document.querySelectorAll('#main .card').forEach((c) => c.__load && !c.__loaded && io.observe(c)) // only tile() cards load
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
    // One query per list the scope and search need. Values stay strings, and nulls are dropped:
    // a null in a list becomes a blank option that matches "nothing selected".
    const [seasons, classes, months, storms] = await Promise.all([
      query('run: storms -> kpis'),
      query('run: storms -> { group_by: peak_group, peak_group_rank; order_by: peak_group_rank desc }'),
      query('run: storms -> { group_by: start_month_name, start_month; order_by: start_month }'),
      query('run: storms -> { group_by: storm_id, storm_label, season; order_by: season desc, storm_id desc; limit: 5000 }'),
    ])
    known.seasons = [seasons[0].first_season, seasons[0].last_season]
    const values = (rows, f) => rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined)
    known.peak = values(classes, 'peak_group')
    known.month = values(months, 'start_month_name')
    known.entity = values(storms, 'storm_id')
    for (const r of storms) S.LABELS[r.storm_id] = r.storm_label
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Best track through the ${known.seasons[1]} season`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Views: ADAPT. Each returns one element; tiles inside it load as they near the screen. ----

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}

const fixed = (v, d) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'n/a')
const HALF = { '1966-1995': '--c2', '1996-2025': '--c1' }
const GROUP_COLOR = { 'Major hurricane': '--c1', Hurricane: '--c3', 'Tropical storm': '--c4', Depression: '--c6' }
const yearOf = (id) => Number(String(S.LABELS[id] || '').slice(-4))
/** Rows of the tracks view as one track per storm, in time order. */
const toTracks = (rows, color) => {
  const by = new Map()
  for (const r of rows) {
    if (!by.has(r.storm_id)) by.set(r.storm_id, { id: r.storm_id, name: S.ENTITY.label(r.storm_id), points: [] })
    by.get(r.storm_id).points.push(r)
  }
  return [...by.values()].map((t) => ({ ...t, color: color(t) }))
}
const ATLANTIC = [[-100, 8], [-10, 52]]

function overview() {
  // The headline runs bare views of the source that carries the question's scope, and every word of the answer comes
  // from their rows: so the page, the Credible agent and an analyst get the same numbers.
  const qK = `run: ${S.HEADLINE} -> lead_kpis`
  const qS = `run: ${S.HEADLINE} -> by_season`
  const answer = h('p', { class: 'answer' })
  query(qK).then(([a, b]) => {
    const more = b.majors_per_season > a.majors_per_season
    answer.replaceChildren(...prose([
      `${more ? 'Yes, on the record' : 'No'}: the Atlantic averaged `, { b: fixed(b.majors_per_season, 2) }, ` major hurricanes a season in ${b.satellite_half}, against `,
      { b: fixed(a.majors_per_season, 2) }, ` in ${a.satellite_half}, and `, { b: C.pct(b.major_share_of_hurricanes, 1) }, ` of hurricanes reached major strength, against `,
      { b: C.pct(a.major_share_of_hurricanes, 1) }, '.',
    ]))
  })
  const [kicker, title, lede] = viewHead('Have major hurricanes become more common since satellites began watching in 1966?',
    'Every storm NOAA tracked across the Atlantic since 1851, from its best-track record. Before weather satellites, a storm that stayed far from ships and land could go unseen, so the early record undercounts; the fair comparison starts in 1966.').filter(Boolean)
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    h('div', { class: 'grid-2' },
      tile({
        title: 'The satellite era, half against half', sub: 'Storms of 1966-1995 beside 1996-2025, 30 seasons each.', cls: 'span-2',
        queries: () => [qK, qS],
        explain: ['Each half of the satellite era: seasons, major hurricanes (category 3 or more, 96 kt and up) and averages per season.', 'One row per satellite-era season, for the sparklines.'],
        draw: ([halves, seasons], body) => {
          const [a, b] = halves
          const late = seasons.filter((r) => r.season >= 1996)
          const kpi = (label, value, sub, series, accent) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            svg.setAttribute('class', 'kpi__spark')
            const el = h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('p', { class: 'kpi__label', text: label }), h('p', { class: 'kpi__value', text: value }), h('p', { class: 'kpi__sub' }, ...sub), svg)
            requestAnimationFrame(() => C.sparkline(svg, series, accent ? '--accent' : '--c2'))
            return el
          }
          body.append(h('div', { class: 'kpis' },
            kpi('Majors per season, 1996-2025', fixed(b.majors_per_season, 2), ['against ', h('strong', { text: fixed(a.majors_per_season, 2) }), ' in 1966-1995'], late.map((r) => r.major_hurricanes), true),
            kpi('Hurricanes that became major', C.pct(b.major_share_of_hurricanes, 1), ['against ', h('strong', { text: C.pct(a.major_share_of_hurricanes, 1) }), ' in 1966-1995'], late.map((r) => r.hurricanes ? r.major_hurricanes / r.hurricanes : 0)),
            kpi('Named storms per season', fixed(b.named_storms_per_season, 1), ['against ', h('strong', { text: fixed(a.named_storms_per_season, 1) }), ' in 1966-1995'], late.map((r) => r.named_storms)),
            kpi('Energy (ACE) per season', fixed(b.ace_per_season, 0), ['against ', h('strong', { text: fixed(a.ace_per_season, 0) }), ' in 1966-1995'], late.map((r) => r.total_ace))))
        },
        finding: ([halves]) => [`Major hurricanes went from `, { b: C.fmt(halves[0].major_hurricanes) }, ` in the first 30 seasons to `, { b: C.fmt(halves[1].major_hurricanes) }, ` in the next 30.`],
        method: 'Sparklines run 1996-2025. Category from peak 1-minute sustained wind in the best track. A count, not a trend test: decades-long ocean cycles (the Atlantic Multidecadal Oscillation) were in a quiet phase for much of 1970-1994.',
      }),
      tile({
        title: 'Major hurricanes per season, 1851 to now', sub: 'Each season’s count of storms that reached category 3. Satellite era shaded.', cls: 'span-2',
        queries: () => [S.viewQuery('by_season', S.DEFAULT_SCOPE, known)],
        explain: ['One row per season: major hurricanes, every storm in the record.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => r.season), [{ name: 'Major hurricanes', values: rows.map((r) => r.major_hurricanes), color: '--accent' }], {
          band: { from: 1966, to: rows[rows.length - 1].season, label: 'Satellite era' }, beginAtZero: true, maxTicks: 8, label: 'Major hurricanes per season, 1851 onward',
          onPick: (season) => go({ view: 'explore', id: null, compare: [] }, { ...S.DEFAULT_SCOPE, from: Number(season), to: Number(season) }),
        }),
        finding: ([rows]) => {
          const top = rows.reduce((m, r) => (r.major_hurricanes > m.major_hurricanes ? r : m))
          return [`The busiest season for major hurricanes was `, { b: String(top.season) }, `, with `, { b: C.fmt(top.major_hurricanes) }, '.']
        },
        method: 'Before 1966 the count is a floor: storms out at sea were missed. Click a season to explore it.',
      }),
      tile({
        title: 'Where major hurricanes went', sub: 'Every satellite-era storm that reached category 3, coloured by half. Hover for the storm, click to open it.', cls: 'span-2',
        queries: () => [`run: ${S.POINTS} -> tracks + { where: storms.is_satellite_era and storms.peak_category >= 3 }`],
        explain: ['The six-hourly fixes and landfalls of every 1966-2025 storm that peaked at category 3 or more.'],
        draw: ([rows], body) => trackMap(chartBox(body), toTracks(rows, (t) => (yearOf(t.id) >= 1996 ? '--c1' : '--c2')), {
          extent: ATLANTIC, onOpen: openEntity, label: 'Tracks of satellite-era major hurricanes',
          key: [{ name: '1966-1995', color: '--c2' }, { name: '1996-2025', color: '--c1' }],
          tip: (t, p) => [t.name, ...(p ? [`${p.observed_at.slice(0, 10)}: ${p.category >= 1 ? `category ${p.category}` : 'below hurricane strength'}`] : [])],
        }),
        finding: ([rows]) => {
          const ts = toTracks(rows, () => '')
          const late = ts.filter((t) => yearOf(t.id) >= 1996).length
          return [{ b: C.fmt(late) }, ` of the `, { b: C.fmt(ts.length) }, ` tracks are from 1996-2025.`]
        },
        method: 'Fixes at 00, 06, 12 and 18 UTC plus landfalls, so a track is drawn from its synoptic positions.',
      }),
      tile({
        title: 'The strongest storms on record', sub: 'Peak sustained wind, then lowest pressure. Open a storm.',
        queries: () => [S.viewQuery('strongest', S.DEFAULT_SCOPE, known)],
        explain: ['Storms ranked by peak 1-minute sustained wind, ties broken by lowest central pressure.'],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.storm_id, name: r.storm_label, sub: r.peak_class, value: r.peak_wind_kt })), { valueLabel: 'Peak wind (kt)', limit: 10, onOpen: openEntity, href: (id) => linkTo(S.ENTITY.view, id) }),
        finding: ([rows]) => [{ b: rows[0].storm_label }, ` peaked at `, { b: `${rows[0].peak_wind_kt} kt` }, `, with a pressure of ${rows[0].min_pressure_mb} mb.`],
        method: 'Winds are rounded to 5 kt in the best track, so ties are common.',
      }),
      tile({
        title: 'Where storms came ashore', sub: 'Landfalls by country. A storm can land more than once.',
        queries: () => [S.pointsQuery('landfalls_by_country', S.DEFAULT_SCOPE, known)],
        explain: ['Best-track landfall entries (record type L), by the country they fall in.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.slice(0, 10).map((r) => ({ label: r.landfall_place, value: r.landfall_count })), { horizontal: true, direct: true, color: '--c5', label: 'Landfalls by country' }),
        finding: ([rows]) => [{ b: rows[0].landfall_place }, ` has the most landfalls on record, `, { b: C.fmt(rows[0].landfall_count) }, '.'],
        method: 'The L record type is only marked consistently since 1991; earlier landfalls come from NHC’s reanalysis and are less complete. Country from the landfall point.',
      }),
      h('div', { class: 'card card--links span-2' },
        h('h3', { class: 'card__title', text: 'Keep going' }),
        h('p', {}, h('a', { href: linkTo('explore'), text: 'When in the season majors form, and how it changed →' })),
        h('p', {}, h('a', { href: linkTo('records'), text: 'Every storm, newest first →' })),
        h('p', {}, h('a', { href: linkTo('about'), text: 'How the record was made, and what it misses →' })))))
}

function explore() {
  const T = (id, extra) => () => [S.tileQuery(id, scope, known, extra)]
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore the record', 'Narrow to a span of seasons, a peak strength or a month, or click a mark: every card follows, and the address keeps your place.'),
    section('Season by season', 'Counts by strength across the seasons in scope.',
      tile({
        title: 'In scope', cls: 'span-2',
        queries: T('kpis'),
        explain: ['Headline counts for the storms in scope.'],
        draw: ([[k]], body) => body.append(h('div', { class: 'kpis' },
          ...[['Storms', k.storm_count], ['Hurricanes', k.hurricanes], ['Major hurricanes', k.major_hurricanes], ['Made landfall', k.landfalling_storms]].map(([l, v], i) =>
            h('div', { class: `kpi${i === 2 ? ' kpi--accent' : ''}` }, h('p', { class: 'kpi__label', text: l }), h('p', { class: 'kpi__value', text: C.fmt(v) }))))),
        finding: ([[k]]) => [{ b: C.fmt(k.storm_count) }, ` storms from ${k.first_season} to ${k.last_season}, `, { b: fixed(k.majors_per_season, 2) }, ' major hurricanes a season.'],
        method: 'A storm counts once, in the season it formed. Majors are category 3 or more (96 kt and up).',
      }),
      tile({
        title: 'Storms per season', sub: 'Drag across the chart to set the seasons.', cls: 'span-2',
        queries: T('trend'),
        explain: ['One row per season: named storms, hurricanes and majors, with every other filter applied.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => r.season), [
          { name: 'Named storms', values: rows.map((r) => r.named_storms), color: '--c4' },
          { name: 'Hurricanes', values: rows.map((r) => r.hurricanes), color: '--c3' },
          { name: 'Majors', values: rows.map((r) => r.major_hurricanes), color: '--c1', width: 2.5 },
        ], { endLabels: true, beginAtZero: true, maxTicks: 8, label: 'Storms per season by strength',
          band: scope.from !== null || scope.to !== null ? { from: scope.from ?? known.seasons[0], to: scope.to ?? known.seasons[1], label: 'In scope' } : { from: 1966, to: known.seasons[1], label: 'Satellite era' },
          onBrush: (a, b) => setScope({ from: Number(a), to: Number(b) }) }),
        finding: ([rows]) => {
          const top = rows.reduce((m, r) => (r.named_storms > m.named_storms ? r : m))
          return [`The most named storms in one season: `, { b: String(top.season) }, `, with `, { b: C.fmt(top.named_storms) }, '.']
        },
        method: 'This card shows every season and ignores the season range, so you can move it. Named storms reached 34 kt.',
      })),
    section('How strong they got', 'The strongest stage each storm reached, decade by decade.',
      tile({
        title: 'Share of storms by peak strength, by decade', sub: 'Click a strength to filter.', cls: 'span-2',
        queries: T('groups'),
        explain: ['Storms per decade by the strength they peaked at.'],
        draw: ([rows], body) => C.stackedShare(chartBox(body), rows.map((r) => ({ x: `${r.decade}s`, part: r.peak_group, value: r.storm_count })),
          ['Major hurricane', 'Hurricane', 'Tropical storm', 'Depression'].map((n) => ({ name: n, color: GROUP_COLOR[n] })),
          { selected: scope.peak, onPick: (p) => toggleScope('peak', p), label: 'Share of storms by peak strength per decade' }),
        finding: ([rows]) => {
          const by = d3.rollup(rows, (v) => d3.sum(v, (r) => r.storm_count), (r) => r.decade)
          const maj = d3.rollup(rows.filter((r) => r.peak_group === 'Major hurricane'), (v) => d3.sum(v, (r) => r.storm_count), (r) => r.decade)
          const top = [...by.keys()].filter((d) => by.get(d) >= 20).map((d) => [d, (maj.get(d) || 0) / by.get(d)]).sort((x, y) => y[1] - x[1])[0]
          return top ? [`The ${top[0]}s had the largest share of storms peaking as majors, `, { b: C.pct(top[1], 0) }, '.'] : ''
        },
        method: 'Depressions were rarely recorded before the 1960s, which inflates the other shares then. The finding counts decades with 20 storms or more.',
      }),
      tile({
        title: 'When in the year they formed', sub: 'Storms by start month, 1966-1995 against 1996-2025. Click a month.', cls: 'span-2',
        queries: T('months'),
        explain: ['Storms by the month they formed in, counted in each 30-season half of the satellite era.'],
        draw: ([rows], body) => C.dumbbell(chartBox(body), rows.map((r) => ({ label: r.start_month_name, id: r.start_month_name, a: r.early, b: r.late })), {
          aName: '1966-1995', bName: '1996-2025', aColor: '--c2', bColor: '--c1', selected: scope.month, onPick: (m) => toggleScope('month', m), label: 'Storms by start month in each half of the satellite era' }),
        finding: ([rows]) => {
          const top = rows.reduce((m, r) => (r.late - r.early > m.late - m.early ? r : m))
          return [{ b: top.start_month_name }, ` grew most, from ${C.fmt(top.early)} to `, { b: C.fmt(top.late) }, ' storms.']
        },
        method: 'Ignores the season range and the month: it always compares the two satellite halves. Months with no storms in either half are not shown.',
      })),
    section('Where they went', 'Tracks and landfalls of the storms in scope.',
      tile({
        title: 'Where storms travel', sub: 'Best-track positions per 2° cell.', cls: 'span-2',
        queries: T('density'),
        explain: ['Best-track entries per 2-degree cell, every entry of the storms in scope.'],
        draw: async ([rows], body) => {
          const topo = await C.loadTopo('./vendor/maps/countries-110m.json')
          C.hexMap(chartBox(body), rows.map((r) => ({ lat: r.lat_cell + 1, lon: r.lon_cell + 1, value: r.point_count })), { format: (v) => C.fmt(v), legendTitle: 'Track positions', label: 'Density of storm positions', land: topojson.feature(topo, topo.objects.countries) })
        },
        finding: ([rows]) => [`Storms in scope logged positions in `, { b: C.fmt(rows.length) }, ' cells.'],
        method: 'Entries are mostly six-hourly, so a slow storm adds more to a cell than a fast one.',
      }),
      tile({
        title: 'Landfalls by country', sub: 'Each landfall counts; a storm can land several times.',
        queries: T('countries'),
        explain: ['Landfall entries by country, for the storms in scope.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.slice(0, 12).map((r) => ({ label: r.landfall_place, value: r.landfall_count })), { horizontal: true, direct: true, color: '--c5', label: 'Landfalls by country' }),
        finding: ([rows]) => [{ b: rows[0].landfall_place }, ` leads with `, { b: C.fmt(rows[0].landfall_count) }, ' landfalls.'],
        method: 'Landfalls are marked consistently from 1991; earlier ones come from reanalysis.',
      }),
      tile({
        title: 'US landfalls by state', sub: 'With the number made at major strength.',
        queries: T('states'),
        explain: ['US landfall entries by state, and how many were at category 3 or more.'],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.state, name: r.state, sub: `${C.fmt(r.major_landfalls)} major`, value: r.landfall_count })), { valueLabel: 'Landfalls', limit: 10 }),
        finding: ([rows]) => [{ b: rows[0].state }, ` has `, { b: C.fmt(rows[0].landfall_count) }, ` landfalls, ${C.fmt(rows[0].major_landfalls)} of them major.`],
        method: 'State from the landfall point; a storm crossing two states counts in each it landed in.',
      })),
    section('The storms', 'The strongest and the most energetic in scope.',
      tile({
        title: 'Strongest', sub: 'Peak wind. Open a storm.',
        queries: T('strongest'),
        explain: ['Storms in scope by peak sustained wind, then lowest pressure.'],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.storm_id, name: r.storm_label, sub: r.peak_class, value: r.peak_wind_kt })), { valueLabel: 'Peak wind (kt)', limit: 10, onOpen: openEntity, href: (id) => linkTo(S.ENTITY.view, id) }),
        finding: ([rows]) => [{ b: rows[0].storm_label }, ` is the strongest in scope, `, { b: `${rows[0].peak_wind_kt} kt` }, '.'],
        method: 'The first 25 by wind are listed.',
      }),
      tile({
        title: 'Most energetic', sub: 'Accumulated cyclone energy. Open a storm.',
        queries: T('energetic'),
        explain: ['Storms in scope by ACE: the sum of the squared six-hourly wind at 35 kt or more while tropical, over 10,000.'],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.storm_id, name: r.storm_label, sub: `${fixed(r.duration_days, 1)} days`, value: r.ace })), { valueLabel: 'ACE', format: (v) => fixed(v, 1), limit: 10, onOpen: openEntity, href: (id) => linkTo(S.ENTITY.view, id) }),
        finding: ([rows]) => [{ b: rows[0].storm_label }, ` had the most energy, an ACE of `, { b: fixed(rows[0].ace, 1) }, '.'],
        method: 'ACE rewards long-lived storms as well as strong ones.',
      })))
}

const catColor = (p) => (p.category >= 3 ? '--c1' : p.category >= 1 ? '--c3' : p.wind_kt >= 34 ? '--c4' : '--c6')
const CAT_KEY = [{ name: 'Major hurricane', color: '--c1' }, { name: 'Category 1-2', color: '--c3' }, { name: 'Tropical storm', color: '--c4' }, { name: 'Depression or other', color: '--c6' }]
const strength = (p) => (p.category >= 1 ? `category ${p.category}` : p.wind_kt >= 34 ? 'tropical storm' : 'below storm strength')
/** Hours since a track's first fix, for drawing several storms' winds on one axis. */
const hoursIn = (rows) => rows.map((r) => Math.round((Date.parse(r.observed_at) - Date.parse(rows[0].observed_at)) / 216e5) * 6)
const compareLink = (id) => linkTo('compare', null, [...new Set([...(route.compare || []), id])].slice(0, S.COMPARE_MAX))

function entity() {
  const id = route.id
  const name = S.ENTITY.label(id)
  const head = viewHead(name, null, [h('a', { href: linkTo('records'), text: 'Storms' }), ` / ${name}`]).filter(Boolean)
  const qR = () => [`run: ${S.SOURCE} -> records + { where: storm_id = ${S.lit(id)} }`]
  const qT = () => [S.trackQuery(id, known)]
  return h('div', { class: 'view wrap' },
    ...head,
    h('p', {}, h('a', { class: 'btn btn--primary', href: linkTo('compare', null, [id]), text: 'Add to compare' })),
    h('div', { class: 'grid-2' },
      tile({
        title: 'The storm in numbers', cls: 'span-2',
        queries: qR,
        explain: ['This storm’s row of the records view: peak strength, lowest pressure, energy and landfalls.'],
        draw: ([[r]], body) => body.append(h('div', { class: 'kpis' },
          ...[['Peak wind', `${r.peak_wind_kt} kt`], ['Lowest pressure', r.min_pressure_mb ? `${r.min_pressure_mb} mb` : 'not recorded'], ['Energy (ACE)', fixed(r.ace, 1)], ['Landfalls', C.fmt(r.landfalls)]].map(([l, v], i) =>
            h('div', { class: `kpi${i === 0 ? ' kpi--accent' : ''}` }, h('p', { class: 'kpi__label', text: l }), h('p', { class: 'kpi__value', text: v }))))),
        finding: ([[r]]) => [{ b: r.storm_label }, ` formed on ${r.started_at.slice(0, 10)} and peaked as `, { b: r.peak_class.toLowerCase() }, r.us_landfalls ? `, with ${r.us_landfalls} US landfall${r.us_landfalls === 1 ? '' : 's'}.` : '.'],
        method: 'From NHC’s best track: peak 1-minute sustained wind, lowest central pressure, ACE from six-hourly tropical fixes at 35 kt or more.',
      }),
      tile({
        title: 'Its track', sub: 'Coloured by strength at each fix; dots mark landfalls.', cls: 'span-2',
        queries: qT,
        explain: ['Every best-track entry of this storm, in time order.'],
        draw: ([rows], body) => trackMap(chartBox(body), [{ id, name, points: rows }], {
          segColor: catColor, key: CAT_KEY, label: `Track of ${name}`,
          // A place crossed twice is named once, so its labels do not overprint.
          marks: rows.filter((r) => r.record_id === 'L').map((r, i, all) => {
            const label = r.landfall_admin1 || r.landfall_place
            const seen = all.slice(0, i).some((q) => (q.landfall_admin1 || q.landfall_place) === label)
            return { lat: r.lat, lon: r.lon, label: seen ? null : label, color: '--c5' }
          }),
          tip: (t, p) => [t.name, ...(p ? [`${p.observed_at.slice(0, 16).replace('T', ' ')} UTC`, `${p.wind_kt} kt, ${strength(p)}`] : [])],
        }),
        finding: ([rows]) => {
          const lf = rows.filter((r) => r.record_id === 'L')
          return lf.length ? [`Came ashore `, { b: String(lf.length) }, ` time${lf.length === 1 ? '' : 's'}, first in `, { b: lf[0].landfall_admin1 || lf[0].landfall_place || 'an unnamed place' }, '.'] : `No landfall is marked in its best track.`
        },
        method: 'Landfall points (record type L) are marked consistently only since 1991. Place from the landfall point.',
      }),
      tile({
        title: 'Wind over its life', sub: 'Maximum sustained wind at each fix, in knots.', cls: 'span-2',
        queries: qT,
        explain: ['The wind at every best-track entry of this storm.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => `${r.observed_at.slice(5, 10)} ${r.observed_at.slice(11, 13)}h`), [{ name: 'Wind (kt)', values: rows.map((r) => r.wind_kt), color: '--accent' }], {
          beginAtZero: true, maxTicks: 8, label: `Wind over the life of ${name}`, refs: [{ y: 96, label: 'Major (96 kt)' }, { y: 64, label: 'Hurricane (64 kt)' }] }),
        finding: ([rows]) => {
          const top = rows.reduce((m, r) => (r.wind_kt > m.wind_kt ? r : m))
          return [`Peaked at `, { b: `${top.wind_kt} kt` }, ` on ${top.observed_at.slice(0, 10)}.`]
        },
        method: 'Fixes are six-hourly, with extra entries at landfall and peak.',
      })))
}

let shownRecords = 50
function records() {
  const list = h('div', {})
  const more = h('button', { class: 'btn', type: 'button', text: 'Show 50 more' })
  const draw = (n) => {
    const q = S.viewQuery('records', scope, known, [], `order_by: started_at desc; limit: ${n}`)
    query(q).then((rows) => {
      list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'records' },
        h('thead', {}, h('tr', {}, ...['Storm', 'Formed', 'Peak', 'Wind (kt)', 'Pressure (mb)', 'ACE', 'Landfalls'].map((t, i) => h('th', { class: i > 2 ? 'num' : null, text: t })))),
        h('tbody', {}, ...rows.map((r) => h('tr', {},
          h('td', {}, h('a', { href: linkTo(S.ENTITY.view, r.storm_id), text: r.storm_label })),
          h('td', { text: r.started_at.slice(0, 10) }), h('td', { text: r.peak_class }),
          h('td', { class: 'num', text: r.peak_wind_kt ?? '' }), h('td', { class: 'num', text: r.min_pressure_mb ?? '' }),
          h('td', { class: 'num', text: fixed(r.ace, 1) }), h('td', { class: 'num', text: C.fmt(r.landfalls) })))))))
      more.hidden = rows.length < n
      list.dataset.loaded = '1'
    }).catch((err) => list.replaceChildren(h('div', { class: 'state state--error', text: `Could not load: ${err.message}` })))
  }
  more.onclick = () => draw((shownRecords += 50))
  shownRecords = 50
  draw(shownRecords)
  return h('div', { class: 'view wrap' },
    ...viewHead('Every storm', 'Each storm in scope, newest first. Open one for its track.').filter(Boolean),
    h('div', { class: 'card', 'data-loaded': '1' }, list, h('p', {}, more)))
}

function compare() {
  const ids = route.compare
  const head = viewHead('Compare storms', `Up to ${S.COMPARE_MAX} storms side by side. Add one from search or from a storm’s page.`).filter(Boolean)
  const picker = h('select', { 'aria-label': 'Add a storm', onchange: (e) => e.target.value && go({ view: 'compare', id: null, compare: [...ids, e.target.value].slice(0, S.COMPARE_MAX) }) },
    h('option', { value: '', text: 'Add a storm…' }), ...known.entity.slice(0, 600).filter((x) => !ids.includes(x)).map((x) => h('option', { value: x, text: S.ENTITY.label(x) })))
  const chips = h('div', { class: 'chips' }, ...ids.map((x) => h('span', { class: 'chip' }, S.ENTITY.label(x), h('button', { type: 'button', 'aria-label': `Remove ${S.ENTITY.label(x)}`, text: '×', onclick: () => go({ view: 'compare', id: null, compare: ids.filter((y) => y !== x) }) }))))
  if (!ids.length) return h('div', { class: 'view wrap' }, ...head, h('p', {}, picker))
  const colors = ['--c1', '--c2', '--c3', '--c5']
  return h('div', { class: 'view wrap' }, ...head, h('p', {}, chips, ids.length < S.COMPARE_MAX ? picker : ''),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Side by side', cls: 'span-2',
        queries: () => [S.compareQuery('records', ids, scope, known)],
        explain: ['The records view for the storms compared.'],
        draw: ([rows], body) => C.bars(chartBox(body), ids.map((x) => rows.find((r) => r.storm_id === x)).filter(Boolean).map((r) => ({ label: r.storm_label, value: r.peak_wind_kt })), { horizontal: true, direct: true, color: '--accent', label: 'Peak wind by storm' }),
        finding: ([rows]) => {
          const max = d3.max(rows, (r) => r.peak_wind_kt)
          const tops = rows.filter((r) => r.peak_wind_kt === max)
          return tops.length > 1 ? [{ b: tops.map((r) => r.storm_label).join(' and ') }, ` tie as the strongest of these, at `, { b: `${max} kt` }, '.'] : [{ b: tops[0].storm_label }, ` was the strongest of these, at `, { b: `${max} kt` }, '.']
        },
        method: 'Peak 1-minute sustained wind from the best track.',
      }),
      tile({
        title: 'Wind over each storm’s life', sub: 'Hours since each storm’s first fix.', cls: 'span-2',
        queries: () => ids.map((x) => S.trackQuery(x, known)),
        explain: ids.map((x) => `The best track of ${S.ENTITY.label(x)}.`),
        draw: (rs, body) => {
          const hrs = [...new Set(rs.flatMap(hoursIn))].sort((a, b) => a - b)
          const series = rs.map((rows, i) => {
            const at = new Map(hoursIn(rows).map((t, j) => [t, rows[j].wind_kt]))
            return { name: S.ENTITY.label(ids[i]), values: hrs.map((t) => at.get(t) ?? null), color: colors[i] }
          })
          C.lines(chartBox(body), hrs.map((t) => `${Math.round(t)} h`), series, { endLabels: true, beginAtZero: true, maxTicks: 8, label: 'Wind over each storm’s life' })
        },
        finding: (rs) => {
          const life = rs.map((rows, i) => [ids[i], hoursIn(rows).at(-1)]).sort((a, b) => b[1] - a[1])[0]
          return [{ b: S.ENTITY.label(life[0]) }, ` lasted longest, `, { b: `${fixed(life[1] / 24, 1)} days` }, ' from first to last fix.']
        },
        method: 'Every best-track entry, including the depression and post-tropical stages.',
      })))
}

function about() {
  const latest = h('span', {})
  query(S.viewQuery('records', S.DEFAULT_SCOPE, known)).then((rows) => latest.replaceChildren(h('a', { href: linkTo(S.ENTITY.view, rows[0].storm_id), text: rows[0].storm_label }), `, formed ${rows[0].started_at.slice(0, 10)}`) || latest.closest('.view')?.setAttribute('data-loaded', '1'))
  const p = (...k) => h('p', {}, ...k)
  const a = (href, text) => h('a', { href, text })
  return h('div', { class: 'view wrap prose' },
    ...viewHead('About the data', 'Where the numbers come from, what was changed, and what the record cannot tell you.').filter(Boolean),
    h('h2', { text: 'Sources' }),
    p(a('https://www.nhc.noaa.gov/data/#hurdat', 'HURDAT2, the Atlantic hurricane database'), ', from NOAA’s National Hurricane Center: the best track of every known Atlantic tropical and subtropical cyclone since 1851. A work of the US government, in the public domain.'),
    p('Coastlines: ', a('https://www.naturalearthdata.com/', 'Natural Earth'), ' (public domain), via ', a('https://github.com/topojson/world-atlas', 'world-atlas'), ' 2.0.2 (ISC license).'),
    p('Latest storm in the record: ', latest, '.'),
    h('h2', { text: 'What was reshaped' }),
    p('The file mixes header lines (one per storm) with track lines (one per six-hourly fix). It was split into two tables: one row per storm and one row per track entry. Positions were turned into signed decimal degrees, and −999 sentinels into nulls. Each storm’s peak wind, lowest pressure, Saffir-Simpson category, ACE and landfall counts were computed from its own track. Landfall entries (record type L) were matched to a country and, in the US, a state from Natural Earth boundaries.'),
    h('h2', { text: 'Caveats' }),
    p('Before weather satellites (1966) and aircraft reconnaissance (1944), storms that never neared ships or land could go unrecorded, and peak winds were often underestimated. Counts before 1966 are floors, which is why the lead comparison uses the satellite era alone. Even within it, instruments improved: the Dvorak technique and, later, scatterometers caught short-lived storms that 1970s analysts may have missed.'),
    p('Two 30-season halves differ in natural cycles as well as climate: the Atlantic Multidecadal Oscillation was largely in a quiet phase from about 1970 to 1994. This app counts storms; it does not attribute the change to a cause.'),
    p('The L (landfall) record type is used consistently only from 1991. Earlier landfalls come from NHC’s reanalysis project and are less complete.'),
    h('h2', { text: 'How to rebuild' }),
    p('The package’s pipeline/ folder fetches HURDAT2 and shapes it (fetch.sh, then shape_hurdat2.py). The two tables, atlantic_hurricanes__storms and atlantic_hurricanes__track_points, live in the community database, and hurricanes.malloy models them.'))
}
function footer() {
  return h('div', {}, h('h2', { text: 'Atlantic hurricanes' }),
    h('p', { text: 'Source: the Atlantic hurricane database (HURDAT2) of NOAA’s National Hurricane Center, a US government work in the public domain. Coastlines from Natural Earth via world-atlas. An independent app, not produced by NOAA.' }),
    h('p', {}, h('a', { href: 'https://www.nhc.noaa.gov/data/#hurdat', text: 'HURDAT2 at nhc.noaa.gov' })))
}

boot()
