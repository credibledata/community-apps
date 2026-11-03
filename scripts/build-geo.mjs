// Projects US state boundaries once, at dev time, into SVG path strings so the
// app draws maps with no runtime geo library. Output: package/public/geo/states.json
//
//   { width, height, states: { "PA": { fips, name, d, cx, cy } }, mesh }
//
// Run with `pnpm geo` after changing the projection or simplification.

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'

const require = createRequire(import.meta.url)
const topo = JSON.parse(
  readFileSync(require.resolve('us-atlas/states-10m.json'), 'utf8')
)

const FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  10: 'DE', 11: 'DC', 12: 'FL', 13: 'GA', 15: 'HI', 16: 'ID', 17: 'IL', 18: 'IN',
  19: 'IA', 20: 'KS', 21: 'KY', 22: 'LA', 23: 'ME', 24: 'MD', 25: 'MA', 26: 'MI',
  27: 'MN', 28: 'MS', 29: 'MO', 30: 'MT', 31: 'NE', 32: 'NV', 33: 'NH', 34: 'NJ',
  35: 'NM', 36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH', 40: 'OK', 41: 'OR', 42: 'PA',
  44: 'RI', 45: 'SC', 46: 'SD', 47: 'TN', 48: 'TX', 49: 'UT', 50: 'VT', 51: 'VA',
  53: 'WA', 54: 'WV', 55: 'WI', 56: 'WY',
}

const WIDTH = 960
const HEIGHT = 600
const projection = geoAlbersUsa().scale(1280).translate([WIDTH / 2, HEIGHT / 2])
const path = geoPath(projection)

// Two decimal places is sub-pixel at this size and roughly halves the file.
const round = (d) => d.replace(/\d+\.\d+/g, (n) => Number(n).toFixed(1))

const states = {}
for (const f of feature(topo, topo.objects.states).features) {
  const abbr = FIPS[f.id]
  if (!abbr) {
    continue
  }
  const d = path(f)
  if (!d) {
    continue
  }
  const [cx, cy] = path.centroid(f)
  states[abbr] = {
    fips: f.id,
    name: f.properties.name,
    d: round(d),
    cx: Math.round(cx),
    cy: Math.round(cy),
  }
}

const borders = round(
  path(mesh(topo, topo.objects.states, (a, b) => a !== b)) || ''
)

const out = new URL('../package/public/geo/states.json', import.meta.url)
writeFileSync(
  out,
  JSON.stringify({ width: WIDTH, height: HEIGHT, states, borders })
)
console.log(
  `wrote ${Object.keys(states).length} states -> ${out.pathname} (${Math.round(
    readFileSync(out).length / 1024
  )} KB)`
)
