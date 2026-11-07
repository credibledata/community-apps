// Pure formatting and colour helpers. No DOM: covered by tests/format.test.mjs.

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

/** D+4.2 / R+1.0 / EVEN for a D-minus-R margin in points. */
export function fmtMargin(m, digits = 1) {
  if (!isNum(m)) {
    return '—'
  }
  if (Math.abs(m) < 0.05) {
    return 'EVEN'
  }
  return `${m > 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(digits)}`
}

/** Signed points for waterfall labels: +2.1 / −0.4. */
export function fmtSigned(x, digits = 1) {
  if (!isNum(x)) {
    return '—'
  }
  const s = Math.abs(x).toFixed(digits)
  if (Number(s) === 0) {
    return (0).toFixed(digits)
  }
  return `${x > 0 ? '+' : '−'}${s}`
}

export function fmtPct(x, digits = 0) {
  return isNum(x) ? `${(x * 100).toFixed(digits)}%` : '—'
}

/**
 * FiveThirtyEight-style odds: "3 in 4", "about 2 in 3", ">99 in 100".
 * Always out of 100 for the headline; the fraction form is for prose.
 */
export function fmtOdds(p) {
  if (!isNum(p)) {
    return '—'
  }
  if (p > 0.99) {
    return '>99 in 100'
  }
  if (p < 0.01) {
    return '<1 in 100'
  }
  return `${Math.round(p * 100)} in 100`
}

export function fmtInt(n) {
  return isNum(n) ? Math.round(n).toLocaleString('en-US') : '—'
}

export function fmtMoney(m) {
  if (!isNum(m)) {
    return '—'
  }
  return m >= 10 ? `$${Math.round(m)}M` : `$${m.toFixed(1)}M`
}

/** Malloy returns dates as ISO timestamps at UTC midnight; format in UTC so the day never shifts. */
export function fmtDate(v, opts = { month: 'short', day: 'numeric' }) {
  if (v === null || v === undefined || v === '') {
    return '—'
  }
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v).slice(0, 10))
  if (Number.isNaN(d.getTime())) {
    return '—'
  }
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })
}

/** Probability-of-D-win to a forecast category, mirroring the expert-rating vocabulary. */
export function category(p) {
  if (!isNum(p)) {
    return 'No race'
  }
  if (p >= 0.95) {
    return 'Solid D'
  }
  if (p >= 0.75) {
    return 'Likely D'
  }
  if (p >= 0.6) {
    return 'Lean D'
  }
  if (p > 0.4) {
    return 'Toss-up'
  }
  if (p > 0.25) {
    return 'Lean R'
  }
  if (p > 0.05) {
    return 'Likely R'
  }
  return 'Solid R'
}

// Diverging ramp, red (R certain) through a warm neutral to blue (D certain). Stops are at
// P(D) = 0, .05, .25, .4, .5, .6, .75, .95, 1 — the category boundaries above.
const STOPS = [
  [0, [178, 24, 43]],
  [0.05, [200, 52, 56]],
  [0.25, [232, 118, 108]],
  [0.4, [245, 183, 168]],
  [0.5, [236, 229, 216]],
  [0.6, [172, 200, 236]],
  [0.75, [104, 155, 222]],
  [0.95, [36, 96, 186]],
  [1, [20, 66, 150]],
]

/** Colour for a probability that Democrats win. */
export function probColor(p) {
  if (!isNum(p)) {
    return '#dedad3'
  }
  const x = Math.min(1, Math.max(0, p))
  for (let i = 1; i < STOPS.length; i++) {
    const [b, cb] = STOPS[i]
    if (x <= b) {
      const [a, ca] = STOPS[i - 1]
      const f = (x - a) / (b - a || 1)
      const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * f))
      return `rgb(${c[0]},${c[1]},${c[2]})`
    }
  }
  return 'rgb(20,66,150)'
}

/** Text colour that stays readable on probColor(p). */
export function probInk(p) {
  return isNum(p) && (p > 0.8 || p < 0.2) ? '#fff' : '#1d1b18'
}

/** Colour for a margin, by squashing it through a logistic (about ±12 points saturates). */
export function marginColor(m) {
  return isNum(m) ? probColor(1 / (1 + Math.exp(-m / 4))) : probColor(null)
}

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming',
}
