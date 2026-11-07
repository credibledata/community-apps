// Deterministic stub data: an offline fixture for experimenting with the model, never shipped.
// The package serves the real snapshot in data/*.parquet (pipeline/build-data.mjs).
//
// Everything here is SYNTHETIC. State-level presidential margins and the House
// apportionment are approximately real so the maps look familiar; every poll,
// price, rating, dollar figure and district is generated. The generator builds
// one hidden "true" 2026 environment and samples every source from it, so the
// sources agree with each other the way real ones roughly do. It predates the real
// schema (pipeline/data/schema.mjs) and lacks the columns added for it.
//
//   pnpm data:stub   -> pipeline/fixtures/stub-data/*.csv (same seed, same bytes)

import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = new URL('./fixtures/stub-data/', import.meta.url)
mkdirSync(OUT, { recursive: true })

// ---- Seeded randomness -------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}
const rand = mulberry32(2026)
const normal = (mu = 0, sd = 1) => {
  const u = 1 - rand()
  const v = rand()
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const r1 = (x) => Math.round(x * 10) / 10
const r2 = (x) => Math.round(x * 100) / 100
const logistic = (x) => 1 / (1 + Math.exp(-x))
const logit = (p) => Math.log(p / (1 - p))
const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2))
function erf(x) {
  const s = Math.sign(x)
  const t = 1 / (1 + 0.327_591_1 * Math.abs(x))
  const y =
    1 -
    ((((1.061_405_429 * t - 1.453_152_027) * t + 1.421_413_741) * t -
      0.284_496_736) *
      t +
      0.254_829_592) *
      t *
      Math.exp(-x * x)
  return s * y
}

// ---- Dates -------------------------------------------------------------------------------
const ELECTION = Date.UTC(2026, 10, 3)
const START = Date.UTC(2026, 0, 5)
const AS_OF = Date.UTC(2026, 10, 1)
const DAY = 86_400_000
const iso = (t) => new Date(t).toISOString().slice(0, 10)
const progress = (t) => (t - START) / (ELECTION - START) // 0 in Jan, 1 on Election Day

