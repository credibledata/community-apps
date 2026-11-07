// The simulation. Pure: no DOM, no fetch. Imported by the simulation worker, by app.js and
// by tests/model.test.mjs.
//
// Everything before the simulation lives in the Malloy model (forecast.malloy): the national
// environment, each race's poll average, and the blend of fundamentals, polls, experts and
// market into an expected margin (mean) and a race-level error (sigma). The browser takes
// those and plays the election out many times:
//
//   simulated margin = mean + national error + regional error + education error
//                      + race error x sigma, drawn together so races move together
//
// Every number is D minus R in points. "D" is the Democrat or the independent standing in for
// one (Osborn in Nebraska); "R" likewise.

export const ELECTION_DAY = Date.UTC(2026, 10, 3)
const DAY = 86_400_000

export const REGIONS = ['Northeast', 'Midwest', 'South', 'West']

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

// ---- Model inputs -------------------------------------------------------------------------
/**
 * Index the boot query results once, for the simulation and the charts. `data` is
 *   { races, polls, chambers, markets }
 * as returned by the app's Malloy queries (see query.js), and `asOf` is the forecast day the
 * Malloy model reports (national.as_of_day).
 */
export function prepare(data, asOf) {
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
    marketsByRace.get(m.race_id).push({ t: dayOf(m.price_week), price: m.avg_price })
  }
  for (const arr of marketsByRace.values()) {
    arr.sort((a, b) => a.t - b.t)
  }
  const races = data.races.map((r, i) => ({
    ...r,
    index: i,
    regionIndex: Math.max(0, REGIONS.indexOf(r.region)),
  }))
  const t = dayOf(asOf)
  const firstGeneric = Math.min(...generic.map((p) => p._end))
  return {
    asOf: t,
    // The history starts once two weeks of generic-ballot polling exist.
    historyStart: Number.isFinite(firstGeneric) ? Math.min(t, firstGeneric + 14 * DAY) : t,
    races,
    raceById: new Map(races.map((r) => [r.race_id, r])),
    generic,
    pollsByRace,
    pollById: new Map(data.polls.map((p) => [p.poll_id, p])),
    marketsByRace,
    chambers: Object.fromEntries(data.chambers.map((c) => [c.chamber, c])),
  }
}

/** One row of forecast.malloy `race_breakdown -> breakdown`, in the shape the app reads. */
export function breakdownFromRow(row) {
  return {
    race_id: row.race_id,
    locked: row.locked,
    lean: row.lean,
    leanTerm: row.lean_term,
    envTerm: row.environment_term,
    incTerm: row.incumbency_term,
    moneyTerm: row.money_term,
    collegeTerm: row.college_term,
    nonwhiteTerm: row.nonwhite_term,
    collegePct: row.college_pct,
    nonwhitePct: row.nonwhite_pct,
    bl: {
      college: row.bl_college,
      offBallot: row.bl_off_ballot,
      incumbency: row.bl_incumbency,
      money: row.bl_money,
      polls: row.bl_polls,
    },
    blTerm: row.bl_term,
    fundamentals: row.fundamentals,
    pollAvg: row.poll_average,
    rawPollAvg: row.raw_poll_average,
    pollCount: row.poll_count,
    pollStrength: row.poll_strength,
    expert: row.expert,
    market: row.market,
    marketPrice: row.market_price,
    weights: {
      fundamentals: row.weight_fundamentals,
      polls: row.weight_polls,
      expert: row.weight_expert,
      market: row.weight_market,
    },
    mean: row.mean,
    sigma: row.sigma,
    envK: row.env_k,
    eduLoading: row.edu_loading,
  }
}

/** The row of forecast.malloy `national -> summary` for one day, in the shape the app reads. */
export function environmentFromRow(row) {
  return {
    asOf: row.as_of_day,
    genericBallot: row.generic_ballot,
    genericPolls: row.generic_polls,
    netApproval: row.net_approval,
    approvalPrior: row.approval_prior,
    specialsSignal: row.specials_signal,
    keys: { turned: row.keys_turned, total: row.keys_total, environment: row.keys_environment },
    keysShare: row.keys_share,
    keysTerm: row.keys_term,
    shift: row.env_shift,
    value: row.environment,
    regionSd: row.region_sd,
    eduSd: row.edu_sd,
  }
}

