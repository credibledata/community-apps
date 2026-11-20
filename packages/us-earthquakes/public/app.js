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
  // One at a time: in this Publisher, queries sent together can come back with no rows.
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
      // An empty answer is asked again, waiting longer each time, before it is believed: under load this Publisher
      // sometimes drops a result's rows.
      const ask = (n) => Publisher.query(S.MODEL, q).then((r) =>
        n < 4 && Array.isArray(r) && r.length === 0 ? new Promise((ok) => setTimeout(ok, 400 * 2 ** n)).then(() => ask(n + 1)) : r)
      queue.push(() => ask(0).then(resolve, reject))
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
    const [years, states, mags, k] = await Promise.all([
      query('run: earthquakes -> by_year'),
      query('run: earthquakes -> { group_by: state, state_name; order_by: state_name }'),
      query('run: earthquakes -> by_magnitude'),
      query('run: earthquakes -> kpis'),
    ])
    known.years = [years[0].event_year, years.at(-1).event_year]
    for (const r of states) if (r.state) S.NAMES[r.state] = r.state_name
    known.state = states.map((r) => r.state).filter(Boolean)
    known.magnitude = mags.map((r) => r.magnitude_class).filter(Boolean)
    known.entity = known.state
    known.latest = k[0].latest_quake
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Data through ${day(known.latest)}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Views ----

const day = (t) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const one = (v) => C.fmt(Math.round(v * 10) / 10)
const whole = (v) => C.fmt(Math.round(v))
const STATE_COLOR = { OK: '--c1', CA: '--c2', TX: '--c3', KS: '--c4' }
const DEPTHS = [{ name: '0–4.9 km', color: '--seq-1' }, { name: '5–9.9 km', color: '--seq-3' }, { name: '10–19.9 km', color: '--seq-4' }, { name: '20 km+', color: '--seq-5' }]
/** Years from lo to hi as labels, and a series with zero for years that had no earthquake. */
const yearsOf = (lo, hi) => range(lo, hi).map(String)
const fill = (labels, rows, key, val) => { const m = new Map(rows.map((r) => [String(r[key]), r[val]])); return labels.map((l) => m.get(l) ?? 0) }
const yearSpan = () => [scope.from ?? known.years[0], scope.to ?? known.years[1]]
const band = () => (scope.from !== null || scope.to !== null ? { from: String(yearSpan()[0]), to: String(yearSpan()[1]), label: 'In scope' } : null)
const stateLink = (id) => linkTo(S.ENTITY.view, id)

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}

function kpi(label, value, sub, accent, spark) {
  const svg = spark && document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  if (svg) C.sparkline(svg, spark.values, spark.color, { band: spark.band })
  return h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), sub && h('div', { class: 'kpi__sub' }, ...prose(sub)), svg)
}

