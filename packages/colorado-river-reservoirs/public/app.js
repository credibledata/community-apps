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

// ---- State: the route and the scope, both in the address ----

const known = {} // filled by boot() from distinct-value queries
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
      // An empty answer can be a transient miss from the database, so ask twice more before accepting it.
      const ask = (tries) => Publisher.query(S.MODEL, q).then((rows) =>
        Array.isArray(rows) && rows.length === 0 && tries > 0
          ? new Promise((r) => setTimeout(r, 500)).then(() => ask(tries - 1))
          : rows)
      queue.push(() => ask(2).then(resolve, reject))
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
    // Both always have rows; an empty answer is a transient miss, so ask again before giving up.
    const nonEmpty = async (q) => {
      for (let i = 0; i < 3; i++) {
        const rows = await query(q)
        if (rows && rows.length && Object.values(rows[0]).some((v) => v != null)) return rows
        cache.delete(q)
        await new Promise((r) => setTimeout(r, 400 * (i + 1)))
      }
      throw new Error('the model returned no rows')
    }
    const [years, list] = await Promise.all([
      nonEmpty(`run: ${S.SOURCE} -> { aggregate: lo is min(water_year), hi is max(water_year) }`),
      nonEmpty(`run: ${S.SOURCE} -> reservoir_list`),
    ])
    known.years = [years[0].lo, years[0].hi]
    known.list = list
    for (const r of list) S.NAMES[r.short_name] = r.reservoir_name
    known.byId = Object.fromEntries(list.map((r) => [r.reservoir_id, r.short_name]))
    known.basin = [...new Set(list.map((r) => r.basin).filter(Boolean))].sort()
    known.reservoir = list.map((r) => r.short_name).filter(Boolean)
    known.entity = known.reservoir
    known.latest = list.map((r) => String(r.last_date).slice(0, 10)).sort().at(-1)
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Data through ${dateText(known.latest)}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Views ----

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))].filter(Boolean)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateText = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-'); return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}` }
const monthText = (d) => { const [y, m] = String(d).slice(0, 7).split('-'); return `${MONTHS[Number(m) - 1]} ${y}` }
const ft = (v, d = 2) => (Number.isFinite(v) ? `${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} ft` : 'n/a')
const ftSigned = (v, d = 2) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${ft(Math.abs(v), d)}` : 'n/a')
const maf = (v) => (Number.isFinite(v) ? `${(v / 1e6).toFixed(2)} maf` : 'n/a')
const LAKE = { Powell: '--c1', Mead: '--c2' }
const PART = { 'Lake Powell': '--c1', 'Lake Mead': '--c2', 'Other Upper Basin': '--c3', 'Other Lower Basin': '--c4' }
const entityLink = (id) => linkTo(S.ENTITY.view, id)

/** For one lake: its level, the nearest cited line above it and the nearest below, from thresholds -> against_now. */
function standing(lines, reservoirId) {
  const mine = lines.filter((l) => l.reservoir_id === reservoirId)
  const above = mine.filter((l) => l.feet_above < 0).sort((a, b) => a.threshold_ft - b.threshold_ft)[0]
  const below = mine.filter((l) => l.feet_above >= 0).sort((a, b) => b.threshold_ft - a.threshold_ft)[0]
  return { level: mine[0]?.level_ft, date: mine[0]?.level_date, above, below }
}

function lakeSentence(name, s) {
  const parts = [{ b: name }, ' stood at ', { b: ft(s.level) }]
  if (s.above) parts.push(', ', { b: ft(Math.abs(s.above.feet_above)) }, ` below the ${ft(s.above.threshold_ft, 0)} line (${s.above.label})`)
  if (s.below) parts.push(`${s.above ? ' and' : ','} `, { b: ft(s.below.feet_above) }, ` above ${ft(s.below.threshold_ft, 0)} (${s.below.label})`)
  return parts
}

function overview() {
  const qK = `run: ${S.HEADLINE} -> kpis`
  const qT = 'run: thresholds -> against_now'
  const qL = `run: ${S.HEADLINE} -> long_line`
  const answer = h('p', { class: 'answer' })
  Promise.all([query(qT)]).then(([lines]) => {
    const mead = standing(lines, '921')
    const powell = standing(lines, '919')
    answer.replaceChildren(...prose([`On ${dateText(mead.date)}, `, ...lakeSentence('Lake Mead', mead), '. ', ...lakeSentence('Lake Powell', powell), '.']))
  })
  const [kicker, title, lede] = viewHead(
    'How close are Lake Powell and Lake Mead to the lines that cut the river’s water?',
    'The 2007 Interim Guidelines tie how much water the Lower Basin gets, and how much Glen Canyon Dam releases, to the elevation of the two big reservoirs on the river’s main stem. Reclamation reads both lakes every day.'
  )
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    tile({
      title: 'Where the two lakes stand', cls: 'headline',
      queries: () => [qK, qT, qL],
      explain: ['Each lake’s latest end-of-day elevation and storage, the same a year earlier, and storage against its record high.', 'Each cited operating line, with the lake’s latest level and the feet between them.', 'Monthly average elevation and storage of each lake since it began filling, for the sparklines.'],
      draw: ([k, , long], body) => {
        const row = (n) => k.find((r) => r.short_name === n)
        const grid = h('div', { class: 'kpis' })
        for (const n of ['Mead', 'Powell']) {
          const r = row(n)
          if (!r) continue
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          grid.append(
            h('div', { class: 'kpi kpi--accent' }, h('div', { class: 'kpi__label', text: `${r.reservoir_name}, elevation` }), h('div', { class: 'kpi__value', text: ft(r.latest_elevation_ft) }), h('div', { class: 'kpi__sub' }, `on ${dateText(r.last_date)}`), svg),
            h('div', { class: 'kpi' }, h('div', { class: 'kpi__label', text: `${n}, past year` }), h('div', { class: `kpi__value delta--${r.elevation_change_1y_ft < 0 ? 'up' : 'down'}`, text: ftSigned(r.elevation_change_1y_ft) }), h('div', { class: 'kpi__sub' }, 'storage ', h('strong', { text: C.pct(r.pct_of_record_storage) }), ' of its record high')))
          const vals = long.filter((x) => x.short_name === n).slice(-120).map((x) => x.avg_storage_af)
          requestAnimationFrame(() => C.sparkline(svg, vals, LAKE[n]))
        }
        body.append(grid)
      },
      finding: ([k]) => {
        const m = k.find((r) => r.short_name === 'Mead'), p = k.find((r) => r.short_name === 'Powell')
        return [{ b: 'Mead' }, ` holds ${C.pct(m.pct_of_record_storage)} of its record-high storage and `, { b: 'Powell' }, ` ${C.pct(p.pct_of_record_storage)}.`]
      },
      method: 'The record high is the most each lake has held in Reclamation’s daily file, not its design capacity, which the file does not carry. The sparklines are each lake’s average storage, month by month, over the last ten years.',
    }),
    tile({
      title: 'Elevation since Lake Powell began filling, against each lake’s operating lines', cls: 'span-2 lead',
      sub: 'Monthly average of the end-of-day elevation. Each dashed line is a level the 2007 guidelines act on.',
      queries: () => [qL, qT],
      explain: ['Monthly average and lowest end-of-day elevation of Powell and Mead since each began filling.', 'The operating lines cited from the 2007 Record of Decision, with each lake’s latest level.'],
      draw: ([long, lines], body) => {
        const powellStart = long.find((r) => r.short_name === 'Powell')?.m
        for (const [n, id] of [['Powell', '919'], ['Mead', '921']]) {
          const rows = long.filter((r) => r.short_name === n && r.m >= powellStart)
          const refs = lines.filter((l) => l.reservoir_id === id).map((l) => ({ y: l.threshold_ft, label: ft(l.threshold_ft, 0) }))
          body.append(h('h4', { class: 'chart-title', text: S.NAMES[n] }))
          const last = rows.length - 1
          C.lines(chartBox(body), rows.map((r) => String(r.m).slice(0, 7)), [{ name: n, values: rows.map((r) => r.avg_elevation_ft), color: LAKE[n] }], {
            refs, beginAtZero: false, endLabels: false, format: (v) => ft(v, 0), height: 260, label: `${S.NAMES[n]} monthly elevation`,
            points: [{ series: 0, index: last, text: `${monthText(rows[last].m)}: ${ft(rows[last].avg_elevation_ft, 0)}` }],
          })
        }
      },
      finding: ([long, lines]) => {
        const out = []
        for (const [n, id] of [['Mead', '921'], ['Powell', '919']]) {
          const top = lines.filter((l) => l.reservoir_id === id).sort((a, b) => b.threshold_ft - a.threshold_ft).find((l) => l.feet_above < 0)
          if (!top) continue
          const rows = long.filter((r) => r.short_name === n)
          const lastAbove = [...rows].reverse().find((r) => r.avg_elevation_ft >= top.threshold_ft)
          if (lastAbove) out.push(out.length ? ' ' : '', { b: n }, `’s monthly average was last at or above ${ft(top.threshold_ft, 0)} in ${monthText(lastAbove.m)}.`)
        }
        return out
      },
      method: 'Both lakes are drawn from the month Lake Powell began filling; Lake Mead’s earlier years are on its own page. Lines are cited from Reclamation’s 2007 Record of Decision, not read from the data. Powell’s 3,700 ft equalization line is the table’s figure; the guidelines move the real boundary between about 3,636 and 3,666 ft from year to year. Mead’s shortage tiers are set by Reclamation’s August projection of the January 1 level, not by the daily reading.',
    }),
    h('section', { class: 'section' },
      h('div', { class: 'section__head' }, h('h2', { text: 'Go further' }), h('p', { text: 'Every reservoir Reclamation reads on the Colorado and its tributaries, year by year.' })),
      h('div', { class: 'leads' },
        h('a', { class: 'lead-card', href: linkTo('explore') }, h('strong', { text: 'Days below the lines' }), h('span', { text: 'How many days a year each lake spent under its operating lines →' })),
        h('a', { class: 'lead-card', href: entityLink('Powell') }, h('strong', { text: 'Lake Powell' }), h('span', { text: 'Its daily level, releases, inflow and evaporation →' })),
        h('a', { class: 'lead-card', href: entityLink('Mead') }, h('strong', { text: 'Lake Mead' }), h('span', { text: 'Its daily level and releases from Hoover Dam →' })))),
    h('section', { class: 'section' },
      h('div', { class: 'section__head' }, h('h2', { text: 'In the news' }), h('p', { text: 'The article this app responds to.' })),
      h('p', { class: 'article' }, h('a', { href: 'https://grist.org/drought/as-the-colorado-river-shrinks-calls-to-drain-lake-powell-grow/', target: '_blank', rel: 'noopener', text: 'As the Colorado River shrinks, calls to drain Lake Powell grow' }), ' — Grist')))
}

function explore() {
  const band = () => (scope.from || scope.to ? { from: String(scope.from ?? known.years[0]), to: String(scope.to ?? known.years[1]) } : undefined)
  const setYears = (a, b) => setScope({ from: Number(a), to: Number(b) })
  const pickYear = (y) => (scope.from === Number(y) && scope.to === Number(y) ? setScope({ from: null, to: null }) : setYears(y, y))
  const full = (q) => q.replace(/ \+ \{ where: /, ' + { where: is_full_water_year and ').replace(/^(run: \w+ -> \w+)$/, '$1 + { where: is_full_water_year }')
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore', 'Click a reservoir, a year or a cell to filter every card; click it again to clear. The address keeps what you chose.'),
    section('Where the water stands now', 'The latest reading of every reservoir. These cards always show the latest day, whatever years are chosen.',
      tile({
        title: 'Emptiest first', sub: 'Storage against each reservoir’s record high, with its yearly lows. Click a row to filter; the name opens its page.', cls: 'span-2',
        queries: () => [S.tileQuery('standing', scope, known), S.tileQuery('lows', scope, known)],
        explain: ['Each reservoir’s latest storage against its record high, and its change in elevation over 365 days.', 'Each reservoir’s lowest end-of-day elevation in every water year, in feet below the highest level it reached in the years in scope, for the trend.'],
        draw: ([rows, lows], body) => C.rankTable(body, [...rows].sort((a, b) => a.pct_of_record_storage - b.pct_of_record_storage).map((r) => ({
          id: r.short_name, name: r.reservoir_name, sub: `${r.basin} Basin · ${r.river}`, value: r.pct_of_record_storage,
          trend: lows.filter((x) => x.short_name === r.short_name).map((x) => x.low_below_top_ft), change: r.elevation_change_1y_ft,
        })), { valueLabel: 'Storage, share of record', format: (v) => C.pct(v, 0), trendLabel: 'Yearly low, below its top', changeLabel: 'Elevation, past year', changeFormat: (v) => ft(v, 1), good: 'rise', limit: 11, selected: scope.reservoir, onOpen: (id) => toggleScope('reservoir', id), href: entityLink }),
        finding: ([rows]) => { const r = [...rows].sort((a, b) => a.pct_of_record_storage - b.pct_of_record_storage)[0]; return [{ b: r.reservoir_name }, ` holds the smallest share of its record high, ${C.pct(r.pct_of_record_storage)}.`] },
        method: 'The record high is the most a reservoir has held in Reclamation’s file, not its design capacity. The trend follows the years chosen; the share and the change are always the latest day.',
      }),
      tile({
        title: 'Up or down in a year', sub: 'Change in elevation over the last 365 days. Click a bar to filter.', cls: 'span-2',
        queries: () => [S.tileQuery('change', scope, known)],
        explain: ['Each reservoir’s latest end-of-day elevation minus the same 365 days earlier.'],
        draw: ([rows], body) => C.divergingBars(chartBox(body), [...rows].sort((a, b) => a.elevation_change_1y_ft - b.elevation_change_1y_ft).map((r) => ({ id: r.short_name, label: r.reservoir_name, value: r.elevation_change_1y_ft, strong: r.short_name === scope.reservoir })), { format: (v) => ftSigned(v, 1), good: 'rise', selected: scope.reservoir, onPick: (id) => toggleScope('reservoir', id), label: 'Change in elevation over a year' }),
        finding: ([rows]) => { const s = [...rows].sort((a, b) => a.elevation_change_1y_ft - b.elevation_change_1y_ft); const lo = s[0], hi = s.at(-1); return [{ b: lo.reservoir_name }, ` fell most, ${ftSigned(lo.elevation_change_1y_ft)}; `, { b: hi.reservoir_name }, hi.elevation_change_1y_ft > 0 ? ` rose most, ${ftSigned(hi.elevation_change_1y_ft)}.` : ` fell least, ${ftSigned(hi.elevation_change_1y_ft)}.`] },
        method: 'Feet are not comparable in volume between reservoirs: a foot of Lake Mead holds far more water than a foot of Crystal.',
      })),
    section('Year by year', 'Water years run October to September. Drag across a chart, or click a year, to choose a period.',
      tile({
        title: 'What the system held each September 30', sub: 'End-of-water-year storage, stacked by part of the system. Drag to choose years.', cls: 'span-2',
        queries: () => [S.tileQuery('system', scope, known, '', ['from', 'to'])],
        explain: ['Storage on September 30 of each water year, summed by part of the system, for the reservoirs in scope.'],
        draw: ([rows], body) => {
          const yrs = [...new Set(rows.map((r) => r.water_year))].sort((a, b) => a - b)
          const parts = ['Lake Mead', 'Lake Powell', 'Other Upper Basin', 'Other Lower Basin'].filter((p) => rows.some((r) => r.system_part === p))
          C.area(chartBox(body), yrs.map(String), parts.map((p) => ({ name: p, color: PART[p], values: yrs.map((y) => rows.find((r) => r.water_year === y && r.system_part === p)?.wy_end_storage_af ?? 0) })), { format: maf, band: band(), onBrush: setYears, height: 300, label: 'End-of-year storage' })
        },
        finding: ([rows]) => {
          const yrs = [...new Set(rows.map((r) => r.water_year))].sort((a, b) => a - b)
          const y = yrs.at(-1), parts = rows.filter((r) => r.water_year === y)
          const big = parts.sort((a, b) => b.wy_end_storage_af - a.wy_end_storage_af)[0]
          return [`On September 30, ${y}, `, { b: big.system_part }, ` held the most, ${maf(big.wy_end_storage_af)}.`]
        },
        method: 'A reservoir adds to the stack from its first September 30 in the file, so the early years hold fewer reservoirs. The year under way is not shown until it ends.',
      }),
      tile({
        title: 'Days below the operating lines', sub: 'Days each water year Powell and Mead spent below their first two cited lines. Click a cell to choose that year.', cls: 'span-2',
        queries: () => [S.sourceQuery(S.HEADLINE, 'days_below_lines', scope, known, ['reservoir'])],
        explain: ['For Powell and Mead in each water year, the days with an end-of-day elevation below the first and second lines from the 2007 guidelines.'],
        draw: ([rows], body) => {
          const yrs = [...new Set(rows.map((r) => r.water_year))].sort((a, b) => a - b).map(String)
          const lineName = { Mead: ['1,075 ft', '1,050 ft'], Powell: ['3,575 ft', '3,525 ft'] }
          const cells = [], order = []
          for (const n of ['Mead', 'Powell']) {
            if (!rows.some((r) => r.short_name === n)) continue
            const [a, b] = lineName[n]
            order.push(`${n} below ${a}`, `${n} below ${b}`)
            for (const r of rows.filter((x) => x.short_name === n)) cells.push({ row: `${n} below ${a}`, col: String(r.water_year), value: r.days_below_first }, { row: `${n} below ${b}`, col: String(r.water_year), value: r.days_below_second })
          }
          C.heatmap(chartBox(body), order, yrs.length > 40 ? yrs.slice(-40) : yrs, cells, { format: (v) => `${C.fmt(v)} days`, onPick: (_, col) => pickYear(col), selected: scope.from && scope.from === scope.to ? { col: String(scope.from) } : undefined, label: 'Days below the operating lines' })
        },
        finding: ([rows]) => {
          const full = rows.filter((r) => r.reading_days >= 365)
          const y = Math.max(...full.map((r) => r.water_year))
          const m = full.find((r) => r.water_year === y && r.short_name === 'Mead'), p = full.find((r) => r.water_year === y && r.short_name === 'Powell')
          const out = [`In water year ${y}, `]
          if (m) out.push({ b: 'Mead' }, ` spent ${m.days_below_first} days below 1,075 ft and ${m.days_below_second} below 1,050 ft`)
          if (m && p) out.push('; ')
          if (p) out.push({ b: 'Powell' }, ` ${p.days_below_first} days below 3,575 ft and ${p.days_below_second} below 3,525 ft`)
          out.push('.')
          return out
        },
        method: 'Lines are cited from the 2007 Record of Decision (Mead Sec. 2.D.1, Powell Sec. 6). The guidelines act on projected levels on set dates, so a day below a line is not a day under a shortage. The most recent 40 water years are drawn when more are in scope.',
      }),
      tile({
        title: 'Water through Glen Canyon and Hoover dams', sub: 'Water released from Powell and Mead, and flowing into Powell, per full water year. Click a year to choose it.', cls: 'span-2',
        queries: () => [full(S.sourceQuery(S.HEADLINE, 'by_water_year', scope, known, ['from', 'to', 'reservoir', 'basin']))],
        explain: ['For Powell and Mead in each complete water year, the release and the inflow in acre-feet, from Reclamation’s daily mean flows.'],
        draw: ([rows], body) => {
          const yrs = [...new Set(rows.map((r) => r.water_year))].sort((a, b) => a - b)
          const get = (n, f) => yrs.map((y) => rows.find((r) => r.water_year === y && r.short_name === n)?.[f] ?? null)
          C.lines(chartBox(body), yrs.map(String), [
            { name: 'Powell inflow', values: get('Powell', 'inflow_af'), color: '--c1', dashed: true },
            { name: 'Powell release', values: get('Powell', 'release_af'), color: '--c1' },
            { name: 'Mead release', values: get('Mead', 'release_af'), color: '--c2' },
          ], { format: maf, band: band(), onPick: pickYear, onBrush: setYears, height: 300, label: 'Water released and flowing in' })
        },
        finding: ([rows]) => {
          const y = Math.max(...rows.map((r) => r.water_year))
          const p = rows.find((r) => r.water_year === y && r.short_name === 'Powell'), m = rows.find((r) => r.water_year === y && r.short_name === 'Mead')
          return [`In water year ${y}, `, { b: 'Powell' }, ` took in ${maf(p?.inflow_af)} and released ${maf(p?.release_af)}; `, { b: 'Mead' }, ` released ${maf(m?.release_af)}.`]
        },
        method: 'Flows are daily mean cubic feet per second times 1.98347, summed over the year; Reclamation’s official annual release figures can differ slightly. Reclamation publishes no inflow for Mead. This card shows both lakes whatever basin or reservoir is chosen.',
      }),
      tile({
        title: 'How far each reservoir drew down', sub: 'Each water year’s lowest level, in feet below the highest level the reservoir reached in the years shown.', cls: 'span-2',
        queries: () => [S.tileQuery('lows', scope, known)],
        explain: ['Each reservoir’s lowest end-of-day elevation in every water year in scope, and that low minus the highest end-of-day elevation it reached in those years.'],
        draw: ([rows], body) => {
          const names = [...new Set(rows.map((r) => r.short_name))]
          C.multiples(chartBox(body), names.map((n) => { const rs = rows.filter((r) => r.short_name === n); return { title: S.NAMES[n] || n, xs: rs.map((r) => String(r.water_year)), values: rs.map((r) => r.low_below_top_ft), accent: n === 'Powell' || n === 'Mead' } }), { format: (v) => ftSigned(v, 0) })
        },
        finding: ([rows]) => {
          const y = Math.max(...rows.map((r) => r.water_year))
          const lowNow = [...new Set(rows.map((r) => r.short_name))].filter((n) => { const rs = rows.filter((r) => r.short_name === n && r.water_year !== y); const now = rows.find((r) => r.short_name === n && r.water_year === y - 1); return now && rs.length > 5 && rs.every((r) => r.min_elevation_ft >= now.min_elevation_ft) })
          return lowNow.length ? [`In water year ${y - 1}, `, ...lowNow.flatMap((n, i) => [i ? ', ' : '', { b: S.NAMES[n] }]), ` hit the lowest yearly low in the years shown.`] : `No reservoir set a new yearly low in water year ${y - 1} within the years shown.`
        },
        method: 'Zero is the highest end-of-day level each reservoir reached in the years in scope, so choosing years moves the top. A reservoir’s first years are its filling, when lows sit far below anything since: choose later years to see recent drawdowns.',
      })))
}

const only = (patch) => ({ ...S.DEFAULT_SCOPE, ...patch })
const fullYears = (q) => q.replace(/ \+ \{ where: /, ' + { where: is_full_water_year and ').replace(/^(run: \w+ -> \w+)$/, '$1 + { where: is_full_water_year }')
const LINE_ID = { Powell: '919', Mead: '921' }

function entity() {
  const id = route.id
  const name = S.ENTITY.label(id)
  const qNow = S.sourceQuery(S.SOURCE, 'current_levels', only({ reservoir: id }), known)
  const qLines = 'run: thresholds -> against_now'
  const hasLines = id in LINE_ID
  const inCompare = route.compare || []
  return h('div', { class: 'view wrap' },
    ...viewHead(name, null, [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${name}`]),
    h('p', { class: 'actions' }, h('a', { class: 'button', href: linkTo('compare', null, [...new Set([...inCompare, id])]), text: 'Add to compare →' })),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Where it stands', cls: 'span-2 headline',
        queries: () => [qNow],
        explain: [`${name}’s latest end-of-day elevation and storage, the same 365 days earlier, and storage against its record high. Always the latest day, whatever years are chosen.`],
        draw: ([[r]], body) => body.append(h('div', { class: 'kpis' },
          h('div', { class: 'kpi kpi--accent' }, h('div', { class: 'kpi__label', text: 'Elevation' }), h('div', { class: 'kpi__value', text: ft(r.latest_elevation_ft) }), h('div', { class: 'kpi__sub', text: `on ${dateText(r.last_date)}` })),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi__label', text: 'Past year' }), h('div', { class: `kpi__value delta--${r.elevation_change_1y_ft < 0 ? 'up' : 'down'}`, text: ftSigned(r.elevation_change_1y_ft) }), h('div', { class: 'kpi__sub', text: `from ${ft(r.year_ago_elevation_ft)}` })),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi__label', text: 'Storage' }), h('div', { class: 'kpi__value', text: maf(r.latest_storage_af) }), h('div', { class: 'kpi__sub', text: `${r.storage_change_1y_af < 0 ? 'down' : 'up'} ${maf(Math.abs(r.storage_change_1y_af))} on the year` })),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi__label', text: 'Share of record' }), h('div', { class: 'kpi__value', text: C.pct(r.pct_of_record_storage) }), h('div', { class: 'kpi__sub', text: `record ${maf(r.max_storage_af)}` })))),
        finding: ([[r]]) => [{ b: r.reservoir_name }, `, on the ${r.river} in the ${r.basin} Basin, holds ${C.pct(r.pct_of_record_storage)} of the most it has held.`],
        method: 'The record high is the most the reservoir has held in Reclamation’s daily file, not its design capacity, which the file does not carry.',
      }),
      tile({
        title: 'The water year, year over year', cls: 'span-2',
        sub: 'Each line is one water year’s weekly average elevation from October 1. The year under way is in the accent; the last full year in grey-blue.',
        queries: () => [S.entityQuery('seasonal_weekly', id, scope, known)],
        explain: [`${name}’s average elevation in each week of every water year in scope, week 1 starting October 1.`],
        draw: ([rows], body) => {
          const yrs = [...new Set(rows.map((r) => r.water_year))].sort((a, b) => a - b).slice(-30)
          const days = Array.from({ length: 53 }, (_, k) => k + 1)
          const last = yrs.at(-1)
          const series = yrs.map((y) => {
            const m = new Map(rows.filter((r) => r.water_year === y).map((r) => [r.wy_week, r.avg_elevation_ft]))
            return { name: `WY ${y}`, values: days.map((d) => m.get(d) ?? null), color: y === last ? '--accent' : y === last - 1 ? '--c-bar' : '--border-strong' }
          })
          C.lines(chartBox(body), days.map(String), series, { beginAtZero: false, endLabels: false, format: (v) => ft(v, 0), height: 320, label: `${name} elevation by week of the water year` })
        },
        finding: ([rows]) => {
          const yrs = [...new Set(rows.map((r) => r.water_year))].sort((a, b) => a - b)
          const y = yrs.at(-1), cur = rows.filter((r) => r.water_year === y)
          const d = cur.at(-1)?.wy_week
          const prior = yrs.slice(0, -1).map((yy) => rows.find((r) => r.water_year === yy && r.wy_week === d)).filter(Boolean)
          const lower = prior.filter((r) => r.avg_elevation_ft < cur.at(-1).avg_elevation_ft).length
          return [`In week ${d} of water year ${y}, `, { b: name }, ` averaged ${ft(cur.at(-1).avg_elevation_ft)}, higher than in the same week of ${lower} of the ${prior.length} earlier water years shown.`]
        },
        method: 'The chart draws the last 30 water years in scope; the finding counts every earlier year in scope. A reservoir’s seasonal shape is set by snowmelt and by how Reclamation runs it, so it differs from dam to dam.',
      }),
      tile({
        title: 'Elevation, week by week', cls: 'span-2',
        sub: hasLines ? 'Weekly average of the end-of-day elevation, with the lines the 2007 guidelines act on.' : 'Weekly average of the end-of-day elevation.',
        queries: () => [S.entityQuery('by_week', id, scope, known, 'limit: 6000; order_by: wk'), ...(hasLines ? [qLines] : [])],
        explain: [`${name}’s weekly average elevation over the years in scope.`, ...(hasLines ? ['The operating lines cited from the 2007 Record of Decision.'] : [])],
        draw: ([rows, lines], body) => {
          const refs = (lines || []).filter((l) => l.reservoir_id === LINE_ID[id]).map((l) => ({ y: l.threshold_ft, label: ft(l.threshold_ft, 0) }))
          C.lines(chartBox(body), rows.map((r) => String(r.wk).slice(0, 10)), [{ name, values: rows.map((r) => r.avg_elevation_ft), color: LAKE[id] || '--accent' }], { beginAtZero: false, endLabels: false, refs, format: (v) => ft(v, 0), height: 280, label: `${name} weekly elevation` })
        },
        finding: ([rows]) => {
          const ok = rows.filter((r) => Number.isFinite(r.avg_elevation_ft))
          const lo = ok.reduce((a, b) => (b.avg_elevation_ft < a.avg_elevation_ft ? b : a)), hi = ok.reduce((a, b) => (b.avg_elevation_ft > a.avg_elevation_ft ? b : a))
          return ['In the years shown, ', { b: name }, `’s weekly average ran from ${ft(lo.avg_elevation_ft)} in the week of ${dateText(lo.wk)} to ${ft(hi.avg_elevation_ft)} in the week of ${dateText(hi.wk)}.`]
        },
        method: hasLines ? 'Lines are cited from Reclamation’s 2007 Record of Decision, not read from the data; the Overview names each tier. The guidelines act on projected levels on set dates, not on the daily reading.' : 'Weeks start on Sunday. The first weeks of a reservoir are its filling.',
      }),
      tile({
        title: 'Water in and out, per water year', cls: 'span-2',
        sub: 'Release, inflow and evaporation in each full water year, where Reclamation reports them.',
        queries: () => [fullYears(S.entityQuery('by_water_year', id, scope, known))],
        explain: [`${name}’s release, inflow and evaporation in each complete water year in scope, in acre-feet.`],
        draw: ([rows], body) => {
          const s = [['Inflow', 'inflow_af', '--accent', true], ['Release', 'release_af', '--c-bar', false], ['Evaporation', 'evaporation_total_af', '--c4', false]]
            .filter(([, f]) => rows.some((r) => Number.isFinite(r[f]) && r[f] > 0))
            .map(([n, f, c, d]) => ({ name: n, values: rows.map((r) => r[f] ?? null), color: c, dashed: d }))
          if (!s.length) { body.append(h('p', { class: 'state', text: 'Reclamation reports no flows for this reservoir.' })); return }
          C.lines(chartBox(body), rows.map((r) => String(r.water_year)), s, { format: maf, height: 280, onPick: (y) => (scope.from === Number(y) && scope.to === Number(y) ? setScope({ from: null, to: null }) : setScope({ from: Number(y), to: Number(y) })), label: `${name} water in and out` })
        },
        finding: ([rows]) => {
          const r = rows.at(-1)
          if (!r) return 'No full water year in scope.'
          const parts = [`In water year ${r.water_year}, `, { b: name }]
          if (Number.isFinite(r.inflow_af)) parts.push(` took in ${maf(r.inflow_af)}`)
          if (Number.isFinite(r.release_af)) parts.push(`${Number.isFinite(r.inflow_af) ? ' and' : ''} released ${maf(r.release_af)}`)
          if (parts.length === 2) parts.push(' has no reported flows')
          parts.push('.')
          return parts
        },
        method: 'Flows are daily mean cubic feet per second times 1.98347, summed over the year, so they can differ slightly from Reclamation’s official annual figures. The year under way is left out until it ends.',
      }),
      tile({
        title: 'Latest readings', cls: 'span-2',
        queries: () => [S.entityQuery('records', id, scope, known, 'limit: 10; order_by: reading_date desc')],
        explain: [`${name}’s ten most recent daily readings in scope.`],
        draw: ([rows], body) => body.append(recordsTable(rows)),
        finding: ([rows]) => (rows[0] ? ['The latest reading in scope is from ', { b: dateText(rows[0].reading_date) }, '.'] : 'No readings in scope.'),
        method: 'Values are as Reclamation publishes them; a blank is a value it did not report.',
      })))
}

