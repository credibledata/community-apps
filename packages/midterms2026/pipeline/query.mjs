// Run a Malloy query against a local Publisher (pnpm dev) and print the rows.
//
//   node packages/midterms2026/pipeline/query.mjs "run: races -> race_inputs + { limit: 3 }"
//   MODEL=results.malloy node packages/midterms2026/pipeline/query.mjs "run: results -> tally"

const PUBLISHER = process.env.PUBLISHER_URL || 'http://localhost:4000'
const MODEL = process.env.MODEL || 'elections.malloy'
const url = `${PUBLISHER}/api/v0/environments/elections/packages/midterms2026/models/${MODEL}/query`

const query = process.argv.slice(2).join(' ')
if (!query) {
  console.error('usage: node packages/midterms2026/pipeline/query.mjs "<malloy query>"')
  process.exit(2)
}
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ compactJson: true, query }),
})
const json = await res.json()
if (!res.ok) {
  console.error(json.message || json)
  process.exit(1)
}
const rows = JSON.parse(json.result)
console.table(rows.slice(0, 40))
if (rows.length > 40) {
  console.log(`... ${rows.length} rows`)
}
