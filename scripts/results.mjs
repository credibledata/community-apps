// Election-night results: fetch the AP count (as published in The New York Times' results
// feed), map it onto the 2026 race list, and build the tables results.malloy reads. Each run
// adds one snapshot, so re-running through the count builds up how the results came in.
//
//   pnpm results                  fetch a new snapshot, rebuild, validate
//   pnpm results --offline        rebuild from the committed snapshots only
//   pnpm results --refreeze       recompute the frozen forecast (needs pnpm dev running)
//
// What is committed (scripts/data/results/), and why:
//   snapshots/<time>.csv   one row per race per fetch: side vote totals, share counted, call.
//                          The raw feeds (~12 MB a fetch) stay in data-raw/results/.
//   forecast*.csv          the pre-election forecast, frozen the first time this runs: every
//                          scenario preset in model.js, run exactly as the app runs it (same
//                          seed, 10,000 simulations), so a later model edit cannot rewrite
//                          what the model said before the votes were counted.
//   house_popular_vote.csv national House vote 2006-2024 (Wikipedia, from the Clerk of the
//                          House) against the last presidential margin (MIT Election Lab).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { clampControls, DEFAULT_CONTROLS, PRESETS, prepare, simulate } from '../package/public/model.js'
import { BOOT_QUERIES } from '../package/public/query.js'
import { cached, num, OUT, parseCsv, parseCsvRows, r1, RAW, readCurated, readRaw, ROOT, toCsv } from './data/lib.mjs'
import { RESULTS_SCHEMA } from './data/schema.mjs'
import { validateResults } from './validate-data.mjs'

const OFFLINE = process.argv.includes('--offline')
const REFREEZE = process.argv.includes('--refreeze')
const DIR = new URL('scripts/data/results/', ROOT)
const SNAPSHOTS = new URL('snapshots/', DIR)
mkdirSync(SNAPSHOTS, { recursive: true })

const FEED = (office) => `https://static01.nyt.com/elections-assets/pages/data/2026-11-03/results-${office}.json`
const FEED_OFFICES = { senate: 'Senate', governor: 'Governor', house: 'House' }
const NATIONAL_HOUSE = 'US-HOUSE-VOTE'

const races = readCurated('races.csv')
const raceById = new Map(races.map((r) => [r.race_id, r]))
const candsByRace = Map.groupBy(readCurated('candidates.csv'), (c) => c.race_id)
const geoPres = presidentialByGeo()

// ---- Mapping the feed onto the race list --------------------------------------------------
const tokens = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t && !['jr', 'sr', 'ii', 'iii', 'iv'].includes(t))

/** The curated candidate a feed candidate is: last name must match; first name breaks ties. */
function matchCandidate(first, last, cands) {
  const lt = tokens(last)
  const hits = cands.filter((c) => {
    const t = tokens(c.name)
    return lt.length && lt.every((x) => t.includes(x))
  })
  if (hits.length <= 1) {
    return hits[0] || null
  }
  const f = tokens(first)[0]
  return hits.find((c) => tokens(c.name).some((x) => x.startsWith(f) || f.startsWith(x))) || null
}

function raceIdFor(feedRace, office) {
  const st = feedRace.top_reporting_unit.state_postal
  if (office === 'Senate') {
    return /special/i.test(feedRace.type) ? `SEN-${st}-S` : `SEN-${st}`
  }
  if (office === 'Governor') {
    return `GOV-${st}`
  }
  return `HOU-${st}-${String(feedRace.seat_number).padStart(2, '0')}`
}

/**
 * Which side of the race a candidate is on. Curated nominees keep their side (an independent
 * standing in for a party counts for that side, as in the forecast); anyone else counts by
 * party, so Louisiana's and Alaska's multi-candidate ballots total each party's vote. A
 * party's votes go to its side only when the race's side is that party, not a stand-in.
 */
function sideOf(race, cand, meta) {
  const hit = matchCandidate(meta.first_name || '', meta.last_name || '', candsByRace.get(race.race_id) || [])
  if (hit) {
    return hit.side || 'O'
  }
  const party = meta.party?.nyt_id
  const standIn = /counted on the (D|R) side/.exec(race.matchup_note || '')?.[1]
  if (party === 'DEM' && standIn !== 'D') {
    return 'D'
  }
  if (party === 'GOP' && standIn !== 'R') {
    return 'R'
  }
  return 'O'
}