// ---- States: approximate real presidential margins (D minus R, points) -------------------
// abbr, name, region, house seats, 2016, 2020, 2024 margins, population (M),
// % white, % Black, % Hispanic, % Asian, % bachelor's+, median age, median income ($k)
const STATES = `
AL,Alabama,South,7,-27.7,-25.5,-30.5,5.1,64,26,5,2,28,40,59
AK,Alaska,West,1,-14.7,-10.1,-13.1,0.7,58,3,8,7,31,36,86
AZ,Arizona,West,9,-3.5,0.3,-5.5,7.4,52,5,32,4,32,39,72
AR,Arkansas,South,4,-26.9,-27.6,-30.6,3.1,69,15,9,2,25,39,56
CA,California,West,52,30.1,29.2,20.1,39.0,34,5,40,16,37,38,91
CO,Colorado,West,8,4.9,13.5,11.0,5.9,66,4,22,4,44,37,87
CT,Connecticut,Northeast,5,13.6,20.0,14.5,3.6,62,11,18,5,41,41,90
DE,Delaware,South,1,11.4,19.0,14.7,1.0,59,22,10,4,35,41,79
FL,Florida,South,28,-1.2,-3.4,-13.1,22.6,51,15,27,3,33,42,69
GA,Georgia,South,14,-5.1,0.2,-2.2,11.0,50,31,10,4,34,37,72
HI,Hawaii,West,2,32.2,29.5,23.1,1.4,21,2,11,37,34,40,94
ID,Idaho,West,2,-31.8,-30.8,-36.5,2.0,79,1,14,1,30,37,70
IL,Illinois,Midwest,17,17.1,17.0,10.9,12.5,58,14,18,6,37,39,78
IN,Indiana,Midwest,9,-19.2,-16.1,-19.0,6.9,76,10,8,3,28,38,67
IA,Iowa,Midwest,4,-9.4,-8.2,-13.2,3.2,83,4,7,3,30,38,70
KS,Kansas,Midwest,4,-20.4,-14.6,-16.1,2.9,74,6,13,3,35,37,69
KY,Kentucky,South,6,-29.8,-25.9,-30.5,4.5,83,8,4,2,27,39,60
LA,Louisiana,South,6,-19.6,-18.6,-22.0,4.6,57,32,6,2,26,38,57
ME,Maine,Northeast,2,3.0,9.1,7.0,1.4,91,2,2,1,34,45,68
MD,Maryland,South,8,26.4,33.2,28.5,6.2,47,30,12,7,42,39,98
MA,Massachusetts,Northeast,9,27.2,33.5,25.2,7.0,67,7,13,7,46,40,96
MI,Michigan,Midwest,13,-0.2,2.8,-1.4,10.0,73,14,6,3,31,40,68
MN,Minnesota,Midwest,8,1.5,7.1,4.2,5.7,77,7,6,5,38,38,84
MS,Mississippi,South,4,-17.8,-16.5,-22.9,2.9,56,37,3,1,24,38,52
MO,Missouri,Midwest,8,-18.6,-15.4,-18.4,6.2,77,11,5,2,31,39,65
MT,Montana,West,2,-20.4,-16.4,-19.9,1.1,85,1,4,1,33,40,67
NE,Nebraska,Midwest,3,-25.0,-19.1,-20.5,2.0,76,5,12,3,33,37,71
NV,Nevada,West,4,2.4,2.4,-3.1,3.2,45,10,30,9,27,39,72
NH,New Hampshire,Northeast,2,0.4,7.4,2.8,1.4,87,2,5,3,39,43,90
NJ,New Jersey,Northeast,12,14.1,15.9,5.9,9.3,52,13,22,10,42,40,97
NM,New Mexico,West,3,8.2,10.8,6.0,2.1,35,2,50,2,29,39,58
NY,New York,Northeast,26,22.5,23.1,12.6,19.6,54,14,20,9,39,39,81
NC,North Carolina,South,14,-3.7,-1.3,-3.2,10.8,61,21,11,3,34,39,66
ND,North Dakota,Midwest,1,-35.7,-33.4,-36.5,0.8,82,3,5,2,31,35,71
OH,Ohio,Midwest,15,-8.1,-8.0,-11.2,11.8,77,13,5,3,30,40,66
OK,Oklahoma,South,5,-36.4,-33.1,-34.3,4.1,63,7,12,2,27,37,61
OR,Oregon,West,6,11.0,16.1,14.3,4.2,73,2,14,5,36,40,76
PA,Pennsylvania,Northeast,17,-0.7,1.2,-1.7,13.0,74,11,9,4,34,41,73
RI,Rhode Island,Northeast,2,15.5,20.8,13.8,1.1,70,6,17,4,37,40,81
SC,South Carolina,South,7,-14.3,-11.7,-17.8,5.4,63,25,7,2,31,40,64
SD,South Dakota,Midwest,1,-29.8,-26.2,-29.2,0.9,81,2,5,1,30,37,69
TN,Tennessee,South,9,-26.0,-23.2,-29.7,7.1,72,16,7,2,30,39,64
TX,Texas,South,38,-9.0,-5.6,-13.7,30.5,39,12,40,6,32,35,73
UT,Utah,West,4,-18.1,-20.5,-21.6,3.4,77,1,15,3,36,31,86
VT,Vermont,Northeast,1,26.4,35.4,31.5,0.6,89,1,2,2,41,43,74
VA,Virginia,South,11,5.3,10.1,5.8,8.7,60,19,11,7,41,39,87
WA,Washington,West,10,15.7,19.2,18.2,7.8,65,4,14,10,38,38,90
WV,West Virginia,South,2,-42.1,-38.9,-41.9,1.8,91,4,2,1,23,43,55
WI,Wisconsin,Midwest,8,-0.8,0.6,-0.9,5.9,79,6,8,3,32,40,72
WY,Wyoming,West,1,-46.3,-43.4,-45.8,0.6,82,1,10,1,29,38,72
`
  .trim()
  .split('\n')
  .map((line) => {
    const c = line.split(',')
    const n = (i) => Number(c[i])
    return {
      abbr: c[0],
      name: c[1],
      region: c[2],
      seats: n(3),
      pres: { 2016: n(4), 2020: n(5), 2024: n(6) },
      pop: n(7),
      white: n(8),
      black: n(9),
      hispanic: n(10),
      asian: n(11),
      college: n(12),
      age: n(13),
      income: n(14),
    }
  })