function overview() {
  const qH = `run: ${S.HEADLINE} -> headline`
  const qY = `run: ${S.HEADLINE} -> ok_ca_by_year`
  const answer = h('p', { class: 'answer' })
  query(qH).then(([k]) => answer.replaceChildren(...prose([
    'Oklahoma went from ', { b: one(k.ok_per_year_before) }, ' earthquakes a year in 2000–08 to ', { b: whole(k.ok_per_year_surge) },
    ' a year in 2009–15. After the disposal limits it fell to ', { b: C.fmt(k.ok_last_full_year) }, ` in ${k.last_full_year}. California averaged `,
    { b: whole(k.ca_per_year_before) }, ', ', { b: whole(k.ca_per_year_surge) }, ' and ', { b: whole(k.ca_per_year_after) }, ' a year across the same periods.',
  ])))
  const [, kicker, title, lede] = viewHead('Did Oklahoma’s earthquake boom end when the wells were limited?',
    'Oklahoma used to feel a handful of earthquakes a year. Then oil and gas operators began pumping billions of barrels of salty wastewater deep underground, and the state began to shake more often than California. Every earthquake of magnitude 2.5 and up in the contiguous US since 2000, from the USGS catalog.')
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    h('div', { class: 'grid-2' },
      tile({
        title: 'Oklahoma against California', cls: 'span-2',
        queries: () => [qH, qY],
        explain: ['The headline: each state\'s earthquakes (M2.5+) per year in each period, and in the last whole year. Whole years only.', 'Oklahoma\'s and California\'s earthquakes per whole year, for the trends.'],
        draw: ([[k], ys], body) => {
          const ok = ys.map((r) => r.ok_quakes)
          const ca = ys.map((r) => r.ca_quakes)
          const peak = ys.reduce((a, r) => (r.ok_quakes > a.ok_quakes ? r : a), ys[0])
          body.append(h('div', { class: 'kpis' },
            kpi('Oklahoma, a year, 2000–08', one(k.ok_per_year_before), `${C.fmt(k.ok_before)} in ${k.years_before} years`, false, { values: ok, color: '--c1', band: [0, 8] }),
            kpi('Oklahoma, a year, 2009–15', whole(k.ok_per_year_surge), ['Peak ', { b: C.fmt(peak.ok_quakes) }, ` in ${peak.event_year}`], true, { values: ok, color: '--c1', band: [9, 15] }),
            kpi(`Oklahoma in ${k.last_full_year}`, C.fmt(k.ok_last_full_year), `${whole(k.ok_per_year_after)} a year since 2016`, false, { values: ok, color: '--c1', band: [ok.length - 1, ok.length - 1] }),
            kpi('California, a year, since 2016', whole(k.ca_per_year_after), `${C.fmt(k.ca_last_full_year)} in ${k.last_full_year}`, false, { values: ca, color: '--c2' })))
        },
        method: 'Counts every earthquake of magnitude 2.5 and up with its epicentre inside the state. The latest year is left out because it is not over. The periods break at 2009, the first year far above the old rate, and 2016, the first year under the regional cap on disposal volumes.',
      }),
      tile({
        title: 'Earthquakes a year, Oklahoma and California', cls: 'span-2',
        sub: 'M2.5 and up, whole years. The shaded years are the surge; the line marks the limits on wastewater disposal.',
        queries: () => [qY],
        explain: ['Oklahoma\'s and California\'s earthquakes per whole year.'],
        draw: ([ys], body) => C.lines(chartBox(body), ys.map((r) => String(r.event_year)), [
          { name: 'Oklahoma', values: ys.map((r) => r.ok_quakes), color: '--c1', width: 3 },
          { name: 'California', values: ys.map((r) => r.ca_quakes), color: '--c2' },
        ], { band: { from: '2009', to: '2015', label: '2009–15 surge' }, refs: [{ x: '2015', label: 'Injection limits, 2015–16' }], height: 340 }),
        finding: ([ys]) => {
          const over = ys.filter((r) => r.ok_quakes > r.ca_quakes).map((r) => r.event_year)
          const peak = ys.reduce((a, r) => (r.ok_quakes > a.ok_quakes ? r : a), ys[0])
          return over.length
            ? [{ b: 'Oklahoma' }, ` had more earthquakes than California in ${over.length} year${over.length > 1 ? 's' : ''} (${over.join(', ')}), peaking at ${C.fmt(peak.ok_quakes)} in ${peak.event_year}.`]
            : [{ b: 'Oklahoma' }, ` peaked at ${C.fmt(peak.ok_quakes)} in ${peak.event_year}.`]
        },
        method: 'California\'s spikes are aftershock sequences of large natural earthquakes, such as Ridgecrest in 2019. The Oklahoma Corporation Commission issued directives to disposal wells from March 2015 and capped regional volumes from February 2016; the chart shows timing, not cause.',
      }),
      tile({
        title: 'Every state, ranked', cls: 'span-2',
        sub: 'All earthquakes since 2000. Open a state to see its counties, depths and largest earthquakes.',
        queries: () => ['run: earthquakes -> state_ranking'],
        explain: ['Earthquakes (M2.5+) per state since 2000, with each state\'s count per year.'],
        draw: ([rows], body) => {
          const labels = yearsOf(...known.years)
          C.rankTable(body, rows.map((r) => ({ id: r.state, name: r.state_name, sub: `Largest ${mag(r.max_magnitude)}`, value: r.quakes, trend: fill(labels, r.trend, 'event_year', 'quakes') })), {
            valueLabel: 'Earthquakes', trendLabel: `${labels[0]}–${labels.at(-1)}`, limit: 10, onOpen: openEntity, href: stateLink, inCompare: inTray, onCompare: toggleTray,
          })
        },
        finding: ([rows]) => [{ b: rows[0].state_name }, ` has the most, ${C.fmt(rows[0].quakes)}; `, { b: rows[1].state_name }, ` is next with ${C.fmt(rows[1].quakes)}.`],
        method: 'Each trend runs to the latest, partial year, so its last point is low. Offshore earthquakes are left out.',
      }),
      tile({
        title: 'Where to look next',
        queries: () => ['run: earthquakes -> state_ranking'],
        explain: ['Earthquakes per state since 2000, used to pick the states beyond Oklahoma and California.'],
        draw: ([rows], body) => body.append(h('ul', { class: 'leads' }, ...rows.filter((r) => r.state !== 'OK' && r.state !== 'CA').slice(0, 3).map((r) =>
          h('li', {}, h('a', { href: S.buildHash({ view: 'explore', id: null, compare: [] }, { ...S.DEFAULT_SCOPE, state: r.state }) }, `${r.state_name}: ${C.fmt(r.quakes)} earthquakes →`))))),
        method: 'The three states with the most earthquakes after Oklahoma and California. Each opens Explore narrowed to that state.',
      }),
      tile({
        title: 'The largest earthquakes',
        queries: () => ['run: earthquakes -> largest'],
        explain: ['The largest earthquakes since 2000, biggest first.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.slice(0, 8).map((r) => ({ label: `${r.place.replace(/^.*? of /, '').replace(/ Earthquake Sequence$/, '')}, ${day(r.event_time)}`, value: r.magnitude })), { horizontal: true, direct: true, format: (v) => `M${one(v)}` }),
        finding: ([rows]) => ['The largest was ', { b: `M${one(rows[0].magnitude)}` }, `, ${rows[0].place}, on ${day(rows[0].event_time)}.`],
        method: 'Magnitude as the catalog reports it; the largest events are moment magnitudes (Mw).',
      })))
}

