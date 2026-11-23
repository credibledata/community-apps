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

function go(nextRoute, nextScope = scope, { push = true, toTop = push } = {}) {
  route = nextRoute
  scope = nextScope
  const hash = S.buildHash(route, scope)
  if (hash !== location.hash) history[push ? 'pushState' : 'replaceState'](null, '', hash)
  render({ toTop })
}
const setScope = (patch) => go(route, { ...scope, ...patch }, { push: false })
const toggleScope = (key, value) => setScope({ [key]: scope[key] === value ? S.DEFAULT_SCOPE[key] : value })
const openEntity = (id) => go({ view: S.ENTITY.view, id, compare: [] })
const linkTo = (view, id = null, compare = []) => S.buildHash({ view, id, compare }, scope)

// ---- Compare: the entities picked to set side by side, kept until the page reloads. The header's Compare link
// carries and counts them, so a + on a ranked list shows where it went. The Compare view shows what its own address
// holds, so Back and Forward show each step; opening it with picks in the address makes them the picks. Pass
// `inCompare` and `onCompare: toggleCompare` to every ranked list of entities. ----

let picked = []
/** The picks a control on this view acts on: the Compare view's own, elsewhere the kept ones. */
const current = () => (route.view === 'compare' ? route.compare : picked)
const inCompare = (id) => current().some((x) => String(x) === String(id))
/** A control to focus once the next view is drawn, such as the next × after one is pressed. */
let focusNext = null
/** Open Compare with `ids`; past the limit the oldest picks go, as with the +. Changing the picks on Compare itself
 *  keeps the reader's place (`toTop: false`). */
function goCompare(ids, { toTop = true } = {}) {
  picked = ids.slice(-S.COMPARE_MAX)
  go({ view: 'compare', id: null, compare: picked }, scope, { toTop })
}
function toggleCompare(id) {
  const ids = inCompare(id) ? current().filter((x) => String(x) !== String(id)) : [...current(), id]
  if (route.view === 'compare') goCompare(ids, { toTop: false })
  else {
    picked = ids.slice(-S.COMPARE_MAX)
    showPicked()
  }
}
/** The header's Compare link, and the + on every ranked list on the page, not only the one clicked. */
function showPicked() {
  const a = $('.app-nav a[data-view="compare"]')
  if (a) {
    a.href = linkTo('compare', null, picked)
    // The count is drawn by the stylesheet, so the link's own text stays "Compare" for whatever reads it.
    if (picked.length) a.dataset.count = picked.length
    else delete a.dataset.count
    a.setAttribute('aria-label', picked.length ? `Compare, ${picked.length} picked` : 'Compare')
  }
  for (const b of document.querySelectorAll('#main .rt__act button')) {
    const on = inCompare(b.closest('tr')?.dataset.id)
    const name = (b.getAttribute('aria-label') || '').replace(/^(Add|Remove) /, '').replace(/ (to|from) compare$/, '')
    b.textContent = on ? '✓' : '+'
    b.setAttribute('aria-pressed', String(on))
    b.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${name} ${on ? 'from' : 'to'} compare`)
  }
}

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
      spec.default === undefined && h('option', { value: '', text: spec.type === 'pick' ? `All` : spec.type === 'from' ? 'Earliest' : 'Latest' }),
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
  if (route.view === 'compare' && route.compare.length) picked = [...route.compare]
  for (const a of document.querySelectorAll('.app-nav a')) {
    a.href = linkTo(a.dataset.view)
    const on = a.dataset.view === route.view || (a.dataset.view === 'explore' && route.view === S.ENTITY.view)
    if (on) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
  showPicked()
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
    // Parts of a view that are not cards but follow the address, such as Compare's picks, marked data-redraw.
    for (const el of next.querySelectorAll('[data-redraw]')) $(`#main [data-redraw="${el.dataset.redraw}"]`)?.replaceWith(el)
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
  if (focusNext) {
    ;($(focusNext) || $('#main')).focus({ preventScroll: true })
    focusNext = null
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
    const [years, fuels, areas, k] = await Promise.all([
      query('run: fuel_prices -> { aggregate: lo is min(survey_year), hi is max(survey_year) }'),
      query('run: fuel_prices -> { group_by: fuel; where: fuel != \'All grades\'; order_by: fuel }'),
      query('run: fuel_prices -> { group_by: area, area_type_order; order_by: area_type_order, area }'),
      query(`run: ${S.HEADLINE} -> kpis`),
    ])
    known.years = [years[0].lo, years[0].hi]
    const values = (rows, f) => rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined)
    known.fuel = values(fuels, 'fuel')
    known.area = values(areas, 'area')
    known.entity = known.area
    known.latestWeek = k[0].latest_week
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Data through the week of ${day(known.latestWeek)}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Views: ADAPT. Each returns one element; tiles inside it load as they near the screen. ----

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** '2026-11-16' -> 'November 16, 2026'; with short, 'Nov 16, 2026'. */
const day = (d, short) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); const mo = MONTHS[+m - 1]; return `${short ? mo.slice(0, 3) : mo} ${+dd}, ${y}` }
const usd = (v, d = 3) => (v === null || v === undefined ? '–' : `$${v.toFixed(d)}`)
const signed = (v, d = 3) => (v === null || v === undefined ? '–' : `${v < 0 ? '−' : '+'}$${Math.abs(v).toFixed(d)}`)
const wk = (r) => String(r.week).slice(0, 10)
const ARTICLE = { href: 'https://news.google.com/rss/articles/CBMikAFBVV95cUxPWnNrNmcyaXlfWVlTM29KQnZKWUdIZVVvSnREWDhHcm9wZWtDVTVWMXlDV0I4dHFGQlJZYVFFbHI3N1VqdWZjOTlBY2xNT2tEYTBhYlJXX0xkaGpVVU94bnlJcjhXRUl2b3V3b254QmhkR2RPUWZPWjQ0aU9LOGFDdzVHbVFMcXJsWXI5M2FZUVg?oc=5', outlet: 'Vermont Business Magazine' }

