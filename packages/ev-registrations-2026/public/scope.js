// Every query the app runs, and its address, are built here. No DOM code: test it with node.
// Adapted from reference/scope-module.md for two sources: `registrations` (every fuel, for the EV share) and
// `ev_records` (one row per EV, for makes, body types and records).

export const MODEL = 'index.malloy'
export const REG = 'registrations'
export const EV = 'ev_records'
// The headline question's scope lives in the model as sources of its own, so the Overview, the Credible agent and an
// analyst asking the model get the same numbers: passenger cars only. The app adds no filter to them.
export const HEADLINE = 'passenger_cars'
export const HEADLINE_EV = 'passenger_evs'

export const VIEWS = ['overview', 'explore', 'records', 'compare', 'about']
export const ENTITY = { view: 'county', field: 'county_name', label: (id) => id }
export const COMPARE_MAX = 4

// The value of `group` that means "every registration class": no filter.
export const ALL_GROUPS = 'All vehicles'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2025-09' (or a timestamp starting so) -> 'Sep 2025' */
export const monthLabel = (v) => {
  const [y, m] = String(v).slice(0, 7).split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}

// One entry per scope key. `sources` lists the sources whose fields it filters; the other source ignores it.
//   pick: field = one value from known[key]; month: the month field = a month from known.month ('YYYY-MM')
export const SCOPE = {
  group: { type: 'pick', field: 'vehicle_group', label: (v) => v, word: 'Showing', sources: [REG, EV] },
  period: { type: 'pick', field: 'credit_period', label: (v) => v, word: 'in months', sources: [REG, EV] },
  month: { type: 'month', field: 'reg_month', label: (v) => monthLabel(v), word: 'in', sources: [REG, EV] },
  region: { type: 'pick', field: 'region', label: (v) => v, word: 'from', sources: [REG, EV] },
  county: { type: 'pick', field: 'county_name', label: (v) => v, word: 'in county', sources: [REG, EV] },
  make: { type: 'pick', field: 'make_name', label: (v) => v, word: 'make', sources: [EV] },
  body: { type: 'pick', field: 'body_type', label: (v) => v, word: 'body', sources: [EV] },
}

// The app opens on passenger cars: the class the headline share is defined on.
export const DEFAULT_SCOPE = Object.freeze({ group: 'Passenger cars', period: null, month: null, region: null, county: null, make: null, body: null })

/** A Malloy string literal. Malloy escapes with a backslash; it does not accept SQL's doubled quote. */
export function lit(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

function valid(key, v, known) {
  if (v === null || v === undefined) return false
  return (known[key] || []).includes(v)
}

const isEntity = (id, known) => (known.entity || []).includes(id)

/** The scope as Malloy filter expressions for `source`, leaving out the keys in `ignore`. */
export function scopeClauses(source, scope, known, ignore = []) {
  const out = []
  for (const [key, spec] of Object.entries(SCOPE)) {
    if (ignore.includes(key) || !spec.sources.includes(source) || !valid(key, scope[key], known)) continue
    if (key === 'group' && scope[key] === ALL_GROUPS) continue
    // A month is checked against known.month ('YYYY-MM') above, so it is safe to write as a literal.
    if (spec.type === 'month') out.push(`${spec.field} = @${scope[key]}`)
    else out.push(`${spec.field} = ${lit(scope[key])}`)
  }
  return out
}

/** The scope keys that are set but that `source` cannot filter by: a card on it says it ignores them. */
export function ignoredKeys(source, scope, known) {
  return Object.entries(SCOPE)
    .filter(([key, spec]) => !spec.sources.includes(source) && valid(key, scope[key], known))
    .map(([key]) => key)
}

function refine(clauses, extra) {
  // Malloy drops a view's order_by when a refinement adds a limit, so the rows would come back in another order.
  if (/\blimit\s*:/.test(extra) && !/\border_by\s*:/.test(extra)) throw new Error(`A limit needs its order_by beside it: ${extra}`)
  const parts = []
  if (clauses.length) parts.push(`where: ${clauses.join(' and ')}`)
  if (extra) parts.push(extra)
  return parts.length ? ` + { ${parts.join('; ')} }` : ''
}

/** run: <source> -> <view> + { where: <scope>; <extra> } */
export function viewQuery(source, view, scope, known, ignore = [], extra = '') {
  return `run: ${source} -> ${view}${refine(scopeClauses(source, scope, known, ignore), extra)}`
}

/** One county's query: the view, refined by the county and the rest of the scope (its own county key ignored). */
export function entityQuery(source, view, id, scope, known, extra = '', ignore = []) {
  if (!isEntity(id, known)) throw new Error(`Unknown ${ENTITY.view}: ${id}`)
  const clauses = [`${ENTITY.field} = ${lit(id)}`, ...scopeClauses(source, scope, known, ['county', 'region', ...ignore])]
  return `run: ${source} -> ${view}${refine(clauses, extra)}`
}

/** Several counties side by side: the view refined to the ids being compared. */
export function compareQuery(source, view, ids, scope, known, extra = '') {
  const ok = ids.filter((id) => isEntity(id, known)).slice(0, COMPARE_MAX)
  if (!ok.length) throw new Error('Nothing to compare')
  const clauses = [`(${ok.map((id) => `${ENTITY.field} = ${lit(id)}`).join(' or ')})`, ...scopeClauses(source, scope, known, ['county', 'region'])]
  return `run: ${source} -> ${view}${refine(clauses, extra)}`
}

/** Build an address. `route` is { view, id, compare }. Default scope values are left out. */
export function buildHash(route, scope) {
  const p = new URLSearchParams()
  for (const key of Object.keys(SCOPE)) {
    const v = scope[key]
    if (v === null || v === undefined || v === DEFAULT_SCOPE[key]) continue
    p.set(key, String(v))
  }
  if (route.view === 'compare' && route.compare?.length) p.set('ids', route.compare.join(','))
  const path = route.view === ENTITY.view ? `${ENTITY.view}/${encodeURIComponent(route.id)}` : route.view
  const q = p.toString()
  return `#/${path === 'overview' ? '' : path}${q ? `?${q}` : ''}`
}

/** Read an address someone may have edited by hand. Anything not in `known` falls back to the default. */
export function parseHash(hash, known) {
  const raw = String(hash || '').replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const [view, id] = path.split('/').map((s) => (s === undefined ? s : decodeURIComponent(s)))
  let route = { view: 'overview', id: null, compare: [] }
  if (view === ENTITY.view && isEntity(id, known)) route = { view, id, compare: [] }
  else if (VIEWS.includes(view)) route = { view, id: null, compare: [] }
  const p = new URLSearchParams(query)
  if (route.view === 'compare') {
    route.compare = [...new Set((p.get('ids') || '').split(','))].filter((x) => isEntity(x, known)).slice(0, COMPARE_MAX)
  }
  const scope = { ...DEFAULT_SCOPE }
  for (const key of Object.keys(SCOPE)) {
    if (!p.has(key)) continue
    const v = p.get(key)
    if (valid(key, v, known)) scope[key] = v
  }
  return { route, scope }
}

/** One chip per scope key set away from its default, with the patch that clears it. */
export function scopeChips(scope) {
  return Object.entries(SCOPE)
    .filter(([key]) => scope[key] !== null && scope[key] !== DEFAULT_SCOPE[key])
    .map(([key, spec]) => ({ key, label: spec.label(scope[key]), clear: { [key]: DEFAULT_SCOPE[key] } }))
}
