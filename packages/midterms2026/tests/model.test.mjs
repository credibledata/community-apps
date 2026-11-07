import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clampControls,
  DEFAULT_CONTROLS,
  historyDates,
  prepare,
  SENSITIVITY_STEPS,
  sensitivity,
  sensitivityScenarios,
  simulate,
} from '../public/model.js'

const DAY = 86_400_000
const AS_OF = '2026-11-02'
const iso = (t) => new Date(t).toISOString().slice(0, 10)

function race(id, office, extra = {}) {
  return { race_id: id, office, state: id.slice(4, 6), geo_id: id.slice(4, 6), race_name: id, region: 'South', ...extra }
}

const prep = prepare(
  {
    races: [
      race('SEN-AA', 'Senate'),
      race('SEN-BB', 'Senate'),
      race('SEN-CC', 'Senate'),
      race('HOU-AA-01', 'House'),
      race('HOU-AA-05', 'House'),
      race('GOV-AA', 'Governor'),
    ],
    polls: [
      { poll_id: 'g1', race_id: 'US-GENERIC', end_date: iso(Date.parse(AS_OF) - 40 * DAY) },
      { poll_id: 'g2', race_id: 'US-GENERIC', end_date: iso(Date.parse(AS_OF) - 3 * DAY) },
    ],
    chambers: [
      { chamber: 'Senate', total_seats: 5, dem_seats_not_up: 1, rep_seats_not_up: 1, dem_seats_current: 2, rep_seats_current: 3, dem_needs: 3, rep_needs: 3 },
      { chamber: 'House', total_seats: 2, dem_seats_not_up: 0, rep_seats_not_up: 0, dem_seats_current: 0, rep_seats_current: 2, dem_needs: 1, rep_needs: 2 },
      { chamber: 'Governor', total_seats: 1, dem_seats_not_up: 0, rep_seats_not_up: 0, dem_seats_current: 0, rep_seats_current: 1, dem_needs: 1, rep_needs: 1 },
    ],
    markets: [],
  },
  AS_OF
)

/** What forecast.malloy would hand the simulation: each race's mean and sigma, `shift` added to every mean. */
function forecast(shift = 0) {
  const bd = (mean, extra = {}) => ({ mean: mean + shift, sigma: 4.5, locked: 0, envK: 1, eduLoading: 0, ...extra })
  return {
    env: { value: shift, regionSd: 1.6, eduSd: 2.2 },
    breakdowns: new Map([
      ['SEN-AA', bd(-1)],
      ['SEN-BB', bd(2)],
      ['SEN-CC', bd(-8, { eduLoading: 1 })],
      ['HOU-AA-01', bd(0)],
      ['HOU-AA-05', bd(-20, { locked: 1 })],
      ['GOV-AA', bd(3, { envK: 0.7 })],
    ]),
  }
}

test('simulation is deterministic for a seed and seat counts cover every run', () => {
  const a = simulate(prep, forecast(), DEFAULT_CONTROLS, { sims: 2000, seed: 7 })
  const b = simulate(prep, forecast(), DEFAULT_CONTROLS, { sims: 2000, seed: 7 })
  assert.deepEqual(a.chambers.Senate.seatHist, b.chambers.Senate.seatHist)
  assert.equal(a.chambers.Senate.seatHist.reduce((x, y) => x + y, 0), 2000)
  const tip = Object.values(a.races)
    .filter((r) => r.office === 'Senate')
    .reduce((s, r) => s + r.tipping, 0)
  assert.ok(Math.abs(tip - 1) < 1e-9)
})

test('bluer means never lower Democratic odds (common random numbers)', () => {
  let last = -1
  for (const shift of [-6, -3, 0, 3, 6]) {
    const p = simulate(prep, forecast(shift), DEFAULT_CONTROLS, { sims: 3000, detail: false }).chambers.Senate.pDemControl
    assert.ok(p >= last, `shift ${shift}`)
    last = p
  }
})

test('a larger national error spreads the outcomes', () => {
  const sd = (c) => {
    const s = simulate(prep, forecast(), c, { sims: 4000, offices: ['Senate'] })
    const r = s.races['SEN-AA']
    return r.p90 - r.p10
  }
  assert.ok(sd({ ...DEFAULT_CONTROLS, nationalError: 6 }) > sd({ ...DEFAULT_CONTROLS, nationalError: 1 }))
})

test('one-party races are decided in every simulation', () => {
  const s = simulate(prep, forecast(), DEFAULT_CONTROLS, { sims: 500, seed: 3, offices: ['House'] })
  assert.equal(s.races['HOU-AA-05'].pWin, 1)
})

test('the history runs weekly and ends on the forecast day', () => {
  assert.equal(prep.asOf, Date.parse(AS_OF))
  const dates = historyDates(prep.historyStart, prep.asOf)
  assert.equal(dates.at(-1), prep.asOf)
  assert.ok(dates[0] >= prep.historyStart)
})

test('sensitivity compares each lever one step down and up, within its range', () => {
  const scenarios = sensitivityScenarios(DEFAULT_CONTROLS)
  assert.equal(scenarios.length, 1 + 2 * Object.keys(SENSITIVITY_STEPS).length)
  assert.equal(scenarios[0].key, null)
  const lo = scenarios.find((s) => s.key === 'pollTrust' && s.dir === 'lo')
  assert.equal(lo.controls.pollTrust, DEFAULT_CONTROLS.pollTrust - SENSITIVITY_STEPS.pollTrust)
  // marketWeight 0.3 - 0.3 = 0, and 0.3 + 0.3 = 0.6: both inside [0, 0.6]
  const blHi = scenarios.find((s) => s.key === 'blWeight' && s.dir === 'hi')
  assert.equal(blHi.controls.blWeight, 1)

  // A bluer forecast for one scenario shows up as that lever's change, and only there.
  const runs = scenarios.map((s) => ({ ...s, forecast: forecast(s.key === 'envShift' ? (s.dir === 'hi' ? 4 : -4) : 0) }))
  const rows = sensitivity(prep, runs, 'Senate', 2000)
  const env = rows.find((r) => r.key === 'envShift')
  assert.ok(env.hi > 0 && env.lo < 0)
  assert.equal(rows.find((r) => r.key === 'incumbency').hi, 0)
})

test('clampControls keeps levers in range and fills defaults', () => {
  const c = clampControls({ envShift: 99, halfLife: 'nope' })
  assert.equal(c.envShift, 10)
  assert.equal(c.halfLife, DEFAULT_CONTROLS.halfLife)
})