function explore() {
  const [lo, hi] = known.years
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore', 'Narrow to a state, a span of years or a magnitude. Click a bar, a year or a row to filter every card; click it again to clear it.'),
    section('When', 'Swarms and aftershock sequences show up as bursts in time.',
      tile({
        title: 'Earthquakes a year', cls: 'span-2', sub: 'Drag across the years to narrow the span.',
        queries: () => [S.tileQuery('trend', scope, known)],
        explain: ['Earthquakes per year under the scope, every year from 2000; the span of years is not applied, so the chart shows it shaded.'],
        draw: ([rows], body) => {
          const labels = yearsOf(lo, hi)
          C.lines(chartBox(body), labels, [{ name: scope.state ? S.NAMES[scope.state] : 'Contiguous US', values: fill(labels, rows, 'event_year', 'quakes'), color: scope.state ? STATE_COLOR[scope.state] || '--c5' : '--c-bar' }], {
            band: band(), onBrush: (a, b) => setScope({ from: +a, to: +b }), height: 280,
          })
        },
        finding: ([rows]) => {
          const full = rows.filter((r) => !r.is_partial_year)
          const peak = full.reduce((a, r) => (r.quakes > a.quakes ? r : a), full[0])
          return peak ? ['The busiest whole year was ', { b: String(peak.event_year) }, `, with ${C.fmt(peak.quakes)} earthquakes.`] : ''
        },
        method: `${hi} is not over, so its count is partial.`,
      }),
      tile({
        title: 'Every month since 2000', cls: 'span-2', sub: 'Each row is a year, each square a month, darker for more earthquakes. Click a year to narrow to it.',
        queries: () => [S.tileQuery('calendar', scope, known)],
        explain: ['Earthquakes per year and month of year under the scope.'],
        draw: ([rows], body) => C.heatmap(chartBox(body), yearsOf(lo, hi), MONTHS, rows.map((r) => ({ row: String(r.event_year), col: MONTHS[r.month_of_year - 1], value: r.quakes })), {
          onRow: (y) => (scope.from === +y && scope.to === +y ? setScope({ from: null, to: null }) : setScope({ from: +y, to: +y })),
        }),
        finding: ([rows]) => {
          const top = rows.reduce((a, r) => (r.quakes > a.quakes ? r : a), rows[0])
          return ['The busiest month was ', { b: `${MONTHS[top.month_of_year - 1]} ${top.event_year}` }, `, with ${C.fmt(top.quakes)}.`]
        },
        method: 'Colour scales with the square root of the count, so one huge aftershock month does not wash out the rest. Months are UTC.',
      })),
    section('Where', 'Induced earthquakes cluster in the oil fields of the middle of the country; natural ones follow the faults of the West.',
      tile({
        title: 'Map of epicentres', cls: 'span-2', sub: 'Earthquakes per hexagon under the scope; grey shows every earthquake, for the outline.',
        queries: () => [S.tileQuery('location', scope, known), 'run: earthquakes -> by_location'],
        explain: ['Earthquakes per 0.1° cell under the scope.', 'Earthquakes per 0.1° cell, with no filter, drawn grey underneath.'],
        draw: ([rows, base], body) => C.hexMap(chartBox(body), rows.map((r) => ({ lat: r.lat, lon: r.lon, value: r.quakes })), {
          base: base.map((r) => ({ lat: r.lat, lon: r.lon, value: r.quakes })), legendTitle: 'Earthquakes', height: 420,
        }),
        method: 'Locations are binned to 0.1° cells (about 11 km) before drawing. The map does not filter; pick a state in the table below.',
      }),
      tile({
        title: 'States', sub: 'Click a row to filter; open a state from its name.',
        queries: () => [S.tileQuery('states', scope, known)],
        explain: ['Earthquakes per state under the scope (the state filter is not applied, so the selection stays highlighted), with each state\'s count per year.'],
        draw: ([rows], body) => {
          const labels = yearsOf(...yearSpan())
          C.rankTable(body, rows.map((r) => ({ id: r.state, name: r.state_name, value: r.quakes, trend: fill(labels, r.trend, 'event_year', 'quakes') })), {
            valueLabel: 'Earthquakes', limit: 8, selected: scope.state, onOpen: (id) => toggleScope('state', id), href: stateLink,
          })
        },
        finding: ([rows]) => [{ b: rows[0].state_name }, ` leads with ${C.fmt(rows[0].quakes)} earthquakes in scope.`],
      }),
      tile({
        title: 'Counties', sub: 'The 15 counties with the most earthquakes in scope.',
        queries: () => [S.tileQuery('counties', scope, known, 'order_by: quakes desc; limit: 15')],
        explain: ['Earthquakes per county under the scope, top 15.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.county, value: r.quakes })), { horizontal: true, direct: true }),
        finding: ([rows]) => [{ b: rows[0].county }, ` has the most, ${C.fmt(rows[0].quakes)}.`],
        method: 'Counties on the Census Bureau\'s 2023 boundaries; earthquakes off any county are left out.',
      })),
    section('Oklahoma’s neighbours', 'Kansas and Texas sit on the same oil plays, and both had surges of their own.',
      tile({
        title: 'Four states a year', cls: 'span-2', sub: 'Oklahoma, California, Texas and Kansas, whole years.',
        queries: () => [S.tileQuery('four', scope, known, 'where: is_partial_year = false')],
        explain: ['Earthquakes per whole year in Oklahoma, California, Texas and Kansas, under the scope; the state and years filters are not applied.'],
        draw: ([rows], body) => C.lines(chartBox(body), rows.map((r) => String(r.event_year)), [
          { name: 'Oklahoma', values: rows.map((r) => r.ok_quakes), color: '--c1', width: 3 },
          { name: 'California', values: rows.map((r) => r.ca_quakes), color: '--c2' },
          { name: 'Texas', values: rows.map((r) => r.tx_quakes), color: '--c3' },
          { name: 'Kansas', values: rows.map((r) => r.ks_quakes), color: '--c4' },
        ], { height: 320 }),
        finding: ([rows]) => {
          const tx = rows.reduce((a, r) => (r.tx_quakes > a.tx_quakes ? r : a), rows[0])
          const ks = rows.reduce((a, r) => (r.ks_quakes > a.ks_quakes ? r : a), rows[0])
          return [{ b: 'Texas' }, ` peaked at ${C.fmt(tx.tx_quakes)} in ${tx.event_year}; `, { b: 'Kansas' }, ` at ${C.fmt(ks.ks_quakes)} in ${ks.event_year}.`]
        },
        method: 'Ignores the state and year filters, so the four lines always show; the magnitude filter applies.',
      })),
    section('How big, how deep', 'Most earthquakes are small; induced ones are also shallow.',
      tile({
        title: 'By magnitude', sub: 'Click a class to filter.',
        queries: () => [S.tileQuery('magnitude', scope, known)],
        explain: ['Earthquakes per magnitude class under the scope (the magnitude filter is not applied).'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.magnitude_class, value: r.quakes })), { horizontal: true, direct: true, selected: scope.magnitude, onPick: (m) => toggleScope('magnitude', m) }),
        finding: ([rows]) => { const t = rows.reduce((a, r) => a + r.quakes, 0); return [{ b: C.pct(rows[0].quakes / t, 0) }, ` are ${rows[0].magnitude_class}.`] },
        method: 'Each step up in magnitude is about ten times fewer earthquakes, the Gutenberg–Richter law.',
      }),
      tile({
        title: 'Depth, by state', sub: 'Share of each state\'s earthquakes by depth, for the eight states with the most. Click a state to filter.',
        queries: () => [S.tileQuery('depth', scope, known), S.tileQuery('states', scope, known, 'order_by: quakes desc; limit: 8')],
        explain: ['Earthquakes per state and depth class under the scope (the state filter is not applied).', 'The eight states with the most earthquakes under the scope.'],
        draw: ([rows, top], body) => {
          const keep = new Set(top.map((r) => r.state))
          return C.stackedShare(chartBox(body), rows.filter((r) => keep.has(r.state)).map((r) => ({ x: r.state, part: r.depth_class, value: r.quakes })), DEPTHS, { height: 280, onPick: (x) => toggleScope('state', x) })
        },
        method: 'Depths that could not be resolved are often fixed at 5 km, so the 5–9.9 km band holds many of those, especially in Oklahoma.',
      })))
}