function recordsTable(rows) {
  const num = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '')
  return h('div', { class: 'table-scroll' }, h('table', { class: 'records' },
    h('thead', {}, h('tr', {}, ...['Date', 'Reservoir', 'Elevation (ft)', 'Storage (af)', 'Inflow (cfs)', 'Release (cfs)', 'Evaporation (af)'].map((t, k) => h('th', { class: k > 1 ? 'num' : '', text: t })))),
    h('tbody', {}, ...rows.map((r) => {
      const sid = known.byId[r.reservoir_id]
      return h('tr', {}, h('td', { text: String(r.reading_date).slice(0, 10) }), h('td', {}, sid ? h('a', { href: entityLink(sid), text: r.reservoir_name }) : r.reservoir_name),
        h('td', { class: 'num', text: num(r.elevation_ft, 2) }), h('td', { class: 'num', text: num(r.storage_af) }), h('td', { class: 'num', text: num(r.inflow_cfs) }), h('td', { class: 'num', text: num(r.release_cfs) }), h('td', { class: 'num', text: num(r.evaporation_af) }))
    }))))
}

let recordLimit = 50
function records() {
  return h('div', { class: 'view wrap' },
    ...viewHead('Records', 'Every daily reading in scope, newest first. Each reservoir’s name opens its page.'),
    tile({
      title: 'Daily readings', cls: 'span-2',
      queries: () => [S.viewQuery('records', scope, known, [], `limit: ${recordLimit}; order_by: reading_date desc`), S.viewQuery('reservoir_list', scope, known, [], '').replace('reservoir_list', '{ aggregate: reading_count is count() }')],
      explain: ['The readings in scope, newest first.', 'How many daily readings are in scope.'],
      draw: ([rows, [n]], body) => {
        body.append(recordsTable(rows))
        if (rows.length < n.reading_count) body.append(h('p', { class: 'more' }, h('button', { class: 'button', type: 'button', text: 'Show 50 more', onclick: () => { recordLimit += 50; render() } })))
      },
      finding: ([rows, [n]]) => [`Showing ${C.fmt(rows.length)} of `, { b: C.fmt(n.reading_count) }, ' readings in scope.'],
      method: 'One row per reservoir per day, as Reclamation publishes it; a blank is a value it did not report.',
    }))
}

