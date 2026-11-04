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
  const controls = []
  for (const [key, spec] of Object.entries(S.SCOPE)) {
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
  const chips = h('div', { class: 'chips' }, ...S.scopeChips(scope).map((c) =>
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
    const [span, states, regions, causes, sizes, week] = await Promise.all([
      query('run: fires -> { aggregate: lo is min(fire_year), hi is max(fire_year), latest is max(discovery_date) }'),
      query('run: fires -> { group_by: state_code, state_name; order_by: state_name }'),
      query('run: fires -> { group_by: region; where: region is not null; order_by: region }'),
      query('run: fires -> { group_by: cause_name; order_by: cause_name }'),
      query('run: fires -> { group_by: size_class, size_class_order; order_by: size_class_order }'),
      query("run: fires -> { where: season = 'This season'; aggregate: latest_week is max(week_of_year) }"),
    ])
    known.years = [span[0].lo, span[0].hi]
    known.latest = String(span[0].latest).slice(0, 10)
    known.latestWeek = week[0].latest_week
    const values = (rows, f) => rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined)
    for (const r of states) S.STATE_NAMES[r.state_code] = r.state_name
    known.byName = Object.fromEntries(states.map((r) => [r.state_name, r.state_code]))
    known.state = values(states, 'state_code')
    known.region = values(regions, 'region')
    known.cause = values(causes, 'cause_name')
    known.size = values(sizes, 'size_class')
    known.entity = known.state.slice().sort((a, b) => S.ENTITY.label(a).localeCompare(S.ENTITY.label(b)))
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Data through ${longDate(known.latest)}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Views ----

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDate = (d) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${MONTHS[+m - 1]} ${+dd}, ${y}` }
const shortDate = (d) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${MONTHS[+m - 1].slice(0, 3)} ${+dd}, ${y}` }
const acres = (v) => `${C.fmt(Math.round(v))} acres`
const n0 = (v) => C.fmt(Math.round(v))
const pct0 = (v) => C.pct(v, 0)
const CAUSE_COLOR = { Human: '--c1', Natural: '--c2', Undetermined: '--c3', 'Not reported': '--nodata' }
const OWNER_COLOR = { Federal: '--c4', Private: '--c5', Tribal: '--c6', 'State and local': '--c3', 'Not reported': '--nodata' }
const baseline = () => `${known.years[1] - 10} to ${known.years[1] - 1}`
const yearScope = (y) => (scope.from === y && scope.to === y ? { from: null, to: null } : { from: y, to: y })
const pickedYear = () => (scope.from !== null && scope.from === scope.to ? String(scope.from) : null)
let compareIds = []
const inCompare = (id) => compareIds.includes(id)
const addCompare = (id) => {
  compareIds = inCompare(id) ? compareIds.filter((x) => x !== id) : [...compareIds, id].slice(-S.COMPARE_MAX)
  go({ view: 'compare', id: null, compare: compareIds })
}

function kpi(label, value, sub, { accent = false, trend = null, color = '--accent' } = {}) {
  const svg = trend ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : null
  const el = h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), svg, sub && h('div', { class: 'kpi__sub' }, ...prose(sub)))
  if (svg) requestAnimationFrame(() => C.sparkline(svg, trend, color))
  return el
}

function leadCard(kicker, parts, href) {
  return h('a', { class: 'card lead-card', href }, h('p', { class: 'caps', text: kicker }), h('p', { class: 'lead-card__text' }, ...prose(parts), ' →'))
}

const ARTICLES = [
  { title: "NPR's wildfire correspondent on one of the Western U.S.'s worst wildfire seasons", outlet: 'NPR, via WAMC', date: 'September 6, 2026', url: 'https://www.wamc.org/2026-09-06/nprs-wildfire-correspondent-on-one-of-the-western-u-s-s-worst-wildfire-seasons' },
  { title: 'National Fire News', outlet: 'National Interagency Fire Center', date: 'updated weekly; read October 30, 2026', url: 'https://www.nifc.gov/fire-information/nfn' },
]