// The states picked to compare, kept while the reader moves between pages.
let tray = []
const inTray = (id) => tray.includes(id)
function toggleTray(id) {
  tray = inTray(id) ? tray.filter((x) => x !== id) : [...tray, id].slice(-S.COMPARE_MAX)
  if (route.view === 'compare') go({ view: 'compare', id: null, compare: tray }, scope, { push: false })
  else render()
}
const mag = (v) => `M${(Math.round(v * 10) / 10).toFixed(1)}`

function recordTable(rows, { state = true } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'records-table' },
    h('thead', {}, h('tr', {}, h('th', { text: 'When (UTC)' }), h('th', { class: 'num', text: 'Magnitude' }), h('th', { class: 'num', text: 'Depth, km' }), h('th', { text: 'Place' }), state && h('th', { text: 'State' }), h('th', { text: 'Event' }))),
    h('tbody', {}, ...rows.map((r) => h('tr', {},
      h('td', { text: `${day(r.event_time)} ${r.event_time.slice(11, 16)}` }),
      h('td', { class: 'num', text: `${(Math.round(r.magnitude * 100) / 100).toFixed(1)} ${r.mag_type || ''}` }),
      h('td', { class: 'num', text: r.depth_km === null ? '–' : one(r.depth_km) }),
      h('td', { text: r.county ? `${r.place} · ${r.county}` : r.place }),
      state && h('td', {}, r.state ? h('a', { href: stateLink(r.state), text: S.NAMES[r.state] || r.state }) : '–'),
      h('td', {}, h('a', { href: `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(r.event_id)}`, target: '_blank', rel: 'noopener', text: r.event_id })))))))
}