function compare() {
  const ids = route.compare || []
  const add = h('select', { 'aria-label': 'Add a reservoir', onchange: (e) => e.target.value && go({ view: 'compare', id: null, compare: [...ids, e.target.value] }) },
    h('option', { value: '', text: ids.length >= S.COMPARE_MAX ? 'Four is the most' : 'Add a reservoir…' }),
    ...known.reservoir.filter((r) => !ids.includes(r)).map((r) => h('option', { value: r, text: S.NAMES[r] })))
  if (ids.length >= S.COMPARE_MAX) add.disabled = true
  const chips = h('p', { class: 'compare-picks' }, ...ids.map((r) => h('button', { class: 'chip', type: 'button', text: `${S.NAMES[r]} ×`, onclick: () => go({ view: 'compare', id: null, compare: ids.filter((x) => x !== r) }) })), add)
  const head = viewHead('Compare', 'Up to four reservoirs side by side. Pick them below, or from a reservoir’s page.')
  if (!ids.length) return h('div', { class: 'view wrap' }, ...head, chips, h('p', { class: 'state', text: 'Pick a reservoir to start.' }))
  const color = (r) => LAKE[r] || ['--c3', '--c4', '--c5', '--c6'][ids.indexOf(r) % 4]
  return h('div', { class: 'view wrap' }, ...head, chips,
    h('div', { class: 'grid-2' },
      tile({
        title: 'Where they stand', cls: 'span-2',
        queries: () => [`run: ${S.SOURCE} -> current_levels`],
        explain: ['Every reservoir’s latest level and storage and its change over a year; the ones being compared are kept.'],
        draw: ([rows], body) => C.rankTable(body, rows.filter((r) => ids.includes(r.short_name)).sort((a, b) => a.pct_of_record_storage - b.pct_of_record_storage).map((r) => ({ id: r.short_name, name: r.reservoir_name, sub: `${ft(r.latest_elevation_ft)} · ${maf(r.latest_storage_af)}`, value: r.pct_of_record_storage, change: r.elevation_change_1y_ft })), { valueLabel: 'Storage, share of record', format: (v) => C.pct(v, 0), changeLabel: 'Elevation, past year', changeFormat: (v) => ft(v, 1), good: 'rise', href: entityLink }),
        finding: ([rows]) => { const r = rows.filter((x) => ids.includes(x.short_name)).sort((a, b) => a.pct_of_record_storage - b.pct_of_record_storage)[0]; return [{ b: r.reservoir_name }, ` is the emptiest of these, at ${C.pct(r.pct_of_record_storage)} of its record high.`] },
        method: 'Always the latest day, whatever years are chosen.',
      }),
      tile({
        title: 'How far each drew down, year by year', cls: 'span-2',
        sub: 'Each water year’s lowest level, in feet below the highest level that reservoir reached in the years shown.',
        queries: () => [fullYears(S.compareQuery('yearly_drawdown', ids, scope, known))],
        explain: ['For each reservoir compared, its lowest end-of-day elevation each complete water year minus the highest it reached in those years.'],
        draw: ([rows], body) => {
          const yrs = [...new Set(rows.map((r) => r.water_year))].sort((a, b) => a - b)
          C.lines(chartBox(body), yrs.map(String), ids.map((r) => ({ name: S.NAMES[r], color: color(r), values: yrs.map((y) => rows.find((x) => x.water_year === y && x.short_name === r)?.low_below_top_ft ?? null) })), { format: (v) => ftSigned(v, 0), height: 300, label: 'Yearly drawdown' })
        },
        finding: ([rows]) => { const y = Math.max(...rows.map((r) => r.water_year)); const r = rows.filter((x) => x.water_year === y).sort((a, b) => a.low_below_top_ft - b.low_below_top_ft)[0]; return r ? [`In water year ${y}, `, { b: S.NAMES[r.short_name] }, ` drew down furthest, ${ftSigned(r.low_below_top_ft)} from its top.`] : '' },
        method: 'Feet are not volumes: a foot of a big lake holds far more water than a foot of a small one. Zero is each reservoir’s own top in the years in scope.',
      })))
}

