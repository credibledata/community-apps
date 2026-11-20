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
      // The proxy now and then answers a query with no rows that a repeat answers in full: ask again before
      // trusting an empty result.
      const TRIES = 8
      const ask = (left) =>
        Publisher.query(S.MODEL, q).then((rows) =>
          Array.isArray(rows) && rows.length === 0 && left > 0
            ? new Promise((r) => setTimeout(r, Math.min(2000, 400 * (TRIES + 1 - left)))).then(() => ask(left - 1))
            : rows
        )
      queue.push(() => ask(TRIES).then(resolve, reject))
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
    // One query per list the scope and search need, kept as strings with nulls dropped.
    const [span, states, producers, k] = await Promise.all([
      query('run: generation -> { aggregate: lo is min(`year`), hi is max(`year`), latest_month }'),
      query('run: generation -> { group_by: state_name; order_by: state_name }'),
      query('run: generation -> { group_by: producer_type; order_by: producer_type }'),
      query(`run: ${S.HEADLINE} -> kpis`),
    ])
    if (![span, states, producers, k].every((rows) => rows && rows.length)) {
      cache.clear()
      throw new Error('it answered with no rows. Reload the page to try again.')
    }
    known.years = [span[0].lo, span[0].hi]
    known.latest = String(span[0].latest_month).slice(0, 7)
    known.fullYear = k[0].latest_full_year
    const values = (rows, f) => rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined)
    known.state = values(states, 'state_name')
    known.producer = values(producers, 'producer_type')
    known.entity = known.state
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Data through ${monthName(known.latest)}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Formatting and shared pieces ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (ym) => `${MONTHS[Number(String(ym).slice(5, 7)) - 1]} ${String(ym).slice(0, 4)}`
const twh = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : 'n/a')
const fmtTwh = (v) => `${twh(v)} TWh`
// Each fuel group keeps one colour on every chart (styles.css names them).
const FUEL = {
  'Wind and solar': '--c1', Coal: '--c2', 'Natural gas': '--c3', Nuclear: '--c4',
  'Hydro and other renewables': '--c5', 'Oil and other': '--c6',
}
const FUEL_ORDER = ['Coal', 'Natural gas', 'Nuclear', 'Oil and other', 'Hydro and other renewables', 'Wind and solar']
const years = (rows) => rows.map((r) => String(r.year))
const periodBand = () => (scope.from || scope.to ? { from: String(scope.from ?? known.years[0]), to: String(scope.to ?? known.years[1]), label: 'In scope' } : null)
const setPeriod = (a, b) => setScope({ from: Number(String(a).slice(0, 4)), to: Number(String(b).slice(0, 4)) })
const crossLines = (box, rows, name) => {
  const first = rows.find((r) => r.wind_solar_twh > r.coal_twh)
  return C.lines(box, years(rows), [
    { name: 'Coal', values: rows.map((r) => r.coal_twh), color: FUEL.Coal, width: 2.5 },
    { name: 'Natural gas', values: rows.map((r) => r.gas_twh), color: FUEL['Natural gas'], dashed: true, width: 1.5 },
    { name: 'Wind and solar', values: rows.map((r) => r.wind_solar_twh), color: FUEL['Wind and solar'], width: 2.5 },
  ], { format: twh, label: `${name}, TWh per year`, refs: first ? [{ x: String(first.year), label: String(first.year) }] : [], height: 260 })
}

function kpi(label, value, sub, { accent = false, trend = null, color = '--accent' } = {}) {
  const svg = trend ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : null
  const el = h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), sub && h('div', { class: 'kpi__sub' }, ...prose(sub)), svg)
  if (svg) requestAnimationFrame(() => C.sparkline(svg, trend, color))
  return el
}

// ---- Views ----

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}

