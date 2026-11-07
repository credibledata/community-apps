// Build data/*.parquet — one file per table elections.malloy reads — from the cached
// public sources in data-raw/ and the curated race map in pipeline/data/curated/. Every number
// is either copied from a cited source or derived from one by a rule written below;
// README.md documents each table's provenance.
//
//   pnpm data:real                fetch (cached) -> curate -> markets -> build -> validate
//   node packages/midterms2026/pipeline/build-data.mjs   build + validate from what is already in data-raw/

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import {
  OUT,
  RAW,
  STATES,
  num,
  parseCsv,
  parseCsvRows,
  r1,
  r2,
  readCurated,
  readJson,
  readRaw,
  regionOf,
} from './data/lib.mjs'
import { SCHEMA } from './data/schema.mjs'
import { validate } from './validate-data.mjs'

const DAY = 86_400_000
const iso = (t) => new Date(t).toISOString().slice(0, 10)
const TODAY = iso(Date.now())

// ---- Curated race map ---------------------------------------------------------------------
const curatedRaces = readCurated('races.csv')
const curatedCands = readCurated('candidates.csv')
const raceById = new Map(curatedRaces.map((r) => [r.race_id, r]))
const candsByRace = new Map()
for (const c of curatedCands) {
  if (!candsByRace.has(c.race_id)) {
    candsByRace.set(c.race_id, [])
  }
  candsByRace.get(c.race_id).push(c)
}

// ---- Polls (VoteHub) ----------------------------------------------------------------------
const votehub = readJson('votehub-polls.json')
const POLL_START = '2026-01-01'
const AS_OF = votehub
  .map((p) => p.end_date)
  .filter((d) => d && d <= TODAY)
  .sort()
  .at(-1)

const POPULATION = { lv: 'LV', rv: 'RV', a: 'A', v: 'RV' }
const tokens = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t && !['jr', 'sr', 'ii', 'iii', 'iv'].includes(t))

/** The nominee a poll answer names: last name must match; first name breaks ties. */
function matchCandidate(choice, cands) {
  const ct = tokens(choice)
  const hits = cands.filter((c) => {
    const t = tokens(c.name)
    return t.length && ct.includes(t.at(-1))
  })
  if (hits.length <= 1) {
    return hits[0] || null
  }
  return hits.find((c) => ct.includes(tokens(c.name)[0])) || null
}

function raceIdForPoll(p) {
  const subject = String(p.subject || '')
  if (/democratic|republican|primary|runoff/i.test(subject)) {
    return null
  }
  if (p.poll_type === 'generic-ballot') {
    return 'US-GENERIC'
  }
  if (p.poll_type === 'us-representative') {
    const m = (p.seat_name || subject).match(/([A-Z]{2})-(\d{2}|AL)/)
    return m ? `HOU-${m[1]}-${m[2] === 'AL' ? '01' : m[2]}` : null
  }
  const name = subject.replace(/^2026\s+/, '').trim().toLowerCase()
  const st = Object.keys(STATES).find((a) => STATES[a].toLowerCase() === name)
  if (!st) {
    return null
  }
  if (p.poll_type === 'governor') {
    return `GOV-${st}`
  }
  if (p.poll_type === 'us-senator') {
    return raceById.has(`SEN-${st}`) ? `SEN-${st}` : raceById.has(`SEN-${st}-S`) ? `SEN-${st}-S` : null
  }
  return null
}

const sampleMedian = (() => {
  const s = votehub.map((p) => p.sample_size).filter((n) => n > 0).sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
})()

