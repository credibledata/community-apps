// The forecast model. Pure: no DOM, no fetch. Imported by the simulation worker, by app.js
// (for the race breakdowns in the drawer) and by tests/model.test.mjs.
//
// Shape of the model, in the order the drawer's waterfall shows it:
//
//   national environment = 70% generic-ballot average + 20% approval prior + 10% specials,
//                          pulled 15% toward the Bitecofer-Lichtman keys environment
//   fundamentals(race)   = lean x elasticity + environment x elasticity + incumbency
//                          + fundraising + demographic swings + Bitecofer-Lichtman terms
//   poll average(race)   = recency/grade/sample weighted, house-effect and trend adjusted
//   expected margin      = blend of fundamentals, polls, expert rating and (optionally) market
//   simulated margin     = expected + national error + regional error + education error
//                          + race error, drawn together so races move together
//
// Every number is D minus R in points. Inputs are the rows the Malloy views return. "D" is
// the Democrat or the independent standing in for one (Osborn in Nebraska); "R" likewise.
//
// The forecast is as of the snapshot date, which comes from the data (prep.asOf), not the
// clock: re-opening the app next month shows the same forecast until the data is rebuilt.

export const ELECTION_DAY = Date.UTC(2026, 10, 3)
const DAY = 86_400_000

export const REGIONS = ['Northeast', 'Midwest', 'South', 'West']
const NATIONAL_COLLEGE = 33
const NATIONAL_NONWHITE = 41

export const DEFAULT_CONTROLS = Object.freeze({
  /** Points added to the national environment (positive = toward Democrats). */
  envShift: 0,
  /** Multiplier on how much the blend trusts polls over fundamentals. 0 = ignore polls. */
  pollTrust: 1,
  /** Poll recency half-life in days. */
  halfLife: 21,
  /** Standard deviation of the shared national polling/environment error, points. */
  nationalError: 3,
  /** Incumbency advantage for a member running again, points. */
  incumbency: 2.5,
  /** Extra swing among college graduates toward Democrats, points. */
  collegeSwing: 0,
  /** Extra swing among voters of color toward Democrats, points. */
  nonwhiteSwing: 0,
  /** Share of the blend given to the prediction-market price where one exists, 0-0.6. */
  marketWeight: 0.3,
  /** Strength of the Bitecofer-Lichtman layer, 0 (off) to 1 (full). */
  blWeight: 1,
})

/** Ranges the UI and the URL hash accept; anything outside is clamped. */
export const CONTROL_RANGES = Object.freeze({
  envShift: [-10, 10, 0.5],
  pollTrust: [0, 2, 0.1],
  halfLife: [5, 90, 1],
  nationalError: [0.5, 7, 0.25],
  incumbency: [0, 6, 0.25],
  collegeSwing: [-10, 10, 0.5],
  nonwhiteSwing: [-10, 10, 0.5],
  marketWeight: [0, 0.6, 0.05],
  blWeight: [0, 1, 0.25],
})

export const PRESETS = Object.freeze({
  forecast: { label: 'Default assumptions', patch: {} },
  blueWave: {
    label: 'Stronger D environment',
    patch: { envShift: 4, collegeSwing: 3 },
  },
  redWave: { label: 'Stronger R environment', patch: { envShift: -4, nonwhiteSwing: -4 } },
  pollMiss: {
    label: '2020-style polling miss',
    patch: { envShift: -3, nationalError: 4 },
  },
  fundamentals: {
    label: 'Fundamentals only',
    patch: { pollTrust: 0 },
  },
  market: { label: 'Heavier market weight', patch: { marketWeight: 0.6 } },
})

