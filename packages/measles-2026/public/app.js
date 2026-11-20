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

// ---- Queries: one request per distinct text, one in flight ----
// One at a time: parallel queries to the managed tables sometimes come back empty (seen November 2026).

const cache = new Map()
const queue = []
let inFlight = 0
function pump() {
  while (inFlight < 1 && queue.length) {
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
      // An empty answer is asked up to twice more: the managed tables sometimes answer a valid query with no rows.
      const ask = (tries) => Publisher.query(S.MODEL, q).then((rows) =>
        Array.isArray(rows) && !rows.length && tries > 1 ? new Promise((ok) => setTimeout(ok, 300)).then(() => ask(tries - 1)) : rows)
      queue.push(() => ask(3).then(resolve, reject))
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
    // ADAPT: one query per list the scope and search need. Keep the values as strings, and drop nulls:
    // a null in a list becomes a blank option that matches "nothing selected".
    const [years, bands, states, through] = await Promise.all([
      query('run: kindergarten -> { aggregate: lo is min(year_start), hi is max(year_start) }'),
      query("run: kindergarten -> { group_by: coverage_band; where: coverage_band != 'Not reported'; order_by: coverage_band }"),
      query("run: kindergarten -> { group_by: code, place; where: place_type = 'State'; order_by: place }"),
      query('run: weekly_cases -> { aggregate: latest_week }'),
    ])
    known.years = [years[0].lo, years[0].hi]
    const values = (rows, f) => rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined)
    known.band = values(bands, 'coverage_band')
    for (const r of states) if (r.code) S.STATE_NAMES[r.code] = r.place
    known.entity = values(states, 'code')
    known.through = String(through[0].latest_week).slice(0, 10)
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Cases through the week of ${known.through}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Views: ADAPT. Each returns one element; tiles inside it load as they near the screen. ----

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}