const polls = []
const pollDrops = { notRace: 0, notNominees: 0, locked: 0, badDates: 0 }
for (const p of votehub) {
  if (!['generic-ballot', 'us-senator', 'governor', 'us-representative'].includes(p.poll_type)) {
    continue
  }
  if (!p.end_date || p.end_date < POLL_START || p.end_date > AS_OF) {
    continue
  }
  if (p.start_date && p.start_date > p.end_date) {
    pollDrops.badDates++
    continue
  }
  const race_id = raceIdForPoll(p)
  if (!race_id || (race_id !== 'US-GENERIC' && !raceById.has(race_id))) {
    pollDrops.notRace++
    continue
  }
  let dem = null
  let rep = null
  if (race_id === 'US-GENERIC') {
    dem = p.answers.find((a) => a.choice === 'Dem')?.pct ?? null
    rep = p.answers.find((a) => a.choice === 'Rep')?.pct ?? null
  } else {
    if (raceById.get(race_id).locked_party) {
      pollDrops.locked++
      continue
    }
    // Only head-to-heads between the actual nominees: the best-polling D-side and R-side
    // nominee in the question. Hypothetical primary-season matchups are dropped.
    const cands = candsByRace.get(race_id) || []
    for (const a of p.answers) {
      const c = matchCandidate(a.choice, cands)
      if (c?.side === 'D') {
        dem = Math.max(dem ?? -1, a.pct)
      } else if (c?.side === 'R') {
        rep = Math.max(rep ?? -1, a.pct)
      }
    }
  }
  if (dem === null || rep === null) {
    pollDrops.notNominees++
    continue
  }
  const total = p.answers.reduce((s, a) => s + (a.pct || 0), 0)
  polls.push({
    poll_id: p.id,
    race_id,
    pollster: p.pollster,
    start_date: p.start_date || p.end_date,
    end_date: p.end_date,
    sample_size: p.sample_size > 0 ? p.sample_size : sampleMedian,
    population: POPULATION[p.population] || 'A',
    dem_pct: dem,
    rep_pct: rep,
    undecided_pct: r1(Math.max(0, 100 - total)),
    partisan: p.partisan === 'DEM' ? 'D' : p.partisan === 'REP' ? 'R' : '',
    url: p.url || '',
  })
}
polls.sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : a.poll_id < b.poll_id ? -1 : 1))

// ---- Pollsters: 538 grades, house effects estimated from these polls -------------------------
const ratings538 = parseCsv(readRaw('538-pollster-ratings.csv'))
// "University" and "College" are interchangeable (Siena and Marist renamed themselves).
const STOP = new Set(['the', 'of', 'and', 'poll', 'polls', 'polling', 'research', 'inc', 'llc', 'co', 'group', 'survey', 'surveys', 'strategy', 'strategies', 'analytics', 'insights', 'institute', 'center', 'for', 'public', 'opinion', 'news', 'university', 'college'])
const key = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .join(' ')
const by538 = new Map(ratings538.map((r) => [key(r.pollster), r]))
const jaccard = (a, b) => {
  const A = new Set(a.split(' '))
  const B = new Set(b.split(' '))
  return [...A].filter((t) => B.has(t)).length / new Set([...A, ...B]).size
}
/**
 * Exact name, then each "sponsor/pollster" part, then a close (Jaccard >= 3/4) name. Names
 * made only of generic words ("Public Opinion Strategies") match exactly or not at all.
 */
function find538(name) {
  const full = key(name)
  if (!full) {
    return ratings538.find((r) => r.pollster.toLowerCase() === String(name).toLowerCase()) || null
  }
  for (const k of [full, ...String(name).split('/').reverse().map(key)]) {
    if (k && by538.has(k)) {
      return by538.get(k)
    }
  }
  let best = null
  let score = 3 / 4
  for (const r of ratings538) {
    const rk = key(r.pollster)
    const s = rk ? jaccard(full, rk) : 0
    if (s >= score) {
      best = r
      score = s
    }
  }
  return best
}
/** 538's 0.5-3.0 numeric grade onto the letter scale grade_weight expects. */
function letter(g) {
  if (g === null) {
    return 'C'
  }
  return g >= 2.8 ? 'A+' : g >= 2.5 ? 'A' : g >= 2.2 ? 'A-' : g >= 1.9 ? 'B+' : g >= 1.6 ? 'B' : g >= 1.3 ? 'B-' : g >= 1.0 ? 'C+' : 'C'
}

