import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  DEFAULT_STATE,
  hashToState,
  lit,
  scopeClauses,
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
