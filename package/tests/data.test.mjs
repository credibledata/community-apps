// The committed parquet snapshot must pass the release gate in scripts/validate-data.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, validateResults } from '../../scripts/validate-data.mjs'

test('package/data passes schema, join, count, range, leakage and certified-result checks', async () => {
  assert.equal(await validate(), true)
  process.exitCode = 0
})

test('election-night results and the frozen forecast pass their checks', async () => {
  assert.equal(await validateResults(), true)
  process.exitCode = 0
})