const POP_ADJ = { RV: 0.8, A: 1.2, LV: 0 }
const adj = (p) => p.dem_pct - p.rep_pct - POP_ADJ[p.population]
// House effect: a pollster's mean residual against other pollsters' polls of the same race
// within 21 days, shrunk toward zero by HOUSE_K pseudo-polls.
const HOUSE_K = 5
const resid = new Map()
const byRace = Map.groupBy(polls, (p) => p.race_id)
for (const list of byRace.values()) {
  for (const p of list) {
    const t = Date.parse(p.end_date)
    const others = list.filter((q) => q.pollster !== p.pollster && Math.abs(Date.parse(q.end_date) - t) <= 21 * DAY)
    if (others.length < 2) {
      continue
    }
    const avg = others.reduce((s, q) => s + adj(q), 0) / others.length
    if (!resid.has(p.pollster)) {
      resid.set(p.pollster, [])
    }
    resid.get(p.pollster).push(adj(p) - avg)
  }
}
const pollsters = [...new Set(polls.map((p) => p.pollster))].sort().map((name) => {
  const rated = find538(name)
  const rs = resid.get(name) || []
  const own = polls.filter((p) => p.pollster === name)
  const partisan = own.filter((p) => p.partisan)
  const side = partisan.length * 2 > own.length ? partisan[0].partisan : ''
  return {
    pollster: name,
    grade: letter(rated ? num(rated.numeric_grade) : null),
    methodology: '',
    house_effect: r1(rs.reduce((a, b) => a + b, 0) / (rs.length + HOUSE_K)),
    partisan_sponsor: side,
    rating_538: rated ? rated.pollster : '',
  }
})

// ---- Approval: daily average of presidential approval polls ---------------------------------
const approvalPolls = votehub
  .filter((p) => p.poll_type === 'approval' && p.subject === 'Donald Trump' && p.end_date && p.end_date <= AS_OF)
  .map((p) => ({
    t: Date.parse(p.end_date),
    pollster: p.pollster,
    n: p.sample_size > 0 ? p.sample_size : sampleMedian,
    approve: p.answers.find((a) => a.choice === 'Approve')?.pct,
    disapprove: p.answers.find((a) => a.choice === 'Disapprove')?.pct,
  }))
  .filter((p) => Number.isFinite(p.approve) && Number.isFinite(p.disapprove))
const approval = []
// Weight: sqrt(n) x 0.5^(age / 14 days) over the last 60 days, divided by the square root of
// how many polls that pollster has in the window so one prolific tracker cannot dominate.
for (let t = Date.parse(POLL_START) - 56 * DAY; t <= Date.parse(AS_OF); t += DAY) {
  const win = approvalPolls.filter((p) => p.t <= t && t - p.t <= 60 * DAY)
  if (!win.length) {
    continue
  }
  const per = Map.groupBy(win, (p) => p.pollster)
  let w = 0
  let a = 0
  let d = 0
  for (const p of win) {
    const wt = (Math.sqrt(p.n) * 0.5 ** ((t - p.t) / (14 * DAY))) / Math.sqrt(per.get(p.pollster).length)
    w += wt
    a += wt * p.approve
    d += wt * p.disapprove
  }
  approval.push({ approval_date: iso(t), approve_pct: r1(a / w), disapprove_pct: r1(d / w) })
}

// ---- Presidential results: states (MIT) and districts on 2026 lines (The Downballot) --------
const mit = parseCsv(readRaw('mit-president.csv'))
const stateResults = {}
for (const r of mit) {
  const y = Number(r.year)
  if (![2016, 2020, 2024].includes(y) || !(STATES[r.state_po] || r.state_po === 'DC')) {
    continue
  }
  const k = `${y}|${r.state_po}`
  stateResults[k] ??= { y, st: r.state_po, D: 0, R: 0, total: Number(r.totalvotes) }
  if (r.party_simplified === 'DEMOCRAT') {
    stateResults[k].D += Number(r.candidatevotes)
  } else if (r.party_simplified === 'REPUBLICAN') {
    stateResults[k].R += Number(r.candidatevotes)
  }
}
const history = []
const pushResult = (election_year, office, geo_id, d, r, total) =>
  history.push({
    election_year,
    office,
    geo_id,
    dem_pct: r1(d),
    rep_pct: r1(r),
    other_pct: r1(Math.max(0, 100 - d - r)),
    total_votes: total,
  })