const YR = (y) => `${y}-${String(y + 1).slice(2)}`
const p1 = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : 'n/a')
const pts = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} pts` : 'n/a')
const kpi = (label, value, sub, accent = false) =>
  h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), sub && h('div', { class: 'kpi__sub' }, ...prose(sub)))
// The four bare views the Overview's headline reads.
const Q_KPIS = 'run: yearly_cases -> kpis'
const Q_SLIP = 'run: state_slip -> kpis'
const Q_NATION = 'run: kindergarten -> national_trend'
const natRow = (rows, y) => rows.find((r) => r.year_start === y)

function overview() {
  const answer = h('p', { class: 'answer' })
  query(Q_KPIS).then(([k]) => answer.replaceChildren(...prose([
    `So far in ${k.latest_year} the US has recorded `, { b: C.fmt(k.latest_year_cases) }, ' confirmed measles cases: ',
    { b: `${k.times_prior_record.toFixed(1)}×` }, ' the most in any year since measles was declared eliminated in 2000, and ',
    { b: `${Math.round(k.share_of_2000_to_prior * 100)}%` }, ` as many as all ${k.full_years_since_2000} years from 2000 to ${k.latest_year - 1} put together.`])))
  const [kicker, title, lede] = viewHead('How does 2026 compare with every year since measles was eliminated?',
    'Measles was declared eliminated from the United States in 2000: no chain of spread lasted a year. In 2026 one did, and the country lost that status. Here is how this year’s cases compare, and where the kindergarten vaccination that keeps measles out has slipped.').filter(Boolean)
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    h('div', { class: 'grid-2' },
      tile({
        title: 'The year in four numbers', cls: 'span-2',
        queries: () => [Q_KPIS, Q_SLIP, Q_NATION],
        explain: ['Cases in the current year and in every full year since 2000.', 'States whose kindergarten MMR coverage moved between 2019-20 and 2025-26.', 'National kindergarten coverage and exemptions by school year.'],
        draw: ([[k], [sl], nat], body) => {
          const lo = natRow(nat, 2019), hi = natRow(nat, nat[nat.length - 1].year_start)
          body.append(h('div', { class: 'kpis' },
            kpi(`Cases in ${k.latest_year} so far`, C.fmt(k.latest_year_cases), ['Against ', { b: C.fmt(k.prior_record_since_2000) }, ' in the worst year since 2000.'], true),
            kpi(`All cases, 2000–${k.latest_year - 1}`, C.fmt(k.cases_2000_to_prior), ['An average of ', { b: C.fmt(Math.round(k.avg_2000_to_prior)) }, ' a year.']),
            kpi(`Kindergartners with 2 MMR doses, ${hi.year_label}`, p1(hi.us_coverage), ['Down from ', { b: p1(lo.us_coverage) }, ` in ${lo.year_label}; the target is 95%.`]),
            kpi('States where coverage slipped', C.fmt(sl.states_slipped), ['Of ', { b: C.fmt(sl.states_comparable) }, ' with figures for both years, by 1 point or more.'])))
        },
        method: 'Cases are confirmed cases reported to CDC; the current year is to CDC’s latest weekly update and will rise as cases are confirmed.',
      }),
      tile({
        title: 'Every year since elimination', sub: 'Confirmed cases per year, 2000 to now. The line is the average of the full years.', cls: 'span-2',
        queries: () => ['run: yearly_cases -> since_2000', Q_KPIS],
        explain: ['Confirmed cases per year since 2000.', 'The average of the full years, for the reference line.'],
        draw: ([rows, [k]], body) => C.bars(chartBox(body), rows.map((r) => ({ label: String(r.case_year), value: r.total_cases })), {
          selected: String(k.latest_year), color: '--accent', refs: [{ value: k.avg_2000_to_prior, label: `Average ${C.fmt(Math.round(k.avg_2000_to_prior))}` }], height: 300, label: 'Measles cases per year since 2000',
        }),
        finding: ([rows, [k]]) => {
          const prev = [...rows].filter((r) => !r.partial_year).sort((a, b) => b.total_cases - a.total_cases)
          return [{ b: String(k.latest_year) }, ` stands alone. Before it, the worst years were ${prev[0].case_year} (${C.fmt(prev[0].total_cases)}), ${prev[1].case_year} (${C.fmt(prev[1].total_cases)}) and ${prev[2].case_year} (${C.fmt(prev[2].total_cases)}).`]
        },
        method: `The current year is partial. CDC counts a case in the year of rash onset.`,
      }),
      tile({
        title: 'Cases so far, week by week', sub: 'Running total of cases by week of rash onset, each year from January. 2026 in red.',
        queries: () => ['run: weekly_cases -> cumulative_by_year'],
        explain: ['Cases per week of rash onset, with the running total within each year.'],
        draw: ([rows], body) => {
          const years = [...new Set(rows.map((r) => r.onset_year))]
          const weeks = Array.from({ length: Math.max(...rows.map((r) => r.week_of_year)) }, (_, i) => i + 1)
          const latest = years[years.length - 1]
          const color = (y) => (y === latest ? '--accent' : y === latest - 1 ? '--c2' : '--c6')
          return C.lines(chartBox(body), weeks.map((w) => `Week ${w}`), years.map((y) => {
            const by = new Map(rows.filter((r) => r.onset_year === y).map((r) => [r.week_of_year, r.running_total]))
            return { name: String(y), values: weeks.map((w) => by.get(w) ?? null), color: color(y), width: y === latest ? 3 : 1.5 }
          }), { maxTicks: 6, label: 'Running total of cases by week, each year' })
        },
        finding: ([rows]) => {
          const last = new Map()
          for (const r of rows) last.set(r.onset_year, r.running_total)
          const ys = [...last.keys()]
          const y = ys[ys.length - 1]
          return [{ b: String(y) }, ` passed ${C.fmt(last.get(y - 1))}, all of ${y - 1}’s cases, by week ${rows.find((r) => r.onset_year === y && r.running_total >= last.get(y - 1)).week_of_year}.`]
        },
        method: 'Weekly counts start in 2022. The latest weeks are incomplete.',
      }),
      tile({
        title: 'The epidemic curve', sub: 'Cases by week of rash onset since 2022.',
        queries: () => ['run: weekly_cases -> epi_curve', 'run: weekly_cases -> peak_by_year'],
        explain: ['Confirmed cases per week of rash onset.', 'The busiest week of each year.'],
        draw: ([rows], body) => C.area(chartBox(body), rows.map((r) => String(r.onset_week).slice(0, 10)), [{ name: 'Cases', values: rows.map((r) => r.weekly_total), color: '--accent' }], { label: 'Measles cases by week of rash onset' }),
        finding: ([, peaks]) => {
          const p = peaks[peaks.length - 1], q = peaks[peaks.length - 2]
          return [`The busiest week of ${p.onset_year} had `, { b: C.fmt(p.peak_week_cases) }, ` cases, against ${C.fmt(q.peak_week_cases)} at the height of ${q.onset_year}.`]
        },
        method: 'Epidemiologists chart outbreaks by rash onset, not by report date: it shows when people fell ill.',
      })),
    section('Where vaccination slipped', 'Two doses of MMR protect about 97% of children. When 95% of kindergartners have both, measles cannot spread through a school.',
      tile({
        title: 'The biggest falls in kindergarten coverage', sub: 'Each arrow runs from a state’s MMR coverage in 2019-20, before the pandemic, to 2025-26. Click a state to open its page.', cls: 'span-2',
        queries: () => ['run: state_slip -> biggest_slips'],
        explain: ['Each state’s coverage in 2019-20 and 2025-26, biggest fall first.'],
        draw: ([rows], body) => C.arrows(chartBox(body), rows.slice(0, 15).map((r) => ({ id: r.code, label: r.place, a: r.coverage_2019, b: r.coverage_latest })), {
          aName: '2019-20', bName: '2025-26', format: p1, change: (r) => ({ text: pts(r.b - r.a), cls: r.b < r.a ? 'fx-bad' : 'fx-good' }), onPick: openEntity, label: 'Kindergarten MMR coverage, 2019-20 to 2025-26',
        }),
        finding: ([rows]) => [{ b: rows[0].place }, ` fell furthest, from ${p1(rows[0].coverage_2019)} to ${p1(rows[0].coverage_latest)}, while its exemption rate went from ${p1(rows[0].exemption_2019)} to ${p1(rows[0].exemption_latest)}.`],
        method: 'The 15 biggest falls among states with coverage for both years. States count differently (census, sample or voluntary response), so compare a state with itself over time.',
      }),
      tile({
        title: 'National coverage and exemptions', sub: 'All US kindergartners, by school year.',
        queries: () => [Q_NATION],
        explain: ['CDC’s national coverage and exemption rate by school year.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => r.year_label), [
          { name: 'MMR coverage', values: rows.map((r) => r.us_coverage), color: '--c2' },
          { name: 'Median state', values: rows.map((r) => r.median_state_coverage), color: '--c6', dashed: true },
        ], { format: p1, beginAtZero: false, refs: [{ y: 95, label: '95% target' }], label: 'US kindergarten MMR coverage' }),
        finding: ([rows]) => {
          const lo = natRow(rows, 2019), hi = rows[rows.length - 1]
          return ['Coverage fell from ', { b: p1(lo.us_coverage) }, ` in ${lo.year_label} to `, { b: p1(hi.us_coverage) }, ` in ${hi.year_label}; exemptions rose from ${p1(lo.us_exemption_pct)} to ${p1(hi.us_exemption_pct)}, ${C.fmt(hi.us_exemptions)} children.`]
        },
        method: 'CDC published no national figure for 2010-11.',
      }),
      tile({
        title: 'Cases by state in 2026', sub: 'Confirmed cases by reporting jurisdiction. Click a state to open its page.',
        queries: () => ['run: state_cases -> by_state'],
        explain: ['Cases by jurisdiction in 2026, 2025 and 2024.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.slice(0, 12).map((r) => ({ label: r.state_name, value: r.cases_2026, id: r.code })), {
          horizontal: true, direct: true, color: '--accent', label: 'Cases by state, 2026',
          onPick: (name) => { const r = rows.find((x) => x.state_name === name); if (r && known.entity.includes(r.code)) openEntity(r.code) },
          tip: (r) => { const x = rows.find((y) => y.state_name === r.label); return [`2025: ${C.fmt(x.cases_2025)}`, `2024: ${C.fmt(x.cases_2024)}`] },
        }),
        finding: ([rows]) => [{ b: rows[0].state_name }, ` has reported the most cases this year, ${C.fmt(rows[0].cases_2026)}, followed by ${rows[1].state_name} (${C.fmt(rows[1].cases_2026)}).`],
        method: 'The 12 jurisdictions with the most cases. New York City reports apart from the rest of New York State.',
      })))
}

function explore() {
  const yrs = () => `${scope.from ? YR(scope.from) : YR(known.years[0])} to ${scope.to ? YR(scope.to) : YR(known.years[1])}`
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore kindergarten vaccination', 'Choose school years and a coverage band; every card follows. Drag across the trend to choose years, click a band to keep only states in it, and open a state from the table.'),
    section('The nation', 'How coverage and exemptions moved across all kindergartners.',
      tile({
        title: 'Coverage, year by year', sub: 'National MMR coverage and the median state. Drag across it to choose school years.', cls: 'span-2',
        queries: () => [S.tileQuery('trend', scope, known)],
        explain: ['National coverage, exemptions and states at target, by school year (every year; the years in scope are shaded).'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => r.year_label), [
          { name: 'MMR coverage', values: rows.map((r) => r.us_coverage), color: '--c2' },
          { name: 'Median state', values: rows.map((r) => r.median_state_coverage), color: '--c6', dashed: true },
        ], {
          format: p1, beginAtZero: false, refs: [{ y: 95, label: '95% target' }], label: 'US kindergarten MMR coverage',
          band: scope.from || scope.to ? { from: YR(scope.from ?? known.years[0]), to: YR(scope.to ?? known.years[1]), label: 'In scope' } : null,
          onBrush: (a, b) => setScope({ from: Number(a.slice(0, 4)), to: Number(b.slice(0, 4)) }),
        }),
        finding: ([rows]) => {
          const inRange = rows.filter((r) => r.us_coverage !== null && r.year_start >= (scope.from ?? 0) && r.year_start <= (scope.to ?? 9999))
          const a = inRange[0], b = inRange[inRange.length - 1]
          return a && b ? [`From ${a.year_label} to ${b.year_label}, national coverage went from `, { b: p1(a.us_coverage) }, ' to ', { b: p1(b.us_coverage) }, '.'] : null
        },
      }),
      tile({
        title: 'Exemptions', sub: 'Share of all US kindergartners with a vaccine exemption.',
        queries: () => [S.tileQuery('trend', scope, known)],
        explain: ['National exemption rates by school year.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => r.year_label), [
          { name: 'Any exemption', values: rows.map((r) => r.us_exemption_pct), color: '--c3' },
          { name: 'Non-medical', values: rows.map((r) => r.us_nonmedical_pct), color: '--c4' },
        ], { format: p1, label: 'US kindergarten exemption rate' }),
        finding: ([rows]) => { const r = rows[rows.length - 1]; return [`In ${r.year_label}, `, { b: p1(r.us_exemption_pct) }, ` of kindergartners had an exemption, ${p1(r.us_nonmedical_pct)} for non-medical reasons.`] },
        method: 'National exemption figures start in 2011-12.',
      }),
      tile({
        title: 'States by coverage band', sub: 'Share of states in each band, by school year. Click a band to keep only states in it.',
        queries: () => [S.tileQuery('bands', scope, known)],
        explain: ['States (and DC) by school year and coverage band.'],
        draw: ([rows], body) => C.stackedShare(chartBox(body), rows.filter((r) => r.coverage_band !== 'Not reported').map((r) => ({ x: r.year_label, part: r.coverage_band, value: r.places_reporting })),
          [{ name: '95% or more', color: '--c2' }, { name: '90-94.9%', color: '--c3' }, { name: 'Below 90%', color: '--accent' }],
          { selected: scope.band, onPick: (b) => toggleScope('band', b), label: 'States by coverage band' }),
        finding: ([rows]) => {
          const last = rows[rows.length - 1].year_label
          const n = (b) => rows.find((r) => r.year_label === last && r.coverage_band === b)?.places_reporting ?? 0
          return [`In ${last}, `, { b: C.fmt(n('95% or more')) }, ' states met the 95% target and ', { b: C.fmt(n('Below 90%')) }, ' were below 90%.']
        },
        method: 'States that reported no coverage in a year are left out of that year.',
      })),
    section('The states', `Every state, ${yrs()}.`,
      tile({
        title: 'States ranked by coverage', sub: 'Coverage in the latest school year in scope, its trend, and its change across the years in scope. Click a state to open its page.', cls: 'span-2',
        queries: () => [S.tileQuery('states', scope, known)],
        explain: ['Each state’s CDC coverage and exemption rate by school year, in scope.'],
        draw: ([rows], body) => {
          const by = d3.groups(rows.filter((r) => r.reported_coverage !== null), (r) => r.code)
          const items = by.map(([code, rs]) => {
            const first = rs[0], last = rs[rs.length - 1]
            return { id: code, name: last.place, sub: last.year_label, value: last.reported_coverage, trend: rs.map((r) => r.reported_coverage), change: rs.length > 1 ? last.reported_coverage - first.reported_coverage : null }
          }).sort((a, b) => a.value - b.value)
          return C.rankTable(body, items, { valueLabel: 'MMR coverage', format: p1, trendLabel: 'Trend', changeLabel: 'Change', changeFormat: (v) => `${Math.abs(v).toFixed(1)} pts`, good: 'rise', limit: 12, href: (id) => linkTo(S.ENTITY.view, id), onOpen: openEntity, inCompare, onCompare })
        },
        finding: ([rows]) => {
          const latest = Math.max(...rows.filter((r) => r.reported_coverage !== null).map((r) => r.year_start))
          const low = rows.filter((r) => r.year_start === latest && r.reported_coverage !== null).sort((a, b) => a.reported_coverage - b.reported_coverage)[0]
          return low ? [{ b: low.place }, ` had the lowest coverage in ${low.year_label}, ${p1(low.reported_coverage)}.`] : null
        },
        method: 'Lowest coverage first. The change is between the first and last school years in scope that the state reported.',
      }),
      tile({
        title: 'Change since before the pandemic', sub: 'Each state’s change in coverage from 2019-20 to 2025-26, in points. Click a state to open its page.', cls: 'span-2',
        queries: () => ['run: state_slip -> biggest_slips'],
        explain: ['Each state’s coverage in 2019-20 and 2025-26 and the change between them.'],
        draw: ([rows], body) => C.divergingBars(chartBox(body), rows.filter((r) => r.direction !== 'Held').map((r) => ({ id: r.code, label: r.place, value: r.coverage_change })), {
          format: pts, good: 'rise', onPick: openEntity, label: 'Change in kindergarten MMR coverage since 2019-20',
        }),
        finding: ([rows]) => { const sl = rows.filter((r) => r.direction === 'Slipped').length; return [{ b: String(sl) }, ` of ${rows.length} states slipped by 1 point or more; ${rows.filter((r) => r.direction === 'Rose').length} rose by as much.`] },
        method: 'Fixed years, so the school-year filter does not change it. States within 1 point of 2019-20 (held) and states missing either year are left out.',
      })))
}

// Compare: a state goes in or out of the list the Compare view shows.
const inCompare = (id) => route.compare?.includes(id) || compareList.includes(id)
let compareList = []
function onCompare(id) {
  compareList = inCompare(id) ? compareList.filter((x) => x !== id) : [...compareList, id].slice(-S.COMPARE_MAX)
  if (route.view === 'compare') go({ view: 'compare', id: null, compare: compareList }, scope, { push: false })
}

function entity() {
  const id = route.id
  const name = S.ENTITY.label(id)
  const qState = () => S.entityQuery('state_year', id, scope, known)
  const qNation = () => S.tileQuery('trend', scope, known)
  const qSlip = `run: state_slip -> biggest_slips + { where: code = ${S.lit(id)} }`
  const qCases = `run: state_cases -> by_state + { where: code = ${S.lit(id)} }`
  const joinYears = (st, nat) => {
    const by = new Map(st.map((r) => [r.year_label, r]))
    return nat.filter((r) => by.has(r.year_label) || r.year_start >= Math.min(...st.map((x) => x.year_start))).map((r) => ({ nat: r, st: by.get(r.year_label) }))
  }
  return h('div', { class: 'view wrap' },
    ...viewHead(name, `Kindergarten MMR vaccination and measles cases in ${name}, against the nation.`, [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${name}`]),
    h('div', { class: 'grid-2' },
      tile({
        title: `${name} in four numbers`, cls: 'span-2',
        queries: () => [qSlip, qCases],
        explain: ['This state’s coverage and exemptions in 2019-20 and 2025-26.', 'This state’s confirmed cases in 2024, 2025 and 2026.'],
        draw: ([[sl], cs], body) => {
          const c = cs[0] || {}
          body.append(h('div', { class: 'kpis' },
            kpi('MMR coverage, 2025-26', p1(sl.coverage_latest), ['Was ', { b: p1(sl.coverage_2019) }, ' in 2019-20.'], true),
            kpi('Change since 2019-20', pts(sl.coverage_change), [sl.direction === 'Slipped' ? 'Slipped' : sl.direction === 'Rose' ? 'Rose' : 'Held', ' by this app’s 1-point rule.']),
            kpi('Exemptions, 2025-26', p1(sl.exemption_latest), ['Was ', { b: p1(sl.exemption_2019) }, ' in 2019-20.']),
            kpi('Measles cases in 2026', C.fmt(c.cases_2026 ?? 0), ['2025: ', { b: C.fmt(c.cases_2025 ?? 0) }, '; 2024: ', { b: C.fmt(c.cases_2024 ?? 0) }, '.'])))
        },
        method: 'Coverage and exemptions are CDC’s figures for the state. Cases are confirmed cases the state reported; New York’s exclude New York City.',
      }),
      tile({
        title: 'Coverage against the nation', sub: `${name} and all US kindergartners, by school year.`, cls: 'span-2',
        queries: () => [qState(), qNation()],
        explain: ['This state’s coverage by school year, in scope.', 'National coverage by school year.'],
        draw: ([st, nat], body) => {
          const rows = joinYears(st, nat)
          return C.lines(chartBox(body), rows.map((r) => r.nat.year_label), [
            { name, values: rows.map((r) => r.st?.reported_coverage ?? null), color: '--accent', width: 3 },
            { name: 'United States', values: rows.map((r) => r.nat.us_coverage), color: '--c2' },
          ], { format: p1, beginAtZero: false, refs: [{ y: 95, label: '95% target' }], label: `MMR coverage, ${name} and US` })
        },
        finding: ([st]) => {
          const ok = st.filter((r) => r.reported_coverage !== null)
          const a = ok[0], b = ok[ok.length - 1]
          return a && b && a !== b ? [`${name}’s coverage went from `, { b: p1(a.reported_coverage) }, ` in ${a.year_label} to `, { b: p1(b.reported_coverage) }, ` in ${b.year_label}.`] : null
        },
        method: 'Years the state reported no coverage are gaps.',
      }),
      tile({
        title: 'Exemptions', sub: 'Share of kindergartners with any exemption, and with a non-medical one.',
        queries: () => [qState()],
        explain: ['This state’s exemption rates by school year, in scope.'],
        draw: ([st], body) => C.lines(chartBox(body), st.map((r) => r.year_label), [
          { name: 'Any exemption', values: st.map((r) => r.reported_exemption_pct), color: '--c3' },
          { name: 'Non-medical', values: st.map((r) => r.reported_nonmedical_pct), color: '--c4' },
        ], { format: p1, label: `Exemption rate, ${name}` }),
        finding: ([st]) => { const r = [...st].reverse().find((x) => x.reported_exemption_pct !== null); return r ? [`In ${r.year_label}, `, { b: C.fmt(r.exemptions) }, ` kindergartners in ${name} had an exemption, ${p1(r.reported_exemption_pct)}.`] : null },
        method: 'Some states report no exemptions in some years; those are gaps.',
      }),
      tile({
        title: 'Measles cases', sub: 'Confirmed cases the state reported, by year.',
        queries: () => [qCases],
        explain: ['This state’s confirmed cases in 2024, 2025 and 2026.'],
        draw: ([cs], body) => C.bars(chartBox(body), [['2024', 'cases_2024'], ['2025', 'cases_2025'], ['2026', 'cases_2026']].map(([l, f]) => ({ label: l, value: cs[0][f] ?? 0 })), { color: '--accent', direct: true, label: `Measles cases, ${name}` }),
        method: 'CDC publishes cases by state from 2024. 2026 is to CDC’s latest weekly update.',
      }),
      h('p', {}, h('button', { class: 'btn', type: 'button', text: inCompare(id) ? 'In Compare' : 'Add to Compare', onclick: () => { if (!inCompare(id)) compareList = [...compareList, id].slice(-S.COMPARE_MAX); go({ view: 'compare', id: null, compare: compareList }) } }))))
}