export function clampControls(c) {
  const out = { ...DEFAULT_CONTROLS }
  for (const [k, [lo, hi]] of Object.entries(CONTROL_RANGES)) {
    const v = Number(c?.[k])
    out[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : out[k]
  }
  return out
}

// ---- Small math ---------------------------------------------------------------------------
export const dayOf = (iso) => Date.parse(String(iso).slice(0, 10))

export function normCdf(z) {
  // Abramowitz-Stegun 7.1.26 via erf.
  const x = z / Math.SQRT2
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
  return 0.5 * (1 + s * y)
}

/** Inverse standard normal CDF (Acklam). */
export function normInv(p) {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p))
  const a = [
    -39.696_830_286_653_76, 220.946_098_424_520_5, -275.928_510_446_968_7,
    138.357_751_867_269, -30.664_798_066_147_16, 2.506_628_277_459_239,
  ]
  const b = [
    -54.476_098_798_224_06, 161.585_836_858_040_9, -155.698_979_859_886_6,
    66.801_311_887_719_72, -13.280_681_552_885_72,
  ]
  const c = [
    -0.007_784_894_002_430_293, -0.322_396_458_041_136_4, -2.400_758_277_161_838,
    -2.549_732_539_343_734, 4.374_664_141_464_968, 2.938_163_982_698_783,
  ]
  const d = [
    0.007_784_695_709_041_462, 0.322_467_129_070_039_8, 2.445_134_137_142_996,
    3.754_408_661_907_416,
  ]
  const lo = 0.024_25
  if (q < lo) {
    const r = Math.sqrt(-2 * Math.log(q))
    return (
      (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
      ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
    )
  }
  if (q > 1 - lo) {
    return -normInv(1 - q)
  }
  const r = q - 0.5
  const s = r * r
  return (
    ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) *
      r) /
    (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
  )
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Fill `out` with standard normals from a seeded stream (Box-Muller, both outputs used). */
export function fillNormals(out, seed) {
  const r = mulberry32(seed)
  for (let i = 0; i < out.length; i += 2) {
    const u = 1 - r()
    const v = r()
    const m = Math.sqrt(-2 * Math.log(u))
    out[i] = m * Math.cos(2 * Math.PI * v)
    if (i + 1 < out.length) {
      out[i + 1] = m * Math.sin(2 * Math.PI * v)
    }
  }
  return out
}

// ---- Poll averaging -----------------------------------------------------------------------
/**
 * Weight of one poll as of `asOf`: grade x sqrt(sample / 600) x 0.5^(age / halfLife).
 * Polls that end after `asOf` get zero weight (they had not been published yet).
 */
export function pollWeight(poll, asOf, halfLife) {
  const end = dayOf(poll.end_date)
  if (!(end <= asOf)) {
    return 0
  }
  const age = (asOf - end) / DAY
  const n = Math.max(100, Number(poll.sample_size) || 600)
  return (
    (Number(poll.grade_weight) || 0.35) *
    Math.sqrt(n / 600) *
    0.5 ** (age / halfLife)
  )
}

/** Weighted average of adjusted margins. Returns { avg, strength, count }. */
export function pollAverage(polls, asOf, halfLife, shiftFor = null) {
  let sw = 0
  let swx = 0
  let count = 0
  for (const p of polls) {
    const w = pollWeight(p, asOf, halfLife)
    if (w <= 0) {
      continue
    }
    const x = p.adjusted_margin + (shiftFor ? shiftFor(p) : 0)
    sw += w
    swx += w * x
    count++
  }
  return { avg: sw > 0 ? swx / sw : null, strength: sw, count }
}

// ---- Model inputs -------------------------------------------------------------------------
/**
 * The snapshot date: `data.asOf` if given, else the latest poll or approval day (the build
 * drops everything after the snapshot, and the approval average runs through it).
 */
export function snapshotDate(data) {
  if (data.asOf) {
    return dayOf(data.asOf)
  }
  let t = -Infinity
  for (const p of data.polls || []) {
    t = Math.max(t, dayOf(p.end_date))
  }
  for (const a of data.approval || []) {
    t = Math.max(t, dayOf(a.approval_date))
  }
  if (!Number.isFinite(t)) {
    throw new Error('no dated polls or approval rows to take the snapshot date from')
  }
  return t
}