const NATIONAL = { 2016: 2.1, 2020: 4.5, 2024: -1.5 }
const totalSeats = STATES.reduce((s, x) => s + x.seats, 0)
if (totalSeats !== 435) {
  throw new Error(`House apportionment sums to ${totalSeats}, not 435`)
}

const lean = (pres) =>
  0.5 * (pres[2024] - NATIONAL[2024]) +
  0.3 * (pres[2020] - NATIONAL[2020]) +
  0.2 * (pres[2016] - NATIONAL[2016])

// ---- The hidden truth --------------------------------------------------------------------
// A Republican president's first midterm: Democrats drift from D+1 in January to about D+3.4.
const envAt = (t) =>
  1.0 + 2.4 * progress(t) + 0.6 * Math.sin(progress(t) * 9) * (1 - progress(t))
const ENV_FINAL = envAt(ELECTION)

// ---- Senate and governor races (2026 cycle; seats approximately real) --------------------
const SENATE = [
  // state, incumbent party, open seat?, special election?
  ['AL', 'R', true],
  ['AK', 'R', false],
  ['AR', 'R', false],
  ['CO', 'D', false],
  ['DE', 'D', false],
  ['GA', 'D', false],
  ['ID', 'R', false],
  ['IL', 'D', true],
  ['IA', 'R', true],
  ['KS', 'R', false],
  ['KY', 'R', true],
  ['LA', 'R', false],
  ['ME', 'R', false],
  ['MA', 'D', false],
  ['MI', 'D', true],
  ['MN', 'D', true],
  ['MS', 'R', false],
  ['MT', 'R', false],
  ['NE', 'R', false],
  ['NH', 'D', true],
  ['NJ', 'D', false],
  ['NM', 'D', false],
  ['NC', 'R', true],
  ['OK', 'R', false],
  ['OR', 'D', false],
  ['RI', 'D', false],
  ['SC', 'R', false],
  ['SD', 'R', false],
  ['TN', 'R', false],
  ['TX', 'R', false],
  ['VA', 'D', false],
  ['WV', 'R', false],
  ['WY', 'R', false],
  ['OH', 'R', false, true],
  ['FL', 'R', false, true],
]
const GOVERNOR = [
  ['AL', 'R', true],
  ['AK', 'R', true],
  ['AZ', 'D', false],
  ['AR', 'R', false],
  ['CA', 'D', true],
  ['CO', 'D', true],
  ['CT', 'D', false],
  ['FL', 'R', true],
  ['GA', 'R', true],
  ['HI', 'D', false],
  ['ID', 'R', false],
  ['IL', 'D', false],
  ['IA', 'R', true],
  ['KS', 'D', true],
  ['ME', 'D', true],
  ['MD', 'D', false],
  ['MA', 'D', false],
  ['MI', 'D', true],
  ['MN', 'D', true],
  ['NE', 'R', false],
  ['NV', 'R', false],
  ['NH', 'R', false],
  ['NM', 'D', true],
  ['NY', 'D', false],
  ['OH', 'R', true],
  ['OK', 'R', true],
  ['OR', 'D', false],
  ['PA', 'D', false],
  ['RI', 'D', false],
  ['SC', 'R', true],
  ['SD', 'R', false],
  ['TN', 'R', true],
  ['TX', 'R', false],
  ['VT', 'R', false],
  ['WI', 'D', true],
  ['WY', 'R', true],
]

const byAbbr = Object.fromEntries(STATES.map((s) => [s.abbr, s]))

