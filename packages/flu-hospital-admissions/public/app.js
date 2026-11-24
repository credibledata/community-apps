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

// ---- Theme and mode: the app's theme is data-theme on <html>; data-mode fixes light or dark, else the reader's
// system setting decides. ?theme= and ?mode= in the address override both, for a preview or a screenshot. ----
{
  const p = new URLSearchParams(location.search)
  if (p.get('theme')) document.documentElement.dataset.theme = p.get('theme')
  if (['light', 'dark'].includes(p.get('mode'))) document.documentElement.dataset.mode = p.get('mode')
}
// The host's mode. Credible shows the app in a frame and tells it which mode its reader chose
// (credible:color-scheme, on load and on every change). The frame follows it unless the address fixes one (?mode=),
// and answers credible:color-scheme-applied, so the host knows this app draws dark itself and stops holding its
// frame light. It also asks once on start, in case the host spoke before the frame was listening.
if (window.parent !== window) {
  const fixed = ['light', 'dark'].includes(new URLSearchParams(location.search).get('mode'))
  addEventListener('message', (e) => {
    const d = e.data
    if (e.source !== window.parent || !d || d.type !== 'credible:color-scheme' || !['light', 'dark'].includes(d.mode)) return
    if (!fixed && document.documentElement.dataset.mode !== d.mode) document.documentElement.dataset.mode = d.mode // the same mode again redraws nothing
    e.source.postMessage({ type: 'credible:color-scheme-applied', mode: fixed ? document.documentElement.dataset.mode : d.mode }, e.origin === 'null' ? '*' : e.origin)
  })
  // The request carries nothing; it goes to the host's own origin where the browser says it, else to any.
  window.parent.postMessage({ type: 'credible:color-scheme-request' }, location.ancestorOrigins?.[0] || '*')
}
/** Charts read their colours when they draw, so a new theme or mode draws every loaded card again, in place. */
function recolour() {
  for (const c of document.querySelectorAll('#main article.card')) if (c.__loaded && c.__spec) c.__update?.(c.__spec)
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolour)
new MutationObserver(recolour).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] })

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
let backs = 0
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
  // The info mark turns the card over to how it is made: what it covers and leaves out, each query with what it
  // counts and its rows, and, inside Credible, a question to Credible's agent about it.
  const backId = `back-${++backs}`
  const back = h('div', { class: 'card__back', id: backId, role: 'region', 'aria-label': `How “${title}” is made`, hidden: true })
  const info = h('button', { type: 'button', class: 'card__info', 'aria-expanded': 'false', 'aria-controls': backId, 'aria-label': `How “${title}” is made`, title: 'How it’s made' }, infoIcon())
  let status = 'loading' // 'loading', 'ok', or the error's message: what the back says about the rows
  const fill = () => back.replaceChildren(...howMade(current, results, found.textContent, title, status))
  const flip = (open) => {
    // Closing with focus inside the back would drop it to the page: it goes back to the info mark first.
    if (!open && back.contains(document.activeElement)) info.focus()
    if (open) {
      back.style.minHeight = `${card.offsetHeight - card.querySelector('.card__head').offsetHeight}px`
      fill()
    }
    back.hidden = !open
    card.classList.toggle('card--back', open)
    info.setAttribute('aria-expanded', String(open))
  }
  info.onclick = () => flip(back.hidden)
  const card = h(
    'article',
    { class: `card ${cls}`, 'data-key': `${cls}|${title}` },
    h('div', { class: 'card__head' }, h('h3', { class: 'card__title', text: title }), info),
    back,
    sub && h('p', { class: 'card__sub', text: sub }),
    body,
    found,
    spec.method && methodEl,
    note && h('div', { class: 'card__foot' }, h('span', { text: note }))
  )
  card.__spec = spec
  card.addEventListener('keydown', (e) => e.key === 'Escape' && !back.hidden && flip(false))
  const run = (updating) => {
    const mine = epoch
    const s = current
    card.__loaded = true
    status = 'loading'
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
        if (mine !== epoch) return
        status = 'ok'
        card.dataset.loaded = '1'
        if (!back.hidden) {
          // Opened while loading: now it has the rows. Focus inside the back goes to the info mark first.
          if (back.contains(document.activeElement)) info.focus()
          fill()
        }
      })
      .finally(() => mine === epoch && card.classList.remove('is-updating'))
      .catch((err) => {
        if (mine !== epoch) return
        body.replaceChildren(h('div', { class: 'state state--error', text: `Could not load: ${err.message}` }))
        status = err.message || 'an error'
        results = []
        if (!back.hidden) fill()
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
    flip(false)
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

function infoIcon() {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  for (const [tag, attrs] of [['circle', { cx: 8, cy: 8, r: 6.5 }], ['path', { d: 'M8 7.2v4' }], ['circle', { cx: 8, cy: 4.9, r: 0.6, class: 'dot' }]]) {
    const el = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    svg.append(el)
  }
  return svg
}

/** The back of a card: how it is made. */
function howMade(spec, results, finding, title, status = 'ok') {
  const part = (head, ...kids) => h('section', { class: 'back__part' }, h('h4', { text: head }), ...kids)
  // What the card's own queries apply, read from the queries themselves: a filter whose clause is in none of them
  // (the card ignores it, or always shows the whole) is said to be left out, never claimed.
  const qs = spec.queries()
  const keys = Object.keys(S.SCOPE || {})
  const applied = (key) => {
    const [clause] = S.scopeClauses(scope, known, keys.filter((k) => k !== key))
    if (!clause) return false
    // The clause as a whole expression, never part of a longer name or after a "not".
    const re = new RegExp(`(?<!not\\s)(?<![\\w.])${clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.])`)
    return qs.some((q) => re.test(q))
  }
  const set = S.scopeChips(scope)
  const chips = set.filter((c) => applied(c.key)).map((c) => c.label)
  // An entity's page, or Compare, narrows every query to its entities before any filter.
  if (S.ENTITY && route.view === S.ENTITY.view && route.id != null) chips.unshift(S.ENTITY.label(route.id))
  if (route.view === 'compare' && route.compare?.length) chips.unshift(route.compare.map((id) => (S.ENTITY ? S.ENTITY.label(id) : id)).join(' against '))
  const ignored = set.filter((c) => !applied(c.key)).map((c) => c.label)
  return [
    spec.sub && part('What it shows', h('p', { text: spec.sub })),
    part('What it covers', h('p', { text: `${chips.length ? `${chips.join(', ')}.` : 'All of the data.'}${ignored.length ? ` It does not apply the filter${ignored.length > 1 ? 's' : ''} ${ignored.join(', ')}.` : ''}` })),
    spec.method && part('What it leaves out', h('p', { text: spec.method })),
    part('How it is counted', working(qs, spec.explain || [], results, status)),
    inCredible() && h('button', { type: 'button', class: 'btn back__ask', text: 'Ask Credible about this', onclick: () => askCredible(
      `${document.title}, "${title}": ${finding ? `${finding} ` : ''}What is behind this, and what should I look at next?`,
      { scope: { package: decodeURIComponent(location.pathname.match(/\/packages\/([^/]+)/)?.[1] || ''), model: S.MODEL }, view: { type: 'card', id: title, title },
        entities: [{ kind: 'source', name: S.SOURCE }], items: [{ label: 'what it covers', value: chips.join(', ') || 'everything' }, ...qs.slice(0, 3).map((q, i) => ({ label: `query ${i + 1}`, value: q.slice(0, 900) }))] }) }),
  ].filter(Boolean)
}

/** True inside Credible's viewer: in a frame, on a Credible data host ("data" or "<env>-data"). */
function inCredible(loc = location) {
  const parts = loc.host.split('.')
  const plane = parts[1] || ''
  return window.parent !== window && parts.length >= 3 && (plane === 'data' || plane.endsWith('-data'))
}
/** Opens Credible's chat with `prompt`, after attaching `context`; Credible drops a context over 8,000 characters. */
function askCredible(prompt, context) {
  const text = String(prompt ?? '').trim().slice(0, 4000)
  if (!text || !inCredible()) return false
  const parts = location.host.split('.')
  parts[1] = parts[1].replace(/data$/, 'app')
  const origin = `${location.protocol}//${parts.join('.')}`
  let c = context
  while (JSON.stringify(c).length > 7800 && (c.items || []).length > 1) c = { ...c, items: c.items.slice(0, -1) }
  if (JSON.stringify(c).length > 7800) c = { scope: c.scope, view: { ...c.view, id: String(c.view.id).slice(0, 200), title: String(c.view.title).slice(0, 200) } }
  window.parent.postMessage({ type: 'credible:chat-context', context: c }, origin)
  window.parent.postMessage({ type: 'credible:chat-message', prompt: text }, origin)
  return true
}

/** The working behind a card: for each query, what it counts, the query itself, and the rows it returned. */
function working(qs, explain, results, status = 'ok') {
  const cell = (v) => (v === null || v === undefined ? '∅' : typeof v === 'number' ? String(Number.isInteger(v) ? v : Number(v.toPrecision(4))) : String(v))
  return h('div', { class: 'working' }, ...qs.map((q, i) => {
    // Rows only from an answer to this query: while it loads, or when it failed, there are none to show.
    const rows = status === 'ok' ? results[i] || [] : []
    const cols = rows.length ? Object.keys(rows[0]) : []
    const said = status === 'loading' ? 'Loading.' : status !== 'ok' ? `Could not load: ${status}` : `${rows.length} row${rows.length === 1 ? '' : 's'}${rows.length > 100 ? ', the first 100 shown' : ''}`
    return h('div', { class: 'working__item' },
      explain[i] && h('p', { text: explain[i] }),
      h('pre', { text: q }),
      h('span', { class: status !== 'ok' && status !== 'loading' ? 'state--error' : null, text: said }),
      cols.length > 0 && h('button', { type: 'button', class: 'btn btn--small', text: 'Download CSV', onclick: () => downloadCsv(rows, cols, i) }),
      cols.length > 0 && h('div', { class: 'working__rows' }, h('table', {},
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
    // One query per list the scope and search need, values as strings and nulls dropped.
    const [regions, places, kpis] = await Promise.all([
      query(`run: ${S.SOURCE} -> { group_by: region; where: region is not null; order_by: region }`),
      query(`run: ${S.SOURCE} -> { group_by: state_code, state_name; where: state_code is not null; order_by: state_code }`),
      query(`run: ${S.HEADLINE} -> kpis`),
    ])
    const values = (rows, f) => rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined).map(String)
    known.region = values(regions, 'region')
    known.state = values(places, 'state_code')
    known.entity = known.state
    for (const r of places) if (r.state_code) S.names[r.state_code] = r.state_name || r.state_code
    known.kpis = kpis[0]
  } catch (err) {
    $('#main').replaceChildren(h('div', { class: 'wrap state state--error', text: `Could not reach the model: ${err.message}` }))
    return
  }
  ;({ route, scope } = S.parseHash(location.hash, known))
  history.replaceState(null, '', S.buildHash(route, scope))
  $('#footer').replaceChildren(footer())
  $('#data-through').textContent = `Data through the week ending ${day(known.kpis.last_week)}`
  render()
  if (new URLSearchParams(location.search).has('check')) selfCheck()
}

// ---- Views ----

/** A view's head: crumbs, a kicker naming the view (shown by the light headers' looks), its title and lede. */
function viewHead(title, lede, crumbs) {
  const kicker = $(`.app-nav a[data-view="${route.view}"]`)?.textContent || ''
  return [crumbs && h('p', { class: 'crumbs' }, ...crumbs), h('p', { class: 'kicker', text: kicker }), h('h1', { class: 'view-title', text: title }), lede && h('p', { class: 'lede' }, ...prose(lede))]
}

/** "Nov 14, 2026" from a date the model returns. */
const day = (d, year = true) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
const n0 = (v) => C.fmt(v)
const n2 = (v) => (v === null || v === undefined ? '–' : Number(v).toFixed(2))
const signed2 = (v) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`)
const share = (v, d = 1) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(d)}%`)
const ARTICLE = { href: 'https://www.cnn.com/2026/11/24/health/flu-season-vaccines-cdc', text: 'CNN, November 24, 2026' }

// Season colours: this season in the accent, last season in the neutral bar colour, older ones soft.
const seasonColour = (label, current, last) => (label === current ? '--accent' : label === last ? '--c-bar' : '--text-soft')

/**
 * The season overlay: one line per season over the weeks of the season. Labels are the dates of the last complete
 * season's weeks ("Oct 4"), so a reader sees when in the year each week falls.
 */
function seasonOverlay(body, rows, field, fmt) {
  const seasons = [...new Set(rows.map((r) => r.season_label))].sort()
  const current = seasons[seasons.length - 1]
  const last = seasons[seasons.length - 2]
  const weeks = d3.range(1, (d3.max(rows, (r) => r.season_week) || 52) + 1)
  const ref = new Map(rows.filter((r) => r.season_label === last).map((r) => [r.season_week, r.week_end]))
  const labels = weeks.map((w) => (ref.get(w) ? day(ref.get(w), false) : `Week ${w}`))
  const series = seasons.slice(-6).map((sn) => {
    const at = new Map(rows.filter((r) => r.season_label === sn).map((r) => [r.season_week, r[field]]))
    return { name: sn, values: weeks.map((w) => at.get(w) ?? null), color: seasonColour(sn, current, last), width: sn === current ? 3 : sn === last ? 2 : 1.25 }
  })
  return C.lines(chartBox(body), labels, series, { format: fmt, endLabels: true, beginAtZero: true, label: 'Week of the flu season' })
}

/** The season-to-date comparison: each season's flu admissions through the same week, the current one in the accent. */
function toDateBars(body, rows) {
  const current = rows[rows.length - 1]?.season_label
  return C.bars(chartBox(body), rows.map((r) => ({ label: r.season_label, value: r.flu_admissions_to_date })), { horizontal: true, direct: true, format: n0, selected: current, color: '--c-bar' })
}

function overview() {
  const k = known.kpis
  // The headline runs one bare view, and every number in the answer and the card comes from its row.
  const qK = `run: ${S.HEADLINE} -> kpis`
  const answer = h('p', { class: 'answer' })
  query(qK).then(([r]) => {
    const above = r.flu_admissions_latest > r.flu_admissions_same_week_prior_max
    answer.replaceChildren(...prose([
      { b: n0(r.flu_admissions_latest) }, ` people were admitted to US hospitals with flu in the week ending ${day(r.last_week)}, week ${r.current_season_week} of the season: `,
      above ? 'more than in that week of any of the last five seasons, whose highest was ' : 'against a high for that week in the last five seasons of ',
      { b: n0(r.flu_admissions_same_week_prior_max) }, '. Last season it was ', { b: n0(r.flu_admissions_same_week_last_season) }, '.',
    ]))
  })
  return h('div', { class: 'view wrap' },
    ...viewHead('Is this flu season coming early and hard?', 'Hospitals across the US report their new flu, COVID-19 and RSV patients to the CDC each week. Here is this season against the last five, week by week.'),
    h('p', { class: 'card__sub' }, 'Prompted by ', h('a', { href: ARTICLE.href, target: '_blank', rel: 'noopener', text: ARTICLE.text }), '.'),
    answer,
    tile({
      title: 'The latest week, across the US', cls: 'card--headline',
      queries: () => [qK],
      explain: ['Headline numbers for the latest week, from the US total (NHSN\'s national rows, territories included).'],
      draw: ([[r]], body) => {
        const kpi = (label, value, sub, accent) => h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), h('div', { class: 'kpi__sub' }, ...prose(sub)))
        body.append(h('div', { class: 'kpis' },
          kpi('Flu admissions', n0(r.flu_admissions_latest), ['against ', { b: n0(r.flu_admissions_prior_week) }, ' the week before'], true),
          kpi('Per 100,000 people', n2(r.flu_rate_latest), ['flu fills ', { b: share(r.flu_bed_share_latest, 2) }, ' of staffed beds']),
          kpi('This season so far', n0(r.flu_admissions_season_to_date), [`flu admissions in ${r.current_season_week} weeks`]),
          kpi('COVID-19 and RSV', n0(r.covid_admissions_latest), ['COVID-19 admissions; RSV ', { b: n0(r.rsv_admissions_latest) }])))
      },
      method: `Counts are what hospitals reported; ${n0(k.hospitals_reporting_latest)} hospitals reported flu admissions in the latest week. A late report can raise the latest week a little when the CDC updates.`,
    }),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Flu admissions each week of the season', sub: 'The US, this season against the five before it. Week 1 ends in early October.', cls: 'span-2',
        queries: () => [`run: ${S.HEADLINE} -> by_season_week`],
        explain: ['New flu admissions per week across the US, one line per season, by week of the season. The partial 2019-2020 season is left out.'],
        draw: ([rows], body) => seasonOverlay(body, rows, 'flu_admissions', n0),
        finding: ([rows]) => {
          const cur = rows[rows.length - 1].season_label
          const at = rows.filter((r) => r.season_label === cur)
          const last = at[at.length - 1]
          const peak = d3.greatest(rows, (r) => r.flu_admissions)
          return ['In week ', { b: String(last.season_week) }, ` of ${cur}, ${n0(last.flu_admissions)} people were admitted with flu. The highest week on the chart is ${n0(peak.flu_admissions)}, in the week ending ${day(peak.week_end)} (${peak.season_label}).`]
        },
        method: 'Hospitals did not have to report from May to October 2024, so fewer did and the 2024-2025 line starts low; those weeks are summer, when flu is rare.',
      }),
      tile({
        title: 'This season so far, against the same weeks before', sub: 'US flu admissions from week 1 to the latest week of each season.',
        queries: () => [`run: ${S.HEADLINE} -> same_week_by_season`],
        explain: ['New flu admissions across the US from the first week of each season through the same week of the season as the latest week.'],
        draw: ([rows], body) => toDateBars(body, rows),
        finding: ([rows]) => {
          const cur = rows[rows.length - 1]
          const prev = d3.greatest(rows.slice(0, -1), (r) => r.flu_admissions_to_date)
          return [`${cur.season_label} has `, { b: n0(cur.flu_admissions_to_date) }, ` flu admissions so far; the most at this point in an earlier season was ${n0(prev.flu_admissions_to_date)}, in ${prev.season_label}.`]
        },
      }),
      tile({
        title: 'Where flu is highest now', sub: 'Flu admissions per 100,000 people in the latest week, and the change over three weeks. Open a state.',
        queries: () => [`run: ${S.SOURCE} -> by_state`],
        explain: ['Every state and territory in the latest week: flu admissions per 100,000 people, and that rate minus the rate three weeks earlier.'],
        draw: ([rows], body) => C.rankTable(body, rows.filter((r) => r.flu_rate_latest !== null).map((r) => ({ id: r.state_code, name: r.state_name, sub: r.region || 'Territory', value: r.flu_rate_latest, change: r.flu_rate_change_3w })), {
          valueLabel: 'Per 100,000', format: n2, changeLabel: 'In 3 weeks', changeFormat: (v) => Math.abs(v).toFixed(2), good: 'fall', limit: 8,
          onOpen: openEntity, href: (id) => linkTo(S.ENTITY.view, id), inCompare, onCompare: toggleCompare,
        }),
        finding: ([rows]) => { const t = rows.filter((r) => r.flu_rate_latest !== null); return [{ b: t[0].state_name }, ` has the highest rate, ${n2(t[0].flu_rate_latest)} per 100,000, then ${t[1].state_name} (${n2(t[1].flu_rate_latest)}) and ${t[2].state_name} (${n2(t[2].flu_rate_latest)}).`] },
        method: 'Guam, American Samoa, the Northern Mariana Islands and the Virgin Islands have no population in the Census file, so no rate; their counts are on their pages.',
      })),
    section('Read on', 'Where to go from here.',
      h('div', { class: 'card card--link' }, h('h3', { class: 'card__title' }, h('a', { href: linkTo('explore'), text: 'Explore by region and state' })), h('p', { class: 'card__sub', text: 'Pick a region or a state and every chart follows: the season curve, beds, ages, and flu against COVID-19 and RSV.' })),
      h('div', { class: 'card card--link' }, h('h3', { class: 'card__title' }, h('a', { href: linkTo('about'), text: 'How the data is made' })), h('p', { class: 'card__sub', text: 'What hospitals report to the CDC, the months when reporting was voluntary, and how each number is computed.' }))))
}