function overview() {
  // The headline runs bare views of the headline source, and every word of the answer comes from their rows: so the
  // page, the Credible agent and an analyst get the same numbers.
  const H = S.HEADLINE
  const qs = [`run: ${H} -> overtake`, `run: ${H} -> texas_overtake`, `run: ${H} -> kpis`, `run: ${H} -> texas_kpis`, `run: ${H} -> annual`, `run: ${H} -> texas_annual`]
  const answer = h('p', { class: 'answer' })
  Promise.all(qs.slice(0, 2).map(query)).then(([[us], [tx]]) => answer.replaceChildren(...prose(
    us && tx ? ['Wind and solar together first generated more electricity than coal across the US in ', { b: String(us.first_year_ahead) }, ', and in Texas in ', { b: String(tx.first_year_ahead) }, '.']
      : us ? ['Wind and solar together first generated more electricity than coal across the US in ', { b: String(us.first_year_ahead) }, '.']
        : 'Wind and solar have not yet generated more electricity than coal across the US in a complete year.')))
  const [kicker, title, lede] = viewHead('When did wind and solar overtake coal?', 'The Energy Information Administration counts what US power plants generate, by state and energy source, every month since 2001. Here is when wind and solar passed coal, nationally and in Texas.').filter(Boolean)
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    h('div', { class: 'grid-2' },
      tile({
        title: 'Wind and solar against coal', sub: 'The first complete year each led, and the latest complete year.', cls: 'span-2',
        queries: () => qs,
        explain: [
          'The first complete calendar year in which US wind and solar generation exceeded coal generation, and both totals that year.',
          'The same for Texas.',
          'US generation by fuel in the latest complete year.',
          'Texas generation by fuel in the latest complete year.',
          'US generation by fuel, each complete year, for the trends.',
          'Texas generation by fuel, each complete year, for the trends.',
        ],
        draw: ([[us], [tx], [k], [tk], annual, txAnnual], body) => {
          const l = k.latest[0]
          const t = tk.latest[0]
          body.append(h('div', { class: 'kpis' },
            us ? kpi('US: wind and solar passed coal in', String(us.first_year_ahead), [{ b: twh(us.wind_solar_in_year) }, ' TWh against coal’s ', { b: twh(us.coal_in_year) }, ' TWh that year'], { accent: true }) : kpi('US: wind and solar passed coal in', 'Not yet', null),
            tx ? kpi('Texas: wind and solar passed coal in', String(tx.first_year_ahead), [{ b: twh(tx.wind_solar_in_year) }, ' TWh against coal’s ', { b: twh(tx.coal_in_year) }, ' TWh that year'], { accent: true }) : kpi('Texas: wind and solar passed coal in', 'Not yet', null),
            kpi(`US wind and solar, ${l.year}`, fmtTwh(l.wind_solar_twh), [{ b: C.pct(l.wind_solar_share) }, ' of generation; coal ', { b: C.pct(l.coal_share) }], { trend: annual.map((r) => r.wind_solar_twh) }),
            kpi(`Texas wind and solar, ${t.year}`, fmtTwh(t.wind_solar_twh), [{ b: C.pct(t.wind_solar_share) }, ' of generation; coal ', { b: C.pct(t.coal_share) }], { trend: txAnnual.map((r) => r.wind_solar_twh) })))
        },
        finding: ([, , [k], [tk]]) => [`In ${k.latest[0].year}, natural gas made `, { b: C.pct(k.latest[0].gas_share) }, ' of US electricity and ', { b: C.pct(tk.latest[0].gas_share) }, ' of Texas’s.'],
        method: 'Complete calendar years only: the latest year in the data is partial and left out of these numbers. Utility-scale plants of 1 MW and more; rooftop solar is not counted.',
      }),
      tile({
        title: 'Coal, gas, and wind and solar, each complete year', sub: 'The US on the left, Texas on the right. Terawatt-hours per year.', cls: 'span-2',
        queries: () => [`run: ${S.HEADLINE} -> annual`, `run: ${S.HEADLINE} -> texas_annual`],
        explain: ['US generation from coal, natural gas, and wind and solar, each complete year.', 'The same for Texas.'],
        draw: ([us, tx], body) => {
          const pair = body.appendChild(h('div', { class: 'pair' }))
          crossLines(chartBox(pair), us, 'United States')
          crossLines(chartBox(pair), tx, 'Texas')
        },
        finding: ([us, tx]) => {
          const a = us[0], b = us[us.length - 1]
          return ['US coal generation went from ', { b: fmtTwh(a.coal_twh) }, ` in ${a.year} to `, { b: fmtTwh(b.coal_twh) }, ` in ${b.year}; wind and solar from `, { b: fmtTwh(a.wind_solar_twh) }, ' to ', { b: fmtTwh(b.wind_solar_twh) }, '.']
        },
        method: 'Complete years only. Natural gas is drawn dashed; the line marks the first year wind and solar made more than coal.',
      }),
      tile({
        title: 'States where wind and solar out-generated coal', sub: 'Each year, of 50 states and DC.',
        queries: () => [S.crossoverQuery('states_ahead_by_year', S.DEFAULT_SCOPE, known)],
        explain: ['For each year, the number of states (DC counted) where wind and solar generated more than coal over the year.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: String(r.year), value: r.states_ahead })), { color: '--c1', label: 'States', height: 220 }),
        finding: ([rows]) => {
          const full = rows.filter((r) => r.year <= known.fullYear)
          const a = full[0], b = full[full.length - 1]
          return [`From `, { b: String(a.states_ahead) }, ` states in ${a.year} to `, { b: String(b.states_ahead) }, ` in ${b.year}.`]
        },
        method: `The last bar is a partial year, through ${monthName(known.latest)}: a state's count can change before the year ends.`,
      }),
      tile({
        title: `Wind and solar's share of each state's generation, ${known.fullYear}`, sub: 'Open a state’s page from its name.',
        queries: () => [S.viewQuery('by_state', S.DEFAULT_SCOPE, known, [], `where: \`year\` = ${known.fullYear}; order_by: wind_solar_share desc`)],
        explain: [`Each state's wind and solar share of its net generation in ${known.fullYear}, and wind and solar minus coal in TWh.`],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.state_name, name: r.state_name, value: r.wind_solar_share, change: r.wind_solar_minus_coal_twh })), {
          valueLabel: 'Wind and solar share', format: (v) => C.pct(v, 0), changeLabel: 'Wind and solar minus coal', changeFormat: (v) => `${twh(v)} TWh`, good: 'rise', limit: 8,
          onOpen: openEntity, href: (id) => linkTo(S.ENTITY.view, id), inCompare: (id) => picked.includes(id), onCompare: toggleCompare,
        }),
        finding: ([rows]) => [{ b: rows[0].state_name }, ' had the highest share, ', { b: C.pct(rows[0].wind_solar_share, 0) }, '.'],
        method: 'Net generation within the state, including power sent to other states.',
      })),
    h('p', { class: 'lead-on' }, h('a', { href: linkTo('explore'), text: 'Explore by year, state and producer →' }), ' ', h('a', { href: linkTo(S.ENTITY.view, 'Texas'), text: 'Texas, year by year →' })))
}

