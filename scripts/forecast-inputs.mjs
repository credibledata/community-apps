// What the simulation needs, from a running Publisher (pnpm dev): the races and seat
// arithmetic (elections.malloy) and, for a set of levers, every race's forecast inputs
// (forecast.malloy). Shared by scripts/forecast.mjs and scripts/results.mjs --refreeze, so
// both simulate exactly what the app does.

import { breakdownFromRow, environmentFromRow, prepare } from '../package/public/model.js'
import { BOOT_QUERIES, FORECAST_MODEL, FORECAST_QUERIES, forecastGivens, MODEL } from '../package/public/query.js'

export const PUBLISHER = process.env.PUBLISHER_URL || 'http://localhost:4000'

export async function query(malloy, model = MODEL, givens = null) {
  const url = `${PUBLISHER}/api/v0/environments/elections/packages/midterms2026/models/${model}/query`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ compactJson: true, query: malloy, ...(givens && { givens }) }),
  }).catch(() => {
    throw new Error(`this needs Publisher at ${PUBLISHER}: start it with pnpm dev`)
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`${malloy}\n${json.message}`)
  }
  return JSON.parse(json.result)
}

/** The forecast inputs for `controls` on the snapshot day: { env, breakdowns }. */
export async function loadForecast(controls) {
  const givens = forecastGivens(controls)
  const [rows, [national]] = await Promise.all([
    query(FORECAST_QUERIES.breakdown, FORECAST_MODEL, givens),
    query(FORECAST_QUERIES.national, FORECAST_MODEL, givens),
  ])
  return {
    env: environmentFromRow(national),
    breakdowns: new Map(rows.map((r) => [r.race_id, breakdownFromRow(r)])),
  }
}

/** The races and seat arithmetic, indexed for simulate(), on the snapshot day. */
export async function loadPrep() {
  const [races, chambers, [national]] = await Promise.all([
    query(BOOT_QUERIES.races),
    query(BOOT_QUERIES.chambers),
    query(FORECAST_QUERIES.national, FORECAST_MODEL),
  ])
  return prepare({ races, chambers, polls: [], markets: [] }, national.as_of_day)
}