function entity() {
  const id = route.id
  const name = S.ENTITY.label(id)
  const add = h('button', { class: 'btn', 'aria-pressed': String(inTray(id)), text: inTray(id) ? 'In compare ✓' : 'Add to compare', onclick: () => toggleTray(id) })
  const open = tray.length > 1 && inTray(id) && h('a', { class: 'btn', href: linkTo('compare', null, tray), text: `Compare ${tray.length} states →` })
  return h('div', { class: 'view wrap' },
    ...viewHead(name, null, [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${name}`]),
    h('p', { class: 'actions' }, add, ' ', open),
    h('div', { class: 'grid-2' },
      tile({
        title: `${name} against the contiguous US`, cls: 'span-2',
        queries: () => [S.entityQuery('kpis', id, scope, known), S.viewQuery('kpis', scope, known, S.ENTITY_KEYS)],
        explain: [`${name}'s headline numbers under the scope.`, 'The same numbers for the whole contiguous US under the scope.'],
        draw: ([[k], [all]], body) => body.append(h('div', { class: 'kpis' },
          kpi('Earthquakes', C.fmt(k.quakes), [{ b: C.pct(k.quakes / all.quakes, 1) }, ' of the US total'], true),
          kpi('Magnitude 4 and up', C.fmt(k.quakes_m4), [{ b: C.pct(all.quakes_m4 ? k.quakes_m4 / all.quakes_m4 : 0, 1) }, ' of the US total']),
          kpi('Largest', k.max_magnitude === null ? '–' : mag(k.max_magnitude), `US largest ${mag(all.max_magnitude)}`),
          kpi('Shallower than 5 km', C.pct(k.shallow_share, 0), `US ${C.pct(all.shallow_share, 0)}`))),
        method: 'Earthquakes of magnitude 2.5 and up with the epicentre inside the state.',
      }),
      tile({
        title: 'Earthquakes a year', cls: 'span-2',
        queries: () => [S.entityQuery('by_year', id, scope, known)],
        explain: [`${name}'s earthquakes per year under the scope.`],
        draw: ([rows], body) => { const labels = yearsOf(...yearSpan()); return C.lines(chartBox(body), labels, [{ name, values: fill(labels, rows, 'event_year', 'quakes'), color: STATE_COLOR[id] || '--accent', width: 3 }], { height: 300 }) },
        finding: ([rows]) => {
          const full = rows.filter((r) => !r.is_partial_year)
          const peak = full.reduce((a, r) => (r.quakes > a.quakes ? r : a), full[0])
          return peak ? [{ b: name }, `'s busiest whole year was ${peak.event_year}, with ${C.fmt(peak.quakes)}.`] : ''
        },
        method: `${known.years[1]} is not over, so its count is partial.`,
      }),
      tile({
        title: 'Where in the state', cls: 'span-2', sub: 'Earthquakes per hexagon; grey shows every earthquake in the US.',
        queries: () => [S.entityQuery('by_location', id, scope, known), 'run: earthquakes -> by_location'],
        explain: [`${name}'s earthquakes per 0.1° cell under the scope.`, 'Every earthquake per 0.1° cell, drawn grey underneath.'],
        draw: ([rows, base], body) => C.hexMap(chartBox(body), rows.map((r) => ({ lat: r.lat, lon: r.lon, value: r.quakes })), { base: base.map((r) => ({ lat: r.lat, lon: r.lon, value: r.quakes })), legendTitle: 'Earthquakes', height: 400 }),
        method: 'Locations are binned to 0.1° cells (about 11 km) before drawing.',
      }),
      tile({
        title: 'Counties', sub: 'The counties with the most earthquakes.',
        queries: () => [S.entityQuery('by_county', id, scope, known, 'order_by: quakes desc; limit: 12')],
        explain: [`${name}'s earthquakes per county under the scope, top 12.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.county.replace(/, [A-Z]{2}$/, ''), value: r.quakes })), { horizontal: true, direct: true }),
        finding: ([rows]) => [{ b: rows[0].county }, ` has the most, ${C.fmt(rows[0].quakes)}.`],
        method: 'Earthquakes off any county, such as in a lake, are left out.',
      }),
      tile({
        title: 'How deep', sub: 'Earthquakes by depth of the focus.',
        queries: () => [S.entityQuery('by_depth', id, scope, known)],
        explain: [`${name}'s earthquakes per depth class under the scope.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.depth_class, value: r.quakes })), { horizontal: true, direct: true }),
        finding: ([rows]) => { const t = rows.reduce((a, r) => a + r.quakes, 0); const top = rows.reduce((a, r) => (r.quakes > a.quakes ? r : a), rows[0]); return [{ b: C.pct(top.quakes / t, 0) }, ` were ${top.depth_class} deep.`] },
        method: 'Depths that could not be resolved are often fixed at 5 km by the network.',
      }),
      tile({
        title: 'Largest earthquakes', cls: 'span-2',
        queries: () => [S.entityQuery('largest', id, scope, known, 'order_by: magnitude desc; limit: 10')],
        explain: [`${name}'s ten largest earthquakes under the scope.`],
        draw: ([rows], body) => body.append(recordTable(rows, { state: false })),
        method: 'Each event links to its page on the USGS site.',
      }),
      tile({
        title: 'Latest earthquakes', cls: 'span-2',
        queries: () => [S.entityQuery('records', id, scope, known, 'order_by: event_time desc; limit: 10')],
        explain: [`${name}'s ten most recent earthquakes under the scope.`],
        draw: ([rows], body) => body.append(recordTable(rows, { state: false }), h('p', { class: 'pager' }, h('a', { class: 'btn', href: S.buildHash({ view: 'records', id: null, compare: [] }, { ...scope, state: id }), text: 'All records →' }))),
        method: 'Newest first, in UTC.',
      })))
}

