// Run the forecast headlessly against a local Publisher (pnpm dev) and print the topline.
// Same queries and model code as the app, so this is the quickest way to check a model change.
//
//   node scripts/forecast.mjs                 # default levers
//   node scripts/forecast.mjs envShift=3      # any DEFAULT_CONTROLS key=value

import {
  clampControls,
  DEFAULT_CONTROLS,
  prepare,
  simulate,
} from '../package/public/model.js'
import { BOOT_QUERIES } from '../package/public/query.js'

const PUBLISHER = process.env.PUBLISHER_URL || 'http://localhost:4000'
const url = `${PUBLISHER}/api/v0/environments/elections/packages/midterms2026/models/elections.malloy/query`

async function run(query) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ compactJson: true, query }),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`${query}\n${json.message}`)
  }
  return JSON.parse(json.result)
}

const controls = clampControls({
  ...DEFAULT_CONTROLS,
  ...Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.split('=')
      return [k, Number(v)]
    })
  ),
})

const data = {}
for (const [k, q] of Object.entries(BOOT_QUERIES)) {
  data[k] = await run(q)
}
data.specials = data.specials[0]
const prep = prepare(data)

const t0 = performance.now()
const result = simulate(prep, controls, { sims: 10_000 })
const ms = Math.round(performance.now() - t0)

const pct = (x) => `${(x * 100).toFixed(1)}%`
const env = result.env
console.log(
  `National environment D${env.value >= 0 ? '+' : ''}${env.value.toFixed(1)} ` +
    `(generic ballot ${env.genericBallot.toFixed(1)}, approval prior ${env.approvalPrior.toFixed(1)}, specials ${env.specialsSignal.toFixed(1)})`
)
for (const [office, c] of Object.entries(result.chambers)) {
  console.log(
    `${office.padEnd(9)} P(D control) ${pct(c.pDemControl).padStart(6)}  ` +
      `D seats ${c.expectedDemSeats.toFixed(1)} (80%: ${c.p10}-${c.p90})`
  )
}
const close = Object.entries(result.races)
  .filter(([, r]) => r.office !== 'House')
  .sort((a, b) => Math.abs(a[1].pWin - 0.5) - Math.abs(b[1].pWin - 0.5))
  .slice(0, 12)
console.table(
  close.map(([id, r]) => ({
    race: id,
    pDem: pct(r.pWin),
    margin: r.meanMargin.toFixed(1),
    polls: r.breakdown.pollCount,
    wPoll: r.breakdown.weights.polls.toFixed(2),
    market: r.breakdown.marketPrice ?? '',
    tipping: pct(r.tipping),
  }))
)
console.log(`${result.sims} sims x ${prep.races.length} races in ${ms} ms`)