/** Which side the incumbent is on: 1 = D side, -1 = R side, 0 = none or unknown. */
export function incumbentSign(race) {
  if (race.is_open_seat || !race.incumbent_party) {
    return 0
  }
  if (race.incumbent_party === 'D') {
    return 1
  }
  if (race.incumbent_party === 'R') {
    return -1
  }
  // An independent incumbent counts for the side they stand on ("Kevin Kiley: Incumbent ...").
  const name = String(race.incumbent_status || '').split(':')[0].trim()
  if (name && String(race.dem_candidate || '').includes(name)) {
    return 1
  }
  if (name && String(race.rep_candidate || '').includes(name)) {
    return -1
  }
  return 0
}

/**
 * Index the raw query results once. `data` is
 *   { races, polls, chambers, markets, approval, specials, asOf? }
 * as returned by the app's Malloy queries (see query.js).
 */
export function prepare(data) {
  const pollsByRace = new Map()
  const generic = []
  for (const p of data.polls) {
    const row = { ...p, _end: dayOf(p.end_date) }
    if (p.race_id === 'US-GENERIC') {
      generic.push(row)
    } else {
      if (!pollsByRace.has(p.race_id)) {
        pollsByRace.set(p.race_id, [])
      }
      pollsByRace.get(p.race_id).push(row)
    }
  }
  const marketsByRace = new Map()
  for (const m of data.markets || []) {
    if (!marketsByRace.has(m.race_id)) {
      marketsByRace.set(m.race_id, [])
    }
    marketsByRace
      .get(m.race_id)
      .push({ t: dayOf(m.price_week), price: m.avg_price })
  }
  for (const arr of marketsByRace.values()) {
    arr.sort((a, b) => a.t - b.t)
  }
  const approval = (data.approval || [])
    .map((a) => ({ t: dayOf(a.approval_date), net: a.net_approval }))
    .sort((a, b) => a.t - b.t)
  // Districts redrawn for 2026 have no census tabulation yet; they read as the nation.
  const races = data.races.map((r, i) => ({
    ...r,
    index: i,
    regionIndex: Math.max(0, REGIONS.indexOf(r.region)),
    pct_nonwhite: r.pct_white === null || r.pct_white === undefined ? NATIONAL_NONWHITE : 100 - Number(r.pct_white),
  }))
  const asOf = snapshotDate(data)
  const firstGeneric = Math.min(...generic.map((p) => p._end))
  return {
    asOf,
    // The history starts once two weeks of generic-ballot polling exist.
    historyStart: Number.isFinite(firstGeneric) ? Math.min(asOf, firstGeneric + 14 * DAY) : asOf,
    races,
    raceById: new Map(races.map((r) => [r.race_id, r])),
    generic,
    pollsByRace,
    marketsByRace,
    approval,
    specials: data.specials || { weighted_swing: 0, special_count: 0 },
    chambers: Object.fromEntries(data.chambers.map((c) => [c.chamber, c])),
  }
}

/** Latest market price at or before `asOf`, or null. */
export function marketPrice(prep, raceId, asOf) {
  const arr = prep.marketsByRace.get(raceId)
  if (!arr) {
    return null
  }
  let last = null
  for (const m of arr) {
    if (m.t <= asOf) {
      last = m.price
    } else {
      break
    }
  }
  return last
}

function netApprovalAt(prep, asOf) {
  // 14-day trailing mean.
  let s = 0
  let n = 0
  for (const a of prep.approval) {
    if (a.t <= asOf && a.t > asOf - 14 * DAY) {
      s += a.net
      n++
    }
  }
  return n ? s / n : 0
}

/** Generic-ballot average at a date, memoised per (asOf, halfLife). */
function genericAt(prep, asOf, halfLife) {
  prep._gcache ||= new Map()
  const key = `${asOf}|${halfLife}`
  if (!prep._gcache.has(key)) {
    prep._gcache.set(key, pollAverage(prep.generic, asOf, halfLife))
  }
  return prep._gcache.get(key)
}