function explore() {
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore', 'Drag across a time chart to choose years; click a state or a producer to filter every card. The address keeps the view.'),
    section('How the mix changed', 'What US power plants generated, by fuel, and when wind and solar passed coal.',
      tile({
        title: 'Generation by fuel, each year', sub: 'Terawatt-hours. Drag to choose years.', cls: 'span-2',
        queries: () => [S.tileQuery('mix', scope, known)],
        explain: ['Net generation per complete year by fuel group, and its share of the year, under the scope; every year is shown so the chosen ones are shaded.'],
        draw: ([rows], body) => {
          const ys = [...new Set(rows.map((r) => String(r.year)))]
          const series = FUEL_ORDER.map((g) => ({ name: g, color: FUEL[g], values: ys.map((y) => rows.find((r) => String(r.year) === y && r.fuel_group === g)?.net_twh ?? 0) }))
          C.area(chartBox(body), ys, series, { format: twh, band: periodBand(), onBrush: setPeriod, label: 'TWh per year', height: 300 })
        },
        finding: ([rows]) => {
          const ws = rows.filter((r) => r.fuel_group === 'Wind and solar')
          const a = ws[0], b = ws[ws.length - 1]
          return ['Wind and solar went from ', { b: C.pct(a.share_of_year) }, ` of generation in ${a.year} to `, { b: C.pct(b.share_of_year) }, ` in ${b.year}.`]
        },
        method: `Complete years only: the months of ${known.latest.slice(0, 4)} so far are left out. Pumped storage uses more power than it makes and counts as negative in "Oil and other".`,
      }),
      tile({
        title: 'Coal against wind and solar, each month', sub: 'Terawatt-hours. Drag to choose years.', cls: 'span-2',
        queries: () => [S.tileQuery('monthly', scope, known)],
        explain: ['Net generation per month from coal, and from wind and solar, under the scope.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => String(r.month).slice(0, 7)), [
          { name: 'Coal', values: rows.map((r) => r.coal_twh), color: FUEL.Coal },
          { name: 'Wind and solar', values: rows.map((r) => r.wind_solar_twh), color: FUEL['Wind and solar'] },
        ], { format: twh, onBrush: setPeriod, band: periodBand() && { from: `${periodBand().from}-01`, to: `${periodBand().to}-12`, label: 'In scope' }, label: 'TWh per month', height: 260 }),
        finding: ([rows]) => {
          const r = rows[rows.length - 1]
          return [`In ${monthName(String(r.month).slice(0, 7))}, wind and solar made `, { b: fmtTwh(r.wind_solar_twh) }, ' and coal ', { b: fmtTwh(r.coal_twh) }, '.']
        },
        method: 'Monthly totals swing with the seasons: wind peaks in spring, solar in summer, and coal with summer and winter demand.',
      })),
    section('Where', 'Which states make the most wind and solar power, and where it leads coal.',
      tile({
        title: 'States by wind and solar generation', sub: 'Click a row to filter; the name opens the state.',
        queries: () => [S.tileQuery('states', scope, known, 'order_by: wind_solar_twh desc')],
        explain: ['Wind and solar generation per state under the scope, and wind and solar minus coal.'],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.state_name, name: r.state_name, value: r.wind_solar_twh, change: r.wind_solar_minus_coal_twh })), {
          valueLabel: 'Wind and solar, TWh', format: twh, changeLabel: 'Minus coal, TWh', changeFormat: twh, good: 'rise', selected: scope.state,
          onOpen: (id) => toggleScope('state', id), href: (id) => linkTo(S.ENTITY.view, id), inCompare: (id) => picked.includes(id), onCompare: toggleCompare,
        }),
        finding: ([rows]) => [{ b: rows[0].state_name }, ' generated the most from wind and solar in scope, ', { b: fmtTwh(rows[0].wind_solar_twh) }, '.'],
        method: 'Generation where the plant is, not where the power is used.',
      }),
      tile({
        title: 'States where wind and solar led coal, each year', sub: 'Click a year to choose it.',
        queries: () => [S.crossoverQuery('states_ahead_by_year', scope, known, ['from', 'to'])],
        explain: ['For each year, the number of states in scope where wind and solar generated more than coal over the year.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: String(r.year), value: r.states_ahead })), {
          color: '--c1', label: 'States', height: 240, selected: scope.from && scope.from === scope.to ? String(scope.from) : null,
          onPick: (y) => (scope.from === Number(y) && scope.to === Number(y) ? setScope({ from: null, to: null }) : setPeriod(y, y)),
        }),
        finding: ([rows]) => {
          const b = rows.filter((r) => r.year <= known.fullYear).pop()
          return b ? [`In ${b.year}, wind and solar led coal in `, { b: String(b.states_ahead) }, ' of ', { b: String(b.state_count) }, ' states in scope.'] : null
        },
        method: 'A state-year counts when wind and solar exceed coal over the whole year. The producer filter does not apply here: the count is for all producers.',
      }),
      tile({
        title: 'Wind and solar minus coal, by state', sub: 'TWh in scope: right of the line, wind and solar made more.', cls: 'span-2',
        queries: () => [S.tileQuery('states', scope, known, 'order_by: wind_solar_minus_coal_twh desc')],
        explain: ['Wind and solar generation minus coal generation, per state, under the scope.'],
        draw: ([rows], body) => {
          const pick = rows.length > 40 ? [...rows.slice(0, 20), ...rows.slice(-20)] : rows
          C.divergingBars(chartBox(body), pick.map((r) => ({ id: r.state_name, label: r.state_name, value: r.wind_solar_minus_coal_twh })), {
            format: (v) => `${v > 0 ? '+' : ''}${twh(v)}`, good: 'rise', selected: scope.state, onPick: (id) => toggleScope('state', id),
          })
        },
        finding: ([rows]) => [{ b: rows[0].state_name }, ' leads by the most, ', { b: `${twh(rows[0].wind_solar_minus_coal_twh)} TWh` }, '; ', { b: rows[rows.length - 1].state_name }, ' trails by the most, ', { b: `${twh(-rows[rows.length - 1].wind_solar_minus_coal_twh)} TWh` }, '.'],
        method: 'With more than 40 states in scope, the 20 furthest ahead and the 20 furthest behind are drawn; the full list is in the working.',
      })),
    section('Who and when', 'Which kinds of plant make the power, and how each source runs through the year.',
      tile({
        title: 'Generation by type of producer', sub: 'TWh in scope. Click to filter.',
        queries: () => [S.tileQuery('producers', scope, known)],
        explain: ['Net generation per producer type under the scope.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.producer_type, value: r.net_twh, ws: r.wind_solar_twh, coal: r.coal_twh })), {
          horizontal: true, direct: true, format: twh, selected: scope.producer, onPick: (p) => toggleScope('producer', p),
          tip: (r) => [`Wind and solar: ${fmtTwh(r.ws)}`, `Coal: ${fmtTwh(r.coal)}`],
        }),
        finding: ([rows]) => {
          const ws = [...rows].sort((a, b) => b.wind_solar_twh - a.wind_solar_twh)[0]
          return [{ b: ws.producer_type }, ' made the most wind and solar power in scope, ', { b: fmtTwh(ws.wind_solar_twh) }, '.']
        },
        method: 'EIA sorts plants by who owns them and what they are for; combined heat and power plants also make heat or steam.',
      }),
      tile({
        title: 'Generation by energy source', sub: 'TWh in scope.',
        queries: () => [S.tileQuery('sources', scope, known)],
        explain: ['Net generation per energy source under the scope, and its share of the total.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.energy_source, value: r.net_twh, share: r.share_of_total })), {
          horizontal: true, direct: true, format: twh, tip: (r) => [`${C.pct(r.share)} of the total`],
        }),
        finding: ([rows]) => [{ b: rows[0].energy_source }, ' made the most in scope, ', { b: C.pct(rows[0].share_of_total) }, ' of the total.'],
        method: 'This card does not filter: choosing one source would empty the others. Pumped storage is negative.',
      }),
      tile({
        title: 'An average month, by month of the year', sub: 'TWh per month, averaged over the years in scope.', cls: 'span-2',
        queries: () => [S.tileQuery('seasons', scope, known)],
        explain: ['Average monthly generation from wind, solar and coal for each calendar month, over the years in scope.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => MONTHS[r.month_of_year - 1]), [
          { name: 'Coal', values: rows.map((r) => r.coal_avg_twh), color: FUEL.Coal },
          { name: 'Wind', values: rows.map((r) => r.wind_avg_twh), color: FUEL['Wind and solar'] },
          { name: 'Solar', values: rows.map((r) => r.solar_avg_twh), color: FUEL['Wind and solar'], dashed: true },
        ], { format: twh, label: 'TWh per month', height: 240 }),
        finding: ([rows]) => {
          const w = [...rows].sort((a, b) => b.wind_avg_twh - a.wind_avg_twh)[0]
          const s = [...rows].sort((a, b) => b.solar_avg_twh - a.solar_avg_twh)[0]
          return ['Wind runs highest in ', { b: MONTHS[w.month_of_year - 1] }, ', solar in ', { b: MONTHS[s.month_of_year - 1] }, '.']
        },
        method: 'Each month is averaged over the years in scope that have it, so recent growth pulls the averages of recent months up.',
      })))
}

