// Every query the app runs is built here, from the model's real names (avalanche.malloy).
// Pure: no DOM. Covered by tests/query.test.mjs.
//
// DESIGN BRIEF (recorded assumption; correct it here):
//   Who: backcountry travellers, avalanche educators, forecasters-in-training.
//   Question: when, where and on what terrain do Colorado avalanches happen, and what is
//   different about the ones people trigger?
//   Archetype: Explorer. Leads with avalanches in scope, % human-triggered, % D2+ and
//   incident observations; every tile cross-filters through one shared scope (chips + URL hash);
//   zones open a drawer backed by the parameterised `zone_detail` source.

export const MODEL = 'avalanche.malloy'

export const SOURCE = 'avalanche_observations'

export const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const ELEVATIONS = ['Above treeline', 'Near treeline', 'Below treeline']
// The model's `trigger` groups, in display order. Validated against the live distinct list too.
export const TRIGGERS = [
  'Natural',
  'Skier / rider',
  'Snowmobile',
  'Hiker / climber',
  'Other human',
  'Explosives',
  'Unknown',
]
export const HUMAN_TRIGGERS = new Set([
  'Skier / rider',
  'Snowmobile',
  'Hiker / climber',
  'Other human',
])

export const RELIABLE_FROM = 2011

export const DEFAULT_STATE = Object.freeze({
  from: RELIABLE_FROM,
  to: null,
  zone: null,
  trigger: null,
  problem: null,
  aspect: null,
  elevation: null,
  people: false,
  big: false,
})