// ---- The Bitecofer-Lichtman layer ---------------------------------------------------------
// A structural layer after Allan Lichtman (judge the party holding the White House on a
// checklist of keys, not the horse race) and Rachel Bitecofer (polarization leaves few swing
// voters; midterms are decided by who turns out, and negative partisanship mobilises the party
// out of power). Applied to 2026:
//   - The partisan lean is built from 2016, 2020 and 2024, all with Trump on the ballot. His
//     coalition's low-propensity voters (heavily non-college and, by 2024, increasingly
//     nonwhite) did not show up for Republicans without him in 2018 or in the 2025 off-year
//     races, while college graduates turned out against him. The composition terms re-read
//     the lean for a Trump-off-ballot electorate. They are centred on the national shares, so
//     they move races relative to each other, not the national total.
//   - Polls underestimated Republicans with Trump on the ballot (2016, 2020, 2024) but not
//     without him (2018, 2022, 2025), so the layer adds a small off-ballot poll correction.
//   - Polarization shrinks what candidates themselves can do: smaller incumbency and money
//     effects and a slightly tighter race-level error.
// Each key is true when it counts against the White House party (Republicans in 2026).
// `judgment` keys are the modeller's calls as of the snapshot. Edit them here.
export const KEYS_2026 = Object.freeze([
  { id: 'midterm', label: 'Midterm with the president’s party defending', turned: () => true },
  { id: 'approval', label: 'Presidential net approval below −5', turned: (ctx) => ctx.netApproval < -5 },
  { id: 'specials', label: 'Special elections swinging D by more than 3', turned: (ctx) => ctx.specialSwing > 3 },
  { id: 'offyear', label: '2025 off-year results favoring the out-party (NJ and VA governors, CA Prop 50)', turned: () => true, judgment: true },
  { id: 'global', label: 'International results running against incumbents or Trump-aligned parties (UK 2024; Canada, Australia 2025)', turned: () => true, judgment: true },
  { id: 'shortEcon', label: 'Recession during the campaign', turned: () => false, judgment: true },
  { id: 'longEcon', label: 'Weak long-term growth', turned: () => false, judgment: true },
  { id: 'policy', label: 'No major policy change this term', turned: () => false, judgment: true },
  { id: 'unrest', label: 'Sustained social unrest', turned: () => false, judgment: true },
  { id: 'scandal', label: 'Major White House scandal', turned: () => false, judgment: true },
  { id: 'foreign', label: 'Major foreign or military failure', turned: () => false, judgment: true },
])

const BL = {
  /** Keys environment = 2024 national margin + this many points per turned key. */
  perKey: 1.25,
  /** Share of the national environment given to the keys environment at full strength. */
  keysShare: 0.15,
  /** Points toward D per point of college share above the nation (2018 suburban turnout). */
  college: 0.06,
  /** Points toward D per point of nonwhite share above the nation (2024 gains not carrying over). */
  offBallot: 0.05,
  /** Off-ballot poll correction toward D, points. */
  pollCorrection: 0.75,
  /** Fraction of the incumbency and fundraising terms polarization takes away. */
  incumbencyCut: 0.25,
  moneyCut: 0.5,
  /** Fractional cut in race-level error. */
  sigmaCut: 0.08,
}

/** Which keys are turned against the White House party, and the environment they imply. */
export function lichtmanKeys(netApproval, specialSwing) {
  const ctx = { netApproval, specialSwing }
  const keys = KEYS_2026.map((k) => ({ id: k.id, label: k.label, judgment: !!k.judgment, turned: k.turned(ctx) }))
  const turned = keys.filter((k) => k.turned).length
  return { keys, turned, environment: -1.5 + BL.perKey * turned }
}

/**
 * The national environment and its parts.
 *   genericBallot: recency-weighted generic-ballot average
 *   approvalPrior: -0.3 x net approval (the president is a Republican: unpopularity helps D)
 *   specialsSignal: 2024 national margin + 35% of the average special-election swing
 *   keysTerm: what the Bitecofer-Lichtman keys environment adds (blended in at 15% x blWeight)
 */
