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
  // One at a time: the box's warehouse proxy returned empty rows to concurrent queries (2026-11-19).
  while (inFlight < 1 && queue.length) {
    const job = queue.shift()
    inFlight++
    job().finally(() => {
      inFlight--
      pump()
    })
  }
}
// The same proxy now and then answers a lone query with no rows; an empty answer is asked twice more.
async function runRetrying(q, tries = 3) {
  let rows = await Publisher.query(S.MODEL, q)
  for (let i = 1; i < tries && Array.isArray(rows) && !rows.length; i++) {
    await new Promise((r) => setTimeout(r, 300 * i))
    rows = await Publisher.query(S.MODEL, q)
  }
  return rows
}
export function query(q) {
  if (!cache.has(q)) {
    const p = new Promise((resolve, reject) => {
      queue.push(() => runRetrying(q).then(resolve, reject))
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
    const [years, regions, states, ratings] = await Promise.all([
      query('run: tornadoes -> { aggregate: lo is min(`year`), hi is max(`year`), latest is max(event_date) }'),
      query('run: tornadoes -> { group_by: region; order_by: region }'),
      query('run: tornadoes -> { group_by: state; where: state is not null; order_by: state }'),
      query('run: tornadoes -> { group_by: rating_class; order_by: rating_class }'),
    ])
    known.years = [years[0].lo, years[0].hi]
    known.latest = years[0].latest
    const values = (rows, f) => rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined)
    known.region = values(regions, 'region')
    known.state = values(states, 'state')
    known.rating = values(ratings, 'rating_class')
    known.entity = known.state
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Data through ${String(known.latest).slice(0, 10)}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Views: ADAPT. Each returns one element; tiles inside it load as they near the screen. ----

// The region colours: one per region on every chart, the lead region in the accent.
const REGION_COLOR = { Southeast: '--c1', 'Great Plains': '--c2', Midwest: '--c3', 'Atlantic coast': '--c4', Northeast: '--c5', West: '--c6' }
const REGIONS = ['Southeast', 'Great Plains', 'Midwest', 'Atlantic coast', 'Northeast', 'West']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RATING_LABEL = (r) => (r === 'Unknown' ? 'Unrated' : `(E)F${r}`)
const lon = (v) => `${Math.abs(v).toFixed(1)}°W`
const rateFmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : 'n/a')

function kpi(label, value, sub, accent = false) {
  return h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` },
    h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), sub && h('div', { class: 'kpi__sub' }, ...prose(sub)))
}

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}

function overview() {
  // The headline runs bare views of the model, and every number in the answer comes from their rows.
  const qK = `run: ${S.HEADLINE} -> kpis`
  const qD = `run: ${S.HEADLINE} -> by_decade`
  const answer = h('p', { class: 'answer' })
  query(qD).then((rows) => {
    const a = rows[0], z = rows[rows.length - 1]
    const cross = rows.find((r) => r.southeast_share_ef1 > r.plains_share_ef1)
    answer.replaceChildren(...prose([
      'Yes. In the ', a.decade_label, ' the Great Plains had ', { b: C.pct(a.plains_share_ef1, 0) }, ' of the country’s (E)F1+ tornadoes and the Southeast ',
      { b: C.pct(a.southeast_share_ef1, 0) }, '. In the ', z.decade_label, ' the Southeast has ', { b: C.pct(z.southeast_share_ef1, 0) }, ' and the Plains ',
      { b: C.pct(z.plains_share_ef1, 0) }, cross ? `; the Southeast first led in the ${cross.decade_label}.` : '.',
    ]))
  })
  const [, kicker, title, lede] = viewHead('Has tornado country moved from the Great Plains to the Southeast?',
    'NOAA’s Storm Prediction Center has logged every US tornado since 1950: where it touched down, how strong it was, who it killed. Counting the (E)F1 and stronger ones, whose reporting has changed least, the answer is decade by decade below.')
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    tile({
      title: 'The record at a glance', cls: 'span-2',
      queries: () => [qK, qD],
      explain: ['Every tornado in the record, 1950 to the latest month: counts, people killed and injured, and the Plains and Southeast shares of (E)F1+ tornadoes.', 'The same by decade; the 2020s hold six years.'],
      draw: ([[k], d], body) => {
        const z = d[d.length - 1]
        const svgSe = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        const svgGp = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        body.append(h('div', { class: 'kpis' },
          kpi('Southeast share, (E)F1+', C.pct(z.southeast_share_ef1, 0), [`in the ${z.decade_label}; `, { b: C.pct(k.southeast_share_ef1, 0) }, ' since 1950']),
          kpi('Great Plains share, (E)F1+', C.pct(z.plains_share_ef1, 0), [`in the ${z.decade_label}; `, { b: C.pct(k.plains_share_ef1, 0) }, ' since 1950']),
          kpi('Tornadoes since 1950', C.fmt(k.tornado_count), [{ b: C.fmt(k.ef1_plus_count) }, ' rated (E)F1 or stronger']),
          kpi('People killed', C.fmt(k.deaths), [{ b: C.pct(k.southeast_death_share, 0) }, ' of them in the Southeast'], true)))
        const kp = body.querySelectorAll('.kpi')
        kp[0].append(svgSe); kp[1].append(svgGp)
        C.sparkline(svgSe, d.map((r) => r.southeast_share_ef1), '--c1')
        C.sparkline(svgGp, d.map((r) => r.plains_share_ef1), '--c2')
      },
      method: 'Shares are of (E)F1+ tornadoes, by the state each began in. The Southeast here is AR, LA, MS, AL, TN, KY and GA; the Great Plains TX, OK, KS, NE, SD and ND.',
    }),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Share of the country’s (E)F1+ tornadoes', sub: 'Each line is a region’s share of all (E)F1+ tornadoes in that decade.', cls: 'span-2',
        queries: () => [qD],
        explain: ['Per decade: (E)F1+ tornadoes that began in the Great Plains, and in the Southeast, over all (E)F1+ tornadoes.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => r.decade_label), [
          { name: 'Southeast', values: rows.map((r) => r.southeast_share_ef1), color: '--c1', width: 3 },
          { name: 'Great Plains', values: rows.map((r) => r.plains_share_ef1), color: '--c2', width: 3 },
        ], { format: (v) => C.pct(v, 0), height: 320 }),
        finding: ([rows]) => {
          const cross = rows.find((r) => r.southeast_share_ef1 > r.plains_share_ef1)
          return cross ? ['The lines cross in the ', { b: cross.decade_label }, `: the Southeast ${C.pct(cross.southeast_share_ef1, 0)}, the Great Plains ${C.pct(cross.plains_share_ef1, 0)}.`] : []
        },
        method: 'F0 tornadoes are left out: far more of them are reported since Doppler radar and storm spotters spread in the 1990s, wherever they happen.',
      }),
      tile({
        title: 'States with the most strong tornadoes', sub: 'Ranked by (E)F1+ tornadoes; the trend is (E)F1+ per year, decade by decade. Open a state’s page.', cls: 'span-2',
        queries: () => [S.viewQuery('by_state', S.DEFAULT_SCOPE, known)],
        explain: ['Per state the tornado began in: (E)F1+ tornadoes, and per decade the (E)F1+ count over the years in it.'],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.state, name: S.ENTITY.label(r.state), sub: r.region, value: r.ef1_plus_count, trend: r.trend.map((t) => t.ef1_plus_per_year) })), {
          valueLabel: '(E)F1+ tornadoes', trendLabel: 'Per year, 1950s to 2020s', limit: 8, onOpen: openEntity, href: (id) => linkTo('state', id),
        }),
        finding: ([rows]) => [{ b: S.ENTITY.label(rows[0].state) }, ` has had the most (E)F1+ tornadoes, ${C.fmt(rows[0].ef1_plus_count)}, and `, { b: S.ENTITY.label(rows[1].state) }, ` the next most, ${C.fmt(rows[1].ef1_plus_count)}.`],
        method: 'A tornado counts in the state it began in, even when it crossed into others.',
      })))
}

function explore() {
  const pickRegion = (r) => toggleScope('region', r)
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore', 'Filter by years, region, state or rating; a click on a bar or row filters every card, and the address keeps it.'),
    section('Over time', 'How many, and where, decade by decade.',
      tile({
        title: 'Tornadoes per year', sub: 'Drag across the chart to choose a period.', cls: 'span-2',
        queries: () => [S.tileQuery('years', scope, known)],
        explain: ['Tornadoes per year under the filters, all ratings and (E)F1+.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => String(r.year)), [
          { name: 'All', values: rows.map((r) => r.tornado_count), color: '--text-soft' },
          { name: '(E)F1+', values: rows.map((r) => r.ef1_plus_count), color: '--accent', width: 2.5 },
        ], { band: scope.from || scope.to ? { from: String(scope.from ?? known.years[0]), to: String(scope.to ?? known.years[1]) } : null, onBrush: (a, b) => setScope({ from: Number(a), to: Number(b) }), maxTicks: 8 }),
        finding: ([rows]) => {
          const top = rows.reduce((m, r) => (r.tornado_count > m.tornado_count ? r : m))
          return ['The busiest year was ', { b: String(top.year) }, `, with ${C.fmt(top.tornado_count)} tornadoes.`]
        },
        method: 'All tornadoes rise as reporting improves; the (E)F1+ line is the steadier one.',
      }),
      tile({
        title: '(E)F1+ tornadoes a year, by region', sub: 'Per decade, so the six-year 2020s compare with full decades.', cls: 'span-2',
        queries: () => [S.tileQuery('regionDecades', scope, known)],
        explain: ['Per region and decade: (E)F1+ tornadoes over the number of years with any tornado in that decade.'],
        draw: ([rows], body) => {
          const labels = [...new Set(rows.map((r) => r.decade_label))]
          const series = REGIONS.filter((g) => rows.some((r) => r.region === g)).map((g) => ({
            name: g, color: REGION_COLOR[g], width: g === 'Southeast' || g === 'Great Plains' ? 3 : 1.5,
            values: labels.map((l) => rows.find((r) => r.region === g && r.decade_label === l)?.ef1_plus_per_year ?? null),
          }))
          return C.lines(chartBox(body), labels, series, { format: rateFmt, height: 340 })
        },
        finding: ([rows]) => {
          const last = rows.filter((r) => r.decade === Math.max(...rows.map((x) => x.decade))).sort((a, b) => b.ef1_plus_per_year - a.ef1_plus_per_year)[0]
          return last ? ['In the ', { b: last.decade_label }, `, the ${last.region} has the most (E)F1+ tornadoes a year, ${rateFmt(last.ef1_plus_per_year)}.`] : []
        },
        method: 'Regions are this app’s grouping of states; About lists them.',
      }),
      tile({
        title: 'Where the average strong tornado touches down', sub: 'The mean longitude of (E)F1+ touch-down points, per decade.',
        queries: () => [S.tileQuery('decades', scope, known)],
        explain: ['Per decade: the average longitude where (E)F1+ tornadoes began.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => r.decade_label), [{ name: 'Mean longitude', values: rows.map((r) => r.mean_lon_ef1), color: '--accent', width: 2.5 }], { format: lon, beginAtZero: false, endLabels: false, height: 240 }),
        finding: ([rows]) => ['From ', { b: lon(rows[0].mean_lon_ef1) }, ` in the ${rows[0].decade_label} to `, { b: lon(rows[rows.length - 1].mean_lon_ef1) }, ` in the ${rows[rows.length - 1].decade_label}: higher is further east.`],
        method: 'Further east means toward the Mississippi and the Southeast.',
      }),
      tile({
        title: 'Southeast share: tornadoes and deaths', sub: 'Per decade, the Southeast’s share of (E)F1+ tornadoes and of tornado deaths.',
        queries: () => [S.tileQuery('decades', scope, known)],
        explain: ['Per decade: Southeast (E)F1+ tornadoes over all, and people killed in Southeast tornadoes over all killed.'],
        draw: ([rows], body) => C.dumbbell(chartBox(body), rows.map((r) => ({ label: r.decade_label, id: r.decade_label, a: r.southeast_share_ef1, b: r.southeast_death_share })), {
          aName: 'Share of (E)F1+ tornadoes', bName: 'Share of deaths', aColor: '--c-bar', bColor: '--accent', format: (v) => C.pct(v, 0), diff: (r) => C.pct(r.b, 0),
        }),
        finding: ([rows]) => { const z = rows[rows.length - 1]; return ['In the ', { b: z.decade_label }, `, the Southeast had ${C.pct(z.southeast_share_ef1, 0)} of strong tornadoes and `, { b: C.pct(z.southeast_death_share, 0) }, ' of the deaths.'] },
        method: 'Deaths are as recorded on the tornado that caused them.',
      })),
    section('Where and how strong', 'Click a region, state or rating to filter the page.',
      tile({
        title: 'States', sub: 'Ranked by (E)F1+ tornadoes; the trend is (E)F1+ per year by decade. Click to filter, or open a state’s page.', cls: 'span-2',
        queries: () => [S.tileQuery('states', scope, known)],
        explain: ['Per state the tornado began in, under the filters: (E)F1+ tornadoes, and per decade (E)F1+ per year.'],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.state, name: S.ENTITY.label(r.state), sub: r.region, value: r.ef1_plus_count, trend: r.trend.map((t) => t.ef1_plus_per_year) })), {
          valueLabel: '(E)F1+ tornadoes', trendLabel: 'Per year by decade', selected: scope.state, onOpen: (id) => toggleScope('state', id), href: (id) => linkTo('state', id),
        }),
        finding: ([rows]) => [{ b: S.ENTITY.label(rows[0].state) }, ` leads with ${C.fmt(rows[0].ef1_plus_count)} (E)F1+ tornadoes and ${C.fmt(rows[0].deaths)} deaths.`],
      }),
      tile({
        title: 'Regions at night', sub: 'Share of each region’s tornadoes that began between midnight and 6 a.m. Click to filter.',
        queries: () => [S.tileQuery('regions', scope, known)],
        explain: ['Per region: tornadoes that began from 00:00 to 05:59 local standard time over all tornadoes.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.region, value: r.night_share })).sort((a, b) => b.value - a.value), { horizontal: true, direct: true, format: (v) => C.pct(v, 0), selected: scope.region, onPick: pickRegion, color: '--c-bar' }),
        finding: ([rows]) => { const t = [...rows].sort((a, b) => b.night_share - a.night_share)[0]; return [`In the ${t.region}, `, { b: C.pct(t.night_share, 0) }, ' of tornadoes began at night, when they are hardest to see and warnings reach fewer people.'] },
        method: 'Times are in SPC’s local standard time (CST for most of the record).',
      }),
      tile({
        title: 'How strong', sub: 'Tornadoes and deaths by rating. Click to filter.',
        queries: () => [S.tileQuery('ratings', scope, known)],
        explain: ['Per rating class, F and EF together: tornadoes and people killed.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: RATING_LABEL(r.rating_class), value: r.deaths, key: r.rating_class, tornadoes: r.tornado_count })), {
          direct: true, color: '--accent', selected: scope.rating ? RATING_LABEL(scope.rating) : null,
          onPick: (l) => toggleScope('rating', rows0(l)), tip: (r) => [`${C.fmt(r.tornadoes)} tornadoes`], label: 'People killed',
        }),
        finding: ([rows]) => { const v = rows.filter((r) => r.rating_class === '4' || r.rating_class === '5'); return v.length === 2 ? ['(E)F4 and (E)F5 tornadoes were ', { b: C.fmt(v[0].tornado_count) }, ' and ', { b: C.fmt(v[1].tornado_count) }, ` of the record, and killed ${C.fmt(v[0].deaths)} and ${C.fmt(v[1].deaths)} people.`] : [] },
        method: 'F ratings before February 2007, EF after; the classes line up by design.',
      })),
    section('When', 'The season and the hour.',
      tile({
        title: 'Month by hour', sub: 'Tornadoes by month and hour they began. Darker is more.', cls: 'span-2',
        queries: () => [S.tileQuery('clock', scope, known)],
        explain: ['Per month and hour of the day (local standard time): tornadoes under the filters.'],
        draw: ([rows], body) => C.heatmap(chartBox(body), MONTHS, Array.from({ length: 24 }, (_, i) => String(i)), rows.filter((r) => r.hour_local !== null).map((r) => ({ row: MONTHS[r.month - 1], col: String(r.hour_local), value: r.tornado_count }))),
        finding: ([rows]) => { const t = rows.reduce((m, r) => (r.tornado_count > m.tornado_count ? r : m)); return ['The busiest hour is ', { b: `${t.hour_local}:00 in ${MONTHS[t.month - 1]}` }, `, with ${C.fmt(t.tornado_count)} tornadoes.`] },
        method: 'Hours are SPC’s local standard time; columns read left to right from midnight.',
      }),
      tile({
        title: 'The season', sub: '(E)F1+ tornadoes by the month they began.',
        queries: () => [S.tileQuery('months', scope, known)],
        explain: ['Per month: (E)F1+ tornadoes under the filters.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: MONTHS[r.month - 1], value: r.ef1_plus_count })), { color: '--c-bar', height: 240 }),
        finding: ([rows]) => { const t = rows.reduce((m, r) => (r.ef1_plus_count > m.ef1_plus_count ? r : m)); return [{ b: MONTHS[t.month - 1] }, ` has the most, ${C.fmt(t.ef1_plus_count)}.`] },
      })))
}
const rows0 = (label) => (label === 'Unrated' ? 'Unknown' : label.replace('(E)F', ''))

function entity() {
  const id = route.id
  const name = S.ENTITY.label(id)
  const skip = S.skipFor(route.view)
  return h('div', { class: 'view wrap' },
    ...viewHead(name, `Every tornado that began in ${name}, from the same record as the rest of the app. The filters above apply; the state is fixed by this page.`, [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${name}`]),
    tile({
      title: `${name} at a glance`, cls: 'span-2',
      queries: () => [S.entityQuery('kpis', id, scope, known), S.viewQuery('kpis', scope, known, skip)],
      explain: [`Tornadoes that began in ${name} under the filters: counts, people killed and injured.`, 'The same for the whole country under the filters.'],
      draw: ([[k], [all]], body) => body.append(h('div', { class: 'kpis' },
        kpi('Tornadoes', C.fmt(k.tornado_count), [{ b: C.pct(k.tornado_count / all.tornado_count, 1) }, ' of the country’s']),
        kpi('(E)F1 or stronger', C.fmt(k.ef1_plus_count), [{ b: C.fmt(k.intense_count) }, ' rated (E)F3 or stronger']),
        kpi('Per year', rateFmt(k.tornadoes_per_year), ['tornadoes, on average']),
        kpi('People killed', C.fmt(k.deaths), [{ b: C.fmt(k.injured) }, ' injured'], true))),
      method: 'The share of the country’s divides two counts the model returns.',
    }),
    h('div', { class: 'grid-2' },
      tile({
        title: '(E)F1+ tornadoes a year, by decade', sub: 'Per year, so the six-year 2020s compare fairly. Set this state beside others on the Compare view.', cls: 'span-2',
        queries: () => [S.entityQuery('by_decade', id, scope, known)],
        explain: [`Per decade: (E)F1+ tornadoes that began in ${name} over the years in the decade with any tornado there.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.decade_label, value: r.ef1_plus_per_year })), { direct: true, format: rateFmt, color: '--accent', height: 260 }),
        finding: ([rows]) => { const a = rows[0], z = rows[rows.length - 1]; return ['From ', { b: rateFmt(a.ef1_plus_per_year) }, ` a year in the ${a.decade_label} to `, { b: rateFmt(z.ef1_plus_per_year) }, ` in the ${z.decade_label}.`] },
        method: 'The 2020s hold six years; per year keeps them comparable.',
      }),
      tile({
        title: 'Month by hour', sub: 'When tornadoes begin in this state. Darker is more.', cls: 'span-2',
        queries: () => [S.entityQuery('month_hour', id, scope, known)],
        explain: [`Per month and hour (local standard time): tornadoes that began in ${name}.`],
        draw: ([rows], body) => C.heatmap(chartBox(body), MONTHS, Array.from({ length: 24 }, (_, i) => String(i)), rows.filter((r) => r.hour_local !== null).map((r) => ({ row: MONTHS[r.month - 1], col: String(r.hour_local), value: r.tornado_count }))),
        finding: ([rows]) => { const t = rows.reduce((m, r) => (r.tornado_count > m.tornado_count ? r : m)); return ['The busiest hour is ', { b: `${t.hour_local}:00 in ${MONTHS[t.month - 1]}` }, `, with ${C.fmt(t.tornado_count)} tornadoes.`] },
      }),
      tile({
        title: 'The deadliest tornadoes', sub: `Tornadoes that began in ${name}, by people killed.`, cls: 'span-2',
        queries: () => [S.entityQuery('deadliest', id, scope, known, 'order_by: fatalities desc; limit: 10')],
        explain: [`The ten tornadoes that began in ${name} under the filters and killed the most people.`],
        draw: ([rows], body) => body.append(recordTable(rows, ['event_date', 'rating', 'fatalities', 'injuries', 'length_mi', 'width_yd'])),
        finding: ([rows]) => ['The deadliest, on ', { b: String(rows[0].event_date).slice(0, 10) }, `, killed ${C.fmt(rows[0].fatalities)} people.`],
        method: 'Deaths are as SPC records them on the tornado; a long track crossing a state line counts in the state it began in.',
      })))
}

const COLS = {
  event_date: ['Date', (v) => String(v).slice(0, 10)], hour_local: ['Hour', (v) => (v === null ? '' : `${v}:00`)], state: ['State', (v) => v],
  region: ['Region', (v) => v], rating: ['Rating', (v) => (v === 'Unknown' || v === null ? 'Unrated' : v)], fatalities: ['Killed', C.fmt, 1], injuries: ['Injured', C.fmt, 1],
  length_mi: ['Path, miles', (v) => (v ?? 0).toFixed(1), 1], width_yd: ['Width, yards', C.fmt, 1],
}
function recordTable(rows, cols) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', { class: COLS[c][2] ? 'num' : '', text: COLS[c][0] })))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...cols.map((c) => c === 'state'
      ? h('td', {}, h('a', { href: linkTo('state', r.state), text: S.ENTITY.label(r.state) }))
      : h('td', { class: COLS[c][2] ? 'num' : '', text: COLS[c][1](r[c]) })))))))
}

function records() {
  return h('div', { class: 'view wrap' },
    ...viewHead('Records', 'The newest fifty tornadoes under the filters, one row each. Narrow the filters to reach older ones; the working under the table has a CSV.'),
    tile({
      title: 'Tornadoes, newest first', cls: 'span-2',
      queries: () => [S.tileQuery('records', scope, known)],
      explain: ['One row per tornado under the filters, newest first, at most 50.'],
      draw: ([rows], body) => body.append(recordTable(rows, ['event_date', 'hour_local', 'state', 'region', 'rating', 'fatalities', 'injuries', 'length_mi', 'width_yd'])),
      method: 'A tornado that crossed state lines appears once, under the state it began in. Hours are local standard time.',
    }))
}

function compare() {
  const ids = route.compare
  const setIds = (next) => go({ view: 'compare', id: null, compare: next }, scope, { push: false })
  const add = h('select', { 'aria-label': 'Add a state', onchange: (e) => e.target.value && setIds([...ids, e.target.value]) },
    h('option', { value: '', text: ids.length >= S.COMPARE_MAX ? `At most ${S.COMPARE_MAX}` : 'Add a state' }),
    ...known.entity.filter((s) => !ids.includes(s)).map((s) => h('option', { value: s, text: S.ENTITY.label(s) })))
  add.disabled = ids.length >= S.COMPARE_MAX
  const chips = h('div', { class: 'chips' }, ...ids.map((s) => h('span', { class: 'chip' }, S.ENTITY.label(s), h('button', { type: 'button', 'aria-label': `Remove ${S.ENTITY.label(s)}`, text: '×', onclick: () => setIds(ids.filter((x) => x !== s)) }))))
  const head = [...viewHead('Compare', 'Up to four states side by side, under the filters above.'), h('div', { class: 'compare-pick' }, add, chips)]
  if (!ids.length) {
    return h('div', { class: 'view wrap' }, ...head,
      h('p', { class: 'lede' }, 'Pick a state to start, or try ', h('a', { href: linkTo('compare', null, ['OK', 'AL', 'MS', 'KS']), text: 'Oklahoma, Kansas, Alabama and Mississippi' }), '.'))
  }
  return h('div', { class: 'view wrap' }, ...head,
    h('div', { class: 'grid-2' },
      tile({
        title: '(E)F1+ tornadoes a year, by decade', sub: 'One line per state.', cls: 'span-2',
        queries: () => [S.compareQuery('by_state', ids, scope, known)],
        explain: ['Per state and decade: (E)F1+ tornadoes over the years with any tornado in that decade.'],
        draw: ([rows], body) => {
          const labels = [...new Set(rows.flatMap((r) => r.trend.map((t) => `${t.decade}s`)))].sort()
          const colors = ['--c1', '--c2', '--c3', '--c4']
          const ordered = ids.map((s) => rows.find((r) => r.state === s)).filter(Boolean)
          return C.lines(chartBox(body), labels, ordered.map((r, i) => ({ name: S.ENTITY.label(r.state), color: colors[i], width: 2.5, values: labels.map((l) => r.trend.find((t) => `${t.decade}s` === l)?.ef1_plus_per_year ?? null) })), { format: rateFmt, height: 320 })
        },
        method: 'Colours here follow the order the states were picked, not the regions.',
      }),
      tile({
        title: 'Side by side', cls: 'span-2',
        queries: () => [S.compareQuery('by_state', ids, scope, known)],
        explain: ['Per state under the filters: tornadoes, (E)F1+, (E)F3+, tornadoes that killed, deaths and injuries.'],
        draw: ([rows], body) => body.append(h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ...['State', 'Region', 'Tornadoes', '(E)F1+', '(E)F3+', 'Killer tornadoes', 'Killed', 'Injured'].map((t, i) => h('th', { class: i > 1 ? 'num' : '', text: t })))),
          h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, h('a', { href: linkTo('state', r.state), text: S.ENTITY.label(r.state) })), h('td', { text: r.region }),
            ...[r.tornado_count, r.ef1_plus_count, r.intense_count, r.killer_count, r.deaths, r.injured].map((v) => h('td', { class: 'num', text: C.fmt(v) })))))))),
      })))
}

function about() {
  const p = (...kids) => h('p', {}, ...kids)
  const a = (href, text) => h('a', { href, text, rel: 'noopener', target: '_blank' })
  return h('div', { class: 'view wrap' },
    ...viewHead('About the data', 'Where the numbers come from, what was changed, and what they cannot tell you.'),
    h('div', { class: 'prose' },
      h('h2', { text: 'The source' }),
      p('Every number in this app comes from the ', a('https://www.spc.noaa.gov/wcm/', 'Severe Weather Database'), ' of NOAA’s Storm Prediction Center (SPC): one row per tornado since 1950, with where it began and ended, its rating, path length and width, and the people it killed and injured. It is a work of the US federal government and in the public domain. Source: NOAA Storm Prediction Center.'),
      p('The app reads the file of actual tornadoes (1950 to the latest complete year) and keeps its whole-track records, one row per tornado, so a tornado that crossed state lines counts once, in the state it began in. Property and crop losses are left out, because their units change three times across the record; unknown ratings are shown as Unrated.'),
      h('h2', { text: 'Regions' }),
      p('The regions are this app’s grouping of states, not an official one. Great Plains: Texas, Oklahoma, Kansas, Nebraska, South Dakota and North Dakota. Southeast: Arkansas, Louisiana, Mississippi, Alabama, Tennessee, Kentucky and Georgia, the area often called Dixie Alley. Midwest: Iowa, Missouri, Minnesota, Wisconsin, Illinois, Indiana, Michigan and Ohio. Atlantic coast: Florida, South Carolina, North Carolina, Virginia, West Virginia, Maryland, Delaware and DC. Northeast: Pennsylvania, New Jersey, New York and New England. West: every other state and territory.'),
      h('h2', { text: 'Caveats' }),
      h('ul', {},
        h('li', { text: 'Reporting has changed. Far more weak (F0/EF0) tornadoes are reported since Doppler radar and storm spotter networks spread in the 1990s. The app compares regions on (E)F1 and stronger tornadoes, whose counts have changed least, and on shares, which a nationwide change in reporting affects less than counts.' }),
        h('li', { text: 'Ratings changed scale. Tornadoes before 1 February 2007 are rated on the Fujita (F) scale, later ones on the Enhanced Fujita (EF) scale; the classes 0 to 5 are designed to line up, and the app groups them. Ratings of early tornadoes were assigned later from records.' }),
        h('li', { text: 'The 2020s hold six years, 2020 to 2025. Compare decades by per-year measures and shares, never by totals.' }),
        h('li', { text: 'Times are SPC’s local standard time (Central Standard Time for most of the record), so night means midnight to 6 a.m. in that clock.' }),
        h('li', { text: 'A count of tornadoes is not a measure of risk to people: deaths depend on where people live, the time of day, housing and warnings.' })),
      h('h2', { text: 'How it is built' }),
      p('The fetch and shaping scripts are in the package’s pipeline folder, so anyone can rebuild the table from SPC’s file. The semantic model, tornadoes.malloy, defines every measure the app shows; the working under each card shows its query and rows.')))
}
function footer() {
  return h('div', {}, h('h2', { text: 'US Tornadoes' }), h('p', { text: 'Source: NOAA Storm Prediction Center, Severe Weather Database (public domain). An independent app, not produced by NOAA.' }))
}

boot()