/** Backslash-escape a value for a Malloy string literal. Malloy does not accept SQL '' doubling. */
export function lit(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * Turn scope into Malloy filter expressions. Every value is checked against a known set
 * (`known` comes from distinct-value queries against the model) before it reaches the query.
 * `ignore` lists the scope keys a tile must not filter itself by.
 */
export function scopeClauses(state, known, ignore = []) {
  const skip = new Set(ignore)
  const out = []
  const seasonOk = (n) =>
    Number.isInteger(n) && n >= known.minSeason && n <= known.maxSeason
  if (!skip.has('season')) {
    if (seasonOk(state.from)) {
      out.push(`season >= ${state.from}`)
    }
    if (seasonOk(state.to)) {
      out.push(`season <= ${state.to}`)
    }
  }
  if (!skip.has('zone') && state.zone && known.zones.includes(state.zone)) {
    out.push(`forecast_zone = ${lit(state.zone)}`)
  }
  if (
    !skip.has('trigger') &&
    state.trigger &&
    known.triggers.includes(state.trigger)
  ) {
    out.push(`trigger = ${lit(state.trigger)}`)
  }
  if (
    !skip.has('problem') &&
    state.problem &&
    known.problems.includes(state.problem)
  ) {
    out.push(`avalanche_problem = ${lit(state.problem)}`)
  }
  if (!skip.has('aspect') && ASPECTS.includes(state.aspect)) {
    out.push(`slope_aspect = ${lit(state.aspect)}`)
  }
  if (!skip.has('elevation') && ELEVATIONS.includes(state.elevation)) {
    out.push(`elevation = ${lit(state.elevation)}`)
  }
  if (!skip.has('people') && state.people === true) {
    out.push('involved_people')
  }
  if (!skip.has('big') && state.big === true) {
    out.push('is_dangerous_size')
  }
  return out
}

function refinement(clauses, extra) {
  const parts = []
  if (clauses.length) {
    parts.push(`where: ${clauses.join(' and ')}`)
  }
  if (extra) {
    parts.push(extra)
  }
  return parts.length ? ` + { ${parts.join('; ')} }` : ''
}

/** `run: avalanche_observations -> <view> + { where: <scope> }` */
export function viewQuery(view, state, known, ignore = [], extra = '') {
  return `run: ${SOURCE} -> ${view}${refinement(scopeClauses(state, known, ignore), extra)}`
}

/** The zone drawer: the parameterised source, with the rest of the scope applied (zone is the parameter). */
export function zoneQuery(zone, view, state, known, extra = '') {
  if (!known.zones.includes(zone)) {
    throw new Error(`Unknown zone: ${zone}`)
  }
  const clauses = scopeClauses(state, known, ['zone'])
  return `run: zone_detail(zone_name is ${lit(zone)}) -> ${view}${refinement(clauses, extra)}`
}

// Tiles as data. `ignore` = the scope keys this tile sets itself, so clicking it does not
// collapse it to one bar; it highlights the selection instead.
export const TILES = {
  kpis: { view: 'kpis', ignore: [] },
  spark: { view: 'by_season', ignore: ['season'] },
  rose: { view: 'rose', ignore: ['aspect', 'elevation'] },
  calendar: { view: 'calendar', ignore: ['season'] },
  map: { view: 'map_grid', ignore: [] },
  zones: { view: 'by_zone', ignore: ['zone'] },
  triggers: { view: 'trigger_mix', ignore: ['trigger'] },
  sizes: { view: 'size_by_trigger', ignore: ['trigger', 'big'] },
  problems: { view: 'problem_by_month', ignore: ['problem'] },
  crown: { view: 'crown_by_problem', ignore: ['problem'] },
  table: { view: 'observation_list', ignore: [] },
}

export function tileQuery(id, state, known) {
  const t = TILES[id]
  if (!t) {
    throw new Error(`Unknown tile: ${id}`)
  }
  return viewQuery(t.view, state, known, t.ignore)
}

// ---- Linkable state: #from=2015&to=2020&zone=Aspen&people=1 -------------------------------
const KEYS = [
  'from',
  'to',
  'zone',
  'trigger',
  'problem',
  'aspect',
  'elevation',
  'people',
  'big',
  'drawer',
]

export function stateToHash(state, drawerZone = null) {
  const p = new URLSearchParams()
  for (const k of KEYS) {
    const v = k === 'drawer' ? drawerZone : state[k]
    if (v === null || v === undefined || v === false) {
      continue
    }
    if (k === 'from' && v === DEFAULT_STATE.from) {
      continue // omit defaults
    }
    p.set(k, v === true ? '1' : String(v))
  }
  const s = p.toString()
  return s ? `#${s}` : ''
}

/** Parse a user-editable hash. Anything not in a known set falls back to the default. */
export function hashToState(hash, known) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''))
  const st = { ...DEFAULT_STATE }
  const int = (v) => (v !== null && /^\d{4}$/.test(v) ? Number(v) : null)
  const inRange = (n) =>
    n !== null && n >= known.minSeason && n <= known.maxSeason
  if (p.has('from')) {
    const n = int(p.get('from'))
    st.from = inRange(n) ? n : DEFAULT_STATE.from
  }
  if (p.has('to')) {
    const n = int(p.get('to'))
    st.to = inRange(n) ? n : null
  }
  if (st.from !== null && st.to !== null && st.from > st.to) {
    ;[st.from, st.to] = [st.to, st.from]
  }
  const pick = (k, list) => {
    const v = p.get(k)
    return v !== null && list.includes(v) ? v : null
  }
  st.zone = pick('zone', known.zones)
  st.trigger = pick('trigger', known.triggers)
  st.problem = pick('problem', known.problems)
  st.aspect = pick('aspect', ASPECTS)
  st.elevation = pick('elevation', ELEVATIONS)
  st.people = p.get('people') === '1'
  st.big = p.get('big') === '1'
  const drawer = pick('drawer', known.zones)
  return { state: st, drawer }
}

/** Human-readable chips for the active scope, each with the keys its X clears. */
export function scopeChips(state, seasonLabel) {
  const chips = []
  if (state.from !== DEFAULT_STATE.from || state.to !== null) {
    const a = state.from === null ? 'all' : seasonLabel(state.from)
    const b = state.to === null ? 'now' : seasonLabel(state.to)
    chips.push({
      label: state.from === state.to ? `Season ${a}` : `Seasons ${a} → ${b}`,
      clear: { from: DEFAULT_STATE.from, to: null },
    })
  }
  if (state.zone) {
    chips.push({ label: `Zone: ${state.zone}`, clear: { zone: null } })
  }
  if (state.trigger) {
    chips.push({ label: `Trigger: ${state.trigger}`, clear: { trigger: null } })
  }
  if (state.problem) {
    chips.push({ label: `Problem: ${state.problem}`, clear: { problem: null } })
  }
  if (state.aspect) {
    chips.push({ label: `Aspect: ${state.aspect}`, clear: { aspect: null } })
  }
  if (state.elevation) {
    chips.push({ label: state.elevation, clear: { elevation: null } })
  }
  if (state.people) {
    chips.push({ label: 'People involved', clear: { people: false } })
  }
  if (state.big) {
    chips.push({ label: 'D2 and larger', clear: { big: false } })
  }
  return chips
}