function explore() {
  return h('div', { class: 'view wrap' },
    ...viewHead('Explore', 'Pick a region or a state: every chart follows, and the address keeps the view.'),
    section('The season', 'How this season is running against earlier ones, for the places picked.',
      tile({
        title: 'Flu admissions each week of the season', sub: 'One line per season, by week of the season.', cls: 'span-2',
        queries: () => [S.tileQuery('seasons', scope, known)],
        explain: ['New flu admissions per week in the places picked, one line per season, by week of the season.'],
        draw: ([rows], body) => seasonOverlay(body, rows, 'flu_admissions', n0),
        finding: ([rows]) => {
          const cur = rows[rows.length - 1].season_label
          const at = rows.filter((r) => r.season_label === cur)
          const last = at[at.length - 1]
          const same = rows.filter((r) => r.season_label !== cur && r.season_week === last.season_week)
          const hi = d3.greatest(same, (r) => r.flu_admissions)
          return ['Week ', { b: String(last.season_week) }, ` of ${cur}: ${n0(last.flu_admissions)} flu admissions` + (hi ? `, against ${n0(hi.flu_admissions)} at the most in that week of an earlier season (${hi.season_label}).` : '.')]
        },
      }),
      tile({
        title: 'Season so far', sub: 'Flu admissions from week 1 to the same week, each season.',
        queries: () => [S.tileQuery('to_date', scope, known)],
        explain: ['New flu admissions in the places picked from the first week of each season through the same week of the season as the latest week.'],
        draw: ([rows], body) => toDateBars(body, rows),
        finding: ([rows]) => {
          const cur = rows[rows.length - 1]
          const prev = d3.greatest(rows.slice(0, -1), (r) => r.flu_admissions_to_date)
          const more = cur.flu_admissions_to_date > prev.flu_admissions_to_date
          return [`${cur.season_label} so far: `, { b: n0(cur.flu_admissions_to_date) }, more ? `, more than any earlier season at this point (the most was ${n0(prev.flu_admissions_to_date)}, ${prev.season_label}).` : `; ${prev.season_label} had ${n0(prev.flu_admissions_to_date)} at this point.`]
        },
      }),
      tile({
        title: 'Who is admitted, by age', sub: 'Share of flu admissions so far each season, by age group.',
        queries: () => [S.tileQuery('ages', scope, known)],
        explain: ['New flu admissions by age group from week 1 to the same week of each season. Hospitals reported ages only from 2024-2025.'],
        draw: ([rows], body) => {
          const bands = [['flu_adm_age_0_4', '0–4', '--c5'], ['flu_adm_age_5_17', '5–17', '--c3'], ['flu_adm_age_18_49', '18–49', '--c6'], ['flu_adm_age_50_64', '50–64', '--c4'], ['flu_adm_age_65_74', '65–74', '--c2'], ['flu_adm_age_75_plus', '75+', '--c1']]
          const rs = rows.filter((r) => r.season_label >= '2024-2025')
          return C.stackedShare(chartBox(body), rs.flatMap((r) => bands.map(([f, name]) => ({ x: r.season_label, part: name, value: r[f] || 0 }))), bands.map(([, name, color]) => ({ name, color })))
        },
        finding: ([rows]) => {
          const r = rows[rows.length - 1]
          return [`In ${r.season_label} so far, people 75 and over account for `, { b: n0(r.flu_adm_age_75_plus) }, ` of ${n0(r.flu_admissions)} flu admissions, and children under 18 for ${n0((r.flu_adm_age_0_4 || 0) + (r.flu_adm_age_5_17 || 0))}.`]
        },
        method: 'Admissions with no age reported are left out of the shares. Seasons before 2024-2025 have no ages.',
      })),
    section('Where', 'Regions and states in the latest week. Click a region or a state to pick it.',
      tile({
        title: 'By region', sub: 'Flu admissions per 100,000 people, latest week. Click to pick a region.',
        queries: () => [S.tileQuery('regions', scope, known)],
        explain: ['Flu admissions per 100,000 people in each Census region in the latest week. Puerto Rico and the territories have no region.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.region, value: r.flu_rate_latest })), { horizontal: true, direct: true, format: n2, selected: scope.region, onPick: (v) => toggleScope('region', v) }),
        finding: ([rows]) => [{ b: rows[0].region }, ` has the highest rate, ${n2(rows[0].flu_rate_latest)} per 100,000; ${rows[rows.length - 1].region} the lowest, ${n2(rows[rows.length - 1].flu_rate_latest)}.`],
      }),
      tile({
        title: 'Rising and falling', sub: 'Change in the weekly flu rate per 100,000 over the last three weeks.',
        queries: () => [S.tileQuery('by_state', scope, known, 'order_by: flu_rate_change_3w desc')],
        explain: ['For each state in the places picked: its flu rate per 100,000 in the latest week minus its rate three weeks earlier.'],
        draw: ([rows], body) => C.divergingBars(chartBox(body), rows.filter((r) => r.flu_rate_change_3w !== null).map((r) => ({ id: r.state_code, label: r.state_name, value: r.flu_rate_change_3w })), { format: signed2, good: 'fall', selected: scope.state, onPick: (v) => toggleScope('state', v) }),
        finding: ([rows]) => { const t = rows.filter((r) => r.flu_rate_change_3w !== null); return [{ b: t[0].state_name }, ` rose most, by ${n2(t[0].flu_rate_change_3w)} per 100,000 in three weeks.`] },
      }),
      tile({
        title: 'States by flu rate', sub: 'Latest week, per 100,000. Click a row to pick it; its name opens its page.', cls: 'span-2',
        queries: () => [S.tileQuery('by_state', scope, known)],
        explain: ['Every state and territory in the places picked, latest week: flu admissions per 100,000, and the change over three weeks.'],
        draw: ([rows], body) => C.rankTable(body, rows.filter((r) => r.flu_rate_latest !== null).map((r) => ({ id: r.state_code, name: r.state_name, sub: `${n0(r.flu_admissions_latest)} admissions`, value: r.flu_rate_latest, change: r.flu_rate_change_3w })), {
          valueLabel: 'Per 100,000', format: n2, changeLabel: 'In 3 weeks', changeFormat: (v) => Math.abs(v).toFixed(2), good: 'fall', limit: 10, selected: scope.state,
          onOpen: (id) => toggleScope('state', id), href: (id) => linkTo(S.ENTITY.view, id), inCompare, onCompare: toggleCompare,
        }),
        finding: ([rows]) => { const t = rows.filter((r) => r.flu_rate_latest !== null); return [{ b: t[0].state_name }, ` leads with ${n2(t[0].flu_rate_latest)} flu admissions per 100,000 in the latest week.`] },
      })),
    section('Hospitals', 'How full hospitals are, and flu against COVID-19 and RSV.',
      tile({
        title: 'Flu, COVID-19 and RSV admissions', sub: 'New admissions per week, the last two seasons.', cls: 'span-2',
        queries: () => [S.tileQuery('viruses', scope, known)],
        explain: ['New admissions per week for each virus in the places picked.'],
        draw: ([all], body) => {
          const rows = all.slice(-110)
          return C.lines(chartBox(body), rows.map((r) => day(r.week_end, true)), [
            { name: 'Flu', values: rows.map((r) => r.flu_admissions), color: '--c1', width: 2.5 },
            { name: 'COVID-19', values: rows.map((r) => r.covid_admissions), color: '--c2' },
            { name: 'RSV', values: rows.map((r) => r.rsv_admissions), color: '--c3' },
          ], { format: n0, endLabels: true, beginAtZero: true })
        },
        finding: ([rows]) => { const r = rows[rows.length - 1]; return [`In the week ending ${day(r.week_end)}: `, { b: n0(r.flu_admissions) }, ` flu admissions, ${n0(r.covid_admissions)} COVID-19 and ${n0(r.rsv_admissions)} RSV.`] },
        method: 'Reporting was voluntary from May to October 2024, so those weeks undercount; the full record from 2020 is in Records.',
      }),
      tile({
        title: 'Share of beds by virus', sub: 'Patients in hospital with each virus, as a share of staffed beds, the last two seasons.', cls: 'span-2',
        queries: () => [S.tileQuery('beds', scope, known)],
        explain: ['Patients in hospital with flu, COVID-19 and RSV each week, divided by staffed inpatient beds, in the places picked.'],
        draw: ([all], body) => {
          const rows = all.slice(-110)
          return C.lines(chartBox(body), rows.map((r) => day(r.week_end, true)), [
            { name: 'Flu', values: rows.map((r) => r.flu_bed_share), color: '--c1', width: 2.5 },
            { name: 'COVID-19', values: rows.map((r) => r.covid_bed_share), color: '--c2' },
            { name: 'RSV', values: rows.map((r) => r.rsv_bed_share), color: '--c3' },
          ], { format: (v) => share(v, 1), endLabels: true, beginAtZero: true })
        },
        finding: ([rows]) => { const r = rows[rows.length - 1]; return [`In the latest week flu patients filled `, { b: share(r.flu_bed_share, 2) }, ` of staffed beds; all patients together filled ${share(r.bed_occupancy, 1)}.`] },
      })))
}

/** The weekly lines for flu, COVID-19 and RSV from rows with those three fields plus week_end; the last two seasons. */
function virusLines(body, all, fields, fmt) {
  const rows = all.slice(-110)
  const names = [['Flu', '--c1', 2.5], ['COVID-19', '--c2', 1.5], ['RSV', '--c3', 1.5]]
  return C.lines(chartBox(body), rows.map((r) => day(r.week_end)), names.map(([name, color, width], i) => ({ name, color, width, values: rows.map((r) => r[fields[i]]) })), { format: fmt, endLabels: true, beginAtZero: true })
}

function entity() {
  const id = route.id
  const name = S.ENTITY.label(id)
  const skip = S.skipFor(route.view)
  return h('div', { class: 'view wrap' },
    ...viewHead(name, null, [h('a', { href: linkTo('explore'), text: 'Explore' }), ` / ${name}`]),
    h('p', {}, h('button', { class: 'btn', type: 'button', text: inCompare(id) ? 'Open compare' : 'Add to compare', onclick: () => goCompare(inCompare(id) ? picked : [...picked, id]) })),
    tile({
      title: `${name} in the latest week`, cls: 'card--headline',
      queries: () => [S.entityQuery('by_state', id, scope, known), S.viewQuery('by_state', S.DEFAULT_SCOPE, known, skip, 'having: flu_rate_latest is not null')],
      explain: [`${name}'s numbers for the latest week.`, 'Every state and territory with a rate, to rank this one.'],
      draw: ([[r], all], body) => {
        const rank = all.findIndex((x) => x.state_code === id) + 1
        const kpi = (label, value, sub, accent) => h('div', { class: `kpi${accent ? ' kpi--accent' : ''}` }, h('div', { class: 'kpi__label', text: label }), h('div', { class: 'kpi__value', text: value }), h('div', { class: 'kpi__sub' }, ...prose(sub)))
        body.append(h('div', { class: 'kpis' },
          kpi('Flu admissions', n0(r.flu_admissions_latest), ['against ', { b: n0(r.flu_admissions_prior_week) }, ' the week before'], true),
          kpi('Per 100,000 people', n2(r.flu_rate_latest), rank ? ['rank ', { b: String(rank) }, ` of ${all.length}`] : ['no population, so no rate']),
          kpi('Flu share of beds', share(r.flu_bed_share_latest, 2), ['all patients fill ', { b: share(r.bed_occupancy_latest, 1) }]),
          kpi('COVID-19 and RSV', n0(r.covid_admissions_latest), ['COVID-19 admissions; RSV ', { b: n0(r.rsv_admissions_latest) }])))
      },
      finding: ([[r]]) => r.flu_rate_same_week_last_season !== null && r.flu_rate_latest !== null
        ? [{ b: name }, ` admitted ${n2(r.flu_rate_latest)} people per 100,000 with flu in the latest week, against ${n2(r.flu_rate_same_week_last_season)} in the same week last season.`]
        : [{ b: name }, ` had ${n0(r.flu_admissions_latest)} flu admissions in the latest week.`],
      method: 'Counts are what the state\'s hospitals reported; a late report can raise the latest week a little.',
    }),
    h('div', { class: 'grid-2' },
      tile({
        title: 'Flu admissions per 100,000, each week of the season', sub: `${name}, one line per season. Week 1 ends in early October.`, cls: 'span-2',
        queries: () => [S.entityQuery('by_season_week', id, scope, known), `run: ${S.HEADLINE} -> by_season_week`],
        explain: [`${name}'s weekly flu admissions per 100,000 people, one line per season, by week of the season.`, 'The same rate for the US, for the current season.'],
        draw: ([rows], body) => seasonOverlay(body, rows, 'flu_rate', n2),
        finding: ([rows, us]) => {
          const cur = rows[rows.length - 1].season_label
          const at = rows.filter((r) => r.season_label === cur)
          const last = at[at.length - 1]
          const usAt = us.find((r) => r.season_label === cur && r.season_week === last.season_week)
          return ['In week ', { b: String(last.season_week) }, ` of ${cur}, ${name} admitted ${n2(last.flu_rate)} people per 100,000 with flu` + (usAt ? `; the US as a whole, ${n2(usAt.flu_rate)}.` : '.')]
        },
        method: 'Territories without a Census population have no rate, so this chart is empty for them; their counts are in the charts below.',
      }),
      tile({
        title: 'Season so far', sub: 'Flu admissions from week 1 to the same week, each season.',
        queries: () => [S.entityQuery('same_week_by_season', id, scope, known)],
        explain: [`${name}'s flu admissions from the first week of each season through the same week as the latest.`],
        draw: ([rows], body) => toDateBars(body, rows),
        finding: ([rows]) => {
          const cur = rows[rows.length - 1]
          const prev = d3.greatest(rows.slice(0, -1), (r) => r.flu_admissions_to_date)
          return [`${cur.season_label} so far: `, { b: n0(cur.flu_admissions_to_date) }, `; the most at this point before was ${n0(prev.flu_admissions_to_date)}, in ${prev.season_label}.`]
        },
      }),
      tile({
        title: 'Who is admitted, by age', sub: 'Flu admissions so far each season, by age group.',
        queries: () => [S.entityQuery('age_by_season', id, scope, known)],
        explain: [`${name}'s flu admissions by age group through the same week of each season. Ages are reported from 2024-2025.`],
        draw: ([rows], body) => {
          const bands = [['flu_adm_age_0_4', '0–4', '--c5'], ['flu_adm_age_5_17', '5–17', '--c3'], ['flu_adm_age_18_49', '18–49', '--c6'], ['flu_adm_age_50_64', '50–64', '--c4'], ['flu_adm_age_65_74', '65–74', '--c2'], ['flu_adm_age_75_plus', '75+', '--c1']]
          const rs = rows.filter((r) => r.season_label >= '2024-2025')
          return C.stackedShare(chartBox(body), rs.flatMap((r) => bands.map(([f, nm]) => ({ x: r.season_label, part: nm, value: r[f] || 0 }))), bands.map(([, nm, color]) => ({ name: nm, color })))
        },
        finding: ([rows]) => { const r = rows[rows.length - 1]; return [`In ${r.season_label} so far, people 75 and over account for `, { b: n0(r.flu_adm_age_75_plus) }, ` of ${n0(r.flu_admissions)} flu admissions.`] },
        method: 'Admissions with no age reported are left out of the shares.',
      }),
      tile({
        title: 'Flu, COVID-19 and RSV admissions', sub: 'New admissions per week, the last two seasons.', cls: 'span-2',
        queries: () => [S.entityQuery('state_trend', id, scope, known)],
        explain: [`${name}'s new admissions per week for each virus.`],
        draw: ([rows], body) => virusLines(body, rows, ['flu_admissions', 'covid_admissions', 'rsv_admissions'], n0),
        finding: ([rows]) => { const r = rows[rows.length - 1]; return [`In the week ending ${day(r.week_end)}: `, { b: n0(r.flu_admissions) }, ` flu admissions, ${n0(r.covid_admissions)} COVID-19 and ${n0(r.rsv_admissions)} RSV.`] },
        method: 'Reporting was voluntary from May to October 2024, so those weeks undercount.',
      }),
      tile({
        title: 'Share of beds by virus', sub: 'Patients in hospital with each virus, as a share of staffed beds.', cls: 'span-2',
        queries: () => [S.entityQuery('state_trend', id, scope, known)],
        explain: [`${name}'s patients in hospital with flu, COVID-19 and RSV each week, divided by staffed inpatient beds.`],
        draw: ([rows], body) => virusLines(body, rows, ['flu_bed_share', 'covid_bed_share', 'rsv_bed_share'], (v) => share(v, 1)),
        finding: ([rows]) => { const r = rows[rows.length - 1]; return ['Flu patients filled ', { b: share(r.flu_bed_share, 2) }, ` of staffed beds in the latest week; all patients together, ${share(r.bed_occupancy, 1)}.`] },
      })))
}

let recLimit = 50
function records() {
  const cols = [
    ['week_end', 'Week ending', (v) => day(v)], ['state_name', 'State'], ['flu_admissions', 'Flu', n0, true], ['flu_rate', 'Per 100k', n2, true],
    ['covid_admissions', 'COVID-19', n0, true], ['rsv_admissions', 'RSV', n0, true], ['flu_inpatients', 'Flu in hospital', n0, true],
    ['flu_icu_patients', 'Flu in ICU', n0, true], ['beds_total', 'Staffed beds', n0, true], ['hospitals_reporting', 'Hospitals', n0, true],
    ['reporting_period', 'Reporting', (v) => (v === 'Mandatory' ? 'Required' : 'Voluntary')],
  ]
  const t = tile({
    title: 'Every state, every week', sub: 'Newest first. Pick a region or a state above to narrow it.',
    queries: () => [S.viewQuery('records', scope, known, [], `order_by: week_end desc, state_code; limit: ${recLimit}`)],
    explain: ['Each state\'s week: new admissions for each virus, patients in hospital and in intensive care, staffed beds, and hospitals reporting.'],
    draw: ([rows], body) => {
      body.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ...cols.map(([, label, , num]) => h('th', { class: num ? 'num' : '', text: label })))),
        h('tbody', {}, ...rows.map((r) => h('tr', {}, ...cols.map(([f, , fmt, num]) => h('td', { class: num ? 'num' : '' },
          f === 'state_name' ? h('a', { href: linkTo(S.ENTITY.view, r.state_code), text: r.state_name }) : (fmt ? fmt(r[f]) : String(r[f] ?? '–'))))))))),
      h('div', { class: 'pager' },
        h('span', { text: `${rows.length} rows shown${r0(rows) ? `, the oldest from ${day(rows[rows.length - 1].week_end)}` : ''}` }),
        rows.length === recLimit && h('button', { class: 'btn', type: 'button', text: 'Show 50 more', onclick: () => { recLimit += 50; t.__update(t.__spec) } })))
    },
    method: 'Weeks from May to October 2024, when reporting was voluntary, are marked Voluntary in the last column and undercount. A dash means the state did not report that number.',
  })
  return h('div', { class: 'view wrap' }, ...viewHead('Records', 'The weekly rows behind every chart, newest first.'), t)
}
const r0 = (rows) => rows.length > 0