function extract(feed, office, snapshotAt) {
  const rows = []
  const problems = []
  for (const fr of feed.races) {
    const top = fr.top_reporting_unit
    const meta = fr.candidate_metadata || {}
    const votes = (c) => Number(c.votes?.total) || 0
    if (top.level === 'national') {
      const by = Object.fromEntries(top.candidates.map((c) => [c.nyt_id, votes(c)]))
      rows.push({
        snapshot_at: snapshotAt,
        race_id: NATIONAL_HOUSE,
        office,
        source_race_id: fr.nyt_id,
        dem_votes: by.democrat ?? 0,
        rep_votes: by.republican ?? 0,
        other_votes: by.other ?? 0,
        total_votes: top.candidates.reduce((s, c) => s + votes(c), 0),
        pct_expected_counted: top.eevp ?? 0,
        call_status: 'not called',
        source_updated_at: top.provider_updated_at || fr.updated_at,
        is_uncontested: false,
      })
      continue
    }
    const race_id = raceIdFor(fr, office)
    const race = raceById.get(race_id)
    if (!race) {
      problems.push(`${fr.nyt_id}: no race ${race_id}`)
      continue
    }
    const side = new Map(top.candidates.map((c) => [c.nyt_id, sideOf(race, c, meta[c.nyt_id] || {})]))
    const sum = (s) => top.candidates.filter((c) => side.get(c.nyt_id) === s).reduce((t, c) => t + votes(c), 0)
    const won = fr.outcome?.won || []
    const runoff = fr.outcome?.advanced_to_runoff || []
    const winner = won.length === 1 ? meta[won[0]] : null
    const row = {
      snapshot_at: snapshotAt,
      race_id,
      office,
      source_race_id: fr.nyt_id,
      dem_votes: sum('D'),
      rep_votes: sum('R'),
      other_votes: sum('O'),
      total_votes: top.candidates.reduce((s, c) => s + votes(c), 0),
      pct_expected_counted: top.eevp ?? 0,
      call_status: won.length ? 'called' : runoff.length ? 'runoff' : 'not called',
      winner_side: won.length === 1 ? side.get(won[0]) : null,
      winner_name: winner ? `${winner.first_name} ${winner.last_name}` : null,
      called_at: fr.outcome?.winner_accepted_at?.[0] || null,
      is_uncontested: !!fr.uncontested,
      source_updated_at: top.provider_updated_at || fr.updated_at,
    }
    // The feed's own 2024 presidential margin for the seat must agree with ours, or the race
    // (or the district lines) has been mapped wrongly. The Downballot's 2026-lines sheet is
    // in whole points, hence the tolerance.
    const theirs = Object.values(top.historical_comparison_race_data || {})[0]?.margin
    const ours = geoPres.get(race.office === 'House' ? race_id.slice(4) : race.state)
    if (Number.isFinite(theirs) && Number.isFinite(ours) && Math.abs(theirs - ours) > 2.5) {
      problems.push(`${race_id}: 2024 presidential margin ${theirs.toFixed(1)} in the feed, ${ours.toFixed(1)} here`)
    }
    rows.push(row)
  }
  return { rows, problems }
}

/** 2024 presidential margins by state and 2026 district, as the forecast's data has them. */
function presidentialByGeo() {
  const out = new Map()
  for (const r of parseCsvRows(readRaw('downballot-pres-2026-lines.csv'))) {
    const m = String(r[0]).match(/^([A-Z]{2})-(\d{2}|AL)$/)
    if (m && num(r[3]) !== null) {
      out.set(`${m[1]}-${m[2] === 'AL' ? '01' : m[2]}`, num(r[3]) - num(r[4]))
    }
  }
  const nat = mitNational()
  for (const [st, v] of mitStates(2024)) {
    out.set(st, v)
  }
  out.set('US', nat.get(2024))
  return out
}

// ---- Snapshots -----------------------------------------------------------------------------
const SNAP_COLS = RESULTS_SCHEMA.results.map(([c]) => c).filter((c) => c !== 'is_latest')

