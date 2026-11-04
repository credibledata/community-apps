// Every Malloy query the app runs, built from the model's real names (elections.malloy).
// Pure: no DOM. Covered by tests/query.test.mjs.
//
// DESIGN BRIEF (recorded assumption; correct it here):
//   Who: politically curious readers, newsroom data teams, and anyone evaluating Credible as a
//   way to ship a governed, explainable model alongside a public-facing app.
//   Question: who is favoured to win the Senate, House and governorships in 2026, how sure
//   should we be, and why does the model think so?
//   Archetype: Explainer. Leads with chamber odds; maps and the race list drill into a race
//   drawer that decomposes the forecast into named, sourced parts; levers re-run the
//   simulation live; every data panel can show the Malloy that produced it.

export const MODEL = 'elections.malloy'
/** The election-night model (results.html): imports MODEL and adds the count. */
export const RESULTS_MODEL = 'results.malloy'
// Must match publisher.config.json's environment name and this package's name.
export const ENVIRONMENT = 'elections'
export const PACKAGE = 'midterms2026'

/**
 * Where the app POSTs its queries, resolved against the page it is served from, so the same
 * files work under Publisher's four-level path, at "/" behind serve.mjs, and under a
 * load-balancer prefix such as "/elections/". See community/apps/avalanche for the history.
 */
export function queryUrl(pathname, model = MODEL) {
  return modelUrl(pathname, model) + '/query'
}

/** The model itself (GET): its source text, which the methodology page shows each source from. */
export function modelUrl(pathname, model = MODEL) {
  const base = new URL(pathname, 'https://placeholder.invalid')
  const path = `api/v0/environments/${ENVIRONMENT}/packages/${PACKAGE}/models/${encodeURIComponent(model)}`
  // Served by Publisher directly, the page lives at
  //   /api/v0/environments/<env>/packages/<pkg>/... or /environments/<env>/packages/<pkg>/...
  // and the endpoint is absolute; behind serve.mjs it is page-relative.
  if (/\/environments\/[^/]+\/packages\/[^/]+\//.test(base.pathname)) {
    return `/${path}`
  }
  return new URL(`./${path}`, base).pathname
}

export const OFFICES = ['Senate', 'House', 'Governor']
const RACE_ID = /^(SEN|GOV)-[A-Z]{2}(-S)?$|^HOU-[A-Z]{2}-\d{2}$|^US-(SENATE|HOUSE|GENERIC)$/
const GEO_ID = /^[A-Z]{2}(-\d{2})?$/

