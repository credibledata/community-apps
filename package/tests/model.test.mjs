import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clampControls,
  DEFAULT_CONTROLS,
  historyDates,
  incumbentSign,
  normCdf,
  normInv,
  pollAverage,
  pollWeight,
  prepare,
  raceBreakdown,
  nationalEnvironment,
  simulate,
  snapshotDate,
} from '../public/model.js'

const DAY = 86_400_000
const AS_OF = Date.UTC(2026, 10, 2)
const iso = (t) => new Date(t).toISOString().slice(0, 10)

function race(id, office, lean, extra = {}) {
  return {
    race_id: id,
    office,
    state: id.slice(4, 6),
    geo_id: id.slice(4, 6),
    race_name: id,
    region: 'South',
    incumbent_party: 'R',
    is_open_seat: false,
    is_special: false,
    rating_score: 0,
    expert_rating: 'Toss-up',
    dem_raised_m: 10,
    rep_raised_m: 10,
    pct_white: 60,
    pct_college: 33,
    race_lean: lean,
    ...extra,
  }
}
function poll(raceId, daysAgo, margin, extra = {}) {
  return {
    poll_id: `${raceId}-${daysAgo}`,
    race_id: raceId,
    pollster: 'Test',
    grade: 'A',
    grade_weight: 1,
    house_effect: 0,
    end_date: iso(AS_OF - daysAgo * DAY),
    sample_size: 600,
    population: 'LV',
    raw_margin: margin,
    population_adjustment: 0,
    adjusted_margin: margin,
    ...extra,
  }
}
const fixture = (extraRaces = []) =>
  prepare({
    races: [
      race('SEN-AA', 'Senate', -2),
      race('SEN-BB', 'Senate', 1, { incumbent_party: 'D' }),
      race('SEN-CC', 'Senate', -8, { is_open_seat: true }),
      race('HOU-AA-01', 'House', 0),
      race('GOV-AA', 'Governor', 3),
      ...extraRaces,
    ],
    polls: [
      poll('US-GENERIC', 3, 3),
      poll('US-GENERIC', 10, 2),
      poll('US-GENERIC', 40, 1),
      poll('SEN-AA', 5, 1),
      poll('SEN-AA', 20, -1),
    ],
    chambers: [
      { chamber: 'Senate', total_seats: 5, dem_seats_not_up: 1, rep_seats_not_up: 1, dem_seats_current: 2, rep_seats_current: 3, dem_needs: 3, rep_needs: 3 },
      { chamber: 'House', total_seats: 1, dem_seats_not_up: 0, rep_seats_not_up: 0, dem_seats_current: 0, rep_seats_current: 1, dem_needs: 1, rep_needs: 1 },
      { chamber: 'Governor', total_seats: 1, dem_seats_not_up: 0, rep_seats_not_up: 0, dem_seats_current: 0, rep_seats_current: 1, dem_needs: 1, rep_needs: 1 },
    ],
    markets: [{ race_id: 'SEN-AA', price_week: iso(AS_OF - 2 * DAY), avg_price: 0.4 }],
    approval: [{ approval_date: iso(AS_OF - DAY), net_approval: -10 }],
    specials: { weighted_swing: 10 },
  })

test('normInv inverts normCdf', () => {
  for (const p of [0.01, 0.1, 0.3, 0.5, 0.8, 0.975]) {
    assert.ok(Math.abs(normCdf(normInv(p)) - p) < 1e-4, `p=${p}`)
  }
})

test('poll weight halves every half-life and ignores unpublished polls', () => {
  const fresh = poll('X', 0, 0)
  const old = poll('X', 21, 0)
  assert.ok(Math.abs(pollWeight(old, AS_OF, 21) / pollWeight(fresh, AS_OF, 21) - 0.5) < 1e-9)
  assert.equal(pollWeight(poll('X', -3, 0), AS_OF, 21), 0)
})