// DC counts toward the national popular vote but has no geography of its own here.
const nat = {}
for (const s of Object.values(stateResults)) {
  if (s.st !== 'DC') {
    pushResult(s.y, 'President', s.st, (100 * s.D) / s.total, (100 * s.R) / s.total, s.total)
  }
  nat[s.y] ??= { D: 0, R: 0, total: 0 }
  nat[s.y].D += s.D
  nat[s.y].R += s.R
  nat[s.y].total += s.total
}
for (const [y, n] of Object.entries(nat)) {
  pushResult(Number(y), 'President', 'US', (100 * n.D) / n.total, (100 * n.R) / n.total, n.total)
}

/** The Downballot sheet: District, Incumbent, Party, then [D, R, margin] per year. */
function downballot(name) {
  const rows = parseCsvRows(readRaw(name))
  const out = new Map()
  for (const r of rows) {
    const m = String(r[0]).match(/^([A-Z]{2})-(\d{2}|AL)$/)
    if (!m) {
      continue
    }
    const id = `${m[1]}-${m[2] === 'AL' ? '01' : m[2]}`
    out.set(id, { d24: num(r[3]), r24: num(r[4]), d20: num(r[6]), r20: num(r[7]) })
  }
  return out
}
const pres26 = downballot('downballot-pres-2026-lines.csv')
const pres24 = downballot('downballot-pres-2024-lines.csv')
// A district is "redrawn" when its 2024 or 2020 presidential result differs between the 2024
// and 2026 lines (whole-number precision in the 2026 sheet, so compare after rounding), or the
// 2026 sheet has no 2020 figure for it (states whose new maps were not recomputed for 2020).
const same = (a, b) => a !== null && b !== null && Math.round(a) === Math.round(b)
const redrawn = new Set(
  [...pres26]
    .filter(([id, v]) => {
      const old = pres24.get(id)
      return !old || !same(old.d24, v.d24) || !same(old.r24, v.r24) || !same(old.d20, v.d20) || !same(old.r20, v.r20)
    })
    .map(([id]) => id)
)
for (const [id, v] of pres26) {
  if (v.d24 !== null) {
    pushResult(2024, 'President', id, v.d24, v.r24, null)
  }
  if (v.d20 !== null) {
    pushResult(2020, 'President', id, v.d20, v.r20, null)
  }
}

// Optional: House and Senate results from MIT, when a maintainer has downloaded them (the
// Dataverse files need a guestbook response). House results only for districts whose lines
// did not change for 2026.
function mitTab(name) {
  return existsSync(new URL(name, RAW)) ? parseCsv(readRaw(name), { delimiter: '\t' }) : null
}
const unquote = (s) => String(s).replace(/^"|"$/g, '')
const mitHouse = mitTab('mit-house.tab')
if (mitHouse) {
  const agg = {}
  for (const r of mitHouse.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [unquote(k), unquote(v)])))) {
    const y = Number(r.year)
    if (y !== 2024 || r.stage !== 'GEN' || r.special === 'TRUE' || !STATES[r.state_po]) {
      continue
    }
    const id = `${r.state_po}-${String(Math.max(1, Number(r.district))).padStart(2, '0')}`
    agg[id] ??= { D: 0, R: 0, total: Number(r.totalvotes) }
    if (r.party === 'DEMOCRAT') {
      agg[id].D += Number(r.candidatevotes)
    } else if (r.party === 'REPUBLICAN') {
      agg[id].R += Number(r.candidatevotes)
    }
  }
  const usH = { D: 0, R: 0, total: 0 }
  for (const [id, a] of Object.entries(agg)) {
    usH.D += a.D
    usH.R += a.R
    usH.total += a.total
    if (!redrawn.has(id) && a.total > 0) {
      pushResult(2024, 'House', id, (100 * a.D) / a.total, (100 * a.R) / a.total, a.total)
    }
  }
  pushResult(2024, 'House', 'US', (100 * usH.D) / usH.total, (100 * usH.R) / usH.total, usH.total)
}
const mitSenate = mitTab('mit-senate.tab')
if (mitSenate) {
  const last = {}
  for (const r of mitSenate.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [unquote(k), unquote(v)])))) {
    const y = Number(r.year)
    if (r.stage !== 'gen' && r.stage !== 'GEN') {
      continue
    }
    const special = r.special === 'TRUE'
    const id = `SEN-${r.state_po}${special ? '-S' : ''}`
    if (!raceById.has(id)) {
      continue
    }
    const k = `${id}|${y}`
    last[k] ??= { id, y, st: r.state_po, D: 0, R: 0, total: Number(r.totalvotes) }
    if (r.party_simplified === 'DEMOCRAT') {
      last[k].D += Number(r.candidatevotes)
    } else if (r.party_simplified === 'REPUBLICAN') {
      last[k].R += Number(r.candidatevotes)
    }
  }
  const latest = {}
  for (const v of Object.values(last)) {
    if (!latest[v.st] || v.y > latest[v.st].y) {
      latest[v.st] = v
    }
  }
  for (const v of Object.values(latest)) {
    pushResult(v.y, 'Senate', v.st, (100 * v.D) / v.total, (100 * v.R) / v.total, v.total)
  }
}