function kpi(label, value, sub, accent) {
  return h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), h('div', { class: 'kpi__sub' }, ...prose(sub)))
}

function overview() {
  // The headline runs bare views of us_regular, and every word of the answer comes from their rows.
  const qK = `run: ${S.HEADLINE} -> kpis`
  const qW = `run: ${S.HEADLINE} -> weekly`
  const qB = `run: ${S.HEADLINE} -> before_thanksgiving_ranked`
  const answer = h('p', { class: 'answer' })
  Promise.all([query(qK), query(qB)]).then(([[k], bt]) => {
    const now = bt[bt.length - 1]
    answer.replaceChildren(...prose([
      'Not in real terms. The week before Thanksgiving, US regular cost ', { b: usd(k.latest_price) }, ` a gallon, `,
      { b: signed(k.change_vs_year_ago) }, ' on a year earlier. That is dear for recent years, but in today’s dollars it ranks ',
      { b: String(now.real_rank) }, ` of ${bt.length} pre-Thanksgiving weeks since ${bt[0].survey_year}, and the 2008 record of `,
      { b: usd(k.peak_real_price) }, ' was ', { b: usd(k.below_peak_real) }, ' higher.',
    ]))
  })
  const [kicker, title, lede] = viewHead('Are Thanksgiving gas prices near a record?',
    ['Reports call this year’s Thanksgiving gas prices near an all-time high. The Energy Information Administration has surveyed pump prices every week since 1990: here is where this November sits, before and after inflation.']).filter(Boolean)
  return h('div', { class: 'view wrap' },
    kicker, title, answer, lede,
    h('div', { class: 'grid-2' },
      tile({
        title: 'US regular gasoline, every week since 1990', cls: 'span-2',
        sub: 'Dollars per gallon. The dashed line is in today’s dollars (“Real” on a small screen). The year-by-year Thanksgiving comparison is the next chart.',
        queries: () => [qK, qW, qB],
        explain: ['The headline numbers: the latest week, 52 weeks earlier, and the highest week on record, nominal and adjusted by CPI-U.', 'Every weekly US average price of regular gasoline, nominal and in dollars of the latest CPI month, with Thanksgiving week flagged.', 'For each year, the price in the week before Thanksgiving and its rank in today’s dollars (the answer’s rank).'],
        draw: ([[k], rows], body) => {
          const spark = rows.slice(-104).map((r) => r.price)
          body.append(h('div', { class: 'kpis' },
            kpi(`Week of ${day(k.latest_week, true)}`, usd(k.latest_price), 'US regular, a gallon', true),
            kpi('On a year earlier', signed(k.change_vs_year_ago), [`From `, { b: usd(k.year_ago_price) }, ` in the week of ${day(k.year_ago_week, true)}`]),
            kpi('Record, as paid', usd(k.peak_price), `Week of ${day(k.peak_week, true)}`),
            kpi('Record, in today’s dollars', usd(k.peak_real_price), [`Week of ${day(k.peak_real_week, true)}, `, { b: usd(k.peak_real_nominal_price) }, ' as paid'])))
          const sv = body.querySelector('.kpi--accent').appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
          C.sparkline(sv, spark, '--accent')
          const labels = rows.map(wk)
          const tg = rows.map((r, i) => (r.is_thanksgiving_week ? i : -1)).filter((i) => i >= 0)
          const last = tg[tg.length - 1]
          const narrow = innerWidth < 600
          C.lines(chartBox(body, 'chart--tall'), labels, [
            { name: narrow ? 'Paid' : 'As paid', values: rows.map((r) => r.price), color: '--accent' },
            { name: narrow ? 'Real' : 'Today’s dollars', values: rows.map((r) => r.real_price), color: '--c2', dashed: true },
          ], {
            beginAtZero: true, format: (v) => usd(v, 2), maxTicks: narrow ? 3 : 8,
            points: narrow ? [] : [
              { series: 1, index: labels.indexOf(String(k.peak_real_week).slice(0, 10)), text: `${usd(k.peak_real_price, 2)} in today’s dollars, ${String(k.peak_real_week).slice(0, 4)}` },
              { series: 0, index: labels.indexOf(String(k.peak_week).slice(0, 10)), text: `${usd(k.peak_price, 2)} as paid, ${String(k.peak_week).slice(0, 4)}` },
              { series: 0, index: last, text: `Thanksgiving ${labels[last].slice(0, 4)}: ${usd(rows[last].price)}` },
            ],
          })
        },
        finding: ([[k]]) => ['The highest week as paid was ', { b: usd(k.peak_price) }, ` in the week of ${day(k.peak_week)}; in today’s dollars the record is `, { b: usd(k.peak_real_price) }, ` in the week of ${day(k.peak_real_week)}.`],
        method: 'Real prices use the BLS consumer price index (CPI-U, all items), in dollars of the latest CPI month. BLS published no index for October 2025, so those four weeks have no price in today’s dollars. Thanksgiving week is the survey Monday from November 19 to 25.',
      }),
      tile({
        title: 'The week before Thanksgiving, every year', cls: 'span-2',
        sub: 'US regular in the survey week before Thanksgiving, in today’s dollars. This year is the coloured bar.',
        queries: () => [qB],
        explain: ['For each year, the US regular price in the survey week dated November 12 to 18, in dollars of the latest CPI month, and its rank among those years.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: String(r.survey_year), value: r.real_price })), {
          format: (v) => usd(v, 2), selected: String(rows[rows.length - 1].survey_year),
          tip: (r) => { const x = rows.find((y) => String(y.survey_year) === r.label); return [`As paid: ${usd(x.price)}`, `Rank in today’s dollars: ${x.real_rank} of ${rows.length}`] },
        }),
        finding: ([rows]) => { const n = rows[rows.length - 1]; const top = rows.find((r) => r.real_rank === 1); return [`In today’s dollars, ${n.survey_year}’s `, { b: usd(n.real_price) }, ` ranks ${n.real_rank} of ${rows.length}. The dearest was `, { b: String(top.survey_year) }, ' at ', { b: usd(top.real_price) }, '.'] },
        method: 'The latest week EIA published before Thanksgiving 2026 is November 16, so every year is compared on its own week before Thanksgiving.',
      })),
    h('div', { class: 'grid-3 next-cards' },
      ...[['Where it costs most', 'California pays the most; see every region and city EIA surveys.', 'explore'],
        ['Premium and diesel', 'The gaps between grades, and diesel’s, have widened.', 'explore'],
        ['Every reading', 'The weekly prices behind every chart, to search and download.', 'records']]
        .map(([t, d, v]) => h('a', { class: 'card card--link', href: linkTo(v) }, h('h3', { class: 'card__title', text: t }), h('p', { text: d })))),
    h('p', { class: 'source-note' }, 'Responding to: ', h('a', { href: ARTICLE.href, rel: 'noopener', target: '_blank', text: 'Thanksgiving gas prices' }), ` (${ARTICLE.outlet}, November 2026).`))
}