async function fetchSnapshot() {
  const now = new Date()
  const snapshotAt = `${now.toISOString().slice(0, 16)}:00Z`
  const id = snapshotAt.slice(0, 16).replace(':', '')
  mkdirSync(new URL(`results/${id}/`, RAW), { recursive: true })
  const rows = []
  const problems = []
  for (const [feed, office] of Object.entries(FEED_OFFICES)) {
    const json = JSON.parse(await cached(`results/${id}/nyt-${feed}.json`, FEED(feed)))
    const got = extract(json, office, snapshotAt)
    rows.push(...got.rows)
    problems.push(...got.problems)
  }
  if (problems.length) {
    throw new Error(`the feed does not map cleanly onto the race list:\n  ${problems.join('\n  ')}`)
  }
  rows.sort((a, b) => (a.race_id < b.race_id ? -1 : 1))
  writeFileSync(new URL(`${id}.csv`, SNAPSHOTS), toCsv(rows, SNAP_COLS))
  const called = rows.filter((r) => r.call_status === 'called').length
  console.log(`snapshot ${snapshotAt}: ${rows.length} rows, ${called} races called`)
}

function readSnapshots() {
  const files = readdirSync(SNAPSHOTS).filter((f) => f.endsWith('.csv')).sort()
  if (!files.length) {
    throw new Error('no snapshots yet: run without --offline to fetch one')
  }
  return files.flatMap((f, i) =>
    parseCsv(readFileSync(new URL(f, SNAPSHOTS), 'utf8')).map((r) => ({ ...r, is_latest: i === files.length - 1 }))
  )
}

// ---- The frozen forecast -------------------------------------------------------------------
const PUBLISHER = process.env.PUBLISHER_URL || 'http://localhost:4000'

async function query(malloy) {
  const url = `${PUBLISHER}/api/v0/environments/elections/packages/midterms2026/models/elections.malloy/query`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ compactJson: true, query: malloy }),
  }).catch(() => {
    throw new Error(`freezing the forecast needs Publisher at ${PUBLISHER}: start it with pnpm dev`)
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`${malloy}\n${json.message}`)
  }
  return JSON.parse(json.result)
}

async function freezeForecast() {
  const data = {}
  for (const [k, q] of Object.entries(BOOT_QUERIES)) {
    data[k] = await query(q)
  }
  data.specials = data.specials[0]
  const prep = prepare(data)
  const races = []
  const chambers = []
  const seats = []
  Object.entries(PRESETS).forEach(([scenario, preset], order) => {
    const result = simulate(prep, clampControls({ ...DEFAULT_CONTROLS, ...preset.patch }), { sims: 10_000 })
    for (const [race_id, r] of Object.entries(result.races)) {
      races.push({ scenario, race_id, p_dem: r.pWin, mean_margin: r2(r.meanMargin), p10: r2(r.p10), p50: r2(r.p50), p90: r2(r.p90) })
    }
    for (const [chamber, c] of Object.entries(result.chambers)) {
      chambers.push({
        scenario,
        scenario_label: preset.label,
        scenario_order: order,
        chamber,
        national_environment: r2(result.env.value),
        p_dem_control: c.pDemControl,
        expected_dem_seats: r2(c.expectedDemSeats),
        p10: c.p10,
        p50: c.p50,
        p90: c.p90,
      })
      c.seatHist.forEach((n, dem_seats) => n && seats.push({ scenario, chamber, dem_seats, share: n / result.sims }))
    }
  })
  writeFileSync(new URL('forecast.csv', DIR), toCsv(races))
  writeFileSync(new URL('forecast_chambers.csv', DIR), toCsv(chambers))
  writeFileSync(new URL('forecast_seats.csv', DIR), toCsv(seats))
  console.log(`froze the forecast as of ${new Date(prep.asOf).toISOString().slice(0, 10)}: ${chambers.length / 3} scenarios`)
}
const r2 = (x) => Math.round(x * 100) / 100

// ---- National House vote, past midterms ----------------------------------------------------
function mitStates(year) {
  const agg = new Map()
  for (const r of parseCsv(readRaw('mit-president.csv'))) {
    if (Number(r.year) !== year || r.state_po === 'DC') {
      continue
    }
    const a = agg.get(r.state_po) ?? { D: 0, R: 0, total: Number(r.totalvotes) }
    a.D += r.party_simplified === 'DEMOCRAT' ? Number(r.candidatevotes) : 0
    a.R += r.party_simplified === 'REPUBLICAN' ? Number(r.candidatevotes) : 0
    agg.set(r.state_po, a)
  }
  return new Map([...agg].map(([st, a]) => [st, (100 * (a.D - a.R)) / a.total]))
}