// ---- Geographies: ACS demographics + presidential margins ---------------------------------
const FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', 10: 'DE',
  12: 'FL', 13: 'GA', 15: 'HI', 16: 'ID', 17: 'IL', 18: 'IN', 19: 'IA', 20: 'KS', 21: 'KY',
  22: 'LA', 23: 'ME', 24: 'MD', 25: 'MA', 26: 'MI', 27: 'MN', 28: 'MS', 29: 'MO', 30: 'MT',
  31: 'NE', 32: 'NV', 33: 'NH', 34: 'NJ', 35: 'NM', 36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH',
  40: 'OK', 41: 'OR', 42: 'PA', 44: 'RI', 45: 'SC', 46: 'SD', 47: 'TN', 48: 'TX', 49: 'UT',
  50: 'VT', 51: 'VA', 53: 'WA', 54: 'WV', 55: 'WI', 56: 'WY',
}
const acs = {}
for (const table of ['b01003', 'b03002', 'b15003', 'b01002', 'b19013']) {
  const lines = readRaw(`acs-${table}.dat`).split('\n')
  const head = lines[0].split('|')
  for (const line of lines.slice(1)) {
    const cells = line.split('|')
    const geo = cells[0]
    let id = null
    let m = geo.match(/^0400000US(\d{2})$/)
    if (m) {
      id = FIPS[m[1]]
    } else if ((m = geo.match(/^5001900US(\d{2})(\d{2})$/))) {
      id = FIPS[m[1]] && `${FIPS[m[1]]}-${m[2] === '00' ? '01' : m[2]}`
    }
    if (!id) {
      continue
    }
    acs[id] ??= {}
    head.forEach((h, i) => {
      if (/_E\d+$/.test(h)) {
        acs[id][h] = num(cells[i])
      }
    })
  }
}
function demographics(id) {
  const a = acs[id]
  if (!a) {
    return null
  }
  const pct = (x, of) => (x === null || !of ? null : r1((100 * x) / of))
  const ba = ['B15003_E022', 'B15003_E023', 'B15003_E024', 'B15003_E025'].reduce((s, k) => s + (a[k] || 0), 0)
  return {
    population: a.B01003_E001,
    pct_white: pct(a.B03002_E003, a.B03002_E001),
    pct_black: pct(a.B03002_E004, a.B03002_E001),
    pct_hispanic: pct(a.B03002_E012, a.B03002_E001),
    pct_asian: pct(a.B03002_E006, a.B03002_E001),
    pct_college: pct(ba, a.B15003_E001),
    median_age: a.B01002_E001,
    median_income_k: a.B19013_E001 === null ? null : Math.round(a.B19013_E001 / 1000),
  }
}
const margin = (d, r) => (d === null || r === null ? null : r1(d - r))
const EMPTY_DEMO = Object.fromEntries(
  ['population', 'pct_white', 'pct_black', 'pct_hispanic', 'pct_asian', 'pct_college', 'median_age', 'median_income_k'].map((k) => [k, null])
)
const geographies = []
for (const [st, name] of Object.entries(STATES)) {
  const sr = (y) => stateResults[`${y}|${st}`]
  const m = (y) => margin((100 * sr(y).D) / sr(y).total, (100 * sr(y).R) / sr(y).total)
  geographies.push({
    geo_id: st,
    kind: 'state',
    state: st,
    state_name: name,
    district_number: null,
    name,
    region: regionOf[st],
    ...demographics(st),
    pres_2016: m(2016),
    pres_2020: m(2020),
    pres_2024: m(2024),
    redrawn_for_2026: false,
  })
}
for (const r of curatedRaces.filter((x) => x.office === 'House')) {
  const id = r.race_id.slice(4)
  const p = pres26.get(id)
  const changed = redrawn.has(id)
  geographies.push({
    geo_id: id,
    kind: 'district',
    state: r.state,
    state_name: STATES[r.state],
    district_number: Number(r.district_number),
    name: r.race_name,
    region: regionOf[r.state],
    // ACS districts are the 2024 lines; a redrawn district gets no demographics rather than
    // its predecessor's.
    ...(changed ? EMPTY_DEMO : demographics(id) || EMPTY_DEMO),
    pres_2016: null,
    pres_2020: p ? margin(p.d20, p.r20) : null,
    pres_2024: p ? margin(p.d24, p.r24) : null,
    redrawn_for_2026: changed,
  })
}

