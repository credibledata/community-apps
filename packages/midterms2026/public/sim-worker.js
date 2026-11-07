// Runs the Monte Carlo off the main thread. The app starts two of these: one for the live
// forecast (re-run on every lever change) and one for the slower background jobs (forecast
// history and sensitivity), so dragging a slider never waits behind a history rebuild.
//
// The app fetches each forecast's inputs from forecast.malloy and posts them here as
// { env, breakdowns } (see model.js simulate); this worker only simulates.

import { clampControls, prepare, sensitivity, simulate } from './model.js'

let prep = null

self.onmessage = (e) => {
  const { type, id, payload } = e.data
  try {
    if (type === 'init') {
      prep = prepare(payload.data, payload.asOf)
      self.postMessage({ type, id })
      return
    }
    if (!prep) {
      throw new Error('worker not initialised')
    }
    if (type === 'run') {
      const result = simulate(prep, payload.forecast, clampControls(payload.controls), { sims: payload.sims ?? 10_000 })
      self.postMessage({ type, id, result })
    } else if (type === 'history') {
      const controls = clampControls(payload.controls)
      const points = payload.days.map(({ t, forecast }) => {
        const r = simulate(prep, forecast, controls, { sims: payload.sims ?? 800, detail: false })
        return {
          t,
          env: forecast.env.value,
          Senate: r.chambers.Senate.pDemControl,
          House: r.chambers.House.pDemControl,
          Governor: r.chambers.Governor.pDemControl,
          seats: {
            Senate: r.chambers.Senate.expectedDemSeats,
            House: r.chambers.House.expectedDemSeats,
            Governor: r.chambers.Governor.expectedDemSeats,
          },
        }
      })
      self.postMessage({ type, id, points })
    } else if (type === 'sensitivity') {
      const rows = sensitivity(prep, payload.runs, payload.office, payload.sims ?? 2000)
      self.postMessage({ type, id, office: payload.office, rows })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err) })
  }
}