function entity() {
  const id = route.id
  const eq = (view, extra = '') => S.entityQuery(view, id, scope, known, extra)
  return h('div', { class: 'view wrap' },
    ...viewHead(S.ENTITY.label(id), null, [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${S.ENTITY.label(id)}`]),
    h('p', { class: 'lead-on' }, h('button', { class: 'btn', type: 'button', text: 'Add to compare', onclick: () => goCompare([...picked.filter((x) => x !== id), id]) })),
    h('div', { class: 'grid-2' },
      tile({
        title: `${id} against the US`, sub: 'The latest complete year in scope, and the first year wind and solar led coal.', cls: 'span-2',
        queries: () => [eq('kpis'), eq('overtake'), S.viewQuery('kpis', scope, known, S.ENTITY_KEYS), eq('annual')],
        explain: [`${id}'s generation by fuel in the latest complete year in scope.`, `The first complete year in which ${id}'s wind and solar generated more than its coal.`, 'The same numbers for the US, under the same scope.', `${id}'s generation each complete year, for the trends.`],
        draw: ([[k], [o], [us], annual], body) => {
          const l = k.latest[0]
          const u = us.latest[0]
          body.append(h('div', { class: 'kpis' },
            kpi('Wind and solar passed coal in', o ? String(o.first_year_ahead) : 'Not yet', o ? [{ b: twh(o.wind_solar_in_year) }, ' TWh against coal’s ', { b: twh(o.coal_in_year) }, ' TWh that year'] : ['in a complete year in scope'], { accent: true }),
            kpi(`Wind and solar share, ${l.year}`, C.pct(l.wind_solar_share), ['US: ', { b: C.pct(u.wind_solar_share) }], { trend: annual.map((r) => r.wind_solar_share) }),
            kpi(`Coal share, ${l.year}`, C.pct(l.coal_share), ['US: ', { b: C.pct(u.coal_share) }], { trend: annual.map((r) => r.coal_share), color: '--c2' }),
            kpi(`Net generation, ${l.year}`, fmtTwh(l.net_twh), ['Natural gas ', { b: C.pct(l.gas_share) }, '; US ', { b: C.pct(u.gas_share) }], { trend: annual.map((r) => r.net_twh), color: '--c-bar' })))
        },
        finding: ([[k], , [us]]) => [`In ${k.latest[0].year}, wind and solar made `, { b: C.pct(k.latest[0].wind_solar_share) }, ` of ${id}’s electricity, against `, { b: C.pct(us.latest[0].wind_solar_share) }, ' across the US.'],
        method: 'Complete calendar years only. Net generation within the state, including power sent to other states.',
      }),
      tile({
        title: 'Coal, gas, and wind and solar, each complete year', sub: 'Terawatt-hours per year.', cls: 'span-2',
        queries: () => [eq('annual'), eq('overtake')],
        explain: [`${id}'s generation from coal, natural gas, and wind and solar, each complete year.`, `The first complete year in which ${id}'s wind and solar generated more than its coal.`],
        draw: ([rows], body) => crossLines(chartBox(body), rows, id),
        finding: ([rows, [o]]) => {
          const a = rows[0], b = rows[rows.length - 1]
          return [`Coal went from `, { b: fmtTwh(a.coal_twh) }, ` in ${a.year} to `, { b: fmtTwh(b.coal_twh) }, ` in ${b.year}; wind and solar from `, { b: fmtTwh(a.wind_solar_twh) }, ' to ', { b: fmtTwh(b.wind_solar_twh) }, o ? ['. They first led in ', { b: String(o.first_year_ahead) }, '.'] : '.'].flat()
        },
        method: 'Complete years only. Natural gas is drawn dashed; the line marks the first year wind and solar made more than coal.',
      }),
      tile({
        title: 'Wind and solar share, by year and month', sub: 'Each cell is one month: darker means a larger share. Click a year to choose it.', cls: 'span-2',
        queries: () => [eq('share_calendar'), eq('by_month_of_year')],
        explain: [`Wind and solar's share of ${id}'s net generation, each month.`, `${id}'s average monthly generation by month of year, for the season in the finding.`],
        draw: ([rows], body) => {
          const ys = [...new Set(rows.map((r) => String(r.year)))]
          C.heatmap(chartBox(body), ys, MONTHS, rows.map((r) => ({ row: String(r.year), col: MONTHS[r.month_of_year - 1], value: r.wind_solar_share })), {
            format: (v) => C.pct(v, 0), label: 'Wind and solar share',
            selected: scope.from && scope.from === scope.to ? String(scope.from) : null,
            onRow: (y) => (scope.from === Number(y) && scope.to === Number(y) ? setScope({ from: null, to: null }) : setPeriod(y, y)),
          })
        },
        finding: ([rows]) => {
          const top = rows.reduce((m, r) => (r.wind_solar_share > m.wind_solar_share ? r : m), rows[0])
          return ['The highest month was ', { b: `${MONTHS[top.month_of_year - 1]} ${top.year}` }, ', at ', { b: C.pct(top.wind_solar_share, 0) }, '.']
        },
        method: 'Share of net generation in the month. The latest year is partial, so its later months are blank.',
      }),
      tile({
        title: 'Generation by energy source', sub: 'TWh in scope.',
        queries: () => [eq('by_energy_source')],
        explain: [`${id}'s net generation by energy source, under the scope, with its share of the total.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.energy_source, value: r.net_twh })), { horizontal: true, direct: true, format: twh, color: '--c-bar' }),
        finding: ([rows]) => [{ b: rows[0].energy_source }, ' made the most in scope, ', { b: C.pct(rows[0].share_of_total) }, ' of the total.'],
        method: 'Pumped storage uses more power than it makes, so its net generation is negative.',
      }),
      tile({
        title: 'Latest records', sub: 'The largest rows of the latest month in scope.',
        queries: () => [eq('records', 'order_by: `month` desc, mwh desc; limit: 10')],
        explain: [`${id}'s rows, newest first and largest first within a month: one row per month, producer type and energy source.`],
        draw: ([rows], body) => body.append(recordTable(rows, false)),
        finding: ([rows]) => [`The newest month is `, { b: monthName(String(rows[0].month).slice(0, 7)) }, '.'],
        method: 'EIA revises recent months; rows marked preliminary can change.',
      })),
    h('p', { class: 'lead-on' }, h('a', { href: linkTo('records'), text: 'All records →' })))
}

