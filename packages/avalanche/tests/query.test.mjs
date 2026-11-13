import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  DEFAULT_STATE,
  hashToState,
  lit,
  scopeClauses,
  sideQuery,
  sideScopeNote,
  timelinePick,
  timelineQuery,
  stateToHash,
  TILES,
  tileQuery,
  viewQuery,
  zoneQuery,
} from '../public/query.js'

const known = {
  minSeason: 1951,
  maxSeason: 2026,
  zones: ['Aspen', 'Front Range', 'Vail & Summit County'],
  triggers: ['Natural', 'Skier / rider', 'Unknown'],
  problems: ['Persistent slab', 'Wind slab'],
}

test('lit backslash-escapes quotes and backslashes (no SQL doubling)', () => {
  assert.equal(lit("O'Brien"), "'O\\'Brien'")
  assert.equal(lit('a\\b'), "'a\\\\b'")
})

test('default scope is reliable era only', () => {
  assert.deepEqual(scopeClauses(DEFAULT_STATE, known), ['season >= 2011'])
  assert.equal(
    viewQuery('kpis', DEFAULT_STATE, known),
    'run: avalanche_observations -> kpis + { where: season >= 2011 }'
  )
})

test('values outside known sets never reach the query', () => {
  const evil = {
    ...DEFAULT_STATE,
    zone: "x' or true or '",
    trigger: 'Nope',
    aspect: 'UP',
    elevation: 'Moon',
    from: 1800,
    to: 3000,
  }
  assert.deepEqual(scopeClauses(evil, known), [])
})

test("all filters compose, and ignore drops a tile's own dimension", () => {
  const st = {
    ...DEFAULT_STATE,
    to: 2020,
    zone: 'Vail & Summit County',
    trigger: 'Skier / rider',
    problem: 'Wind slab',
    aspect: 'NE',
    elevation: 'Near treeline',
    people: true,
    big: true,
  }
  assert.deepEqual(scopeClauses(st, known), [
    'season >= 2011',
    'season <= 2020',
    "forecast_zone = 'Vail & Summit County'",
    "trigger = 'Skier / rider'",
    "avalanche_problem = 'Wind slab'",
    "slope_aspect = 'NE'",
    "elevation = 'Near treeline'",
    'involved_people',
    'is_dangerous_size',
  ])
  const rose = tileQuery('rose', st, known)
  assert.ok(!(rose.includes('slope_aspect') || rose.includes('elevation =')))
  assert.ok(!tileQuery('zones', st, known).includes('forecast_zone'))
  assert.ok(!tileQuery('calendar', st, known).includes('season'))
})

test('every tile query names a view the model actually declares', () => {
  // Read the view names out of the model rather than restating them here. A
  // hardcoded list only fails when someone edits the list and TILES together,
  // which is the one case that was never going to break: renaming a view in
  // the model would leave the test green and every tile returning a 400.
  const model = readFileSync(
    new URL('../avalanche.malloy', import.meta.url),
    'utf8'
  )
  const declared = new Set(
    [...model.matchAll(/^\s*view:\s*([a-zA-Z_][\w]*)\s+is\b/gm)].map(
      (m) => m[1]
    )
  )
  assert.ok(declared.size > 0, 'parsed no views out of avalanche.malloy')

  for (const t of Object.values(TILES)) {
    assert.ok(declared.has(t.view), `${t.view} is not declared in the model`)
  }
})

test('zone drawer uses the parameterised source and drops the zone filter', () => {
  const q = zoneQuery(
    'Aspen',
    'kpis',
    { ...DEFAULT_STATE, zone: 'Front Range' },
    known
  )
  assert.equal(
    q,
    "run: zone_detail(zone_name is 'Aspen') -> kpis + { where: season >= 2011 }"
  )
  assert.throws(() => zoneQuery('Atlantis', 'kpis', DEFAULT_STATE, known))
})

test('hash round-trips and rejects junk', () => {
  const st = {
    ...DEFAULT_STATE,
    from: 2015,
    to: 2020,
    zone: 'Aspen',
    people: true,
  }
  const h = stateToHash(st, 'Front Range')
  const back = hashToState(h, known)
  assert.deepEqual(back.state, st)
  assert.equal(back.drawer, 'Front Range')
  assert.equal(stateToHash(DEFAULT_STATE), '')
  const junk = hashToState(
    '#from=abc&to=1700&zone=Mars&aspect=UP&people=yes',
    known
  )
  assert.deepEqual(junk.state, DEFAULT_STATE)
  assert.deepEqual(hashToState('#from=2020&to=2012', known).state.from, 2012) // swapped
})

test('accident and snowpack tiles take only the season and zone scope', () => {
  const st = { ...DEFAULT_STATE, zone: 'Aspen', trigger: 'Natural', people: true }
  assert.equal(
    sideQuery('storm', st, known),
    "run: snow_days -> by_storm + { where: season >= 2011 and forecast_zone = 'Aspen' }"
  )
  assert.equal(
    sideQuery('acc-rose', st, known),
    "run: accident_avalanches -> by_aspect + { where: accident.season >= 2011 and accident.forecast_zone = 'Aspen' }"
  )
  assert.equal(sideScopeNote(st), 'Seasons and zone apply here; the trigger, people involved filters do not.')
  assert.equal(sideScopeNote(DEFAULT_STATE), '')
})

test('the accident season chart keeps every reliable season, highlighting the scope instead', () => {
  const st = { ...DEFAULT_STATE, from: 2018, to: 2020 }
  assert.equal(
    sideQuery('acc-seasons', st, known),
    'run: accidents -> by_season + { where: season >= 2011 }'
  )
})

test('the timeline shows the scoped zone and last season, or a default', () => {
  assert.deepEqual(timelinePick(DEFAULT_STATE, known), { season: 2026, zone: 'Front Range' })
  assert.deepEqual(timelinePick({ ...DEFAULT_STATE, zone: 'Aspen', to: 2019 }, known), {
    season: 2019,
    zone: 'Aspen',
  })
  assert.equal(
    timelineQuery({ ...DEFAULT_STATE, zone: "x' or true" }, known),
    "run: snow_days -> season_timeline + { where: season = 2026 and forecast_zone = 'Front Range' }"
  )
})
