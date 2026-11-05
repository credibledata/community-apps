// forecast.malloy must compute the same numbers as public/model.js. This runs the real Malloy
// model on the committed Parquet with DuckDB (no Publisher needed) and compares every race,
// every named part, under several lever settings and an earlier as-of date.

import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { DuckDBConnection } from '@malloydata/db-duckdb'
import { SingleConnectionRuntime } from '@malloydata/malloy'
import {
  clampControls,
  nationalEnvironment,
  pollContributions,
  prepare,
  raceBreakdown,
} from '../public/model.js'
import { BOOT_QUERIES } from '../public/query.js'

const PACKAGE = new URL('../', import.meta.url)
const TOLERANCE = 1e-9

/** model.js control name -> forecast.malloy given name. */
const GIVEN = {
  envShift: 'ENV_SHIFT',
  pollTrust: 'POLL_TRUST',
  halfLife: 'HALF_LIFE',
  nationalError: 'NATIONAL_ERROR',
  incumbency: 'INCUMBENCY',
  collegeSwing: 'COLLEGE_SWING',
  nonwhiteSwing: 'NONWHITE_SWING',
  marketWeight: 'MARKET_WEIGHT',
  blWeight: 'BL_WEIGHT',
}

/** Each case: model.js controls, and optionally an earlier as-of date. */
const CASES = [
  { name: 'default levers', controls: {} },
  { name: 'stronger D environment', controls: { envShift: 4, collegeSwing: 3 } },
  {
    name: 'every lever moved',
    controls: {
      pollTrust: 0,
      halfLife: 10,
      incumbency: 5,
      nonwhiteSwing: -4,
      marketWeight: 0.6,
      blWeight: 0.5,
      nationalError: 5,
    },
  },
  { name: 'as of mid-August, polls trusted double', controls: { pollTrust: 2 }, asOf: '2026-08-15' },
]

let connection
let elections
let forecast
let prep

async function rows(model, query, givens = {}) {
  const result = await model.loadQuery(query).run({ rowLimit: 100_000, givens })
  // Through JSON, so dates arrive as ISO strings and counts as numbers, as from Publisher.
  const json = JSON.stringify(result.data.toObject(), (_, v) => (typeof v === 'bigint' ? Number(v) : v))
  return JSON.parse(json)
}

before(async () => {
  const dir = fileURLToPath(PACKAGE)
  connection = new DuckDBConnection('duckdb', ':memory:', dir)
  const runtime = new SingleConnectionRuntime({
    urlReader: { readURL: (url) => readFile(fileURLToPath(url), 'utf8') },
    connection,
  })
  elections = runtime.loadModel(pathToFileURL(`${dir}elections.malloy`))
  forecast = runtime.loadModel(pathToFileURL(`${dir}forecast.malloy`))
  // The same inputs the app loads at boot (app.js), from the same model.
  const data = {}
  for (const key of ['races', 'polls', 'chambers', 'markets', 'approval', 'specials']) {
    data[key] = await rows(elections, BOOT_QUERIES[key])
  }
  data.specials = data.specials[0]
  prep = prepare(data)
})

after(async () => {
  await connection?.close()
})

function givensFor({ controls, asOf }) {
  const c = clampControls(controls)
  const givens = Object.fromEntries(Object.entries(c).map(([k, v]) => [GIVEN[k], v]))
  if (asOf) {
    givens.AS_OF = asOf
  }
  return givens
}

const asOfTime = (asOf) => (asOf ? Date.parse(asOf) : prep.asOf)

function assertClose(actual, expected, what) {
  if (expected === null || expected === undefined) {
    assert.equal(actual ?? null, null, `${what}: expected null, got ${actual}`)
    return
  }
  assert.ok(
    Math.abs(actual - expected) <= TOLERANCE,
    `${what}: Malloy ${actual}, model.js ${expected}`
  )
}

test('the default as-of date is the data snapshot date', async () => {
  const [{ as_of }] = await rows(forecast, 'run: national -> { group_by: as_of is $AS_OF }')
  assert.equal(new Date(as_of).toISOString().slice(0, 10), new Date(prep.asOf).toISOString().slice(0, 10))
})