function about() {
  const src = (t, href) => h('a', { href, target: '_blank', rel: 'noopener', text: t })
  return h('div', { class: 'view wrap prose-view' },
    ...viewHead('About the data', 'Where every number comes from, what was reshaped, and what to keep in mind.'),
    h('h2', { text: 'Sources' }),
    h('ul', {},
      h('li', {}, src('U.S. Bureau of Reclamation, HydroData', 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data/site_map.html'), ': daily end-of-day elevation, storage, inflow, release and evaporation for eleven reservoirs of the Colorado River system, from Reclamation’s Upper and Lower Colorado regions. A work of the U.S. federal government, in the public domain.'),
      h('li', {}, src('Colorado River Interim Guidelines for Lower Basin Shortages and Coordinated Operations for Lake Powell and Lake Mead, Record of Decision (2007)', 'https://www.usbr.gov/lc/region/programs/strategies/RecordofDecision.pdf'), ': the operating lines drawn on the charts, typed from the document into the package’s thresholds file with the section each comes from. Lake Mead’s shortage tiers are in Section 2.D.1; Lake Powell’s release tiers in Section 6.')),
    h('p', { id: 'data-latest' }, `The latest reading is from ${dateText(known.latest)}.`),
    h('h2', { text: 'What was reshaped' }),
    h('ul', {},
      h('li', { text: 'Reclamation’s files, one per reservoir and measure, were joined into one row per reservoir per day.' }),
      h('li', { text: 'Water years run October 1 to September 30 and are named for the year they end in, as Reclamation reports them.' }),
      h('li', { text: 'Yearly flows are daily mean cubic feet per second times 1.98347 acre-feet per cfs-day, summed over the water year.' }),
      h('li', { text: 'A reservoir’s “record high” is the most it has held in the file, used in place of design capacity, which the files do not carry.' })),
    h('h2', { text: 'Keep in mind' }),
    h('ul', {},
      h('li', { text: 'The 2007 Interim Guidelines govern operations through 2026. Reclamation is preparing the rules that follow them; the lines drawn here are the 2007 ones.' }),
      h('li', { text: 'Lake Mead’s shortage tiers are set each August from Reclamation’s 24-Month Study projection of the January 1 elevation, not from the daily reading. A day below a line is not a day under a shortage.' }),
      h('li', { text: 'Lake Powell’s 3,700 ft equalization line is the table’s figure; the guidelines set the real boundary each year from a schedule, between about 3,636 and 3,666 ft over the guidelines’ years.' }),
      h('li', { text: 'Later agreements, such as the 2019 Drought Contingency Plan, add contributions at further Lake Mead elevations. They are not drawn here.' }),
      h('li', { text: 'Reclamation publishes provisional data; recent days can be revised.' })),
    h('h2', { text: 'Rebuild it' }),
    h('p', {}, 'The package’s pipeline folder holds the scripts that download Reclamation’s files and shape them into the three tables the app reads, in the community-apps environment’s community database. Run ', h('code', { text: 'pipeline/fetch.sh' }), ', then ', h('code', { text: 'python3 pipeline/shape_readings.py' }), ', and load each file it writes as a table.'),
    h('p', {}, 'This app responds to Grist’s ', src('As the Colorado River shrinks, calls to drain Lake Powell grow', 'https://grist.org/drought/as-the-colorado-river-shrinks-calls-to-drain-lake-powell-grow/'), '.'))
}

function footer() {
  return h('div', {}, h('h2', { text: 'Colorado River reservoirs' }),
    h('p', {}, 'Source: U.S. Bureau of Reclamation, ', h('a', { href: 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data/site_map.html', text: 'HydroData daily reservoir data' }), ' (public domain), and the ', h('a', { href: 'https://www.usbr.gov/lc/region/programs/strategies/RecordofDecision.pdf', text: '2007 Interim Guidelines Record of Decision' }), '. An independent app, not produced by Reclamation.'))
}

boot()