function records() {
  return h('div', { class: 'view wrap' },
    ...viewHead('Records', 'Every place and school year in scope, newest first, as CDC reports them: states, New York City and Houston on their own, and the national rows.'),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Kindergarten coverage and exemptions', cls: 'span-2',
        queries: () => [S.tileQuery('records', scope, known)],
        explain: ['One row per place and school year, in scope.'],
        draw: ([rows], body) => {
          const cols = [['place', 'Place'], ['year_label', 'School year'], ['coverage_pct', 'MMR coverage'], ['exemption_pct', 'Any exemption'], ['nonmedical_pct', 'Non-medical'], ['medical_pct', 'Medical'], ['kindergarten_population', 'Kindergartners'], ['method', 'Survey']]
          const cell = (r, k) => (r[k] === null || r[k] === undefined || r[k] === '' ? '–' : /pct/.test(k) ? p1(r[k]) : typeof r[k] === 'number' ? C.fmt(r[k]) : r[k])
          const shown = rows.slice(0, 200)
          body.append(h('div', { class: 'working__rows records' }, h('table', {},
            h('thead', {}, h('tr', {}, ...cols.map(([, l]) => h('th', { text: l })))),
            h('tbody', {}, ...shown.map((r) => h('tr', {}, ...cols.map(([k]) => h('td', { class: typeof r[k] === 'number' ? 'num' : null, text: cell(r, k) }))))))),
          h('p', { class: 'card__method', text: `${C.fmt(rows.length)} rows in scope${rows.length > 200 ? '; the first 200 shown. Show the working to download them all.' : '.'}` }))
        },
        method: 'A dash is a figure CDC did not publish. Survey is how the state counted: census, sample or voluntary response.',
      })))
}