/** A table of generation rows: month, state (when asked), producer, source, MWh, and whether EIA has finalised it. */
function recordTable(rows, withState = true) {
  const head = ['Month', ...(withState ? ['State'] : []), 'Producer', 'Energy source', 'MWh', 'Status']
  return h('div', { class: 'table-wrap' }, h('table', { class: withState ? 'records records--state' : 'records' },
    h('thead', {}, h('tr', {}, ...head.map((t) => h('th', { text: t })))),
    h('tbody', {}, ...rows.map((r) => h('tr', {},
      h('td', { text: monthName(String(r.month).slice(0, 7)) }),
      ...(withState ? [h('td', {}, h('a', { href: linkTo(S.ENTITY.view, r.state_name), text: r.state_name }))] : []),
      h('td', { text: r.producer_type }),
      h('td', { text: r.energy_source }),
      h('td', { class: 'num', text: C.fmt(r.mwh) }),
      h('td', { text: r.final ? 'Final' : 'Preliminary' }))))))
}

let recordLimit = 50
function records() {
  const ignore = S.skipFor('records')
  return h('div', { class: 'view wrap' },
    ...viewHead('Records', 'Every row in scope, newest month first and the largest rows first within a month: one row per month, state, type of producer and energy source.'),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Generation rows', sub: 'Megawatt-hours. A state’s name opens its page.', cls: 'span-2',
        queries: () => [S.viewQuery('records', scope, known, ignore, `order_by: \`month\` desc, mwh desc; limit: ${recordLimit}`), S.viewQuery('row_total', scope, known, ignore)],
        explain: [`The first ${recordLimit} rows in scope, newest month first.`, 'How many rows are in scope.'],
        draw: ([rows, [n]], body) => {
          body.append(recordTable(rows, true))
          if (rows.length < n.row_count) {
            body.append(h('p', {}, h('button', { class: 'btn', type: 'button', text: 'Show 50 more', onclick: () => { recordLimit += 50; render() } })))
          }
        },
        finding: ([rows, [n]]) => ['Showing ', { b: C.fmt(rows.length) }, ' of ', { b: C.fmt(n.row_count) }, ' rows in scope.'],
        method: 'EIA revises recent months: rows marked preliminary can change when the year is finalised. Pumped storage rows are negative.',
      })))
}