function records() {
  let shown = 50
  const body = h('div', {})
  const status = h('p', { class: 'finding' })
  const more = h('button', { class: 'btn', text: 'Show 50 more' })
  const load = () => {
    more.disabled = true
    Promise.all([query(S.viewQuery('records', scope, known, [], `order_by: event_time desc; limit: ${shown}`)), query(S.viewQuery('kpis', scope, known))]).then(([rows, [k]]) => {
      body.replaceChildren(recordTable(rows))
      status.replaceChildren(...prose(['Showing ', { b: C.fmt(rows.length) }, ' of ', { b: C.fmt(k.quakes) }, ' earthquakes in scope, newest first.']))
      more.hidden = rows.length >= k.quakes
      more.disabled = false
    }, (err) => body.replaceChildren(h('div', { class: 'state state--error', text: `Could not load: ${err.message}` })))
  }
  more.onclick = () => { shown += 50; load() }
  load()
  return h('div', { class: 'view wrap' }, ...viewHead('Records', 'Every earthquake in scope, newest first. Each links to its state and to its page in the USGS catalog.'),
    status, body, h('p', { class: 'pager' }, more),
    h('p', { class: 'method', text: 'Times are UTC. Magnitude as the catalog reports it, with its type (ml local, md duration, mw moment, mb body wave). Depth in kilometres below sea level.' }))
}