function seasonRaceTile(cls = 'span-2') {
  return tile({
    title: 'The season race: acres burned so far, week by week', cls,
    sub: `Cumulative acres from January 1. This season against the ${baseline()} average, the biggest and the smallest year to the same week. Click a line to open that year in Explore.`,
    queries: () => ['run: fires -> season_race', 'run: fires -> cumulative_by_week'],
    explain: ['Each week of the year: acres this season and the ten-year average, each summed from January 1.', 'Each year and week: acres burned, summed from January 1 of that year.'],
    draw: ([race, cum], body) => {
      const wk = known.latestWeek
      const weeks = race.map((r) => r.week_of_year)
      const atWeek = cum.filter((r) => r.week_of_year === wk && r.fire_year !== known.years[1])
      const top = atWeek.reduce((a, b) => (b.cumulative_acres > a.cumulative_acres ? b : a))
      const low = atWeek.reduce((a, b) => (b.cumulative_acres < a.cumulative_acres ? b : a))
      const yearLine = (y) => weeks.map((w) => cum.find((r) => r.fire_year === y && r.week_of_year === w)?.cumulative_acres ?? null)
      C.lines(chartBox(body), weeks.map((w) => `Week ${w}`), [
        { name: String(top.fire_year), values: yearLine(top.fire_year), color: '--c3', width: 1.5 },
        { name: String(low.fire_year), values: yearLine(low.fire_year), color: '--c3', width: 1.5, dashed: true },
        { name: "Ten-year avg.", values: race.map((r) => r.cumulative_ten_year_avg), color: '--c-bar', dashed: true },
        { name: String(known.years[1]), values: race.map((r) => (r.week_of_year <= wk ? r.cumulative_this_season : null)), color: '--accent', width: 3 },
      ], { format: (v) => `${C.fmt(Math.round(v))} acres`, label: 'Cumulative acres burned by week of the year', onPick: null, maxTicks: 8 })
    },
    finding: ([race, cum]) => {
      const r = race.find((x) => x.week_of_year === known.latestWeek)
      const atWeek = cum.filter((x) => x.week_of_year === known.latestWeek && x.fire_year !== known.years[1])
      const more = atWeek.filter((x) => x.cumulative_acres > r.cumulative_this_season).map((x) => x.fire_year).sort()
      return [`By week ${known.latestWeek}, `, { b: acres(r.cumulative_this_season) }, ` had burned in ${known.years[1]}, against `, { b: acres(r.cumulative_ten_year_avg) }, ` in an average year to the same week. `,
        ...(more.length ? [{ b: more.join(', ') }, ` had burned more by that week.`] : [`No year since ${known.years[0]} had burned more by that week.`])]
    },
    method: 'Weeks are 7-day blocks from January 1. The average line sums whole weeks of the ten years before this one, so at the latest week it can differ slightly from the date-cut average in the headline. Fires are counted in the week they were discovered, with their final or latest size.',
  })
}

function calendarTile(rowsQuery, cls = 'span-2', { onYear = (y) => go({ view: 'explore', id: null, compare: [] }, { ...scope, ...yearScope(+y) }) } = {}) {
  return tile({
    title: 'When the land burned: acres by week, every year', cls,
    sub: 'Each row is a year, each cell a week; the darker the cell, the more acres burned in fires discovered that week. Click a cell to filter by its year.',
    queries: () => [rowsQuery()],
    explain: ['Acres burned and fires, by year and week of discovery.'],
    draw: ([rows], body) => {
      const years = [...new Set(rows.map((r) => String(r.fire_year)))].sort().reverse()
      const weeks = Array.from({ length: 53 }, (_, i) => String(i + 1))
      C.heatmap(chartBox(body), years, weeks, rows.map((r) => ({ row: String(r.fire_year), col: String(r.week_of_year), value: r.acres_burned })), {
        format: (v) => `${C.fmt(Math.round(v))} acres`, selected: pickedYear() ? { row: pickedYear() } : null, onPick: (row) => onYear(row), label: 'Acres by week and year',
      })
    },
    finding: ([rows]) => {
      const top = rows.reduce((a, b) => (b.acres_burned > a.acres_burned ? b : a))
      return ['The heaviest single week was week ', { b: `${top.week_of_year} of ${top.fire_year}` }, `: ${acres(top.acres_burned)} in fires discovered that week.`]
    },
    method: 'A large fire counts all its acres in the week it was discovered, though it may burn for months. Colour follows the square root of acres, so one huge week does not wash out the rest.',
  })
}