// ---- Simulation ---------------------------------------------------------------------------
export const HIST_MIN = -30
export const HIST_MAX = 30

/**
 * Run the Monte Carlo over one forecast day. `forecast` is what forecast.malloy computed for
 * that day under `controls`: { env, breakdowns }, where `breakdowns` maps race_id to the
 * race's breakdown (breakdownFromRow) and `env` is environmentFromRow.
 *
 * Common random numbers: the same `seed` gives the same draws, so a slider move changes the
 * forecast only through the model, never through sampling noise.
 *
 * Returns per-race win probabilities, margin quantiles and histograms; per-chamber seat
 * distributions and control odds; tipping-point and conditional probabilities.
 */
export function simulate(prep, forecast, controls, opts = {}) {
  const sims = opts.sims ?? 10_000
  const seed = opts.seed ?? 538
  const offices = opts.offices ?? ['Senate', 'House', 'Governor']
  const detail = opts.detail ?? true
  const { env, breakdowns } = forecast
  const { regionSd, eduSd } = env

  const out = { env, sims, races: {}, chambers: {} }
  const shared = new Float64Array(sims * 6)
  fillNormals(shared, seed)

  for (const office of offices) {
    const rs = prep.races.filter((r) => r.office === office)
    const ch = prep.chambers[office]
    const bds = rs.map((r) => breakdowns.get(r.race_id))
    const n = rs.length
    // The inner loop runs sims x races times: read each race's inputs from flat arrays.
    const mean = Float64Array.from(bds, (b) => b.mean)
    const sigma = Float64Array.from(bds, (b) => b.sigma)
    const locked = Int8Array.from(bds, (b) => b.locked)
    const envK = Float64Array.from(bds, (b) => b.envK)
    const edu = Float64Array.from(bds, (b) => b.eduLoading)
    const region = Uint8Array.from(rs, (r) => r.regionIndex)
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
    let control = 0

    for (let s = 0; s < sims; s++) {
      const base = s * 6
      const nat = shared[base] * controls.nationalError
      const eduErr = shared[base + 5] * eduSd
      let dUp = 0
      for (let i = 0; i < n; i++) {
        const reg = shared[base + 1 + region[i]] * regionSd
        const x = locked[i]
          ? locked[i] * HIST_MAX
          : mean[i] + nat * envK[i] + reg + eduErr * edu[i] + noise[s * n + i] * sigma[i]
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
 * common random numbers so the bars show the model, not noise. Each lever moves one step
 * down and one step up (within its range).
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

/** The lever settings sensitivity compares: the current one, then each lever down and up. */
export function sensitivityScenarios(controls) {
  const c = clampControls(controls)
  return [
    { key: null, controls: c },
    ...Object.keys(SENSITIVITY_STEPS).flatMap((key) => [
      { key, dir: 'lo', controls: clampControls({ ...c, [key]: c[key] - SENSITIVITY_STEPS[key] }) },
      { key, dir: 'hi', controls: clampControls({ ...c, [key]: c[key] + SENSITIVITY_STEPS[key] }) },
    ]),
  ]
}

/**
 * `runs` pairs each of sensitivityScenarios(controls) with its forecast ({ env, breakdowns }).
 * Returns, per lever, the change in Democratic control odds one step down (lo) and up (hi).
 */
export function sensitivity(prep, runs, office, sims = 2500) {
  const odds = runs.map(({ controls, forecast }) =>
    simulate(prep, forecast, controls, { sims, offices: [office], detail: false }).chambers[office].pDemControl
  )
  const base = odds[0]
  return Object.entries(SENSITIVITY_STEPS).map(([key, step]) => {
    const i = runs.findIndex((r) => r.key === key && r.dir === 'lo')
    return { key, step, lo: odds[i] - base, hi: odds[i + 1] - base, base }
  })
}