for (const kase of CASES) {
  test(`national environment matches model.js: ${kase.name}`, async () => {
    const [m] = await rows(forecast, 'run: national -> summary', givensFor(kase))
    const js = nationalEnvironment(prep, clampControls(kase.controls), asOfTime(kase.asOf))
    assertClose(m.generic_ballot, js.genericBallot, 'generic ballot')
    assert.equal(m.generic_polls, js.genericPolls, 'generic poll count')
    assertClose(m.net_approval, js.netApproval, 'net approval')
    assertClose(m.specials_signal, js.specialsSignal, 'specials signal')
    assert.equal(m.keys_turned, js.keys.turned, 'keys turned')
    assertClose(m.keys_term, js.keysTerm, 'keys term')
    assertClose(m.environment, js.value, 'environment')
  })

  test(`every race's breakdown matches model.js: ${kase.name}`, async () => {
    const controls = clampControls(kase.controls)
    const asOf = asOfTime(kase.asOf)
    const env = nationalEnvironment(prep, controls, asOf)
    const malloy = await rows(forecast, 'run: race_breakdown -> breakdown', givensFor(kase))
    assert.equal(malloy.length, prep.races.length, 'one row per race')
    for (const m of malloy) {
      const js = raceBreakdown(prep, prep.raceById.get(m.race_id), controls, env, asOf)
      const at = (part) => `${m.race_id} ${part}`
      assert.equal(m.locked, js.locked, at('locked'))
      assertClose(m.lean_term, js.leanTerm, at('lean term'))
      assertClose(m.environment_term, js.envTerm, at('environment term'))
      assertClose(m.incumbency_term, js.incTerm, at('incumbency term'))
      assertClose(m.money_term, js.moneyTerm, at('money term'))
      assertClose(m.college_term, js.collegeTerm, at('college term'))
      assertClose(m.nonwhite_term, js.nonwhiteTerm, at('nonwhite term'))
      assertClose(m.bl_college, js.bl.college, at('BL college'))
      assertClose(m.bl_off_ballot, js.bl.offBallot, at('BL off-ballot'))
      assertClose(m.bl_incumbency, js.bl.incumbency, at('BL incumbency'))
      assertClose(m.bl_money, js.bl.money, at('BL money'))
      assertClose(m.bl_polls, js.bl.polls, at('BL polls'))
      assertClose(m.fundamentals, js.fundamentals, at('fundamentals'))
      assertClose(m.raw_poll_average, js.rawPollAvg, at('raw poll average'))
      assertClose(m.poll_average, js.pollAvg, at('poll average'))
      assertClose(m.poll_strength, js.pollStrength, at('poll strength'))
      assert.equal(m.poll_count, js.pollCount, at('poll count'))
      assertClose(m.expert, js.expert, at('expert'))
      assertClose(m.market_price, js.marketPrice, at('market price'))
      assertClose(m.market, js.market, at('market'))
      assertClose(m.weight_fundamentals, js.weights.fundamentals, at('fundamentals weight'))
      assertClose(m.weight_polls, js.weights.polls, at('polls weight'))
      assertClose(m.weight_expert, js.weights.expert, at('expert weight'))
      assertClose(m.weight_market, js.weights.market, at('market weight'))
      assertClose(m.mean, js.mean, at('mean'))
      assertClose(m.sigma, js.sigma, at('sigma'))
      assertClose(m.p_win, js.pWin, at('win probability'))
    }
  })
}

test('every poll contribution matches model.js', async () => {
  const kase = CASES[3]
  const controls = clampControls(kase.controls)
  const malloy = await rows(forecast, 'run: poll_contributions -> { select: * }', givensFor(kase))
  const byPoll = new Map(malloy.map((r) => [r.poll_id, r]))
  let compared = 0
  for (const race of prep.races) {
    for (const js of pollContributions(prep, race, controls, asOfTime(kase.asOf))) {
      const m = byPoll.get(js.poll_id)
      assert.ok(m, `poll ${js.poll_id} missing from poll_contributions`)
      assertClose(m.weight, js.weight, `poll ${js.poll_id} weight`)
      assertClose(m.trend_adjustment, js.trendAdj, `poll ${js.poll_id} trend adjustment`)
      assertClose(m.final_margin, js.final, `poll ${js.poll_id} final margin`)
      assertClose(m.share, js.share, `poll ${js.poll_id} share`)
      compared++
    }
  }
  assert.equal(compared, malloy.length, 'one row per race poll')
})
