// node --test packages/wildfire-season-2026/tests/*.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareQuery, DEFAULT_SCOPE } from '../public/scope.js'

const known = { entity: ['CA', 'OR'], years: [2015, 2026], region: [], cause: [], size: [] }
const scope = { ...DEFAULT_SCOPE, from: 2024, to: 2025, ytd: true }

test('the compared states are bracketed, so a filter beside them stays a filter', () => {
  const q = compareQuery('by_state_year', ['CA', 'OR'], scope, known)
  assert.match(q, /where: \(state_code = 'CA' \| 'OR'\) and /)
})

test('keys the tile ignores are left out of its query', () => {
  const q = compareQuery('by_state_season', ['CA', 'OR'], scope, known, '', ['from', 'to', 'ytd'])
  assert.doesNotMatch(q, /fire_year|is_year_to_date/)
})
