// Run the forecast headlessly against a local Publisher (pnpm dev) and print the topline.
// Same queries and model code as the app, so this is the quickest way to check a model change.
//
//   node packages/midterms2026/pipeline/forecast.mjs                 # default levers
//   node packages/midterms2026/pipeline/forecast.mjs envShift=3      # any DEFAULT_CONTROLS key=value

import { clampControls, DEFAULT_CONTROLS, simulate } from '../public/model.js'
import { loadForecast, loadPrep } from './forecast-inputs.mjs'

const controls = clampControls({
  ...DEFAULT_CONTROLS,
  ...Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.split('=')
      return [k, Number(v)]
    })
  ),
})

const [prep, forecast] = await Promise.all([loadPrep(), loadForecast(controls)])

const t0 = performance.now()
const result = simulate(prep, forecast, controls, { sims: 10_000 })
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