// ---- Geographies: states and House districts ---------------------------------------------
const geographies = []
const districtsByState = {}
for (const s of STATES) {
  s.lean = lean(s.pres)
  geographies.push({
    geo_id: s.abbr,
    kind: 'state',
    state: s.abbr,
    state_name: s.name,
    district_number: '',
    name: s.name,
    region: s.region,
    population: Math.round(s.pop * 1e6),
    pct_white: s.white,
    pct_black: s.black,
    pct_hispanic: s.hispanic,
    pct_asian: s.asian,
    pct_college: s.college,
    median_age: s.age,
    median_income_k: s.income,
    pres_2016: s.pres[2016],
    pres_2020: s.pres[2020],
    pres_2024: s.pres[2024],
  })

  // Districts: spread around the state's lean, re-centred so they average to it.
  const n = s.seats
  const spread = n === 1 ? 0 : clamp(8 + n * 0.35, 9, 24)
  const raw = Array.from({ length: n }, () => normal(0, spread))
  const mean = raw.reduce((a, b) => a + b, 0) / n
  districtsByState[s.abbr] = []
  raw.forEach((z, i) => {
    const dl = s.lean + z - mean
    // Demographics drift with lean the way they do in practice: bluer seats are more
    // college-educated and more diverse.
    const k = (dl - s.lean) / 20
    const college = clamp(s.college + k * 9 + normal(0, 4), 12, 72)
    const black = clamp(s.black + k * 6 + normal(0, 3), 0.5, 70)
    const hispanic = clamp(s.hispanic + k * 5 + normal(0, 5), 1, 85)
    const asian = clamp(s.asian + k * 3 + normal(0, 2), 0.3, 45)
    const white = clamp(100 - black - hispanic - asian - 3, 5, 96)
    // Education realignment: college-heavy seats moved left 2016 -> 2024, others right.
    const eduTrend = (college - 32) * 0.18
    const pres = {
      2024: r1(dl + NATIONAL[2024] + eduTrend * 0.3 + normal(0, 1)),
      2020: r1(dl + NATIONAL[2020] + normal(0, 1)),
      2016: r1(dl + NATIONAL[2016] - eduTrend * 0.6 + normal(0, 1.2)),
    }
    const id = `${s.abbr}-${String(i + 1).padStart(2, '0')}`
    const g = {
      geo_id: id,
      kind: 'district',
      state: s.abbr,
      state_name: s.name,
      district_number: i + 1,
      name: n === 1 ? `${s.name} at-large` : `${s.name} ${ordinal(i + 1)}`,
      region: s.region,
      population: Math.round((s.pop * 1e6) / n),
      pct_white: r1(white),
      pct_black: r1(black),
      pct_hispanic: r1(hispanic),
      pct_asian: r1(asian),
      pct_college: r1(college),
      median_age: r1(clamp(s.age + normal(0, 2.5) - k * 2, 28, 55)),
      median_income_k: Math.round(clamp(s.income + k * 12 + normal(0, 9), 35, 190)),
      pres_2016: pres[2016],
      pres_2020: pres[2020],
      pres_2024: pres[2024],
    }
    geographies.push(g)
    districtsByState[s.abbr].push({ ...g, lean: lean(pres) })
  })
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// ---- Races -------------------------------------------------------------------------------
const races = []
const truth = {} // race_id -> true final D margin

function rating(margin) {
  const m = margin + normal(0, 2.5) // experts are good but not omniscient
  const a = Math.abs(m)
  const side = m > 0 ? 'D' : 'R'
  if (a < 2.5) {
    return 'Toss-up'
  }
  if (a < 6.5) {
    return `Lean ${side}`
  }
  if (a < 12) {
    return `Likely ${side}`
  }
  return `Solid ${side}`
}

function money(scale, margin) {
  const dShare = logistic(margin / 9 + 0.25 + normal(0, 0.35))
  const total = scale * Math.exp(normal(0, 0.35))
  return [
    Math.max(0.1, r1(total * dShare)),
    Math.max(0.1, r1(total * (1 - dShare))),
  ]
}

function addRace({ office, state, district, incParty, open, special }) {
  const s = byAbbr[state]
  const geo = district ? district.geo_id : state
  const L = district ? district.lean : s.lean
  const inc = open ? 0 : incParty === 'D' ? 1 : -1
  let m
  let scale
  if (office === 'Senate') {
    m = L + ENV_FINAL + inc * 2.0 + normal(0, 3.5)
    scale = 18 + s.pop * 4
  } else if (office === 'Governor') {
    // Governors run further from the national tide.
    m = 0.72 * L + 0.7 * ENV_FINAL + inc * 4 + normal(0, 6)
    scale = 12 + s.pop * 3
  } else {
    m = L + ENV_FINAL + inc * 2.5 + normal(0, 2.8)
    scale = 3.5
  }
  const suffix = special ? '-S' : ''
  const race_id =
    office === 'House'
      ? `HOU-${geo}`
      : `${office === 'Senate' ? 'SEN' : 'GOV'}-${state}${suffix}`
  truth[race_id] = m
  const competitive = Math.abs(m) < 12
  const [dRaised, rRaised] = money(competitive ? scale * 1.6 : scale * 0.6, m)
  races.push({
    race_id,
    office,
    state,
    geo_id: geo,
    district_number: district ? district.district_number : '',
    race_name:
      office === 'House'
        ? district.name
        : `${s.name} ${office}${special ? ' (special)' : ''}`,
    is_special: Boolean(special),
    incumbent_party: incParty,
    is_open_seat: Boolean(open),
    expert_rating: rating(m),
    dem_raised_m: dRaised,
    rep_raised_m: rRaised,
  })
}

for (const [state, incParty, open, special] of SENATE) {
  addRace({ office: 'Senate', state, incParty, open, special })
}
for (const [state, incParty, open] of GOVERNOR) {
  addRace({ office: 'Governor', state, incParty, open })
}

// House incumbents: the 215 bluest seats (by lean plus noise) are Democratic, the rest
// Republican — the 2024 result, roughly. About 1 in 9 seats is open.
const allDistricts = Object.values(districtsByState).flat()
const ranked = allDistricts
  .map((d) => ({ d, key: d.lean + normal(0, 3) }))
  .sort((a, b) => b.key - a.key)
ranked.forEach(({ d }, i) => {
  addRace({
    office: 'House',
    state: d.state,
    district: d,
    incParty: i < 215 ? 'D' : 'R',
    open: rand() < 0.11,
  })
})

// ---- Chambers ----------------------------------------------------------------------------
// Senate: 53 R - 47 D (independents caucus D). The Vice President is a Republican, so
// Democrats need 51 seats and Republicans 50.
const senUpD = SENATE.filter((s) => s[1] === 'D').length
const senUpR = SENATE.filter((s) => s[1] === 'R').length
const chambers = [
  {
    chamber: 'Senate',
    total_seats: 100,
    dem_seats_not_up: 47 - senUpD,
    rep_seats_not_up: 53 - senUpR,
    dem_seats_current: 47,
    rep_seats_current: 53,
    dem_needs: 51,
    rep_needs: 50,
  },
  {
    chamber: 'House',
    total_seats: 435,
    dem_seats_not_up: 0,
    rep_seats_not_up: 0,
    dem_seats_current: 215,
    rep_seats_current: 220,
    dem_needs: 218,
    rep_needs: 218,
  },
  {
    chamber: 'Governor',
    total_seats: 50,
    dem_seats_not_up: 23 - GOVERNOR.filter((g) => g[1] === 'D').length,
    rep_seats_not_up: 27 - GOVERNOR.filter((g) => g[1] === 'R').length,
    dem_seats_current: 23,
    rep_seats_current: 27,
    dem_needs: 26,
    rep_needs: 26,
  },
]

// ---- Historical results ------------------------------------------------------------------
const history = []
const NAT_HOUSE = { 2018: 8.6, 2020: 3.1, 2022: -2.7, 2024: -2.6 }
function pushResult(year, office, geo_id, margin, votes) {
  const other = clamp(normal(2.2, 1), 0.4, 6)
  const dem = (100 - other + margin) / 2
  history.push({
    election_year: year,
    office,
    geo_id,
    dem_pct: r1(dem),
    rep_pct: r1(100 - other - dem),
    other_pct: r1(other),
    total_votes: Math.round(votes),
  })
}
for (const y of [2016, 2020, 2024]) {
  pushResult(y, 'President', 'US', NATIONAL[y], { 2016: 137e6, 2020: 158e6, 2024: 155e6 }[y])
}
for (const y of [2018, 2020, 2022, 2024]) {
  pushResult(y, 'House', 'US', NAT_HOUSE[y], { 2018: 113e6, 2020: 152e6, 2022: 107e6, 2024: 151e6 }[y])
}
for (const g of geographies) {
  const turnoutRate = g.kind === 'state' ? 0.48 : 0.47
  for (const y of [2016, 2020, 2024]) {
    const t = { 2016: 0.92, 2020: 1.06, 2024: 1.03 }[y]
    pushResult(y, 'President', g.geo_id, g[`pres_${y}`], g.population * turnoutRate * t * (1 + normal(0, 0.05)))
  }
}
for (const d of allDistricts) {
  for (const y of [2018, 2020, 2022, 2024]) {
    const t = { 2018: 0.78, 2020: 1.04, 2022: 0.72, 2024: 1.0 }[y]
    const m = d.lean + NAT_HOUSE[y] + normal(0, 4)
    pushResult(y, 'House', d.geo_id, clamp(m, -80, 80), d.population * 0.47 * t * (1 + normal(0, 0.06)))
  }
}
// The last Senate race for each seat up in 2026, and the last governor's race.
for (const [state, , , special] of SENATE) {
  const s = byAbbr[state]
  const year = special ? 2022 : 2020
  const nat = special ? -2.7 : 3.1
  pushResult(year, 'Senate', state, s.lean + nat + normal(0, 5), s.pop * 1e6 * 0.45)
}
for (const [state] of GOVERNOR) {
  const s = byAbbr[state]
  const year = state === 'NH' || state === 'VT' ? 2024 : 2022
  pushResult(year, 'Governor', state, 0.72 * s.lean - 2 + normal(0, 8), s.pop * 1e6 * 0.4)
}

// ---- Pollsters ---------------------------------------------------------------------------
const POLLSTER_NAMES = [
  ['Meridian Research', 'A+', 'Live phone + text', 0.2],
  ['Lakeshore University Poll', 'A', 'Live phone', -0.4],
  ['Granite Analytics', 'A', 'Mixed mode', 0.6],
  ['Bellwether Strategies', 'A-', 'Online panel', -1.1],
  ['Civic Pulse', 'B+', 'Online panel', 1.4],
  ['Heartland Opinion', 'B+', 'IVR + online', -2.3],
  ['Northstar Polling', 'B', 'Text-to-web', 0.9],
  ['Pinnacle Insights', 'B', 'Online panel', -1.8],
  ['Atlas Survey Co.', 'B', 'Mixed mode', 2.1],
  ['Redline Data', 'B-', 'IVR', -3.4],
  ['Bluewater Research', 'B-', 'Online panel', 2.9],
  ['Keystone Metrics', 'C+', 'IVR + online', -1.0],
  ['Frontier Polls', 'C', 'Opt-in online', 1.7],
  ['Signal & Noise', 'C', 'Opt-in online', -2.6],
  ['Cardinal Opinion', 'B+', 'Live phone', 0.3],
]
const pollsters = POLLSTER_NAMES.map(([pollster, grade, method, trueHe]) => ({
  pollster,
  grade,
  methodology: method,
  // Published house effect: an estimate of the true lean, with error.
  house_effect: r1(trueHe + normal(0, 0.5)),
  partisan_sponsor: pick(['', '', '', '', 'D', 'R']),
  _true: trueHe,
}))
const gradeVolume = { 'A+': 1, A: 1.2, 'A-': 1.2, 'B+': 1.4, B: 1.6, 'B-': 1.3, 'C+': 1, C: 1.1 }
const weightedPollster = () => {
  const total = pollsters.reduce((s, p) => s + gradeVolume[p.grade], 0)
  let x = rand() * total
  for (const p of pollsters) {
    x -= gradeVolume[p.grade]
    if (x <= 0) {
      return p
    }
  }
  return pollsters.at(-1)
}

// ---- Polls -------------------------------------------------------------------------------
const polls = []
let pollSeq = 1
function makePoll(race_id, t, trueMargin) {
  const p = weightedPollster()
  const n = Math.round(clamp(normal(900, 350), 350, 2500))
  const population = rand() < 0.65 || t > Date.UTC(2026, 8, 1) ? 'LV' : 'RV'
  const sampling = 100 / Math.sqrt(n) * 1.25
  const margin = trueMargin + p._true + normal(0, sampling) + (population === 'RV' ? 0.8 : 0)
  const undecided = clamp(13 - 9 * progress(t) + normal(0, 2), 1, 20)
  const other = clamp(normal(2.5, 1), 0, 6)
  const dem = (100 - undecided - other + margin) / 2
  const dur = 2 + Math.floor(rand() * 4)
  polls.push({
    poll_id: `P${String(pollSeq++).padStart(5, '0')}`,
    race_id,
    pollster: p.pollster,
    start_date: iso(t - dur * DAY),
    end_date: iso(t),
    sample_size: n,
    population,
    dem_pct: r1(dem),
    rep_pct: r1(100 - undecided - other - dem),
    undecided_pct: r1(undecided),
  })
}
const randomDay = (bias = 1) =>
  START + Math.floor(rand() ** (1 / bias) * (AS_OF - START) / DAY) * DAY

// Generic congressional ballot: steady cadence through the year.
for (let i = 0; i < 230; i++) {
  const t = randomDay(1.3)
  makePoll('US-GENERIC', t, envAt(t))
}
// Race polls: competitive races get many, safe ones a few or none; polling bunches late.
const raceTrueAt = (race_id, t) =>
  truth[race_id] - (ENV_FINAL - envAt(t)) + Math.sin((t / DAY) * 0.03 + race_id.length) * 0.8
for (const r of races) {
  const m = truth[r.race_id]
  const a = Math.abs(m)
  let count
  if (r.office === 'House') {
    count = a < 6 ? Math.floor(rand() * 5) : a < 10 ? (rand() < 0.3 ? 1 : 0) : 0
  } else {
    count = a < 5 ? 14 + Math.floor(rand() * 14) : a < 10 ? 6 + Math.floor(rand() * 8) : a < 18 ? Math.floor(rand() * 5) : Math.floor(rand() * 2)
    if (r.office === 'Governor') {
      count = Math.round(count * 0.75)
    }
  }
  for (let i = 0; i < count; i++) {
    const t = randomDay(2.2)
    makePoll(r.race_id, t, raceTrueAt(r.race_id, t))
  }
}
polls.sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : 0))