export function nationalEnvironment(prep, controls, asOf = prep.asOf) {
  const gb = genericAt(prep, asOf, controls.halfLife)
  const net = netApprovalAt(prep, asOf)
  const approvalPrior = -0.3 * net
  const specialsSignal = -1.5 + 0.35 * (prep.specials.weighted_swing || 0)
  const genericBallot = gb.avg ?? approvalPrior
  const base = 0.7 * genericBallot + 0.2 * approvalPrior + 0.1 * specialsSignal
  const keys = lichtmanKeys(net, prep.specials.weighted_swing || 0)
  const keysShare = BL.keysShare * (controls.blWeight ?? 0)
  const keysTerm = keysShare * (keys.environment - base)
  return {
    genericBallot,
    genericPolls: gb.count,
    netApproval: net,
    approvalPrior,
    specialsSignal,
    keys,
    keysShare,
    keysTerm,
    shift: controls.envShift,
    value: base + keysTerm + controls.envShift,
  }
}

const OFFICE = {
  Senate: { leanK: 1, envK: 1, incK: 1, moneyK: 1.4, sigma: 4.5 },
  House: { leanK: 1, envK: 1, incK: 1, moneyK: 0.9, sigma: 4.8 },
  // Governors run further from the national tide and get a bigger personal vote.
  Governor: { leanK: 0.72, envK: 0.7, incK: 1.6, moneyK: 1.2, sigma: 6.2 },
}

const RATING_MARGIN = { 3: 14, 2: 8, 1: 4, 0: 0, '-1': -4, '-2': -8, '-3': -14 }

/**
 * Everything about one race's expected margin, as named parts — the drawer's waterfall
 * reads these directly, so the explanation can never drift from the arithmetic.
 */