function compare() {
  const ids = route.compare
  const chips = h('div', { class: 'chips' },
    ...ids.map((id) => h('span', { class: 'chip' }, S.ENTITY.label(id),
      h('button', { type: 'button', 'aria-label': `Remove ${S.ENTITY.label(id)}`, text: '×', onclick: () => {
        focusNext = '.chip button'
        goCompare(ids.filter((x) => x !== id), { toTop: false })
      } }))))
  const colours = ['--c1', '--c2', '--c3', '--c4']
  const empty = h('p', { class: 'lede' }, 'Nothing picked yet. ')
  if (!ids.length) query(`run: ${S.SOURCE} -> by_state + { having: flu_rate_latest is not null; order_by: flu_rate_latest desc; limit: 3 }`).then((rows) => {
    empty.append('Start with the three highest rates now: ', h('a', { href: linkTo('compare', null, rows.map((r) => r.state_code)), text: rows.map((r) => r.state_name).join(', ') }), '.')
  })
  return h('div', { class: 'view wrap' },
    ...viewHead('Compare', `Up to ${S.COMPARE_MAX} states side by side. Add one with the + on a ranked list, or from its page.`),
    h('div', { 'data-redraw': 'picks' }, ids.length ? chips : empty),
    ids.length > 0 && h('div', { class: 'grid-2' },
      tile({
        title: 'Flu admissions per 100,000, week by week', sub: 'Last season and this one, one line per state.', cls: 'span-2',
        queries: () => [S.compareQuery('state_weeks', ids, scope, known)],
        explain: ['Weekly flu admissions per 100,000 people for each state picked, last season and this.'],
        draw: ([rows], body) => {
          const weeks = [...new Set(rows.map((r) => String(r.week_end)))].sort()
          const order = ids.filter((id) => rows.some((r) => r.state_code === id))
          return C.lines(chartBox(body), weeks.map((w) => day(w)), order.map((id, i) => {
            const at = new Map(rows.filter((r) => r.state_code === id).map((r) => [String(r.week_end), r.flu_rate]))
            return { name: S.ENTITY.label(id), color: colours[i], values: weeks.map((w) => at.get(w) ?? null) }
          }), { format: n2, endLabels: true, beginAtZero: true })
        },
        finding: ([rows]) => {
          const lastWeek = d3.max(rows, (r) => String(r.week_end))
          const now = rows.filter((r) => String(r.week_end) === lastWeek && r.flu_rate !== null).sort((a, b) => b.flu_rate - a.flu_rate)
          return now.length ? [{ b: now[0].state_name }, ` is highest in the latest week, ${n2(now[0].flu_rate)} per 100,000.`] : ''
        },
      }),
      tile({
        title: 'Now against this week last season', sub: 'Flu admissions per 100,000 in the latest week and the same week last season.',
        queries: () => [S.compareQuery('by_state', ids, scope, known)],
        explain: ['For each state picked: the flu rate per 100,000 at the same week last season and in the latest week.'],
        draw: ([rows], body) => C.dumbbell(chartBox(body), rows.filter((r) => r.flu_rate_latest !== null).map((r) => ({ id: r.state_code, label: r.state_name, a: r.flu_rate_same_week_last_season, b: r.flu_rate_latest })), { aName: 'Last season', bName: 'Now', aColor: '--c-bar', bColor: '--accent', format: n2 }),
        finding: ([rows]) => { const t = rows.filter((r) => r.flu_rate_latest !== null && r.flu_rate_same_week_last_season !== null).sort((a, b) => (b.flu_rate_latest - b.flu_rate_same_week_last_season) - (a.flu_rate_latest - a.flu_rate_same_week_last_season)); return t.length ? [{ b: t[0].state_name }, ` is up most on last season, from ${n2(t[0].flu_rate_same_week_last_season)} to ${n2(t[0].flu_rate_latest)}.`] : '' },
      }),
      tile({
        title: 'Hospital beds now', sub: 'Share of staffed beds holding a flu patient, latest week.',
        queries: () => [S.compareQuery('by_state', ids, scope, known)],
        explain: ['For each state picked: flu patients in hospital divided by staffed beds, in the latest week.'],
        draw: ([rows], body) => C.bars(chartBox(body), rows.map((r) => ({ label: r.state_name, value: r.flu_bed_share_latest })), { horizontal: true, direct: true, format: (v) => share(v, 2) }),
        finding: ([rows]) => { const t = [...rows].sort((a, b) => (b.flu_bed_share_latest ?? -1) - (a.flu_bed_share_latest ?? -1)); return [{ b: t[0].state_name }, `: flu patients fill ${share(t[0].flu_bed_share_latest, 2)} of staffed beds.`] },
      })))
}