// ---- Kalshi-style prediction market prices -----------------------------------------------
// Daily closing "Yes, Democrat" price (0-1) and volume. Markets read the same signal as
// polls with their own noise and a slight Republican lean.
const kalshi = []
const MARKET_BIAS = -0.18
function raceSigma(t, office) {
  const daysLeft = (ELECTION - t) / DAY
  const base = office === 'Governor' ? 6.5 : office === 'House' ? 5.5 : 5
  return Math.sqrt(base ** 2 + (daysLeft / 30) ** 2 * 2.2)
}
function marketSeries(market_ticker, race_id, title, probAt) {
  let drift = 0
  for (let t = START; t <= AS_OF + DAY; t += DAY) {
    drift = drift * 0.93 + normal(0, 0.09)
    const p = clamp(probAt(t), 0.01, 0.99)
    const price = clamp(logistic(logit(p) + MARKET_BIAS + drift), 0.01, 0.99)
    const daysLeft = (ELECTION - t) / DAY
    kalshi.push({
      market_ticker,
      race_id,
      market_title: title,
      price_date: iso(t),
      yes_price: r2(price),
      volume_usd: Math.round(
        (race_id.startsWith('US-') ? 400_000 : 25_000) *
          Math.exp(-daysLeft / 70) *
          (0.6 + rand())
      ),
    })
  }
}
for (const r of races) {
  if (r.office === 'House' || Math.abs(truth[r.race_id]) > 14) {
    continue
  }
  const ticker = `KX${r.office === 'Senate' ? 'SEN' : 'GOV'}${r.state}${r.is_special ? 'S' : ''}-26`
  marketSeries(ticker, r.race_id, `Will a Democrat win the ${r.race_name}?`, (t) =>
    phi(raceTrueAt(r.race_id, t) / raceSigma(t, r.office))
  )
}
// Chamber control: a quick simulation over the true margins at each date.
function controlProb(office, t, sims = 600) {
  const ch = chambers.find((c) => c.chamber === office)
  const rs = races.filter((r) => r.office === office)
  let wins = 0
  for (let s = 0; s < sims; s++) {
    const nat = normal(0, 3)
    let d = ch.dem_seats_not_up
    for (const r of rs) {
      if (raceTrueAt(r.race_id, t) + nat + normal(0, raceSigma(t, office) * 0.8) > 0) {
        d++
      }
    }
    if (d >= ch.dem_needs) {
      wins++
    }
  }
  return wins / sims
}
for (const office of ['Senate', 'House']) {
  const weekly = new Map()
  for (let t = START; t <= AS_OF + 7 * DAY; t += 7 * DAY) {
    weekly.set(t, controlProb(office, t))
  }
  const keys = [...weekly.keys()]
  const interp = (t) => {
    const i = Math.min(keys.length - 2, Math.floor((t - START) / (7 * DAY)))
    const a = keys[i]
    const f = (t - a) / (7 * DAY)
    return weekly.get(a) * (1 - f) + weekly.get(keys[i + 1]) * f
  }
  marketSeries(
    office === 'Senate' ? 'KXSENATE-26' : 'KXHOUSE-26',
    office === 'Senate' ? 'US-SENATE' : 'US-HOUSE',
    `Will Democrats win the ${office}?`,
    interp
  )
}