function overview() {
  const qK = `run: ${S.HEADLINE} -> kpis`
  const qY = `run: ${S.HEADLINE} -> by_year_to_date`
  const answer = h('p', { class: 'answer' })
  query(qK).then(([k]) => answer.replaceChildren(...prose([
    `By ${longDate(k.latest_discovery)}, US wildfires had burned `, { b: acres(k.acres_this_season) }, ` this year, `, { b: pct0(k.acres_vs_ten_year_avg) },
    ` of the ${baseline()} average for the same date. There were `, { b: n0(k.fires_this_season) }, ' fires, ', { b: pct0(k.fires_vs_ten_year_avg) }, ' of the average.',
  ])))
  const [kicker, title, lede] = viewHead(
    `How did ${known.years[1]}'s fire season compare with other years, and where, when and why did the fires burn?`,
    `Every wildfire that US agencies reported to NIFC's incident system since 2015, ${known.years[1]} included: when each was found, where it started, what started it and how big it grew. Start with the season against the decade before it, then open a state, a year or a cause.`
  ).filter(Boolean)
  const leads = h('div', { class: 'grid-3 leads' })
  Promise.all([
    query("run: fires -> largest_fires + { where: season = 'This season'; limit: 1; order_by: fire_acres desc }"),
    query(qY),
    query('run: fires -> by_state_season'),
  ]).then(([[big], yrs, st]) => {
    const now = yrs.find((r) => r.fire_year === known.years[1])
    leads.replaceChildren(
      leadCard('Largest fire this year', [{ b: big.fire_name }, ` in ${big.county_label}: ${acres(big.fire_acres)}, found ${shortDate(big.discovery_date)}`], linkTo('state', big.state_code)),
      leadCard('Hardest-hit state', [{ b: st[0].state_name }, `: ${acres(st[0].acres_this_season)} this year`], linkTo('state', st[0].state_code)),
      leadCard('Started by people', [{ b: pct0(now.human_fire_share) }, ` of this year's fires with a known cause; see causes by year`], S.buildHash({ view: 'explore' }, { ...S.DEFAULT_SCOPE, cause: 'Human' })),
    )
  }).catch((e) => console.error(e))
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    h('div', { class: 'grid-2' },
      tile({
        title: `${known.years[1]} so far against the ten-year average`, cls: 'span-2 headline',
        queries: () => [qK, qY],
        explain: [`This season's acres and fires, and the ${baseline()} average of each to the same month and day.`, 'Each year to the same month and day: acres, fires, large fires and the share started by people.'],
        draw: ([[k], yrs], body) => {
          body.append(h('div', { class: 'kpis' },
            kpi('Acres burned this year', n0(k.acres_this_season), ['Average to this date: ', { b: n0(k.acres_ten_year_avg) }], { accent: true, trend: yrs.map((r) => r.acres_burned) }),
            kpi('Of the ten-year average', pct0(k.acres_vs_ten_year_avg), `Acres, ${baseline()}, to the same date`),
            kpi('Wildfires this year', n0(k.fires_this_season), ['Average to this date: ', { b: n0(k.fires_ten_year_avg) }], { trend: yrs.map((r) => r.fire_count), color: '--c-bar' }),
            kpi('Fires against the average', pct0(k.fires_vs_ten_year_avg), `Fires, ${baseline()}, to the same date`)))
        },
        finding: ([[k], yrs]) => {
          const more = yrs.filter((r) => r.fire_year !== known.years[1] && r.acres_burned > k.acres_this_season).map((r) => r.fire_year)
          return more.length ? [`To ${shortDate(k.latest_discovery).replace(/, \d+$/, '')}, ${more.length === 1 ? 'only' : ''} `, { b: more.join(', ') }, ` burned more acres than ${known.years[1]} in this data.`] : [`No year since ${known.years[0]} had burned more by this date.`]
        },
        method: `Sparklines are each year from ${known.years[0]} to the same month and day. These are WFIGS incident records; NIFC's National Fire News reports nearly 9.4 million acres and 146% of average from its own situation reports, which count differently (see About the data).`,
      }),
      seasonRaceTile(),
      tile({
        title: `Where it burned in ${known.years[1]}`, cls: '',
        sub: 'Acres burned this year by the state where each fire started. Click a state to open its page.',
        queries: () => ['run: fires -> by_state_season'],
        explain: ['Each state: acres and fires this year, the change against its own ten-year average to the same date, and each year to that date.'],
        draw: ([rows], body) => C.loadTopo('./vendor/maps/states-albers-10m.json').then((topo) =>
          C.choropleth(chartBox(body), topo, new Map(rows.filter((r) => r.acres_this_season > 0).map((r) => [r.state_name, r.acres_this_season])), {
            object: 'states', legendTitle: 'Acres this year', onPick: (name) => known.byName[name] && openEntity(known.byName[name]), linkOf: (name) => known.byName[name],
            format: (v) => `${C.fmt(Math.round(v))} acres`,
          })),
        finding: ([rows]) => [{ b: rows[0].state_name }, ` burned the most, ${acres(rows[0].acres_this_season)}, then `, { b: rows[1].state_name }, ' and ', { b: rows[2].state_name }, '.'],
        method: 'Legend classes are quintiles of the states shown. A fire counts in the state of its point of origin, even when it spread across a line. States with no acres this year are grey.',
      }),
      tile({
        title: 'States ranked by acres this year', cls: '',
        sub: 'With each state’s acres to this date every year since 2015, and the change against its own ten-year average. Click a state for its page.',
        queries: () => ['run: fires -> by_state_season'],
        explain: ['Each state: acres this year, the change against its ten-year average to the same date, and each year to that date.'],
        draw: ([rows], body) => C.rankTable(body, rows.filter((r) => r.acres_this_season > 0).map((r) => ({ id: r.state_code, name: r.state_name, sub: `${n0(r.fires_this_season)} fires`, value: r.acres_this_season, trend: r.trend.map((t) => t.acres_burned), change: r.acres_change_vs_ten_year_avg })), {
          valueLabel: 'Acres this year', format: (v) => C.fmt(Math.round(v)), trendLabel: `Since ${known.years[0]}`, changeLabel: 'Against its average', changeFormat: (v) => C.pct(v, 0), good: 'fall',
          onOpen: openEntity, href: (id) => linkTo('state', id), inCompare, onCompare: addCompare,
        }),
        finding: ([rows]) => {
          const big = rows.filter((r) => r.acres_this_season >= 100000).sort((a, b) => b.acres_change_vs_ten_year_avg - a.acres_change_vs_ten_year_avg)[0]
          return big ? ['Of the states with 100,000 acres or more this year, ', { b: big.state_name }, ` is furthest above its own average, ${C.pct(big.acres_change_vs_ten_year_avg, 0)}.`] : ''
        },
        method: 'The change compares a state with its own ten-year average to the same date; for a state that rarely burns, one fire can make it very large. The 100,000-acre floor in the finding is this app’s choice.',
      }),
      calendarTile(() => 'run: fires -> by_week_and_year'),
    ),
    h('section', { class: 'section' }, h('div', { class: 'section__head' }, h('h2', { text: 'Go further' }), h('p', { text: 'Three ways into the data.' })), leads),
    h('section', { class: 'section articles' }, h('div', { class: 'section__head' }, h('h2', { text: 'In the news' }), h('p', { text: 'The stories this app responds to.' })),
      h('ul', { class: 'article-list' }, ...ARTICLES.map((a) => h('li', {}, h('a', { href: a.url, target: '_blank', rel: 'noopener', text: a.title }), h('span', { text: ` ${a.outlet}, ${a.date}` }))))),
  )
}