// ---- Fundraising: FEC all-candidates summary (2025-26 receipts) ------------------------------
const fec = readRaw('weball26.txt')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const c = l.split('|')
    return { id: c[0], name: c[1], party: c[4], receipts: num(c[5]), state: c[18], district: c[19] }
  })
function raisedM(race, side) {
  const names = (side === 'D' ? race.dem_candidate : race.rep_candidate).split('; ').filter(Boolean)
  if (!names.length || race.office === 'Governor') {
    return null
  }
  const office = race.office === 'Senate' ? 'S' : 'H'
  let best = null
  for (const n of names) {
    const t = tokens(n)
    const last = t.at(-1)
    const first = t[0]
    const here = fec.filter((f) => f.id[0] === office && f.state === race.state)
    // Surname match ("TUREK, JOSHUA" for Josh Turek); failing that, every token of the
    // nominee's name somewhere in the filing ("ARENHOLZ, ASHLEY HINSON" for Ashley Hinson).
    let pool = here.filter((f) => tokens(f.name.split(',')[0]).includes(last))
    if (!pool.length) {
      pool = here.filter((f) => t.every((x) => tokens(f.name).includes(x)))
    }
    const firstOk = (f) => tokens(f.name.split(',')[1] || f.name).some((x) => x.startsWith(first) || first.startsWith(x))
    const hits = pool.filter(firstOk)
    const pick = (hits.length ? hits : pool.length === 1 ? pool : []).sort(
      (a, b) =>
        (office === 'H' ? (Number(b.district) === Number(race.district_number)) - (Number(a.district) === Number(race.district_number)) : 0) ||
        (b.receipts || 0) - (a.receipts || 0)
    )[0]
    if (pick && (best === null || (pick.receipts || 0) > best)) {
      best = pick.receipts || 0
    }
  }
  return best === null ? null : r2(best / 1e6)
}

const races = curatedRaces.map((r) => {
  let d = raisedM(r, 'D')
  let rep = raisedM(r, 'R')
  if (d === null || rep === null) {
    d = null
    rep = null
  }
  return {
    race_id: r.race_id,
    office: r.office,
    state: r.state,
    geo_id: r.office === 'House' ? r.race_id.slice(4) : r.state,
    district_number: r.district_number ? Number(r.district_number) : null,
    race_name: r.race_name,
    is_special: r.is_special === 'true',
    incumbent_party: r.incumbent_party || null,
    is_open_seat: r.is_open_seat === 'true',
    incumbent_status: r.incumbent_status || null,
    expert_rating: r.expert_rating || null,
    dem_raised_m: d,
    rep_raised_m: rep,
    locked_party: r.locked_party || null,
    matchup_note: r.matchup_note || null,
    dem_candidate: r.dem_candidate || null,
    rep_candidate: r.rep_candidate || null,
  }
})

const chambers = readCurated('chambers.csv').map((c) =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k === 'chamber' ? v : Number(v)]))
)