// The states picked for Compare: the address holds them on the Compare view; elsewhere they are kept for the session.
let picked = []
const goCompare = (ids) => go({ view: 'compare', id: null, compare: ids.slice(0, S.COMPARE_MAX) })
function toggleCompare(id) {
  picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-S.COMPARE_MAX)
  if (route.view === 'compare') goCompare(picked)
}
const COMPARE_COLORS = ['--accent', '--c3', '--c5', '--c4']

function compare() {
  picked = route.compare.length ? [...route.compare] : picked
  const ids = picked
  if (route.view === 'compare' && !route.compare.length && ids.length) setTimeout(() => goCompare(ids))
  const add = h('select', { class: 'pick', 'aria-label': 'Add a state', onchange: (e) => e.target.value && goCompare([...ids, e.target.value]) },
    h('option', { value: '', text: ids.length >= S.COMPARE_MAX ? `Up to ${S.COMPARE_MAX} states` : 'Add a state' }),
    ...known.state.filter((x) => !ids.includes(x)).map((x) => h('option', { value: x, text: x })))
  if (ids.length >= S.COMPARE_MAX) add.disabled = true
  const chips = h('div', { class: 'compare-bar' }, add,
    ...ids.map((id, i) => h('button', { class: 'chip', type: 'button', style: `border-color: var(${COMPARE_COLORS[i]})`, 'aria-label': `Remove ${id}`, text: `${id} ×`, onclick: () => goCompare(ids.filter((x) => x !== id)) })))
  const head = viewHead('Compare', `Up to ${S.COMPARE_MAX} states side by side, under the scope above. Pick states here, or with the + on any ranked list.`)
  if (!ids.length) return h('div', { class: 'view wrap' }, ...head, chips, h('p', { class: 'state', text: 'Pick a state to start.' }))
  const series = (rows, field) => {
    const ys = [...new Set(rows.map((r) => String(r.year)))]
    return [ys, ids.map((id, i) => ({ name: id, color: COMPARE_COLORS[i], values: ys.map((y) => rows.find((r) => r.state_name === id && String(r.year) === y)?.[field] ?? null) }))]
  }
  const complete = 'where: is_complete_year'
  return h('div', { class: 'view wrap' }, ...head, chips,
    h('div', { class: 'grid-2' },
      tile({
        title: `The states in ${known.fullYear}`, sub: 'Wind and solar share of net generation, and wind and solar minus coal.', cls: 'span-2',
        queries: () => [S.compareQuery('by_state', ids, scope, known, `where: \`year\` = ${known.fullYear}; order_by: wind_solar_share desc`)],
        explain: [`Each state's wind and solar share of its net generation in ${known.fullYear}, and wind and solar minus coal in TWh, under the scope.`],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.state_name, name: r.state_name, value: r.wind_solar_share, change: r.wind_solar_minus_coal_twh })), {
          valueLabel: 'Wind and solar share', format: (v) => C.pct(v, 0), changeLabel: 'Wind and solar minus coal', changeFormat: (v) => `${twh(v)} TWh`, good: 'rise',
          onOpen: openEntity, href: (id) => linkTo(S.ENTITY.view, id),
        }),
        finding: ([rows]) => [{ b: rows[0].state_name }, ' had the highest wind and solar share, ', { b: C.pct(rows[0].wind_solar_share, 0) }, '.'],
        method: `The latest complete year, ${known.fullYear}. Net generation within each state, including power sent to other states.`,
      }),
      tile({
        title: 'Wind and solar share, each complete year', sub: 'Share of each state’s net generation.',
        queries: () => [S.compareQuery('state_trend', ids, scope, known, complete)],
        explain: ['Each state’s wind and solar share of its net generation, each complete year, under the scope.'],
        draw: ([rows], body) => { const [ys, ss] = series(rows, 'wind_solar_share'); C.lines(chartBox(body), ys, ss, { format: (v) => C.pct(v, 0), label: 'Share', height: 260 }) },
        finding: ([rows]) => { const l = rows.filter((r) => r.year === Math.max(...rows.map((x) => x.year))); const t = l.reduce((m, r) => (r.wind_solar_share > m.wind_solar_share ? r : m), l[0]); return [`In ${t.year}, `, { b: t.state_name }, ' had the highest share, ', { b: C.pct(t.wind_solar_share, 0) }, '.'] },
        method: 'Complete years only.',
      }),
      tile({
        title: 'Coal share, each complete year', sub: 'Share of each state’s net generation.',
        queries: () => [S.compareQuery('state_trend', ids, scope, known, complete)],
        explain: ['Each state’s coal share of its net generation, each complete year, under the scope.'],
        draw: ([rows], body) => { const [ys, ss] = series(rows, 'coal_share'); C.lines(chartBox(body), ys, ss, { format: (v) => C.pct(v, 0), label: 'Share', height: 260 }) },
        finding: ([rows]) => { const l = rows.filter((r) => r.year === Math.max(...rows.map((x) => x.year))); const t = l.reduce((m, r) => (r.coal_share > m.coal_share ? r : m), l[0]); return [`In ${t.year}, `, { b: t.state_name }, ' had the highest coal share, ', { b: C.pct(t.coal_share, 0) }, '.'] },
        method: 'Complete years only.',
      })))
}

