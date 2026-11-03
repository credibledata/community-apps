import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  category,
  fmtDate,
  fmtMargin,
  fmtOdds,
  fmtSigned,
  probColor,
} from '../public/format.js'

test('margins read D+/R+/EVEN', () => {
  assert.equal(fmtMargin(4.24), 'D+4.2')
  assert.equal(fmtMargin(-0.96), 'R+1.0')
  assert.equal(fmtMargin(0.01), 'EVEN')
  assert.equal(fmtMargin(null), '—')
})

test('signed values use a real minus and no negative zero', () => {
  assert.equal(fmtSigned(-1.25), '−1.3')
  assert.equal(fmtSigned(-0.01), '0.0')
  assert.equal(fmtSigned(2), '+2.0')
})

test('odds are out of 100 and capped at the ends', () => {
  assert.equal(fmtOdds(0.734), '73 in 100')
  assert.equal(fmtOdds(0.999), '>99 in 100')
  assert.equal(fmtOdds(0.001), '<1 in 100')
})

test('categories match the rating vocabulary', () => {
  assert.equal(category(0.5), 'Toss-up')
  assert.equal(category(0.62), 'Lean D')
  assert.equal(category(0.2), 'Likely R')
  assert.equal(category(0.99), 'Solid D')
})

test('probability colours run red to blue', () => {
  assert.equal(probColor(0), 'rgb(178,24,43)')
  assert.equal(probColor(1), 'rgb(20,66,150)')
  assert.equal(probColor(Number.NaN), '#dedad3')
})

test('dates format in UTC so the day never shifts', () => {
  assert.equal(fmtDate('2026-11-03T00:00:00.000Z'), 'Nov 3')
})