// ---- Presidential approval (daily average) -----------------------------------------------
const approval = []
let wobble = 0
for (let t = START - 60 * DAY; t <= AS_OF; t += DAY) {
  wobble = wobble * 0.95 + normal(0, 0.25)
  const net = -2 - 7.5 * clamp(progress(t), 0, 1) + wobble
  const approve = 46 + net / 2 - 1
  approval.push({
    approval_date: iso(t),
    approve_pct: r1(approve),
    disapprove_pct: r1(approve - net),
  })
}

// ---- Special elections since 2025 --------------------------------------------------------
const special = []
const chambersList = ['State House', 'State Senate', 'State House', 'U.S. House']
for (let i = 0; i < 46; i++) {
  const s = pick(STATES)
  const t = Date.UTC(2025, 0, 10) + Math.floor(rand() * 640) * DAY
  if (t > AS_OF) {
    continue
  }
  const base = clamp(s.pres[2024] + normal(0, 18), -60, 60)
  const swing = normal(10.5, 7) // low-turnout specials overstate the environment
  special.push({
    election_date: iso(t),
    state: s.abbr,
    chamber: pick(chambersList),
    pres_2024_margin: r1(base),
    result_margin: r1(clamp(base + swing, -80, 80)),
    total_votes: Math.round(4000 + rand() * 60_000),
  })
}
special.sort((a, b) => (a.election_date < b.election_date ? -1 : 1))

// ---- Write -------------------------------------------------------------------------------
function writeCsv(name, rows) {
  const cols = Object.keys(rows[0]).filter((c) => !c.startsWith('_'))
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
  writeFileSync(new URL(name, OUT), `${body}\n`)
  console.log(`${name.padEnd(26)} ${String(rows.length).padStart(6)} rows`)
}

writeCsv('geographies.csv', geographies)
writeCsv('races.csv', races)
writeCsv('chambers.csv', chambers)
writeCsv('historical_results.csv', history)
writeCsv('pollsters.csv', pollsters)
writeCsv('polls.csv', polls)
writeCsv('kalshi_prices.csv', kalshi)
writeCsv('approval.csv', approval)
writeCsv('special_elections.csv', special)