function about() {
  return h('div', { class: 'view wrap prose-view' },
    ...viewHead('About the data', 'Where the numbers come from, what was changed, and what they cannot tell you.'),
    h('section', { class: 'about' },
      h('h2', { text: 'Source' }),
      h('p', {}, 'US Energy Information Administration, ', h('a', { href: 'https://www.eia.gov/electricity/data/state/', text: 'Net generation by state by type of producer by energy source' }), ' (', h('a', { href: 'https://www.eia.gov/electricity/data/state/generation_monthly.xlsx', text: 'generation_monthly.xlsx' }), '), compiled from survey forms EIA-923 and its predecessors EIA-906 and EIA-920. Monthly, January 2001 to ', h('b', { text: monthName(known.latest) }), '.'),
      h('p', { text: 'License: public domain. EIA data are works of the US federal government and free to use; EIA asks to be credited as the source. This app is independent and not produced or endorsed by EIA.' }),
      h('h2', { text: 'What was reshaped' }),
      h('ul', {},
        h('li', { text: 'Every monthly sheet of the workbook was stacked into one table: one row per month, state, type of producer and energy source, with net generation in megawatt-hours.' }),
        h('li', { text: 'Rows that are sums of other rows were dropped: the US total, the "Total Electric Power Industry" producer and the "Total" energy source. The shaping script checks that the rows kept add up to EIA’s own US totals.' }),
        h('li', { text: 'Producer types and energy sources were given short codes and readable names; rows from the preliminary sheets are marked preliminary.' }),
        h('li', { text: 'For charts, energy sources are grouped into six fuel groups; "Wind and solar" is wind plus utility-scale solar. The grouping is this app’s choice.' })),
      h('h2', { text: 'Caveats' }),
      h('ul', {},
        h('li', { text: 'Utility-scale plants only (1 MW and more): rooftop and other small-scale solar is not in these numbers, so solar’s real share is larger.' }),
        h('li', { text: 'Generation is counted where the plant is, not where the power is used: a state can make far more than it uses and send the rest to its neighbours.' }),
        h('li', { text: 'Recent months are preliminary and EIA revises them. Annual comparisons use complete calendar years only.' }),
        h('li', { text: 'Pumped storage uses more electricity than it returns, so its net generation is negative.' }),
        h('li', { text: 'Numbers here can differ slightly from EIA’s published summaries, which include small-scale solar or use later revisions.' })),
      h('h2', { text: 'Rebuild' }),
      h('p', {}, 'The scripts are in the package’s ', h('code', { text: 'pipeline/' }), ' folder: ', h('code', { text: 'fetch.sh' }), ' downloads the workbook and ', h('code', { text: 'shape_generation.py' }), ' writes the table this app reads, the managed table ', h('code', { text: 'community.us_power_grid__generation' }), '. The README has the commands.')))
}

function footer() {
  return h('div', {}, h('h2', { text: 'US power grid' }), h('p', { text: 'Source: US Energy Information Administration, Net generation by state by type of producer by energy source (EIA-923 and predecessor forms). Public domain. An independent app, not produced by EIA.' }))
}

boot()