test('poll average weights recent polls more', () => {
  const avg = pollAverage([poll('X', 0, 10), poll('X', 60, 0)], AS_OF, 21).avg
  assert.ok(avg > 8 && avg < 10)
})

test('national environment is the documented 70/20/10 blend plus the shift', () => {
  const prep = fixture()
  const env = nationalEnvironment(prep, { ...DEFAULT_CONTROLS, envShift: 1.5 })
  const base = 0.7 * env.genericBallot + 0.2 * 3 + 0.1 * (-1.5 + 3.5)
  const expected = base + 0.15 * (env.keys.environment - base) + 1.5
  assert.ok(Math.abs(env.value - expected) < 1e-9)
  const off = nationalEnvironment(prep, { ...DEFAULT_CONTROLS, envShift: 1.5, blWeight: 0 })
  assert.ok(Math.abs(off.value - (base + 1.5)) < 1e-9)
})

test('Bitecofer-Lichtman composition terms are centred on the nation', () => {
  const prep = fixture()
  const env = nationalEnvironment(prep, DEFAULT_CONTROLS)
  const national = { ...prep.races[0], office: 'House', pct_college: 33, pct_nonwhite: 41 }
  const b = raceBreakdown(prep, national, DEFAULT_CONTROLS, env)
  assert.equal(b.bl.college, 0)
  assert.equal(b.bl.offBallot, 0)
})

test('race breakdown: the parts add up and the blend weights sum to 1', () => {
  const prep = fixture()
  const env = nationalEnvironment(prep, DEFAULT_CONTROLS)
  for (const r of prep.races) {
    const b = raceBreakdown(prep, r, DEFAULT_CONTROLS, env)
    const parts = b.leanTerm + b.envTerm + b.incTerm + b.moneyTerm + b.collegeTerm + b.nonwhiteTerm + b.blTerm
    assert.ok(Math.abs(parts - b.fundamentals) < 1e-9, r.race_id)
    const w = Object.values(b.weights).reduce((a, x) => a + x, 0)
    assert.ok(Math.abs(w - 1) < 1e-9, r.race_id)
  }
})

test('races without polls rest on fundamentals; trust in polls of 0 ignores them', () => {
  const prep = fixture()
  const env = nationalEnvironment(prep, DEFAULT_CONTROLS)
  const noPolls = raceBreakdown(prep, prep.raceById.get('SEN-CC'), DEFAULT_CONTROLS, env)
  assert.equal(noPolls.weights.polls, 0)
  const off = { ...DEFAULT_CONTROLS, pollTrust: 0 }
  const b = raceBreakdown(prep, prep.raceById.get('SEN-AA'), off, nationalEnvironment(prep, off))
  assert.equal(b.weights.polls, 0)
})

test('market weight only applies where a market exists', () => {
  const prep = fixture()
  const c = { ...DEFAULT_CONTROLS, marketWeight: 0.4 }
  const env = nationalEnvironment(prep, c)
  assert.ok(raceBreakdown(prep, prep.raceById.get('SEN-AA'), c, env).weights.market > 0.3)
  assert.equal(raceBreakdown(prep, prep.raceById.get('SEN-BB'), c, env).weights.market, 0)
})

test('simulation is deterministic for a seed and seat counts cover every run', () => {
  const prep = fixture()
  const a = simulate(prep, DEFAULT_CONTROLS, { sims: 2000, seed: 7 })
  const b = simulate(prep, DEFAULT_CONTROLS, { sims: 2000, seed: 7 })
  assert.deepEqual(a.chambers.Senate.seatHist, b.chambers.Senate.seatHist)
  assert.equal(a.chambers.Senate.seatHist.reduce((x, y) => x + y, 0), 2000)
  const tip = Object.values(a.races)
    .filter((r) => r.office === 'Senate')
    .reduce((s, r) => s + r.tipping, 0)
  assert.ok(Math.abs(tip - 1) < 1e-9)
})