function compare() {
  tray = route.compare.length ? [...route.compare] : tray
  const ids = tray
  const picker = h('select', { 'aria-label': 'Add a state' }, h('option', { value: '', text: ids.length >= S.COMPARE_MAX ? 'Four states at most' : 'Add a state…' }),
    ...known.state.filter((s) => !ids.includes(s)).sort((a, b) => S.NAMES[a].localeCompare(S.NAMES[b])).map((s) => h('option', { value: s, text: S.NAMES[s] })))
  picker.disabled = ids.length >= S.COMPARE_MAX
  picker.onchange = () => picker.value && toggleTray(picker.value)
  const chips = ids.map((s) => h('span', { class: 'chip' }, S.NAMES[s], h('button', { 'aria-label': `Remove ${S.NAMES[s]}`, text: '×', onclick: () => toggleTray(s) })))
  const head = viewHead('Compare', 'Up to four states side by side, under the same scope.')
  if (!ids.length) {
    return h('div', { class: 'view wrap' }, ...head, h('p', { class: 'actions' }, picker),
      h('p', {}, ...prose(['Pick states above, or try ', h('a', { href: S.buildHash({ view: 'compare', id: null, compare: ['OK', 'KS', 'TX'] }, scope), text: 'Oklahoma, Kansas and Texas' }), ', the induced-earthquake states, or ', h('a', { href: S.buildHash({ view: 'compare', id: null, compare: ['OK', 'CA'] }, scope), text: 'Oklahoma and California' }), '.'])))
  }
  const colors = ids.map((s, i) => STATE_COLOR[s] || ['--c5', '--c3', '--c4', '--c2'][i])
  return h('div', { class: 'view wrap' }, ...head, h('p', { class: 'actions' }, ...chips, ' ', picker),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Earthquakes a year', cls: 'span-2',
        queries: () => [S.compareQuery('by_state_year', ids, scope, known)],
        explain: ['Earthquakes per state and year, for the states compared, under the scope.'],
        draw: ([rows], body) => { const labels = yearsOf(...yearSpan()); return C.lines(chartBox(body), labels, ids.map((s, i) => ({ name: S.NAMES[s], values: fill(labels, rows.filter((r) => r.state === s), 'event_year', 'quakes'), color: colors[i], width: i ? 2 : 3 }))) },
        method: `${known.years[1]} is not over, so its count is partial.`,
      }),
      tile({
        title: 'Side by side', cls: 'span-2',
        queries: () => [S.compareQuery('state_ranking', ids, scope, known)],
        explain: ['Earthquakes, M4+ and the largest magnitude per state compared, under the scope.'],
        draw: ([rows], body) => body.append(h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'State' }), h('th', { class: 'num', text: 'Earthquakes' }), h('th', { class: 'num', text: 'M4 and up' }), h('th', { class: 'num', text: 'Largest' }))),
          h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, h('a', { href: stateLink(r.state), text: r.state_name })), h('td', { class: 'num', text: C.fmt(r.quakes) }), h('td', { class: 'num', text: C.fmt(r.quakes_m4) }), h('td', { class: 'num', text: mag(r.max_magnitude) }))))))),
        finding: ([rows]) => rows.length > 1 ? [{ b: rows[0].state_name }, ` had ${C.fmt(rows[0].quakes)}, ${(rows[0].quakes / Math.max(1, rows.at(-1).quakes)).toFixed(1)} times `, { b: rows.at(-1).state_name }, '’s.'] : '',
      }),
      tile({
        title: 'How deep', cls: 'span-2', sub: 'Share of each state’s earthquakes by depth of the focus.',
        queries: () => [S.compareQuery('depth_by_state', ids, scope, known)],
        explain: ['Earthquakes per state and depth class, for the states compared.'],
        draw: ([rows], body) => C.stackedShare(chartBox(body), rows.map((r) => ({ x: S.NAMES[r.state], part: r.depth_class, value: r.quakes })), DEPTHS, { height: 260 }),
        method: 'Depths that could not be resolved are often fixed at 5 km.',
      })))
}