export function raceBreakdown(prep, race, controls, env, asOf = prep.asOf) {
  const k = OFFICE[race.office] || OFFICE.House
  const lean = Number(race.race_lean) || 0
  const leanTerm = k.leanK * lean
  const envTerm = k.envK * env.value
  const incTerm = incumbentSign(race) * controls.incumbency * k.incK
  // Fundraising only counts when both sides have filed (governors file with states, not the FEC).
  const d = Number(race.dem_raised_m)
  const r = Number(race.rep_raised_m)
  const hasMoney = race.dem_raised_m !== null && race.rep_raised_m !== null && d >= 0 && r >= 0
  const moneyTerm = hasMoney
    ? Math.max(-3, Math.min(3, k.moneyK * Math.log(Math.max(0.1, d) / Math.max(0.1, r))))
    : 0
  const collegeTerm = (controls.collegeSwing * (Number(race.pct_college) || NATIONAL_COLLEGE)) / 100
  const nonwhiteTerm = (controls.nonwhiteSwing * race.pct_nonwhite) / 100
  const bw = controls.blWeight ?? 0
  const college = Number(race.pct_college) || NATIONAL_COLLEGE
  const bl = {
    college: bw * k.leanK * BL.college * (college - NATIONAL_COLLEGE),
    offBallot: bw * k.leanK * BL.offBallot * (race.pct_nonwhite - NATIONAL_NONWHITE),
    incumbency: -bw * BL.incumbencyCut * incTerm,
    money: -bw * BL.moneyCut * moneyTerm,
    polls: bw * BL.pollCorrection * k.envK,
  }
  const blTerm = bl.college + bl.offBallot + bl.incumbency + bl.money
  const fundamentals =
    leanTerm + envTerm + incTerm + moneyTerm + collegeTerm + nonwhiteTerm + blTerm

  // Polls, each shifted by how much the national generic ballot has moved since it was taken
  // (the trend-line adjustment), so an old poll is read in today's environment. The user's
  // national shift and demographic swings apply to polls too: they are "what if the polls
  // are wrong" levers, not fundamentals-only levers.
  const gbNow = genericAt(prep, asOf, controls.halfLife).avg ?? 0
  const racePolls = prep.pollsByRace.get(race.race_id) || []
  const trend = (p) => gbNow - (genericAt(prep, p._end, controls.halfLife).avg ?? gbNow)
  const pa = pollAverage(racePolls, asOf, controls.halfLife, trend)
  const scenarioOnPolls = controls.envShift * k.envK + collegeTerm + nonwhiteTerm + bl.polls
  const pollAvg = pa.avg === null ? null : pa.avg + scenarioOnPolls

  // Blend weights. Poll weight grows with poll strength (sum of weights, ~1 per fresh A-grade
  // poll of 600) and saturates; the user's poll-trust lever scales it.
  const daysLeft = Math.max(0, (ELECTION_DAY - asOf) / DAY)
  let wPoll = pa.avg === null ? 0 : (pa.strength / (pa.strength + 1.2)) * 0.8
  wPoll = Math.min(0.92, wPoll * controls.pollTrust)
  // Unrated races (no Sabato rating) give the expert term no weight rather than a guess.
  const rated = race.rating_score !== null && race.rating_score !== undefined
  const ratingScore = rated ? Number(race.rating_score) : 0
  let expert = rated ? (RATING_MARGIN[ratingScore] ?? 0) : null
  if (rated && Math.abs(ratingScore) === 3 && Math.sign(fundamentals) === Math.sign(ratingScore)) {
    expert = Math.sign(ratingScore) * Math.max(14, Math.abs(fundamentals))
  }
  const wExpert = rated ? 0.08 : 0
  const price = marketPrice(prep, race.race_id, asOf)
  const sigma = raceSigma(race.office, daysLeft, pa.strength, controls)
  const market = price === null ? null : normInv(price) * sigma
  const wMarket = market === null ? 0 : controls.marketWeight
  let wFund = 1 - wPoll - wExpert - wMarket
  if (wFund < 0.05) {
    const scale = 0.95 / (wPoll + wExpert + wMarket)
    wPoll *= scale
    wFund = 0.05
  }
  const total = wFund + wPoll + wExpert + wMarket
  const mean =
    (wFund * fundamentals +
      wPoll * (pollAvg ?? 0) +
      wExpert * (expert ?? 0) +
      wMarket * (market ?? 0)) /
    total
  // Both finalists from one party (California's top two, unopposed seats): decided.
  const locked = race.locked_party === 'D' ? 1 : race.locked_party === 'R' ? -1 : 0

  return {
    race_id: race.race_id,
    locked,
    lean,
    leanTerm,
    envTerm,
    incTerm,
    moneyTerm,
    collegeTerm,
    nonwhiteTerm,
    bl,
    blTerm,
    fundamentals,
    pollAvg,
    rawPollAvg: pa.avg,
    pollCount: pa.count,
    pollStrength: pa.strength,
    expert,
    market,
    marketPrice: price,
    weights: {
      fundamentals: wFund / total,
      polls: wPoll / total,
      expert: wExpert / total,
      market: wMarket / total,
    },
    mean,
    sigma,
    pWin: locked ? (locked > 0 ? 1 : 0) : normCdf(mean / Math.sqrt(sigma ** 2 + totalSharedVar(race, controls))),
  }
}

/** Race-specific (unshared) error: wider with fewer polls and more time left. */
export function raceSigma(office, daysLeft, pollStrength, controls) {
  const base = (OFFICE[office] || OFFICE.House).sigma
  const time = (daysLeft / 30) ** 2 * 1.8
  const thin = 1 + 0.35 / (1 + pollStrength)
  const polarization = 1 - BL.sigmaCut * (controls.blWeight ?? 0)
  return Math.sqrt(base ** 2 + time) * thin * (controls.pollTrust === 0 ? 1.1 : 1) * polarization
}

const REGION_SD = 1.6
const EDU_SD = 2.2
function eduLoading(race) {
  return ((Number(race.pct_college) || NATIONAL_COLLEGE) - NATIONAL_COLLEGE) / 12
}
function totalSharedVar(race, controls) {
  const k = OFFICE[race.office] || OFFICE.House
  return (
    (k.envK * controls.nationalError) ** 2 +
    REGION_SD ** 2 +
    (EDU_SD * eduLoading(race)) ** 2
  )
}