test('a bluer environment never lowers Democratic odds (common random numbers)', () => {
  const prep = fixture()
  let last = -1
  for (const envShift of [-6, -3, 0, 3, 6]) {
    const p = simulate(prep, { ...DEFAULT_CONTROLS, envShift }, { sims: 3000, detail: false }).chambers.Senate.pDemControl
    assert.ok(p >= last, `envShift ${envShift}`)
    last = p
  }
})

test('the snapshot date comes from the data, and the history ends on it', () => {
  const prep = fixture()
  assert.equal(prep.asOf, AS_OF - DAY)
  assert.equal(snapshotDate({ asOf: '2026-10-01', polls: [] }), Date.UTC(2026, 9, 1))
  const dates = historyDates(prep.historyStart, prep.asOf)
  assert.equal(dates.at(-1), prep.asOf)
  assert.ok(dates[0] >= prep.historyStart)
})

test('unrated races give the expert term no weight', () => {
  const prep = fixture([race('HOU-AA-02', 'House', 0, { rating_score: null, expert_rating: null })])
  const env = nationalEnvironment(prep, DEFAULT_CONTROLS)
  const b = raceBreakdown(prep, prep.raceById.get('HOU-AA-02'), DEFAULT_CONTROLS, env)
  assert.equal(b.weights.expert, 0)
  assert.equal(b.expert, null)
  assert.ok(raceBreakdown(prep, prep.raceById.get('HOU-AA-01'), DEFAULT_CONTROLS, env).weights.expert > 0)
})

test('incumbency follows the incumbent’s side; new and open seats get none', () => {
  assert.equal(incumbentSign(race('X', 'House', 0, { incumbent_party: 'D' })), 1)
  assert.equal(incumbentSign(race('X', 'House', 0, { incumbent_party: null, is_open_seat: true })), 0)
  assert.equal(incumbentSign(race('X', 'House', 0, { is_open_seat: true })), 0)
  const kiley = { incumbent_party: 'I', incumbent_status: 'Kevin Kiley: Incumbent advanced', dem_candidate: 'Richard Pan', rep_candidate: 'Kevin Kiley' }
  assert.equal(incumbentSign(race('X', 'House', 0, kiley)), -1)
})

test('fundraising counts only when both sides have filed', () => {
  const prep = fixture([race('GOV-BB', 'Governor', 0, { dem_raised_m: null, rep_raised_m: null }), race('HOU-AA-03', 'House', 0, { dem_raised_m: 5, rep_raised_m: 1 })])
  const env = nationalEnvironment(prep, DEFAULT_CONTROLS)
  assert.equal(raceBreakdown(prep, prep.raceById.get('GOV-BB'), DEFAULT_CONTROLS, env).moneyTerm, 0)
  assert.ok(raceBreakdown(prep, prep.raceById.get('HOU-AA-03'), DEFAULT_CONTROLS, env).moneyTerm > 0)
})

test('districts without demographics read as the nation', () => {
  const prep = fixture([race('HOU-AA-04', 'House', 0, { pct_white: null, pct_college: null })])
  assert.equal(prep.raceById.get('HOU-AA-04').pct_nonwhite, 41)
})

test('one-party races are decided in every simulation', () => {
  const prep = fixture([race('HOU-AA-05', 'House', -20, { locked_party: 'D' })])
  const s = simulate(prep, DEFAULT_CONTROLS, { sims: 500, seed: 3, offices: ['House'] })
  assert.equal(s.races['HOU-AA-05'].pWin, 1)
  assert.equal(s.races['HOU-AA-05'].breakdown.pWin, 1)
})

test('clampControls keeps levers in range and fills defaults', () => {
  const c = clampControls({ envShift: 99, halfLife: 'nope' })
  assert.equal(c.envShift, 10)
  assert.equal(c.halfLife, DEFAULT_CONTROLS.halfLife)
})