/** National presidential margin by year, DC included, as in build-data.mjs. */
function mitNational() {
  const nat = new Map()
  const seen = new Set()
  for (const r of parseCsv(readRaw('mit-president.csv'))) {
    const y = Number(r.year)
    const n = nat.get(y) ?? { D: 0, R: 0, total: 0 }
    if (!seen.has(`${y}|${r.state_po}`)) {
      seen.add(`${y}|${r.state_po}`)
      n.total += Number(r.totalvotes)
    }
    n.D += r.party_simplified === 'DEMOCRAT' ? Number(r.candidatevotes) : 0
    n.R += r.party_simplified === 'REPUBLICAN' ? Number(r.candidatevotes) : 0
    nat.set(y, n)
  }
  return new Map([...nat].map(([y, n]) => [y, (100 * (n.D - n.R)) / n.total]))
}

const HOUSE_YEARS = [2006, 2010, 2014, 2018, 2022, 2024]
const WHITE_HOUSE = { 2006: 'R', 2010: 'D', 2014: 'D', 2018: 'R', 2022: 'D', 2024: 'D' }

async function housePopularVote() {
  const pres = mitNational()
  const rows = []
  for (const y of HOUSE_YEARS) {
    const page = `${y} United States House of Representatives elections`
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&section=0&format=json&formatversion=2`
    const text = JSON.parse(await cached(`wiki-house-${y}.json`, url)).parse.wikitext
    const field = (name, i) => text.match(new RegExp(`\\|\\s*${name}${i}\\s*=\\s*([^\\n]*)`))?.[1] ?? ''
    const pct = {}
    for (let i = 1; i <= 4; i++) {
      const party = field('party', i)
      const side = /democrat/i.test(party) ? 'D' : /republican/i.test(party) ? 'R' : null
      if (side) {
        pct[side] = Number(field('percentage', i).replace(/<ref[\s\S]*$/, '').replace(/[^\d.]/g, ''))
      }
    }
    if (!(pct.D > 0 && pct.R > 0)) {
      throw new Error(`no popular vote in the infobox of "${page}"`)
    }
    const presYear = y % 4 === 0 ? y : y - 2
    rows.push({
      election_year: y,
      dem_pct: pct.D,
      rep_pct: pct.R,
      prior_pres_year: presYear,
      prior_pres_margin: r1(pres.get(presYear)),
      white_house_party: WHITE_HOUSE[y],
      source_url: `https://en.wikipedia.org/wiki/${page.replace(/ /g, '_')}`,
    })
  }
  writeFileSync(new URL('house_popular_vote.csv', DIR), toCsv(rows))
}

// ---- Build ---------------------------------------------------------------------------------
/** A CSV cell as the column's type: '' is null, numbers and booleans are parsed. */
function typed(v, type) {
  if (v === '' || v === null || v === undefined) {
    return null
  }
  if (type === 'BOOLEAN') {
    return v === true || v === 'true'
  }
  if (['INTEGER', 'BIGINT', 'DOUBLE'].includes(type)) {
    return Number(v)
  }
  return v
}

async function writeParquet(tables) {
  const db = await (await DuckDBInstance.create(':memory:')).connect()
  const tmp = mkdtempSync(join(tmpdir(), 'results-'))
  try {
    for (const [name, rows] of Object.entries(tables)) {
      const cols = RESULTS_SCHEMA[name]
      const file = join(tmp, `${name}.ndjson`)
      writeFileSync(file, rows.map((r) => JSON.stringify(Object.fromEntries(cols.map(([c, t]) => [c, typed(r[c], t)])))).join('\n'))
      const columns = cols.map(([c, t]) => `'${c}': '${t}'`).join(', ')
      const out = new URL(`${name}.parquet`, OUT).pathname
      await db.run(
        `COPY (SELECT * FROM read_json('${file}', format='newline_delimited', columns={${columns}})) TO '${out}' (FORMAT parquet, COMPRESSION zstd)`
      )
      console.log(`package/data/${name}.parquet`.padEnd(42), String(rows.length).padStart(6), 'rows')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const curatedCsv = (name) => parseCsv(readFileSync(new URL(name, DIR), 'utf8'))

if (!OFFLINE) {
  await fetchSnapshot()
}
if (REFREEZE || !existsSync(new URL('forecast.csv', DIR))) {
  await freezeForecast()
}
if (!existsSync(new URL('house_popular_vote.csv', DIR))) {
  await housePopularVote()
}
await writeParquet({
  results: readSnapshots(),
  forecasts: curatedCsv('forecast.csv'),
  forecast_chambers: curatedCsv('forecast_chambers.csv'),
  forecast_seats: curatedCsv('forecast_seats.csv'),
  house_popular_vote: curatedCsv('house_popular_vote.csv'),
})
await validateResults()