/** A short explanation of every poll's contribution, for the drawer's poll table. */
export function pollContributions(prep, race, controls, asOf = prep.asOf) {
  const gbNow = genericAt(prep, asOf, controls.halfLife).avg ?? 0
  const rows = (prep.pollsByRace.get(race.race_id) || []).map((p) => {
    const w = pollWeight(p, asOf, controls.halfLife)
    const trendAdj = gbNow - (genericAt(prep, p._end, controls.halfLife).avg ?? gbNow)
    return { ...p, weight: w, trendAdj, final: p.adjusted_margin + trendAdj }
  })
  const total = rows.reduce((s, r) => s + r.weight, 0)
  for (const r of rows) {
    r.share = total > 0 ? r.weight / total : 0
  }
  return rows.sort((a, b) => b.share - a.share)
}

// ---- Simulation ---------------------------------------------------------------------------
export const HIST_MIN = -30
export const HIST_MAX = 30

/**
 * Run the Monte Carlo. Common random numbers: the same `seed` gives the same draws, so a
 * slider move changes the forecast only through the model, never through sampling noise.
 *
 * Returns per-race win probabilities, margin quantiles and histograms; per-chamber seat
 * distributions and control odds; tipping-point and conditional probabilities.
 */
export function simulate(prep, controls, opts = {}) {
  const sims = opts.sims ?? 10_000
  const asOf = opts.asOf ?? prep.asOf
  const seed = opts.seed ?? 538
  const offices = opts.offices ?? ['Senate', 'House', 'Governor']
  const detail = opts.detail ?? true
  const env = nationalEnvironment(prep, controls, asOf)

  const out = { env, sims, asOf, races: {}, chambers: {} }
  const shared = new Float64Array(sims * 6)
  fillNormals(shared, seed)

  for (const office of offices) {
    const rs = prep.races.filter((r) => r.office === office)
    const ch = prep.chambers[office]
    const k = OFFICE[office]
    const bds = rs.map((r) => raceBreakdown(prep, r, controls, env, asOf))
    const n = rs.length
    const noise = new Float64Array(sims * n)
    fillNormals(noise, seed * 31 + office.length)

    const wins = new Uint32Array(n)
    const sumM = new Float64Array(n)
    const hist = detail ? rs.map(() => new Uint32Array(HIST_MAX - HIST_MIN + 1)) : null
    const margins = detail ? rs.map(() => new Float32Array(sims)) : null
    const seatHist = new Uint32Array(ch.total_seats + 1)
    const tip = new Uint32Array(n)
    const winAndControl = new Uint32Array(n)
    const lossAndControl = new Uint32Array(n)
    const seatsBySim = new Uint16Array(sims)
    const controlBySim = new Uint8Array(sims)
    const m = new Float64Array(n)
    const order = Array.from({ length: n }, (_, i) => i)
    const dNeedUp = ch.dem_needs - ch.dem_seats_not_up
    const rNeedUp = ch.rep_needs - ch.rep_seats_not_up
    const loads = rs.map(eduLoading)
    let control = 0

    for (let s = 0; s < sims; s++) {
      const base = s * 6
      const nat = shared[base] * controls.nationalError * k.envK
      const edu = shared[base + 5] * EDU_SD
      let dUp = 0
      for (let i = 0; i < n; i++) {
        const reg = shared[base + 1 + rs[i].regionIndex] * REGION_SD
        const x = bds[i].locked
          ? bds[i].locked * HIST_MAX
          : bds[i].mean + nat + reg + edu * loads[i] + noise[s * n + i] * bds[i].sigma
        m[i] = x
        sumM[i] += x
        if (x > 0) {
          wins[i]++
          dUp++
        }
        if (detail) {
          margins[i][s] = x
          const b = Math.round(Math.max(HIST_MIN, Math.min(HIST_MAX, x))) - HIST_MIN
          hist[i][b]++
        }
      }
      const dSeats = ch.dem_seats_not_up + dUp
      seatHist[dSeats]++
      seatsBySim[s] = dSeats
      const dControl = dSeats >= ch.dem_needs
      controlBySim[s] = dControl ? 1 : 0
      if (dControl) {
        control++
      }
      // Tipping point: sort by margin toward the winner and take the seat that clinches it.
      if (detail) {
        if (dControl) {
          order.sort((a, b) => m[b] - m[a])
          if (dNeedUp >= 1 && dNeedUp <= n) {
            tip[order[dNeedUp - 1]]++
          }
        } else {
          order.sort((a, b) => m[a] - m[b])
          if (rNeedUp >= 1 && rNeedUp <= n) {
            tip[order[rNeedUp - 1]]++
          }
        }
        for (let i = 0; i < n; i++) {
          if (m[i] > 0) {
            if (dControl) {
              winAndControl[i]++
            }
          } else if (dControl) {
            lossAndControl[i]++
          }
        }
      }
    }

    let seatSum = 0
    for (let v = 0; v < seatHist.length; v++) {
      seatSum += v * seatHist[v]
    }
    const tipTotal = tip.reduce((a, b) => a + b, 0) || 1
    rs.forEach((r, i) => {
      const res = {
        office,
        breakdown: bds[i],
        pWin: wins[i] / sims,
        meanMargin: sumM[i] / sims,
      }
      if (detail) {
        const sorted = margins[i].slice().sort()
        res.p10 = sorted[Math.floor(sims * 0.1)]
        res.p50 = sorted[Math.floor(sims * 0.5)]
        res.p90 = sorted[Math.floor(sims * 0.9)]
        res.hist = Array.from(hist[i])
        res.tipping = tip[i] / tipTotal
        res.controlIfWin = wins[i] ? winAndControl[i] / wins[i] : null
        res.controlIfLoss = sims - wins[i] ? lossAndControl[i] / (sims - wins[i]) : null
      }
      out.races[r.race_id] = res
    })
    const sortedSeats = Array.from(seatsBySim).sort((a, b) => a - b)
    out.chambers[office] = {
      pDemControl: control / sims,
      expectedDemSeats: seatSum / sims,
      seatHist: Array.from(seatHist),
      p10: sortedSeats[Math.floor(sims * 0.1)],
      p50: sortedSeats[Math.floor(sims * 0.5)],
      p90: sortedSeats[Math.floor(sims * 0.9)],
      demNeeds: ch.dem_needs,
      repNeeds: ch.rep_needs,
      demNotUp: ch.dem_seats_not_up,
      repNotUp: ch.rep_seats_not_up,
      total: ch.total_seats,
      current: { D: ch.dem_seats_current, R: ch.rep_seats_current },
    }
  }
  return out
}

/** Weekly as-of dates from `from` to the snapshot `to`, ending exactly on `to`. */
export function historyDates(from, to) {
  const out = []
  for (let t = from; t < to; t += 7 * DAY) {
    out.push(t)
  }
  out.push(to)
  return out
}

/**
 * Sensitivity: how much each lever moves the chance Democrats control `office`, using
 * common random numbers so the bars show the model, not noise.
 */
export const SENSITIVITY_STEPS = Object.freeze({
  envShift: 2,
  pollTrust: 0.5,
  halfLife: 14,
  nationalError: 1.5,
  incumbency: 1.5,
  collegeSwing: 4,
  nonwhiteSwing: 4,
  marketWeight: 0.3,
  blWeight: 0.5,
})

export function sensitivity(prep, controls, office, sims = 2500) {
  const run = (c) =>
    simulate(prep, clampControls(c), { sims, offices: [office], detail: false })
      .chambers[office].pDemControl
  const base = run(controls)
  return Object.entries(SENSITIVITY_STEPS).map(([key, step]) => {
    const lo = run({ ...controls, [key]: controls[key] - step })
    const hi = run({ ...controls, [key]: controls[key] + step })
    return { key, step, lo: lo - base, hi: hi - base, base }
  })
}