// ---- Kalshi --------------------------------------------------------------------------------
const kalshi = []
const etDate = (sec) =>
  new Date((sec - 1) * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
for (const t of readCurated('kalshi_tickers.csv')) {
  const file = `kalshi/candles-${t.market_ticker}.json`
  if (!existsSync(new URL(file, RAW))) {
    continue
  }
  const rows = []
  for (const c of readJson(file).candlesticks || []) {
    const close = num(c.price?.close_dollars)
    const bid = num(c.yes_bid?.close_dollars)
    const ask = num(c.yes_ask?.close_dollars)
    // A day with trades closes at its last trade; a quiet day is read at the bid/ask midpoint.
    const price = close ?? (bid !== null && ask !== null && ask > 0 ? (bid + ask) / 2 : null)
    const date = etDate(c.end_period_ts)
    if (price === null || date < POLL_START || date > AS_OF) {
      continue
    }
    // Daily candles close at midnight UTC-5, so the spring DST switch puts two on one ET date.
    if (rows.at(-1)?.price_date === date) {
      rows.pop()
    }
    rows.push({
      market_ticker: t.market_ticker,
      race_id: t.race_id,
      market_title: t.market_title,
      price_date: date,
      yes_price: Math.round(price * 1000) / 1000,
      volume_usd: Math.round((num(c.volume_fp) || 0) * price),
      is_latest: false,
    })
  }
  if (rows.length) {
    rows.at(-1).is_latest = true
    kalshi.push(...rows)
  }
}

// ---- Special elections (The Downballot tracker) --------------------------------------------
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
const specials = []
for (const name of ['downballot-specials-2025.csv', 'downballot-specials-2026.csv']) {
  for (const r of parseCsvRows(readRaw(name))) {
    const m = String(r[1]).match(/^(\d{1,2})-([A-Z][a-z]{2})-(\d{2})$/)
    if (!m || !STATES[r[2]]) {
      continue
    }
    const date = `20${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`
    const d = num(r[7])
    const rep = num(r[8])
    // The Downballot's own averages count only races where D + R is at least 90% of the vote.
    if (d === null || rep === null || d + rep < 90 || date > AS_OF) {
      continue
    }
    const district = r[3]
    const chamber = /^HD|^AD/.test(district) ? 'State House' : /^SD/.test(district) ? 'State Senate' : /^[A-Z]{2}-\d+$/.test(district) ? 'U.S. House' : 'Other'
    specials.push({
      election_date: date,
      state: r[2],
      chamber,
      district,
      pres_2024_margin: num(r[13]),
      result_margin: num(r[9]),
      total_votes: null,
    })
  }
}
specials.sort((a, b) => (a.election_date < b.election_date ? -1 : 1))

// ---- Write ---------------------------------------------------------------------------------
const tables = {
  geographies,
  historical_results: history,
  races,
  chambers,
  pollsters,
  polls,
  kalshi_prices: kalshi,
  approval,
  special_elections: specials,
}

const db = await (await DuckDBInstance.create(':memory:')).connect()
const tmp = mkdtempSync(join(tmpdir(), 'elections-'))
try {
  for (const [name, rows] of Object.entries(tables)) {
    const cols = SCHEMA[name]
    const file = join(tmp, `${name}.ndjson`)
    writeFileSync(file, rows.map((r) => JSON.stringify(Object.fromEntries(cols.map(([c]) => [c, r[c] ?? null])))).join('\n'))
    const columns = cols.map(([c, t]) => `'${c}': '${t}'`).join(', ')
    const out = new URL(`${name}.parquet`, OUT).pathname
    await db.run(
      `COPY (SELECT * FROM read_json('${file}', format='newline_delimited', columns={${columns}})) TO '${out}' (FORMAT parquet, COMPRESSION zstd)`
    )
    console.log(`data/${name}.parquet`.padEnd(42), String(rows.length).padStart(6), 'rows')
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
console.log(`as of ${AS_OF}; polls dropped:`, pollDrops, `; districts redrawn for 2026: ${redrawn.size}`)
writeFileSync(
  new URL('build-info.json', OUT),
  `${JSON.stringify({ as_of: AS_OF, built: TODAY, redrawn_districts: redrawn.size, polls_dropped: pollDrops }, null, 2)}\n`
)

await validate({ asOf: AS_OF })