function explore() {
  const where = `${scope.fuel} in ${scope.area}`
  const yr = (r) => String(r.survey_year)
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore', 'Pick a fuel and an area above, or click a bar or drag across a chart; the address keeps the view.'),
    section('Where it costs most', `${scope.fuel}, in the latest week, by every area EIA surveys.`,
      tile({
        title: 'Price in the latest week', sub: 'Click an area to make it the area in scope.',
        queries: () => [S.tileQuery('areaLatest', scope, known)],
        explain: [`Each area's ${scope.fuel.toLowerCase()} price in its latest survey week.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.area, value: r.price })), { horizontal: true, direct: true, format: (v) => usd(v), selected: scope.area, onPick: (a) => setScope({ area: a }) }),
        finding: ([rows]) => [{ b: rows[0].area }, ` is dearest at ${usd(rows[0].price)}; `, { b: rows[rows.length - 1].area }, ` cheapest at ${usd(rows[rows.length - 1].price)}.`],
      }),
      tile({
        title: 'A year ago against now', sub: 'Each area, the same week a year earlier and the latest week.',
        queries: () => [S.tileQuery('areaLatest', scope, known)],
        explain: ['Each area’s price in its latest week and 52 survey weeks before, and the change.'],
        draw: ([rows], body) => C.dumbbell(chartBox(body), rows.filter((r) => r.year_ago_price !== null).map((r) => ({ label: r.area, id: r.area, a: r.year_ago_price, b: r.price, change: r.change_vs_year_ago })), {
          aName: 'A year ago', bName: 'Latest', aColor: '--c6', bColor: '--accent', format: (v) => usd(v, 2), diff: (r) => signed(r.change, 2), selected: scope.area, onPick: (a) => setScope({ area: a }),
        }),
        finding: ([rows]) => { const r = [...rows].filter((x) => x.change_vs_year_ago !== null).sort((x, y) => y.change_vs_year_ago - x.change_vs_year_ago); return [{ b: r[0].area }, ` rose most, ${signed(r[0].change_vs_year_ago)}; `, { b: r[r.length - 1].area }, ` changed least, ${signed(r[r.length - 1].change_vs_year_ago)}.`] },
        method: 'A year ago is 52 survey weeks before each area’s latest week.',
      })),
    section('Over time', `${where}, every week, as paid and in today’s dollars.`,
      tile({
        title: 'Every week', sub: 'Drag across the chart to choose years.', cls: 'span-2',
        queries: () => [S.tileQuery('trend', scope, known)],
        explain: [`The weekly ${where} price, nominal and in dollars of the latest CPI month.`],
        draw: ([rows], body) => {
          const labels = rows.map(wk)
          const band = scope.from || scope.to ? { from: labels.find((l) => +l.slice(0, 4) >= (scope.from || 0)), to: [...labels].reverse().find((l) => +l.slice(0, 4) <= (scope.to || 9999)) } : null
          return C.lines(chartBox(body, 'chart--tall'), labels, [
            { name: 'As paid', values: rows.map((r) => r.price), color: '--accent' },
            { name: 'Today’s dollars', values: rows.map((r) => r.real_price), color: '--c2', dashed: true }],
          { format: (v) => usd(v, 2), maxTicks: innerWidth < 600 ? 3 : 8, band, onBrush: (a, b) => setScope({ from: +a.slice(0, 4), to: +b.slice(0, 4) }) })
        },
        finding: ([rows]) => { const top = rows.reduce((m, r) => (r.price > m.price ? r : m), rows[0]); return [`${where} peaked as paid at `, { b: usd(top.price) }, ` in the week of ${day(top.week)}.`] },
      }),
      tile({
        title: 'Average price by year', sub: 'Click a year to scope everything to it.', cls: 'span-2',
        queries: () => [S.tileQuery('byYear', scope, known)],
        explain: [`The ${where} yearly average weekly price as paid, with the highest and lowest week. The current year is partial.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: yr(r), value: r.avg_price })), {
          format: (v) => usd(v, 2), selected: scope.from && scope.from === scope.to ? String(scope.from) : null,
          tip: (b) => { const r = rows.find((x) => yr(x) === b.label); return [`Highest week: ${usd(r.max_price)}`, `Lowest week: ${usd(r.min_price)}`, `In today’s dollars: ${usd(r.avg_real_price)}`] },
          onPick: (y) => setScope(scope.from === +y && scope.to === +y ? { from: null, to: null } : { from: +y, to: +y }),
        }),
        finding: ([rows]) => { const top = rows.reduce((m, r) => (r.avg_price > m.avg_price ? r : m), rows[0]); return ['The dearest year on average, as paid, was ', { b: yr(top) }, ` at ${usd(top.avg_price)}.`] },
      })),
    section('Grades and diesel', `How far premium and diesel sit above regular, in ${scope.area}.`,
      tile({
        title: 'Premium over regular, by year', sub: 'Dollars per gallon more than regular, yearly average.',
        queries: () => [S.tileQuery('premium', scope, known)],
        explain: [`Average premium price less average regular price in ${scope.area}, by year.`],
        draw: ([rows], body) => C.bars(chartBox(body), rows.filter((r) => r.premium_gap !== null).map((r) => ({ label: yr(r), value: r.premium_gap })), { format: (v) => usd(v, 2), color: '--c3' }),
        finding: ([rows]) => { const r = rows.filter((x) => x.premium_gap !== null); return [`Premium cost `, { b: usd(r[0].premium_gap, 2) }, ` more than regular in ${yr(r[0])} and `, { b: usd(r[r.length - 1].premium_gap, 2) }, ` more in ${yr(r[r.length - 1])}.`] },
      }),
      tile({
        title: 'Diesel over regular, by month', sub: 'Below zero, diesel was cheaper than regular.',
        queries: () => [S.tileQuery('diesel', scope, known)],
        explain: [`Average diesel price less average regular price in ${scope.area}, by month.`],
        draw: ([rows], body) => { const r = rows.filter((x) => x.diesel_gap !== null); return C.lines(chartBox(body), r.map((x) => String(x.survey_month).slice(0, 7)), [{ name: 'Diesel gap', values: r.map((x) => x.diesel_gap), color: '--c4' }], { format: (v) => signed(v, 2), beginAtZero: false, refs: [{ y: 0, label: 'Same as regular' }], maxTicks: 6 }) },
        finding: ([rows]) => { const r = rows.filter((x) => x.diesel_gap !== null); const top = r.reduce((m, x) => (x.diesel_gap > m.diesel_gap ? x : m), r[0]); return ['Diesel’s widest lead over regular was ', { b: signed(top.diesel_gap, 2) }, ` in ${String(top.survey_month).slice(0, 7)}.`] },
      })),
    section('The season', `${where}: when in the year prices run high.`,
      tile({
        title: 'This year against the usual season', sub: 'Each week’s price against its year’s average.',
        queries: () => [S.tileQuery('seasonal', scope, known), S.tileQuery('profile', scope, known)],
        explain: ['Each week’s price less that year’s average price, by year and week of the year.', 'For each week of the year, the average of that difference over complete years.'],
        draw: ([rows, prof], body) => {
          const last = Math.max(...rows.map((r) => r.survey_year))
          const cur = new Map(rows.filter((r) => r.survey_year === last).map((r) => [r.week_of_year, r.vs_year_avg]))
          return C.lines(chartBox(body), prof.map((p) => `Week ${p.week_of_year}`), [
            { name: 'Usual season', values: prof.map((p) => p.avg_vs_year_avg), color: '--c6' },
            { name: String(last), values: prof.map((p) => cur.get(p.week_of_year) ?? null), color: '--accent' }],
          { format: (v) => signed(v, 2), beginAtZero: false, refs: [{ y: 0, label: 'Year’s average' }, { x: 'Week 47', label: 'Thanksgiving' }], maxTicks: 6 })
        },
        finding: ([, prof]) => { const p = prof.find((x) => x.week_of_year === 47); const top = prof.reduce((m, x) => (x.avg_vs_year_avg > m.avg_vs_year_avg ? x : m), prof[0]); return ['Prices usually peak in week ', { b: String(top.week_of_year) }, ` at ${signed(top.avg_vs_year_avg, 2)} over the year’s average; by Thanksgiving week they run `, { b: signed(p.avg_vs_year_avg, 2) }, '.'] },
        method: 'The usual season averages complete years only; this year’s average covers only the weeks published so far.',
      }),
      tile({
        title: 'Every area’s record', sub: `The highest weekly ${scope.fuel.toLowerCase()} price in each area, as paid and in today’s dollars.`,
        queries: () => [S.tileQuery('peaks', scope, known)],
        explain: ['Each area’s highest weekly price, nominal and in dollars of the latest CPI month.'],
        draw: ([rows], body) => C.dumbbell(chartBox(body), rows.map((r) => ({ label: r.area, id: r.area, a: r.max_price, b: r.max_real_price })), {
          aName: 'As paid', bName: 'Today’s dollars', aColor: '--accent', bColor: '--c2', format: (v) => usd(v, 2), selected: scope.area, onPick: (a) => setScope({ area: a }),
        }),
        finding: ([rows]) => [{ b: rows[0].area }, ` holds the highest record as paid, ${usd(rows[0].max_price)}.`],
        method: 'Each record in today’s dollars may fall in a different week from the record as paid.',
      })))
}