function compare() {
  const ids = route.compare
  compareList = ids
  const names = ids.map(S.ENTITY.label)
  const picker = h('select', { 'aria-label': 'Add a state', onchange: (e) => e.target.value && go({ view: 'compare', id: null, compare: [...ids, e.target.value].slice(-S.COMPARE_MAX) }, scope, { push: false }) },
    h('option', { value: '', text: ids.length >= S.COMPARE_MAX ? `Up to ${S.COMPARE_MAX} states` : 'Add a state' }),
    ...known.entity.filter((x) => !ids.includes(x)).map((x) => h('option', { value: x, text: S.ENTITY.label(x) })))
  const chips = h('div', { class: 'chips' }, ...ids.map((x) => h('span', { class: 'chip' }, S.ENTITY.label(x), h('button', { type: 'button', 'aria-label': `Remove ${S.ENTITY.label(x)}`, text: '×', onclick: () => go({ view: 'compare', id: null, compare: ids.filter((y) => y !== x) }, scope, { push: false }) }))))
  const colors = ['--accent', '--c2', '--c3', '--c4']
  const series = (rows, f, labels) => ids.map((x, i) => {
    const by = new Map(rows.filter((r) => r.code === x).map((r) => [r.year_label, r[f]]))
    return { name: S.ENTITY.label(x), values: labels.map((l) => by.get(l) ?? null), color: colors[i] }
  })
  const labelsOf = (rows) => [...new Set(rows.map((r) => r.year_label))].sort()
  return h('div', { class: 'view wrap' },
    ...viewHead('Compare states', `Up to ${S.COMPARE_MAX} states side by side. Add them here, or from the table on Explore.`),
    h('div', { class: 'compare-pick' }, picker, chips),
    !ids.length ? h('p', { class: 'state', text: 'Choose a state to start.' }) : h('div', { class: 'grid-2' },
      tile({
        title: 'MMR coverage', sub: names.join(', '),
        queries: () => [S.compareQuery('state_year', ids, scope, known)],
        explain: ['Each state’s coverage by school year, in scope.'],
        draw: ([rows], body) => { const l = labelsOf(rows); return C.lines(chartBox(body), l, series(rows, 'reported_coverage', l), { format: p1, beginAtZero: false, refs: [{ y: 95, label: '95% target' }], label: 'MMR coverage by state' }) },
      }),
      tile({
        title: 'Exemptions', sub: names.join(', '),
        queries: () => [S.compareQuery('state_year', ids, scope, known)],
        explain: ['Each state’s exemption rate by school year, in scope.'],
        draw: ([rows], body) => { const l = labelsOf(rows); return C.lines(chartBox(body), l, series(rows, 'reported_exemption_pct', l), { format: p1, label: 'Exemption rate by state' }) },
      }),
      tile({
        title: 'Since before the pandemic', sub: 'Coverage in 2019-20 and 2025-26.',
        queries: () => [`run: state_slip -> biggest_slips + { where: code = ${ids.map(S.lit).join(' | ')} }`],
        explain: ['Each state’s coverage in 2019-20 and 2025-26.'],
        draw: ([rows], body) => C.arrows(chartBox(body), rows.map((r) => ({ id: r.code, label: r.place, a: r.coverage_2019, b: r.coverage_latest })), { aName: '2019-20', bName: '2025-26', format: p1, change: (r) => ({ text: pts(r.b - r.a), cls: r.b < r.a ? 'fx-bad' : 'fx-good' }), onPick: openEntity }),
        method: 'Fixed years; states missing either year are left out.',
      }),
      tile({
        title: 'Measles cases', sub: '2024, 2025 and 2026.',
        queries: () => [`run: state_cases -> by_state + { where: code = ${ids.map(S.lit).join(' | ')} }`],
        explain: ['Each state’s confirmed cases by year.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.state_name, value: r.cases_2026 })), { horizontal: true, direct: true, color: '--accent', label: 'Cases in 2026', tip: (b) => { const r = rows.find((x) => x.state_name === b.label); return [`2025: ${C.fmt(r.cases_2025)}`, `2024: ${C.fmt(r.cases_2024)}`] } }),
        finding: ([rows]) => [{ b: rows[0].state_name }, ` has the most cases of these in 2026, ${C.fmt(rows[0].cases_2026)}.`],
        method: 'Bars are 2026; hover for earlier years.',
      })))
}

function about() {
  const src = [
    ['Measles cases by year, 1985 to now', 'CDC, Measles Cases and Outbreaks (yearly chart data)', 'US federal compilation of state and local health department reports'],
    ['Measles cases by week of rash onset, 2022 to now', 'CDC, Measles Cases and Outbreaks (weekly chart data)', 'As above'],
    ['Measles cases by state, 2024 to now', 'CDC, Measles Cases and Outbreaks (map data)', 'As above'],
    ['Kindergarten MMR coverage and exemptions, 2009-10 to 2025-26', 'CDC SchoolVaxView, data.cdc.gov dataset ijqb-a7ye (NCIRD)', 'US federal compilation of state immunization program reports'],
  ]
  return h('div', { class: 'view wrap about' },
    ...viewHead('About the data', 'Where the numbers come from, what was reshaped, and what to keep in mind.'),
    h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h2', { text: 'Sources' })),
      h('div', { class: 'working__rows' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Data' }), h('th', { text: 'Publisher' }), h('th', { text: 'Terms' }))),
        h('tbody', {}, ...src.map((r) => h('tr', {}, ...r.map((c) => h('td', { text: c }))))))),
      h('p', {}, `Case files were fetched November 13–14, 2026, from the Internet Archive’s copies of CDC’s chart data (www.cdc.gov refuses automated downloads); the weekly series runs to the week of ${known.through}. Kindergarten figures were fetched from data.cdc.gov in November 2026. Every figure is shown as CDC publishes it; this app adds sums, rankings and changes, never estimates. An independent app, not produced by CDC.`)),
    h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h2', { text: 'What to keep in mind' })),
      h('ul', {},
        h('li', { text: 'The current year is partial, and the latest weeks fill in as cases are confirmed.' }),
        h('li', { text: 'Cases are counted in the year and week of rash onset, not the date they were reported.' }),
        h('li', { text: 'State case counts sum to slightly less than the national total: a few cases are not yet assigned to a jurisdiction. New York City reports apart from the rest of New York State.' }),
        h('li', { text: 'States count kindergartners differently (census, sample or voluntary response), and some report no exemptions in some years. Compare a state with itself over time before comparing states.' }),
        h('li', { text: 'Coverage means two doses of MMR. 95% is the Healthy People target, the level that keeps measles from spreading in a school.' }),
        h('li', { text: '"Slipped" means coverage fell by 1 point or more between 2019-20 and 2025-26; smaller moves are within the noise of how states count. That threshold is this app’s choice.' }),
        )),
    h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h2', { text: 'Rebuild it' })),
      h('p', { text: 'The package’s pipeline/ folder fetches the files from CDC and shapes them into the four tables this app reads. Every card’s “Show the working” gives the Malloy query behind it, its rows and a CSV.' })))
}

function footer() {
  return h('div', {}, h('h2', { text: 'Measles comes back' }), h('p', { text: 'Source: CDC, from reports by state and local health departments (measles cases) and state immunization programs (SchoolVaxView kindergarten coverage). An independent app, not produced by CDC.' }))
}

boot()