function explore() {
  const T = (id, extra = '') => S.tileQuery(id, scope, known, extra)
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore every wildfire since 2015', 'Click a bar, a state, a year or a cause to filter every card; click it again to clear it. Names drawn as links open a state’s page. The address keeps the view, so it can be shared.'),
    section('When', 'Which years and which weeks burned.',
      tile({
        title: 'Acres burned each year', cls: 'span-2',
        sub: 'Click a year to filter by it. Turn on “Same dates each year” to compare every year to the latest record’s date.',
        queries: () => [T('years')],
        explain: ['Acres, fires and large fires per year, under the scope.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: String(r.fire_year), value: r.acres_burned })), {
          format: (v) => `${C.fmt(Math.round(v))} acres`, selected: pickedYear(), onPick: (y) => setScope(yearScope(+y)), color: '--accent', label: 'Acres by year',
          tip: (r) => [`${n0(rows.find((x) => String(x.fire_year) === r.label).fire_count)} fires`],
        }),
        finding: ([rows]) => { const t = rows.reduce((a, b) => (b.acres_burned > a.acres_burned ? b : a)); return [{ b: String(t.fire_year) }, ` burned the most in scope: ${acres(t.acres_burned)}.`] },
      }),
      calendarTile(() => T('calendar'), 'span-2', { onYear: (y) => setScope(yearScope(+y)) }),
      tile({
        title: 'The shape of a season, by month',
        sub: 'Acres by month of discovery, pooled over the years in scope. Months are not a filter; click a year above instead.',
        queries: () => [T('months')],
        explain: ['Acres, fires and share started by people, by month of the year, under the scope.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: MONTHS[r.month_of_year - 1].slice(0, 3), value: r.acres_burned })), { format: (v) => `${C.fmt(Math.round(v))} acres`, color: '--c-bar', label: 'Acres by month' }),
        finding: ([rows]) => { const t = rows.reduce((a, b) => (b.acres_burned > a.acres_burned ? b : a)); return [{ b: MONTHS[t.month_of_year - 1] }, ` carries the most acres in scope, ${acres(t.acres_burned)}.`] },
        method: 'Fires count in the month they were discovered.',
      }),
      tile({
        title: 'Fires by size: few fires burn most of the land',
        sub: 'Fires and acres in each size class. Click a class to filter by it.',
        queries: () => [T('sizes')],
        explain: ['Fires and acres by size class, under the scope.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.size_class, value: r.acres_burned })), {
          horizontal: true, direct: true, format: (v) => C.fmt(Math.round(v)), selected: scope.size, onPick: (v) => toggleScope('size', v), color: '--accent', label: 'Acres by size class',
          tip: (r) => [`${n0(rows.find((x) => x.size_class === r.label).fire_count)} fires`],
        }),
        finding: ([rows]) => { const top = rows[rows.length - 1]; const small = rows[0]; return [`${n0(top.fire_count)} fires of `, { b: top.size_class.replace(' or more', '+') }, ` burned ${acres(top.acres_burned)}; the ${n0(small.fire_count)} fires under 1 acre burned ${acres(small.acres_burned)}.`] },
        method: 'Size classes are this app’s, by factors of ten. Fires under 1 acre are stored summed by day, state and cause, so they have no county, point or detail fields.',
      }),
    ),
    section('Where', 'Which states, regions and places burned.',
      tile({
        title: 'Acres by state',
        sub: 'Click a state to filter by it; open its page from the ranked list.',
        queries: () => [T('map')],
        explain: ['Acres, fires, large fires, largest fire and share started by people, by state, under the scope.'],
        draw: ([rows], body) => C.loadTopo('./vendor/maps/states-albers-10m.json').then((topo) =>
          C.choropleth(chartBox(body), topo, new Map(rows.filter((r) => r.acres_burned > 0).map((r) => [r.state_name, r.acres_burned])), {
            object: 'states', legendTitle: 'Acres', selected: scope.state ? S.STATE_NAMES[scope.state] : null, onPick: (name) => known.byName[name] && toggleScope('state', known.byName[name]),
            linkOf: (name) => known.byName[name], format: (v) => `${C.fmt(Math.round(v))} acres`,
          })),
        finding: ([rows]) => [{ b: rows[0].state_name }, ` has the most acres in scope, ${acres(rows[0].acres_burned)}.`],
        method: 'Legend classes are quintiles of the states shown. Fires count in the state where they started.',
      }),
      tile({
        title: 'States ranked',
        sub: 'Click a row to filter; the name opens the state’s page.',
        queries: () => [T('states')],
        explain: ['Acres and fires by state, under the scope.'],
        draw: ([rows], body) => C.rankTable(body, rows.filter((r) => r.acres_burned > 0).map((r) => ({ id: r.state_code, name: r.state_name, sub: `${n0(r.fire_count)} fires`, value: r.acres_burned })), {
          valueLabel: 'Acres', format: (v) => C.fmt(Math.round(v)), selected: scope.state, onOpen: (id) => toggleScope('state', id), href: (id) => linkTo('state', id), inCompare, onCompare: addCompare,
        }),
        finding: ([rows]) => [{ b: String(rows.filter((r) => r.acres_burned > 0).length) }, ' states and territories had wildfire acres in scope.'],
        method: 'Points of origin in Canada and Mexico, where US agencies assisted, are left out.',
      }),
      tile({
        title: 'Where the big fires started, lower 48 states', cls: 'span-2',
        sub: 'Each hexagon sums the acres of fires of 100 acres or more that started inside it; grey shows the same fires with no filter.',
        queries: () => [T('points'), 'run: fires -> fire_points'],
        explain: ['The 5,000 largest fires of 100 acres or more under the scope, with their point of origin and acres.', 'The same with no filter, drawn grey underneath.'],
        draw: ([pts, base], body) => C.hexMap(chartBox(body), pts.map((p) => ({ lat: p.latitude, lon: p.longitude, value: p.fire_acres })), {
          base: base.map((p) => ({ lat: p.latitude, lon: p.longitude, value: p.fire_acres })), format: (v) => `${C.fmt(Math.round(v))} acres`, legendTitle: 'Acres',
        }),
        finding: ([pts]) => [{ b: pts[0].fire_name }, ` (${pts[0].fire_year}) is the largest fire in scope, ${acres(pts[0].fire_acres)}.`],
        method: 'At most the 5,000 largest fires in scope are drawn, so with no filter the smaller ones drop out. Alaska and Hawaii are left out of this map only. A hexagon is not a filter; filter by state instead.',
      }),
      tile({
        title: 'Acres by fire region',
        sub: 'The interagency Geographic Area Coordination Centers. Click a region to filter.',
        queries: () => [T('regions')],
        explain: ['Acres and fires of 1 acre or more by coordination region, under the scope.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.region, value: r.acres_burned })), { horizontal: true, direct: true, format: (v) => C.fmt(Math.round(v)), selected: scope.region, onPick: (v) => toggleScope('region', v), color: '--c-bar', label: 'Acres by region' }),
        finding: ([rows]) => ['The ', { b: rows[0].region }, ` region has the most acres in scope, ${acres(rows[0].acres_burned)}.`],
        method: 'Fires under 1 acre, and the few larger fires with no region recorded, are left out here only.',
      }),
      tile({
        title: 'Whose land it started on',
        sub: 'Acres by the owner of the land at the point of origin, grouped as federal, private, tribal, state and local.',
        queries: () => [T('owners')],
        explain: ['Acres and fires of 1 acre or more by land owner at the point of origin, under the scope.'],
        draw: ([rows], body) => C.treemap(chartBox(body), rows.map((r) => ({ id: r.land_owner, label: r.land_owner, value: r.acres_burned, group: r.owner_group, color: OWNER_COLOR[r.owner_group] })), { colorBy: 'color', format: (v) => `${C.fmt(Math.round(v))} acres`, label: 'Acres by land owner' }),
        finding: ([rows]) => ['Most acres in scope started on ', { b: rows[0].land_owner }, ` land: ${acres(rows[0].acres_burned)}.`],
        method: 'Where a fire started, not all the land it burned. Not a filter. Fires under 1 acre are left out here only.',
      }),
    ),
    section('Why and how', 'What started the fires, and how long they took to contain.',
      tile({
        title: 'What started the fires, year by year', cls: 'span-2',
        sub: 'Each year’s fires by reported cause, as shares. Click a cause to filter by it.',
        queries: () => [S.viewQuery('by_year_and_cause', scope, known, ['cause'])],
        explain: ['Fires and acres by year and broad cause, under the scope.'],
        draw: ([rows], body) => C.stackedShare(chartBox(body), rows.map((r) => ({ x: String(r.fire_year), part: r.cause_name, value: r.fire_count })),
          ['Human', 'Natural', 'Undetermined', 'Not reported'].filter((c) => rows.some((r) => r.cause_name === c)).map((c) => ({ name: c, color: CAUSE_COLOR[c] })), { selected: scope.cause, onPick: (c) => toggleScope('cause', c), label: 'Share of fires by cause' }),
        finding: ([rows]) => { const t = rows.filter((r) => r.cause_name === 'Human').reduce((a, b) => (b.fire_count > a.fire_count ? b : a), { fire_count: -1 }); return t.fire_count >= 0 ? ['Human-caused fires peaked in ', { b: String(t.fire_year) }, ` at ${n0(t.fire_count)} fires in scope.`] : '' },
        method: '“Unknown” is merged into Undetermined. The share of fires started by people elsewhere in this app leaves Undetermined and Not reported out of the denominator.',
      }),
      tile({
        title: 'Specific causes, where reported',
        sub: 'Fires of 1 acre or more with a specific cause on record. Not a filter.',
        queries: () => [T('causeDetail')],
        explain: ['Fires of 1 acre or more and their acres, by specific cause group, under the scope; undetermined and unreported left out.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.cause_detail, value: r.incident_count })), { horizontal: true, direct: true, format: (v) => C.fmt(v), color: '--c-bar', label: 'Fires by specific cause' }),
        finding: ([rows]) => [{ b: rows[0].cause_detail }, ` started the most of these fires, ${n0(rows[0].incident_count)}.`],
        method: 'Only about one fire in five of 1 acre or more has a specific cause recorded, most of them since 2020. Spelling variants are merged (see About the data).',
      }),
      tile({
        title: 'How long fires took to contain',
        sub: 'Fires of 1 acre or more by days from discovery to containment. Not a filter.',
        queries: () => [T('containment')],
        explain: ['Fires of 1 acre or more and their acres, by days from discovery to containment, under the scope.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.containment_band, value: r.incident_count })), { horizontal: true, direct: true, format: (v) => C.fmt(v), color: '--c-bar', label: 'Fires by days to containment' }),
        finding: ([rows]) => { const same = rows.find((r) => r.containment_band === 'Same day'); return same ? [{ b: n0(same.incident_count) }, ' fires in scope were contained the day they were found.'] : '' },
        method: 'Many records carry no containment time, mostly small fires and fires still burning; they are shown as their own bar, not dropped.',
      }),
      tile({
        title: 'The largest fires, each a dot', cls: 'span-2',
        sub: 'The 300 largest fires in scope, along a log scale of acres.',
        queries: () => [T('largest', 'limit: 300; order_by: fire_acres desc')],
        explain: ['The 300 largest fires under the scope: name, date, state, county, cause and acres.'],
        draw: ([rows], body) => C.beeswarm(chartBox(body), rows.map((r) => ({ id: String(r.fire_id), label: `${r.fire_name}, ${r.state_code} ${String(r.discovery_date).slice(0, 4)}`, value: r.fire_acres })), {
          log: true, format: (v) => `${C.fmt(Math.round(v))} acres`, axisTitle: 'Acres (log scale)', labelIds: rows.slice(0, 3).map((r) => String(r.fire_id)), emph: rows.filter((r) => String(r.discovery_date).startsWith(String(known.years[1]))).map((r) => String(r.fire_id)), label: 'Largest fires',
        }),
        finding: ([rows]) => [{ b: rows[0].fire_name }, ` (${rows[0].state_name}, ${String(rows[0].discovery_date).slice(0, 4)}) is the largest in scope at ${acres(rows[0].fire_acres)}. Dots in the accent colour are from ${known.years[1]}.`],
        method: 'A complex of fires appears as its member fires when agencies reported them separately. Acres of fires still burning are their latest reported size.',
      }),
    ),
  )
}

function entity() {
  const id = route.id
  const name = S.ENTITY.label(id)
  const E = (view, extra = '', ignore = []) => S.entityQuery(view, id, scope, known, extra, ignore)
  return h('div', { class: 'view wrap' },
    ...viewHead(name, `Wildfires that started in ${name}, ${known.years[0]} to ${shortDate(known.latest)}. Filters in the bar above narrow every card except the headline, which always compares this year with the ten before.`, [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${name}`]),
    h('p', {}, h('button', { class: 'btn', type: 'button', text: inCompare(id) ? 'In compare: open it' : 'Add to compare', onclick: () => (inCompare(id) ? go({ view: 'compare', id: null, compare: compareIds }) : addCompare(id)) })),
    h('div', { class: 'grid-2' },
      tile({
        title: `${name} in ${known.years[1]}`, cls: 'span-2',
        queries: () => [E('kpis', '', ['from', 'to', 'ytd']), E('by_year_to_date', '', ['from', 'to', 'ytd'])],
        explain: [`${name}: acres and fires this year and the ten-year average of each to the same date.`, `${name}: each year to the same date.`],
        draw: ([[k], yrs], body) => body.append(h('div', { class: 'kpis' },
          kpi('Acres burned this year', n0(k.acres_this_season), ['Average to this date: ', { b: n0(k.acres_ten_year_avg) }], { accent: true, trend: yrs.map((r) => r.acres_burned) }),
          kpi('Of its ten-year average', k.acres_vs_ten_year_avg === null ? 'n/a' : pct0(k.acres_vs_ten_year_avg), `Acres, ${baseline()}, same date`),
          kpi('Wildfires this year', n0(k.fires_this_season), ['Average to this date: ', { b: n0(k.fires_ten_year_avg) }], { trend: yrs.map((r) => r.fire_count), color: '--c-bar' }),
          kpi('Of its fire average', k.fires_vs_ten_year_avg === null ? 'n/a' : pct0(k.fires_vs_ten_year_avg), `Fires, ${baseline()}, same date`))),
        finding: ([[k]]) => [{ b: name }, ` has burned ${acres(k.acres_this_season)} this year in ${n0(k.fires_this_season)} fires.`],
        method: 'Ignores the period filters: it always compares this year with the ten before, to the same date.',
      }),
      tile({
        title: 'Acres each year', cls: '',
        queries: () => [E('by_year')],
        explain: [`${name}: acres and fires per year, under the scope.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: String(r.fire_year), value: r.acres_burned })), { format: (v) => `${C.fmt(Math.round(v))} acres`, color: '--accent', selected: pickedYear(), onPick: (y) => setScope(yearScope(+y)), label: 'Acres by year' }),
        finding: ([rows]) => { const t = rows.reduce((a, b) => (b.acres_burned > a.acres_burned ? b : a)); return [{ b: String(t.fire_year) }, ` was ${name}'s biggest year in scope, ${acres(t.acres_burned)}.`] },
        method: `The latest year runs to ${shortDate(known.latest)}.`,
      }),
      tile({
        title: 'What started its fires',
        queries: () => [E('by_cause')],
        explain: [`${name}: fires and acres by broad cause, under the scope.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.cause_name, value: r.fire_count })), { horizontal: true, direct: true, format: (v) => C.fmt(v), color: '--c-bar', label: 'Fires by cause', tip: (r) => [acres(rows.find((x) => x.cause_name === r.label).acres_burned)] }),
        finding: ([rows]) => [{ b: rows[0].cause_name }, ` is the most common reported cause, ${n0(rows[0].fire_count)} fires.`],
        method: '“Unknown” is merged into Undetermined.',
      }),
      calendarTile(() => E('by_week_and_year', '', ['from', 'to']), 'span-2', { onYear: (y) => setScope(yearScope(+y)) }),
      tile({
        title: 'Its largest fires', cls: 'span-2',
        queries: () => [E('largest_fires', 'limit: 15; order_by: fire_acres desc')],
        explain: [`${name}: the 15 largest fires under the scope.`],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: String(r.fire_id), name: r.fire_name || 'Unnamed', sub: `${shortDate(r.discovery_date)} · ${r.county_label || 'county not recorded'} · ${r.cause_name}${r.days_to_contain_fire !== null ? ` · contained in ${r.days_to_contain_fire} days` : ''}`, value: r.fire_acres })), { valueLabel: 'Acres', format: (v) => C.fmt(Math.round(v)), limit: 15 }),
        finding: ([rows]) => [{ b: rows[0].fire_name }, `, found ${shortDate(rows[0].discovery_date)}, is the largest in scope at ${acres(rows[0].fire_acres)}.`],
        method: 'Fires of 1 acre or more only.',
      }),
    ),
  )
}

let recLimit = 50
function records() {
  const wrapEl = h('div', {})
  const draw = () => {
    const q = S.tileQuery('records', scope, known, `limit: ${recLimit}; order_by: discovery_date desc, fire_acres desc`)
    query(q).then((rows) => {
      const cols = [['discovery_date', 'Found'], ['fire_name', 'Fire'], ['state_code', 'State'], ['county_label', 'County'], ['cause_name', 'Cause'], ['cause_detail', 'Specific cause'], ['land_owner', 'Land owner'], ['fire_acres', 'Acres'], ['days_to_contain_fire', 'Days to contain']]
      const cell = (r, c) => c === 'state_code' ? h('a', { href: linkTo('state', r.state_code), text: S.ENTITY.label(r.state_code) })
        : c === 'discovery_date' ? shortDate(r[c]) : c === 'fire_acres' ? C.fmt(r[c]) : r[c] === null ? '—' : String(r[c])
      wrapEl.replaceChildren(
        h('div', { class: 'table-wrap', 'data-loaded': '1' }, h('table', { class: 'records' }, h('thead', {}, h('tr', {}, ...cols.map(([, l]) => h('th', { text: l })))),
          h('tbody', {}, ...rows.map((r) => h('tr', {}, ...cols.map(([c]) => h('td', { class: c === 'fire_acres' || c === 'days_to_contain_fire' ? 'num' : null }, cell(r, c)))))))),
        rows.length >= recLimit ? h('p', { class: 'pager' }, h('button', { class: 'btn', type: 'button', text: 'Show 50 more', onclick: () => { recLimit += 50; draw() } })) : h('p', { class: 'pager', text: `All ${rows.length} fires in scope are shown.` }),
        h('details', {}, h('summary', { text: 'Show the query' }), h('pre', { text: q })))
    }).catch((e) => wrapEl.replaceChildren(h('div', { class: 'state state--error', text: `Could not load: ${e.message}` })))
  }
  draw()
  return h('div', { class: 'view wrap' }, ...viewHead('Records', 'Each wildfire of 1 acre or more in scope, newest first. Fires under 1 acre are stored summed by day and state, so they are not listed one by one.'), wrapEl)
}

function compare() {
  compareIds = route.compare.slice()
  const add = h('select', { 'aria-label': 'Add a state', onchange: (e) => e.target.value && addCompare(e.target.value) },
    h('option', { value: '', text: 'Add a state…' }), ...known.entity.filter((id) => !inCompare(id)).map((id) => h('option', { value: id, text: S.ENTITY.label(id) })))
  const head = viewHead('Compare states', 'Up to four states side by side, each year to the same date, so this year is compared like for like.')
  if (!compareIds.length) return h('div', { class: 'view wrap' }, ...head, h('p', {}, h('label', {}, 'Choose a state to start ', add)), h('p', { class: 'lede', text: 'Or use “Add to compare” on a state’s page or in a ranked list.' }))
  return h('div', { class: 'view wrap' }, ...head,
    h('p', { class: 'chips' }, ...compareIds.map((id) => h('span', { class: 'chip' }, h('a', { href: linkTo('state', id), text: S.ENTITY.label(id) }), h('button', { type: 'button', 'aria-label': `Remove ${S.ENTITY.label(id)}`, text: '×', onclick: () => addCompare(id) }))), compareIds.length < S.COMPARE_MAX ? add : null),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Acres each year, to the same date', cls: 'span-2',
        queries: () => [S.compareQuery('by_state_year', compareIds, scope, known)],
        explain: ['Acres and fires by state and year, each year cut at the latest record’s month and day, under the scope.'],
        draw: ([rows], body) => {
          const years = [...new Set(rows.map((r) => r.fire_year))].sort()
          const cols = ['--c1', '--c2', '--c4', '--c6']
          C.lines(chartBox(body), years.map(String), compareIds.map((id, i) => ({ name: S.ENTITY.label(id), color: cols[i], values: years.map((y) => rows.find((r) => r.state_code === id && r.fire_year === y)?.acres_burned ?? 0) })), { format: (v) => `${C.fmt(Math.round(v))} acres`, label: 'Acres by year' })
        },
        finding: ([rows]) => { const t = rows.reduce((a, b) => (b.acres_burned > a.acres_burned ? b : a)); return [{ b: `${S.ENTITY.label(t.state_code)} in ${t.fire_year}` }, ` burned the most of these, ${acres(t.acres_burned)} to the same date.`] },
        method: 'A year with no fires in a state draws at zero.',
      }),
      tile({
        title: 'This year against each state’s own average', cls: 'span-2',
        queries: () => [S.compareQuery('by_state_season', compareIds, scope, known, '', ['from', 'to', 'ytd'])],
        explain: ['Each state: acres this year and the change against its own ten-year average to the same date.'],
        draw: ([rows], body) => C.rankTable(body, rows.map((r) => ({ id: r.state_code, name: r.state_name, value: r.acres_this_season, trend: r.trend.map((t) => t.acres_burned), change: r.acres_change_vs_ten_year_avg })), { valueLabel: 'Acres this year', format: (v) => C.fmt(Math.round(v)), trendLabel: `Since ${known.years[0]}`, changeLabel: 'Against its average', changeFormat: (v) => C.pct(v, 0), good: 'fall', href: (id) => linkTo('state', id), onOpen: openEntity }),
        finding: ([rows]) => [{ b: rows[0].state_name }, ` has burned the most of these this year, ${acres(rows[0].acres_this_season)}.`],
        method: 'Ignores the period filters: it always compares this year with the ten before.',
      }),
    ),
  )
}

function about() {
  const p = (...parts) => h('p', {}, ...parts)
  const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener', text })
  return h('div', { class: 'view wrap prose' },
    ...viewHead('About the data', `Where every number comes from, what was changed, and what the data cannot tell you. The latest record is from ${longDate(known.latest)}.`),
    h('h2', { text: 'Source' }),
    p(h('strong', { text: 'WFIGS Wildland Fire Incident Locations' }), ', published by the National Interagency Fire Center (NIFC) through its Wildland Fire Interagency Geospatial Services group, from the IRWIN incident records of the US Forest Service, Bureau of Land Management, Bureau of Indian Affairs, National Park Service, US Fish and Wildlife Service and state and local fire agencies. ', a('https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-incident-locations', 'Dataset page'), '. Fetched November 4, 2026.'),
    p(h('strong', { text: 'Licence: none is stated.' }), ' The dataset is openly accessible and its page carries only a disclaimer. It is used here, with attribution to NIFC and the agencies above, at the request of the person who commissioned this app. Credit: National Interagency Fire Center; data from federal, state and local wildland fire agencies.'),
    p('State boundaries: us-atlas 3.0.1 (ISC licence), from US Census Bureau cartographic boundaries (public domain).'),
    h('h2', { text: 'What was reshaped' }),
    p('All 392,116 wildfire records (incident type WF; prescribed fires left out) were downloaded. Records discovered before 2015 were dropped: the system starts in mid-2014, and six stray earlier records remain. Each wildfire of 1 acre or more is kept as one row, with its name, date, state, county, point of origin, cause, land owner, region and containment. The 266,822 fires under 1 acre are summed by discovery date, state and cause, so their counts and acres are exact at that grain but they have no county, point or detail fields. Points of origin in Canada and Mexico are left out. Spelling variants of causes are merged (for example “Debris/Open Burning” and “Debris and open burning”), and “Unknown” is merged into Undetermined. Acres are the final acres, else the latest incident size, else the size at discovery.'),
    h('h2', { text: 'Caveats' }),
    p(h('strong', { text: 'These are not NIFC’s official statistics.' }), ' NIFC’s National Fire News reported 67,457 fires and nearly 9.4 million acres, 146% of the ten-year average, by October 30, 2026; those figures come from daily situation reports. WFIGS is the incident record agencies file; it counts fewer fires (many small fires are reported only to the situation reports) and slightly fewer acres, so its totals and percentages here are lower. The ten-year average here is computed from WFIGS itself, over the ten years before this one, to the same month and day.'),
    p('A fire’s acres count in the year, week, state and county where it was discovered, even when it burned for months or across a line. Fires still burning carry their latest reported size. Specific causes are recorded for only about one fire in five of 1 acre or more, and containment times are often missing. Dates are UTC, so a fire found late in the evening in the West can fall on the next day. Fires managed as part of a complex appear as their member fires; the complexes themselves are not separate records here, so no acres are counted twice.'),
    h('h2', { text: 'Rebuild' }),
    p('The package holds the scripts: ', h('code', { text: 'pipeline/fetch.sh /tmp/raw' }), ' downloads every record, and ', h('code', { text: 'python3 -I pipeline/shape_fires.py /tmp/raw data' }), ' writes the files in data/. The model is wildfires.malloy; every number in this app is a view or measure in it.'),
  )
}

function footer() {
  return h('div', {}, h('h2', { text: 'The 2026 Wildfire Season' }),
    h('p', { text: 'Source: National Interagency Fire Center, WFIGS Wildland Fire Incident Locations, from federal, state and local fire agencies; no licence stated, used with attribution. An independent app, not produced by NIFC or any agency.' }),
    h('p', {}, h('a', { href: '#/about', text: 'About the data' })))
}

boot()