function entity() {
  const id = route.id
  const qK = S.entityQuery('scope_kpis', id, scope, known)
  return h('div', { class: 'view wrap' },
    ...viewHead(S.ENTITY.label(id), [`${scope.fuel} prices surveyed by EIA in ${id}, every week, against the United States.`], [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${S.ENTITY.label(id)}`]),
    h('p', {}, h('button', { class: 'btn', type: 'button', text: inCompare(id) ? 'Open compare' : 'Add to compare', onclick: () => goCompare(inCompare(id) ? picked : [...picked, id]) })),
    h('div', { class: 'grid-2' },
      tile({
        title: `${scope.fuel} in ${id}`, cls: 'span-2',
        sub: 'Monthly average, dollars per gallon, against the United States.',
        queries: () => [qK, S.compareQuery('by_area_monthly', [...new Set([id, 'United States'])], scope, known)],
        explain: [`Headline numbers for ${scope.fuel.toLowerCase()} in ${id}: the latest week, 52 weeks earlier, and its highest week, as paid and in today’s dollars.`, `The monthly average ${scope.fuel.toLowerCase()} price in ${id} and in the United States.`],
        draw: ([[k], rows], body) => {
          const ly = k.last_year?.[0] || {}
          body.append(h('div', { class: 'kpis' },
            kpi(`Week of ${day(k.latest_week, true)}`, usd(k.latest?.[0]?.price), `${scope.fuel}, a gallon`, true),
            kpi('A year earlier', usd(ly.year_ago_price), ly.year_ago_week ? `Week of ${day(ly.year_ago_week, true)}` : 'No reading 52 weeks before'),
            kpi('Record, as paid', usd(k.peak_nominal?.[0]?.price), k.peak_nominal?.[0] ? `Week of ${day(k.peak_nominal[0].week, true)}` : ''),
            kpi('Record, in today’s dollars', usd(k.peak_real?.[0]?.real_price), k.peak_real?.[0] ? `Week of ${day(k.peak_real[0].week, true)}` : '')))
          const months = [...new Set(rows.map((r) => String(r.survey_month).slice(0, 7)))].sort()
          const series = [...new Set([id, 'United States'])].map((a, i) => {
            const m = new Map(rows.filter((r) => r.area === a).map((r) => [String(r.survey_month).slice(0, 7), r.avg_price]))
            return { name: a, values: months.map((x) => m.get(x) ?? null), color: i ? '--c6' : '--accent' }
          })
          return C.lines(chartBox(body), months, series, { format: (v) => usd(v, 2), maxTicks: innerWidth < 600 ? 3 : 8 })
        },
        finding: ([[k]]) => [`${scope.fuel} in ${id} was `, { b: usd(k.latest?.[0]?.price) }, ` in the week of ${day(k.latest_week)}; EIA’s series here starts in the week of ${day(k.first_week)}.`],
      }),
      tile({
        title: 'Every week, as a calendar', cls: 'span-2',
        sub: 'One row per year, one square per survey week; darker is dearer, as paid. Late spring runs darkest in most years.',
        queries: () => [S.entityQuery('seasonal', id, scope, known)],
        explain: [`The ${scope.fuel.toLowerCase()} price in ${id} in each survey week, by year and week of the year.`],
        draw: ([rows], body) => {
          const years = [...new Set(rows.map((r) => String(r.survey_year)))]
          const weeks = Array.from({ length: 53 }, (_, i) => String(i + 1))
          return C.heatmap(chartBox(body), years, weeks, rows.map((r) => ({ row: String(r.survey_year), col: String(r.week_of_year), value: r.price })), { format: (v) => usd(v), onRow: (y) => setScope({ from: +y, to: +y }) })
        },
        method: 'Columns are ISO weeks of the year; week 47 is the week before or of Thanksgiving. Click a year to scope the page to it.',
      }),
      tile({
        title: 'Latest readings', cls: 'span-2',
        queries: () => [S.entityQuery('records', id, scope, known, 'order_by: `week` desc, fuel; limit: 12')],
        explain: [`The newest weekly readings in ${id}, every fuel.`],
        draw: ([rows], body) => body.append(recordsTable(rows)),
      })))
}

function recordsTable(rows) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'records' },
    h('thead', {}, h('tr', {}, ...['Week of', 'Area', 'Fuel', 'As paid', 'Today’s dollars', 'EIA series'].map((t, i) => h('th', { class: i === 3 || i === 4 ? 'num' : null, text: t })))),
    h('tbody', {}, ...rows.map((r) => h('tr', {},
      h('td', { text: day(r.week, true) }), h('td', {}, h('a', { href: linkTo(S.ENTITY.view, r.area), text: r.area })), h('td', { text: r.fuel }),
      h('td', { class: 'num', text: usd(r.price) }), h('td', { class: 'num', text: usd(r.real_price) }), h('td', { class: 'mono', text: r.series_id }))))))
}

let recordLimit = 50
function records() {
  const q = () => S.tileQuery('records', scope, known, `order_by: \`week\` desc, area; limit: ${recordLimit}`)
  const more = h('button', { class: 'btn', type: 'button', text: 'Show 50 more', onclick: () => { recordLimit += 50; render() } })
  return h('div', { class: 'view wrap' },
    ...viewHead('Records', [`Every weekly reading of ${scope.fuel.toLowerCase()} in ${scope.area}, newest first. Change the fuel or area above; click an area to open its page.`]),
    h('div', { class: 'grid-2' },
      tile({
        title: `${scope.fuel} in ${scope.area}`, cls: 'span-2',
        queries: () => [q()],
        explain: ['The weekly readings in scope, newest first, with EIA’s series id to check each against the source.'],
        draw: ([rows], body) => { body.append(recordsTable(rows)); if (rows.length >= recordLimit) body.append(more) },
        method: 'Prices are EIA’s weekly retail averages, dollars per gallon including taxes. Today’s dollars use CPI-U.',
      })))
}

function compare() {
  const ids = route.compare
  const chips = h('div', { class: 'chips' },
    ...ids.map((id) => h('span', { class: 'chip' }, S.ENTITY.label(id),
      h('button', { type: 'button', 'aria-label': `Remove ${S.ENTITY.label(id)}`, text: '×', onclick: () => {
        focusNext = '.chip button'
        goCompare(ids.filter((x) => x !== id), { toTop: false })
      } }))))
  const colors = ['--accent', '--c2', '--c3', '--c4']
  const adder = h('select', { 'aria-label': 'Add an area', onchange: (e) => e.target.value && goCompare([...ids, e.target.value], { toTop: false }) },
    h('option', { value: '', text: 'Add an area…' }), ...known.area.filter((a) => !ids.includes(a)).map((a) => h('option', { value: a, text: a })))
  return h('div', { class: 'view wrap' },
    ...viewHead('Compare', `Up to ${S.COMPARE_MAX} areas side by side, for the fuel in scope. Add one here, with the + on a ranked list, or from its page.`),
    // data-redraw: the frame swaps this in place when the picks change, while the cards update where they are.
    h('div', { 'data-redraw': 'picks' }, ids.length ? chips : h('p', { class: 'lede', text: 'Nothing picked yet.' }), ids.length < S.COMPARE_MAX && h('label', { class: 'adder' }, adder)),
    ids.length ? h('div', { class: 'grid-2' },
      tile({
        title: 'Monthly average price', cls: 'span-2', sub: `${scope.fuel}, dollars per gallon, as paid.`,
        queries: () => [S.compareQuery('by_area_monthly', ids, scope, known)],
        explain: ['The monthly average price in each area picked.'],
        draw: ([rows], body) => {
          const months = [...new Set(rows.map((r) => String(r.survey_month).slice(0, 7)))].sort()
          return C.lines(chartBox(body), months, ids.map((a, i) => { const m = new Map(rows.filter((r) => r.area === a).map((r) => [String(r.survey_month).slice(0, 7), r.avg_price])); return { name: a, values: months.map((x) => m.get(x) ?? null), color: colors[i] } }), { format: (v) => usd(v, 2), maxTicks: innerWidth < 600 ? 3 : 8 })
        },
      }),
      tile({
        title: 'A year ago against now', cls: 'span-2',
        queries: () => [S.compareQuery('area_latest', ids, scope, known)],
        explain: ['Each area’s price in its latest week and 52 survey weeks before.'],
        draw: ([rows], body) => C.dumbbell(chartBox(body), rows.map((r) => ({ label: r.area, id: r.area, a: r.year_ago_price, b: r.price, change: r.change_vs_year_ago })), { aName: 'A year ago', bName: 'Latest', aColor: '--c6', bColor: '--accent', format: (v) => usd(v, 2), diff: (r) => signed(r.change, 2), onPick: openEntity }),
        finding: ([rows]) => [{ b: rows[0].area }, ` is dearest of these at ${usd(rows[0].price)}.`],
      })) : null)
}

function about() {
  const p = (...k) => h('p', {}, ...k)
  const a = (href, text) => h('a', { href, rel: 'noopener', target: '_blank', text })
  return h('div', { class: 'view wrap prose-view' },
    ...viewHead('About the data', [`Sources, licenses, what was reshaped, and what to watch for. The latest week is ${day(known.latestWeek)}.`]),
    h('h2', { text: 'Sources' }),
    h('ul', {},
      h('li', {}, a('https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_nus_w.htm', 'Weekly Retail Gasoline and Diesel Prices'), ', US Energy Information Administration. Public domain as a US government work (', a('https://www.eia.gov/about/copyrights_reuse.php', 'EIA copyright and reuse'), ').'),
      h('li', {}, a('https://download.bls.gov/pub/time.series/cu/', 'Consumer Price Index for All Urban Consumers (CPI-U), all items, series CUUR0000SA0'), ', US Bureau of Labor Statistics. Public domain as a US government work.')),
    h('h2', { text: 'What was reshaped' }),
    p('EIA publishes one spreadsheet per grade, each a column per area and formulation. The pipeline turns them into one row per series and week: area, area type, grade, formulation, price. The app reads the “All formulations” series for gasoline and the on-highway series for diesel. The tables live in Credible’s managed database; the scripts in this package’s pipeline folder rebuild them from the sources.'),
    h('h2', { text: 'Caveats' }),
    h('ul', {},
      h('li', { text: 'Prices are EIA’s weekly averages of retail prices including taxes, surveyed on Mondays. They are not every station’s price.' }),
      h('li', { text: 'Today’s dollars restate each week’s price by CPI-U, to the latest month BLS has published. Weeks after that month are left as paid. BLS published no index for October 2025, so those weeks have no price in today’s dollars.' }),
      h('li', { text: 'Areas are EIA’s regions (PADDs and sub-regions), nine states and ten cities, not every state. Series start at different dates: the national regular series in August 1990, the regions in 1992 to 1998, the states and cities in 2000 or 2003.' }),
      h('li', { text: 'Thanksgiving week is the survey Monday from November 19 to 25; the week before, November 12 to 18. 2026’s Thanksgiving week is not yet published.' })),
    h('h2', { text: 'Rebuild' }),
    p('Run pipeline/fetch.sh to download the spreadsheets and the CPI file, then the two shaping scripts; README.md has the steps.'))
}

function footer() {
  return h('div', {}, h('h2', { text: 'US gasoline prices' }), h('p', { text: 'Sources: US Energy Information Administration, Weekly Retail Gasoline and Diesel Prices; US Bureau of Labor Statistics, CPI-U. Both public domain. An independent app, not produced by either agency.' }))
}

boot()