function about() {
  const latest = h('span', { text: day(known.latest) })
  const total = h('b', {})
  query('run: earthquakes -> kpis').then(([k]) => total.replaceChildren(C.fmt(k.quakes)))
  const p = (...kids) => h('p', {}, ...kids)
  const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener', text })
  return h('div', { class: 'view wrap prose-view' }, ...viewHead('About the data', 'Where the numbers come from, what was changed on the way, and what they cannot tell you.'),
    h('h2', { text: 'Sources' }),
    h('ul', {},
      h('li', {}, a('https://earthquake.usgs.gov/fdsnws/event/1/', 'ANSS Comprehensive Earthquake Catalog (ComCat)'), ', U.S. Geological Survey, Earthquake Hazards Program. Public domain (U.S. Government work). Every event of magnitude 2.5 and up from January 1, 2000, inside a box around the lower 48 states.'),
      h('li', {}, a('https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html', 'Cartographic boundary files'), ', U.S. Census Bureau, 2023 states and counties. Public domain. Used to place each epicentre in a state and county.')),
    p('The app holds ', total, ' earthquakes; the latest is from ', latest, ' (UTC).'),
    h('h2', { text: 'What was reshaped' }),
    h('ul', {},
      h('li', { text: 'Events are fetched a year at a time from the catalog\'s public query service, then deduplicated on the event id.' }),
      h('li', { text: 'Each epicentre is placed in a state and county by a point-in-polygon join on the Census boundaries. Epicentres offshore or outside the 48 states and DC are left out.' }),
      h('li', { text: 'Magnitude and depth are put in classes (2.5–2.9, 3.0–3.9 and so on; 0–4.9 km, 5–9.9 km and so on) so they can be counted.' }),
      h('li', { text: 'Only earthquakes are kept: quarry blasts, explosions and other event types are dropped.' })),
    h('h2', { text: 'Caveats' }),
    h('ul', {},
      h('li', { text: 'Seismic networks grew over time, notably in Oklahoma after 2010, so some small earthquakes in the early years may be missing; at M2.5 and up the effect is small, but it is not zero.' }),
      h('li', { text: 'Aftershocks are counted as earthquakes. California\'s spikes in 2010 and 2019 are mostly aftershock sequences of single large events.' }),
      h('li', { text: 'Magnitudes of different types (local, duration, moment) are not strictly comparable, and recent events may still be revised by the network.' }),
      h('li', { text: 'The app shows when earthquakes happened next to when disposal limits began. It shows timing, not cause; the link between wastewater injection and Oklahoma\'s earthquakes comes from published research, not from this data.' })),
    h('h2', { text: 'Rebuild it' }),
    p('The scripts in the package\'s ', h('code', { text: 'pipeline/' }), ' folder fetch the catalog and the boundaries, join and shape them, and load the managed table ', h('code', { text: 'community.us_earthquakes__events' }), '. The README lists the steps.'),
    h('p', { class: 'method', text: 'An independent app, not produced by or affiliated with the USGS.' }))
}

function footer() {
  return h('div', {}, h('h2', { text: 'Earthquakes in the contiguous US' }),
    h('p', { text: 'Source: U.S. Geological Survey, ANSS Comprehensive Earthquake Catalog (ComCat), public domain; state and county boundaries from the U.S. Census Bureau, public domain. An independent app, not produced by the USGS.' }))
}

boot()