/** Backslash-escape a value for a Malloy string literal. Malloy does not accept SQL '' doubling. */
export function lit(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export const isRaceId = (s) => typeof s === 'string' && RACE_ID.test(s)
export const isGeoId = (s) => typeof s === 'string' && GEO_ID.test(s)

/**
 * The queries that load the model's inputs, once, at startup. Each entry also names the
 * panel(s) it feeds, which the expanded-tile modal displays alongside its results.
 */
export const BOOT_QUERIES = Object.freeze({
  races: 'run: races -> race_inputs',
  polls: 'run: polls -> poll_rows',
  chambers: 'run: chambers -> { select: * }',
  markets: 'run: kalshi_prices -> weekly',
  approval: 'run: approval -> trend',
  specials: 'run: special_elections -> summary',
  specialList: 'run: special_elections -> list',
  pollsters: 'run: polls -> by_pollster',
  nationalHistory: 'run: historical_results -> national_by_year',
})

/** Everything results.html loads, from RESULTS_MODEL. */
export const RESULTS_QUERIES = Object.freeze({
  races: 'run: results -> latest_races',
  tally: 'run: results -> tally',
  national: 'run: results -> national_vote',
  snapshots: 'run: results -> by_snapshot',
  forecasts: 'run: forecasts -> by_race',
  scenarios: 'run: scenario_fit -> by_scenario',
  scenarioOffices: 'run: scenario_fit -> by_scenario_office',
  forecastChambers: 'run: forecast_chambers -> by_scenario',
  seats: 'run: forecast_seats -> distribution',
  chambers: 'run: chambers -> { select: * }',
  midterms: 'run: house_popular_vote -> midterms',
})

/** Row counts for the "Data sources" section. */
export const INVENTORY_QUERIES = Object.freeze({
  geographies: 'run: geographies -> { aggregate: geography_count, total_population }',
  historical_results: 'run: historical_results -> { aggregate: results, votes_cast }',
  races: 'run: races -> { aggregate: race_count, competitive_races }',
  polls: 'run: polls -> { aggregate: poll_count, latest_poll }',
  pollsters: 'run: pollsters -> { aggregate: n is count() }',
  kalshi_prices: 'run: kalshi_prices -> { aggregate: days_traded, total_volume_usd, last_date }',
  approval: 'run: approval -> { aggregate: n is count(), avg_net_approval }',
  special_elections: 'run: special_elections -> summary',
})

/** Methodology: a few rows of every dimension on a source. */
export function sampleQuery(source, n = 8) {
  if (!/^\w+$/.test(source)) {
    throw new Error(`Bad source: ${source}`)
  }
  return `run: ${source} -> { select: * limit: ${n} }`
}

/**
 * One source's definition as written in the model, from `source:` to its closing brace.
 * Its leading #(doc) is left out: the page already says what the source is.
 */
export function sourceBlock(modelText, source) {
  const lines = modelText.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((l) => new RegExp(`^source:\\s*${source}\\s+is\\b`).test(l))
  if (start < 0) {
    return null
  }
  if (!/\{\s*$/.test(lines[start])) {
    return lines[start]
  }
  const end = lines.findIndex((l, i) => i > start && l === '}')
  return lines.slice(start, end < 0 ? undefined : end + 1).join('\n')
}

/** One view's definition as written in the model (`view: name is { ... }`), dedented. */
export function viewBlock(modelText, source, view) {
  const lines = (sourceBlock(modelText, source) ?? '').split('\n')
  const start = lines.findIndex((l) => new RegExp(`^\\s*view:\\s*${view}\\s+is\\b`).test(l))
  if (start < 0) {
    return null
  }
  const indent = lines[start].match(/^ */)[0]
  const end = /\}\s*$/.test(lines[start]) ? start : lines.findIndex((l, i) => i > start && l === `${indent}}`)
  return lines
    .slice(start, end < 0 ? undefined : end + 1)
    .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
    .join('\n')
}

/** Drawer: the full results history for one geography (a state or a district). */
export function historyQuery(geoId) {
  if (!isGeoId(geoId)) {
    throw new Error(`Bad geography: ${geoId}`)
  }
  return `run: historical_results -> timeline + { where: geo_id = ${lit(geoId)} }`
}

/** Drawer: the daily market series for one race. */
export function marketQuery(raceId) {
  if (!isRaceId(raceId)) {
    throw new Error(`Bad race: ${raceId}`)
  }
  return `run: kalshi_prices -> daily + { where: race_id = ${lit(raceId)} }`
}

/** Drawer: demographics of the race's geography next to its state and the nation. */
export function demographicsQuery(geoId) {
  if (!isGeoId(geoId)) {
    throw new Error(`Bad geography: ${geoId}`)
  }
  const state = geoId.slice(0, 2)
  return `run: geographies -> {
  where: geo_id = ${lit(geoId)} | ${lit(state)}
  group_by: geo_id, name, kind, population, pct_white, pct_black, pct_hispanic, pct_asian, pct_college, median_age, median_income_k
  order_by: kind desc
}`
}

// ---- Linkable state: #office=Senate&race=SEN-GA&envShift=2 --------------------------------
export function stateToHash(view, controls, defaults) {
  const p = new URLSearchParams()
  if (view.office && view.office !== 'Senate') {
    p.set('office', view.office)
  }
  if (view.race) {
    p.set('race', view.race)
  }
  for (const [k, v] of Object.entries(controls)) {
    if (v !== defaults[k]) {
      p.set(k, String(Math.round(v * 100) / 100))
    }
  }
  const s = p.toString()
  return s ? `#${s}` : ''
}

/** Parse a user-editable hash. Unknown keys and values fall back to defaults. */
export function hashToState(hash, defaults) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''))
  const office = OFFICES.includes(p.get('office')) ? p.get('office') : 'Senate'
  const race = isRaceId(p.get('race')) ? p.get('race') : null
  const controls = { ...defaults }
  for (const k of Object.keys(defaults)) {
    if (p.has(k)) {
      const v = Number(p.get(k))
      if (Number.isFinite(v)) {
        controls[k] = v
      }
    }
  }
  return { view: { office, race }, controls }
}
