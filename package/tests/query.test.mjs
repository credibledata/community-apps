import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_CONTROLS } from '../public/model.js'
import {
  BOOT_QUERIES,
  demographicsQuery,
  hashToState,
  historyQuery,
  INVENTORY_QUERIES,
  isRaceId,
  lit,
  marketQuery,
  modelUrl,
  pageVersion,
  queryUrl,
  RESULTS_MODEL,
  RESULTS_QUERIES,
  sampleQuery,
  sourceBlock,
  stateToHash,
  viewBlock,
} from '../public/query.js'

const ENDPOINT = '/api/v0/environments/elections/packages/midterms2026/models/elections.malloy/query'

test('lit backslash-escapes quotes and backslashes (no SQL doubling)', () => {
  assert.equal(lit("O'Brien"), "'O\\'Brien'")
  assert.equal(lit('a\\b'), "'a\\\\b'")
})

test('queryUrl works under Publisher, at the root, and under a prefix', () => {
  assert.equal(queryUrl('/environments/elections/packages/midterms2026/index.html'), ENDPOINT)
  assert.equal(queryUrl('/'), ENDPOINT)
  assert.equal(queryUrl('/elections/'), `/elections${ENDPOINT}`)
  assert.equal(modelUrl('/elections/methodology.html'), `/elections${ENDPOINT.replace(/\/query$/, '')}`)
  assert.equal(queryUrl('/elections/results.html', RESULTS_MODEL), `/elections${ENDPOINT.replace('elections.malloy', 'results.malloy')}`)
})

test('queryUrl follows whichever environment and package the page is served from', () => {
  assert.equal(
    queryUrl('/environments/community-apps/packages/midterms2026/index.html'),
    '/api/v0/environments/community-apps/packages/midterms2026/models/elections.malloy/query'
  )
  assert.equal(
    modelUrl('/environments/my%20env/packages/m26/results.html', RESULTS_MODEL),
    '/api/v0/environments/my%20env/packages/m26/models/results.malloy'
  )
  assert.equal(pageVersion('?versionId=1.0.7'), '1.0.7')
  assert.equal(pageVersion(''), null)
  assert.equal(pageVersion('?versionId=1.0.7%22%3E'), null)
})

test('ids are validated before they reach a query', () => {
  assert.ok(isRaceId('SEN-GA'))
  assert.ok(isRaceId('SEN-OH-S'))
  assert.ok(isRaceId('HOU-PA-07'))
  assert.ok(!isRaceId("SEN-GA' or 1=1"))
  assert.throws(() => historyQuery("PA'; drop"))
  assert.throws(() => marketQuery('nope'))
  assert.throws(() => demographicsQuery('pennsylvania'))
  assert.match(historyQuery('PA-07'), /geo_id = 'PA-07'/)
  assert.match(demographicsQuery('PA-07'), /'PA-07' \| 'PA'/)
})

test('hash round-trips the view and only non-default levers', () => {
  const controls = { ...DEFAULT_CONTROLS, envShift: 2.5 }
  const hash = stateToHash({ office: 'House', race: 'HOU-PA-07' }, controls, DEFAULT_CONTROLS)
  assert.equal(hash, '#office=House&race=HOU-PA-07&envShift=2.5')
  const back = hashToState(hash, DEFAULT_CONTROLS)
  assert.deepEqual(back.view, { office: 'House', race: 'HOU-PA-07' })
  assert.deepEqual(back.controls, controls)
  assert.equal(stateToHash({ office: 'Senate', race: null }, DEFAULT_CONTROLS, DEFAULT_CONTROLS), '')
})

test('hash ignores junk', () => {
  const s = hashToState('#office=Mayor&race=<script>&envShift=abc&bogus=1', DEFAULT_CONTROLS)
  assert.deepEqual(s.view, { office: 'Senate', race: null })
  assert.deepEqual(s.controls, DEFAULT_CONTROLS)
})

test('sourceBlock returns one source as written, without its leading doc', () => {
  const model = readFileSync(new URL('../elections.malloy', import.meta.url), 'utf8')
  const block = sourceBlock(model, 'national_results')
  assert.equal(block.split('\n')[0], "source: national_results is duckdb.table('data/historical_results.parquet') extend {")
  assert.equal(block.split('\n').at(-1), '}')
  assert.doesNotMatch(block, /source: historical_results/)
  for (const name of Object.keys(INVENTORY_QUERIES)) {
    assert.match(sourceBlock(model, name), new RegExp(`^source: ${name} is [\\s\\S]+\\n\\}$`))
  }
  assert.equal(sourceBlock(model, 'nope'), null)
})

test('viewBlock returns one view as written, for every view the app runs', () => {
  const model = readFileSync(new URL('../elections.malloy', import.meta.url), 'utf8')
  assert.equal(viewBlock(model, 'special_elections', 'summary'), 'view: summary is {\n  aggregate: special_count, avg_swing, weighted_swing\n}')
  for (const q of Object.values(BOOT_QUERIES)) {
    const [, source, view] = q.match(/^run: (\w+) -> (\w+|\{)/)
    if (view !== '{') {
      assert.match(viewBlock(model, source, view), new RegExp(`^view: ${view} is \\{\\n[\\s\\S]+\\n\\}$`))
    }
  }
  assert.equal(viewBlock(model, 'races', 'nope'), null)
})

test('sampleQuery selects every dimension and rejects odd names', () => {
  assert.equal(sampleQuery('races'), 'run: races -> { select: * limit: 8 }')
  assert.throws(() => sampleQuery('races; drop'))
})

function assertQueriesDefined(files, queries) {
  const model = files.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n')
  const sources = new Set([...model.matchAll(/^source: (\w+)/gm)].map((m) => m[1]))
  const views = new Set([...model.matchAll(/view: (\w+)/g)].map((m) => m[1]))
  for (const q of queries) {
    const [, source, view] = q.match(/^run: (\w+) -> (\w+|\{)/)
    assert.ok(sources.has(source), `unknown source in: ${q}`)
    if (view !== '{') {
      assert.ok(views.has(view), `unknown view in: ${q}`)
    }
  }
}

test('every view the app queries is defined in the model', () => {
  assertQueriesDefined(['elections.malloy'], [...Object.values(BOOT_QUERIES), ...Object.values(INVENTORY_QUERIES)])
})

test('every view the results page queries is defined in results.malloy or what it imports', () => {
  const results = readFileSync(new URL(`../${RESULTS_MODEL}`, import.meta.url), 'utf8')
  assert.match(results, /^import 'elections\.malloy'/m)
  assertQueriesDefined([RESULTS_MODEL, 'elections.malloy'], Object.values(RESULTS_QUERIES))
})
