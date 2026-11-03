// The release gate for package/data/*.parquet: the files must match the schema contract,
// join cleanly, count the 2026 map correctly, stay in range, contain nothing dated after the
// snapshot, and reproduce a few certified results. Any failure exits non-zero.
//
//   node scripts/validate-data.mjs        (also run at the end of the build and by pnpm test)

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { DuckDBInstance } from '@duckdb/node-api'
import { SCHEMA } from './data/schema.mjs'

const DATA = new URL('../package/data/', import.meta.url)

// Certified results (D minus R, points) the build must reproduce within 0.3.
const CERTIFIED = [
  ['US', 2024, -1.5],
  ['US', 2020, 4.5],
  ['PA', 2024, -1.7],
  ['GA', 2024, -2.2],
  ['WI', 2024, -0.9],
]

export async function validate({ asOf } = {}) {
  asOf ??= JSON.parse(readFileSync(new URL('build-info.json', DATA), 'utf8')).as_of
  const db = await (await DuckDBInstance.create(':memory:')).connect()
  const failures = []
  const rows = async (sql) => (await db.runAndReadAll(sql)).getRowObjectsJson()
  const one = async (sql) => Object.values((await rows(sql))[0] ?? {})[0]
  const check = async (label, sql) => {
    const n = Number(await one(sql))
    if (n !== 0) {
      failures.push(`${label}: ${n}`)
    }
  }

  for (const table of Object.keys(SCHEMA)) {
    const file = new URL(`${table}.parquet`, DATA).pathname
    if (!existsSync(file)) {
      failures.push(`missing ${table}.parquet`)
      continue
    }
    await db.run(`CREATE VIEW ${table} AS SELECT * FROM '${file}'`)
    const got = (await rows(`DESCRIBE ${table}`)).map((r) => `${r.column_name} ${r.column_type}`)
    const want = SCHEMA[table].map(([c, t]) => `${c} ${t}`)
    if (got.join(',') !== want.join(',')) {
      failures.push(`${table} schema: got [${got.join(', ')}], want [${want.join(', ')}]`)
    }
    if (Number(await one(`SELECT count(*) FROM ${table}`)) === 0) {
      failures.push(`${table} is empty`)
    }
  }
  if (failures.length) {
    return report(failures)
  }
  const stray = readdirSync(DATA).filter((f) => f.endsWith('.csv'))
  if (stray.length) {
    failures.push(`stray CSVs in package/data: ${stray.join(', ')}`)
  }

  // Keys: unique, and every reference resolves.
  for (const [t, k] of [
    ['geographies', 'geo_id'],
    ['races', 'race_id'],
    ['polls', 'poll_id'],
    ['pollsters', 'pollster'],
    ['chambers', 'chamber'],
    ['kalshi_prices', "market_ticker || price_date"],
    ['approval', 'approval_date'],
    ['historical_results', "election_year || office || geo_id"],
  ]) {
    await check(`duplicate ${t} keys`, `SELECT count(*) - count(DISTINCT ${k}) FROM ${t}`)
  }
  await check('races without a geography', 'SELECT count(*) FROM races WHERE geo_id NOT IN (SELECT geo_id FROM geographies)')
  await check('polls for unknown races', "SELECT count(*) FROM polls WHERE race_id <> 'US-GENERIC' AND race_id NOT IN (SELECT race_id FROM races)")
  await check('polls by unknown pollsters', 'SELECT count(*) FROM polls WHERE pollster NOT IN (SELECT pollster FROM pollsters)')
  await check('markets for unknown races', "SELECT count(*) FROM kalshi_prices WHERE race_id NOT IN ('US-SENATE', 'US-HOUSE') AND race_id NOT IN (SELECT race_id FROM races)")
  await check('results for unknown geographies', "SELECT count(*) FROM historical_results WHERE geo_id <> 'US' AND geo_id NOT IN (SELECT geo_id FROM geographies)")
  await check('markets without exactly one latest day', 'SELECT count(*) FROM (SELECT market_ticker FROM kalshi_prices GROUP BY 1 HAVING count(*) FILTER (WHERE is_latest) <> 1)')
  await check('polls of decided (same-party) races', 'SELECT count(*) FROM polls p JOIN races r USING (race_id) WHERE r.locked_party IS NOT NULL')

  // The 2026 map.
  await check('House races != 435', "SELECT abs(count(*) - 435) FROM races WHERE office = 'House'")
  await check('House districts != 435', "SELECT abs(count(*) - 435) FROM geographies WHERE kind = 'district'")
  await check('states != 50', "SELECT abs(count(*) - 50) FROM geographies WHERE kind = 'state'")
  await check('Senate races != 35 (33 Class 2 + 2 specials)', "SELECT abs(count(*) - 35) FROM races WHERE office = 'Senate'")
  await check('Senate specials != 2', "SELECT abs(count(*) - 2) FROM races WHERE office = 'Senate' AND is_special")
  await check('governor races != 36', "SELECT abs(count(*) - 36) FROM races WHERE office = 'Governor'")
  await check('House districts not numbered 1..n per state', `
    SELECT count(*) FROM (SELECT state, count(*) n, min(district_number) lo, max(district_number) hi
      FROM geographies WHERE kind = 'district' GROUP BY 1) WHERE lo <> 1 OR hi <> n`)
  await check('seat arithmetic (not up + up != current)', `
    SELECT count(*) FROM chambers c WHERE chamber <> 'House' AND (
      dem_seats_not_up + (SELECT count(*) FROM races r WHERE r.office = c.chamber AND incumbent_party = 'D') <> dem_seats_current OR
      rep_seats_not_up + (SELECT count(*) FROM races r WHERE r.office = c.chamber AND incumbent_party = 'R') <> rep_seats_current)`)
  await check('chamber holdings exceed seats', 'SELECT count(*) FROM chambers WHERE dem_seats_current + rep_seats_current > total_seats')
  await check('majority rule inconsistent', 'SELECT count(*) FROM chambers WHERE dem_needs + rep_needs NOT IN (total_seats + 1, total_seats + 2)')
  await check('races without a 2024 presidential margin', 'SELECT count(*) FROM races r JOIN geographies g USING (geo_id) WHERE g.pres_2024 IS NULL')
  await check('ratings outside the seven categories', `
    SELECT count(*) FROM races WHERE expert_rating IS NOT NULL AND expert_rating NOT IN
      ('Solid D', 'Likely D', 'Lean D', 'Toss-up', 'Lean R', 'Likely R', 'Solid R')`)
  await check('one-sided fundraising', 'SELECT count(*) FROM races WHERE (dem_raised_m IS NULL) <> (rep_raised_m IS NULL)')
  await check('redrawn districts with old-line demographics', 'SELECT count(*) FROM geographies WHERE redrawn_for_2026 AND pct_college IS NOT NULL')

  // Ranges.
  for (const [t, cols] of [
    ['geographies', ['pct_white', 'pct_black', 'pct_hispanic', 'pct_asian', 'pct_college']],
    ['historical_results', ['dem_pct', 'rep_pct', 'other_pct']],
    ['polls', ['dem_pct', 'rep_pct', 'undecided_pct']],
    ['approval', ['approve_pct', 'disapprove_pct']],
  ]) {
    for (const c of cols) {
      await check(`${t}.${c} outside 0-100`, `SELECT count(*) FROM ${t} WHERE ${c} < 0 OR ${c} > 100`)
    }
  }
  await check('poll shares over 100 (beyond rounding)', 'SELECT count(*) FROM polls WHERE dem_pct + rep_pct > 101.5')
  await check('approval shares over 100', 'SELECT count(*) FROM approval WHERE approve_pct + disapprove_pct > 100.5')
  await check('prices outside 0-1', 'SELECT count(*) FROM kalshi_prices WHERE yes_price <= 0 OR yes_price >= 1')
  await check('non-positive sample sizes', 'SELECT count(*) FROM polls WHERE sample_size IS NULL OR sample_size <= 0')
  await check('house effects beyond 15 points', 'SELECT count(*) FROM pollsters WHERE abs(house_effect) > 15')
  await check('polls ending before they start', 'SELECT count(*) FROM polls WHERE end_date < start_date')
  await check('specials with no margin', 'SELECT count(*) FROM special_elections WHERE result_margin IS NULL OR pres_2024_margin IS NULL')

  // No leakage: nothing after the snapshot, so the weekly re-runs only see data that existed.
  for (const [t, c] of [
    ['polls', 'end_date'],
    ['kalshi_prices', 'price_date'],
    ['approval', 'approval_date'],
    ['special_elections', 'election_date'],
  ]) {
    await check(`${t} rows after ${asOf}`, `SELECT count(*) FROM ${t} WHERE ${c} > DATE '${asOf}'`)
  }

  // Certified results.
  for (const [geo, year, want] of CERTIFIED) {
    const got = Number(await one(`SELECT dem_pct - rep_pct FROM historical_results WHERE office = 'President' AND geo_id = '${geo}' AND election_year = ${year}`))
    if (!(Math.abs(got - want) <= 0.3)) {
      failures.push(`${geo} ${year} presidential margin ${got.toFixed(1)}, certified ${want}`)
    }
  }

  return report(failures)
}

function report(failures) {
  if (failures.length) {
    console.error(`data validation FAILED (${failures.length}):\n  ${failures.join('\n  ')}`)
    process.exitCode = 1
    return false
  }
  console.log('data validation passed')
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await validate()
}
