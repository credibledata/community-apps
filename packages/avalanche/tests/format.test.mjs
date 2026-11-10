import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  fmtDate,
  fmtInt,
  fmtPct,
  makeProjection,
  mix,
  monthTicks,
  rampColor,
  seasonLabel,
  share,
  weekLabel,
} from '../public/format.js'

test('missing is a dash, not zero', () => {
  assert.equal(fmtInt(null), '—')
  assert.equal(fmtPct(undefined), '—')
  assert.equal(fmtPct(Number.NaN), '—')
  assert.equal(share(5, 0), null)
  assert.equal(share(1, 4), 0.25)
})
test('formats', () => {
  assert.equal(fmtInt(45_536), '45,536')
  assert.equal(fmtPct(0.2241), '22%')
  assert.equal(fmtPct(0.2241, 1), '22.4%')
  assert.equal(seasonLabel(2024), '2023-24')
  assert.equal(seasonLabel(2000), '1999-00')
})
test('dates never shift a day (UTC midnight from Malloy)', () => {
  assert.equal(fmtDate('2026-05-30T00:00:00.000Z'), 'May 30, 2026')
})
test('season weeks', () => {
  assert.equal(weekLabel(0), 'Oct 1')
  assert.equal(weekLabel(1), 'Oct 8')
  const t = monthTicks()
  assert.equal(t[0].week, 0)
  assert.equal(t[3].label, 'Jan')
  assert.ok(Math.abs(t[3].week - 92 / 7) < 1e-9)
})
test('color math', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(rampColor(['#000000', '#ffffff'], 0, 10), '#000000')
  assert.equal(rampColor(['#000000', '#ffffff'], 10, 10), '#ffffff')
})
test('projection keeps north up and fits the box', () => {
  const p = makeProjection([-109, 37, -102, 41], 400, 300, 0)
  const [x0, y0] = p([-109, 41]),
    [x1, y1] = p([-102, 37])
  assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 400.0001 && y1 <= 300.0001 && y1 > y0)
})
