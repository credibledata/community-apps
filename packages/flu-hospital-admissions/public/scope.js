export const MODEL = 'index.malloy'
// The record-grain source: one row per state or territory per week.
export const SOURCE = 'states'
// The headline question's source: the US total. The Overview runs its views bare, with no filter added here.
export const HEADLINE = 'national'

export const VIEWS = ['overview', 'explore', 'records', 'compare', 'about']
// The entity is a state (or territory), by its postal code; known.names maps a code to its name.
export const names = {}
export const ENTITY = { view: 'state', field: 'state_code', label: (id) => names[id] || id }
export const COMPARE_MAX = 4

export const SCOPE = {
  region: { type: 'pick', field: 'region', label: (v) => v, word: 'in the' },
  state: { type: 'pick', field: 'state_code', label: (v) => names[v] || v, word: 'and' },
}

export const ENTITY_KEYS = Object.keys(SCOPE).filter((key) => SCOPE[key].field === ENTITY.field)
export const skipFor = (view) => (view === ENTITY.view || view === 'compare' ? ENTITY_KEYS : [])

export const DEFAULT_SCOPE = Object.freeze(
  Object.fromEntries(Object.entries(SCOPE).map(([k, s]) => [k, s.type === 'flag' ? false : null]))
)

// One entry per tile. `ignore` lists the scope keys the tile sets itself when clicked.
export const TILES = {
  seasons: { view: 'by_season_week', ignore: [] },
  to_date: { view: 'same_week_by_season', ignore: [] },
  regions: { view: 'by_region', ignore: ['region', 'state'] },
  by_state: { view: 'by_state', ignore: ['state'] },
  viruses: { view: 'weekly_trend', ignore: [] },
  beds: { view: 'beds_trend', ignore: [] },
  ages: { view: 'age_by_season', ignore: [] },
  records: { view: 'records', ignore: [] },
}

/** A Malloy string literal. Malloy escapes with a backslash; it does not accept SQL's doubled quote. */
export function lit(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

function valid(key, v, known) {
  const spec = SCOPE[key]
  if (spec.type === 'flag') return v === true
  if (v === null || v === undefined) return false
  if (spec.type === 'pick') return (known[key] || []).includes(v)
  const [lo, hi] = known[spec.range] || []
  return Number.isInteger(v) && v >= lo && v <= hi
}

const isEntity = (id, known) => (known.entity || []).includes(id)

/** The scope as Malloy filter expressions, leaving out the keys in `ignore`. */
export function scopeClauses(scope, known, ignore = []) {
  const out = []
  for (const [key, spec] of Object.entries(SCOPE)) {
    if (ignore.includes(key) || !valid(key, scope[key], known)) continue
    if (spec.type === 'pick') out.push(`${spec.field} = ${lit(scope[key])}`)
    else if (spec.type === 'from') out.push(`${spec.field} >= ${scope[key]}`)
    else if (spec.type === 'to') out.push(`${spec.field} <= ${scope[key]}`)
    else out.push(spec.field)
  }
  return out
}

function refine(clauses, extra) {
  // A refinement that adds a limit can drop the view's order (Publisher before 0.11): give the order beside it.
  if (/\blimit\s*:/.test(extra) && !/\border_by\s*:/.test(extra)) throw new Error(`A limit needs its order_by beside it: ${extra}`)
  const parts = []
  if (clauses.length) parts.push(`where: ${clauses.join(' and ')}`)
  if (extra) parts.push(extra)
  return parts.length ? ` + { ${parts.join('; ')} }` : ''
}

/** run: <source> -> <view> + { where: <scope>; <extra> } */
export function viewQuery(view, scope, known, ignore = [], extra = '') {
  return `run: ${SOURCE} -> ${view}${refine(scopeClauses(scope, known, ignore), extra)}`
}

export function tileQuery(id, scope, known, extra = '', skip = []) {
  const t = TILES[id]
  if (!t) throw new Error(`Unknown tile: ${id}`)
  return viewQuery(t.view, scope, known, [...t.ignore, ...skip], extra)
}

/** One entity's query: the same view, refined by the entity and the rest of the scope. */
export function entityQuery(view, id, scope, known, extra = '') {
  if (!isEntity(id, known)) throw new Error(`Unknown ${ENTITY.view}: ${id}`)
  const clauses = [`${ENTITY.field} = ${lit(id)}`, ...scopeClauses(scope, known, ENTITY_KEYS)]
  return `run: ${SOURCE} -> ${view}${refine(clauses, extra)}`
}

/** Several entities side by side: the view grouped by the entity, limited to the ids being compared. */
export function compareQuery(view, ids, scope, known, extra = '') {
  const ok = ids.filter((id) => isEntity(id, known)).slice(-COMPARE_MAX)
  if (!ok.length) throw new Error('Nothing to compare')
  // In brackets: Malloy reads `a = 'x' | 'y' and b = 'z'` as `a = 'x' | ('y' and b = 'z')`, which it refuses.
  const clauses = [`(${ENTITY.field} = ${ok.map(lit).join(' | ')})`, ...scopeClauses(scope, known, ENTITY_KEYS)]
  return `run: ${SOURCE} -> ${view}${refine(clauses, extra)}`
}


/** Build an address. `route` is { view, id, compare }. Default scope values are left out. */
export function buildHash(route, scope) {
  const p = new URLSearchParams()
  for (const key of Object.keys(SCOPE)) {
    const v = scope[key]
    if (v === null || v === undefined || v === false) continue
    p.set(key, v === true ? '1' : String(v))
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
    route.compare = [...new Set((p.get('ids') || '').split(','))].filter((x) => isEntity(x, known)).slice(-COMPARE_MAX)
  }
  const scope = { ...DEFAULT_SCOPE }
  for (const [key, spec] of Object.entries(SCOPE)) {
    if (!p.has(key)) continue
    const s = p.get(key)
    const v = spec.type === 'flag' ? s === '1' : spec.type === 'pick' ? s : /^-?\d+$/.test(s) ? Number(s) : null
    if (valid(key, v, known)) scope[key] = v
  }
  const from = Object.keys(SCOPE).find((k) => SCOPE[k].type === 'from')
  const to = Object.keys(SCOPE).find((k) => SCOPE[k].type === 'to')
  if (from && to && scope[from] !== null && scope[to] !== null && scope[from] > scope[to]) {
    ;[scope[from], scope[to]] = [scope[to], scope[from]]
  }
  return { route, scope }
}

/** One chip per active scope key, with the patch that clears it. */
export function scopeChips(scope, skip = []) {
  return Object.entries(SCOPE)
    .filter(([key, spec]) => !skip.includes(key) && (spec.type === 'flag' ? scope[key] === true : scope[key] !== null))
    .map(([key, spec]) => ({ key, label: spec.label(scope[key]), clear: { [key]: DEFAULT_SCOPE[key] } }))
}