function about() {
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener', text })
  return h('div', { class: 'view wrap' },
    ...viewHead('About the data', 'Where the numbers come from, what was reshaped, and what to keep in mind.'),
    h('div', { class: 'prose' },
      h('h2', { text: 'Sources' }),
      h('p', {}, link('https://data.cdc.gov/Public-Health-Surveillance/Weekly-Hospital-Respiratory-Data-HRD-Metrics-by-Ju/ua7e-t2fy', 'Weekly Hospital Respiratory Data (HRD) Metrics by Jurisdiction'), ', from the CDC\'s National Healthcare Safety Network: what hospitals report each week about patients with laboratory-confirmed flu, COVID-19 and RSV, by state, territory and for the US. Public domain (US government work).'),
      h('p', {}, link('https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/', 'State population estimates, Vintage 2025'), ', from the US Census Bureau, for the rates per 100,000. Public domain. Weeks in 2026 use the 2025 estimate.'),
      h('h2', { text: 'What the numbers mean' }),
      h('p', { text: 'Flu admissions are new hospital admissions of patients with a laboratory-confirmed flu test in the week, all ages. Patients in hospital and beds are weekly averages of daily counts, so they are read one week at a time. A rate is admissions per 100,000 residents in a week. A season starts with the week ending in early October; week 1 is that week.' }),
      h('p', { text: 'These are counts of reported admissions, not the CDC\'s modelled estimates of how many people were hospitalized with flu, which correct for testing and reporting and are larger.' }),
      h('h2', { text: 'Caveats' }),
      h('p', { text: 'Hospitals had to report until April 30, 2024 and again from November 1, 2024. Between those dates reporting was voluntary, fewer hospitals reported, and counts are low and not comparable; the Records view marks those weeks. The data is by state and week, not by hospital.' }),
      h('p', { text: 'The latest week can rise a little when late reports arrive. Guam, American Samoa, the Northern Mariana Islands and the US Virgin Islands have no population in the Census file, so they have counts but no rates. Ages were reported only from the 2024-2025 season. The first season in the data, 2019-2020, holds only its last weeks and is left out of season comparisons.' }),
      h('h2', { text: 'Why this app' }),
      h('p', {}, 'Written in response to ', link(ARTICLE.href, ARTICLE.text), ', on an early flu season. Its numbers come from the data above, not from the article. Every chart\'s info mark shows the query behind it and its rows.'),
      h('p', { text: 'An independent app, not produced or endorsed by the CDC or the Census Bureau.' })))
}
function footer() {
  return h('div', {}, h('h2', { text: 'Flu in US hospitals' }), h('p', { text: 'Source: CDC, National Healthcare Safety Network, Weekly Hospital Respiratory Data; US Census Bureau population estimates. An independent app, not produced by the CDC.' }))
}

boot()
