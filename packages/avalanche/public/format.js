// Pure formatting and math helpers. No DOM, no globals: covered by tests/format.test.mjs.

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

export function fmtInt(n) {
  return isNum(n) ? Math.round(n).toLocaleString('en-US') : '—'
}

export function fmtCompact(n) {
  if (!isNum(n)) {
    return '—'
  }
  if (Math.abs(n) >= 10_000) {
    return `${(n / 1000).toFixed(0)}k`
  }
  if (Math.abs(n) >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return String(Math.round(n))
}

/** A 0-1 fraction as a percent. The model stores shares as fractions. */
export function fmtPct(x, digits = 0) {
  return isNum(x) ? `${(x * 100).toFixed(digits)}%` : '—'
}

/** Malloy returns dates as ISO timestamps at UTC midnight; format in UTC so the day never shifts. */
export function fmtDate(iso) {
  if (!iso) {
    return '—'
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return '—'
  }
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Season (water year) 2024 -> "2023-24". */
export function seasonLabel(season) {
  if (!Number.isInteger(season)) {
    return '—'
  }
  return `${season - 1}-${String(season % 100).padStart(2, '0')}`
}

/** Week-of-season index (0 = week starting Oct 1) -> "Oct 1", "Oct 8", ... using a non-leap season. */
export function weekLabel(week) {
  const base = Date.UTC(2001, 9, 1) // Oct 1 2001; season 2002 has no Feb 29
  const d = new Date(base + week * 7 * 86_400_000)
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
}

/** Month starts as week-of-season positions, for calendar axis labels. */
export function monthTicks() {
  const names = [
    'Oct',
    'Nov',
    'Dec',
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
  ]
  const out = []
  for (let i = 0; i < names.length; i++) {
    const day =
      (Date.UTC(2001 + (i >= 3 ? 1 : 0), (9 + i) % 12, 1) -
        Date.UTC(2001, 9, 1)) /
      86_400_000
    out.push({ label: names[i], week: day / 7 })
  }
  return out
}

export function hexToRgb(hex) {
  const h = hex.trim().replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = Number.parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/** Linear blend between two hex colors, t in [0,1]. */
export function mix(a, b, t) {
  const A = hexToRgb(a),
    B = hexToRgb(b)
  const k = Math.max(0, Math.min(1, t))
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * k))
}

/** Map a value onto a multi-stop ramp. Uses sqrt scaling: counts here are heavy-tailed. */
export function rampColor(stops, value, max) {
  if (!isNum(value) || value <= 0 || !isNum(max) || max <= 0) {
    return stops[0]
  }
  const t = Math.sqrt(Math.min(1, value / max)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  return mix(stops[i], stops[i + 1], t - i)
}

/** Share of a total, or null when the total is zero/missing (missing is not zero). */
export function share(part, total) {
  return isNum(part) && isNum(total) && total > 0 ? part / total : null
}

/** Equirectangular projection scaled by cos(mid-latitude), fitted into w x h with padding. */
export function makeProjection(bounds, w, h, pad = 8) {
  const [minLon, minLat, maxLon, maxLat] = bounds
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const sx = (w - pad * 2) / ((maxLon - minLon) * k)
  const sy = (h - pad * 2) / (maxLat - minLat)
  const s = Math.min(sx, sy)
  const ox = (w - (maxLon - minLon) * k * s) / 2
  const oy = (h - (maxLat - minLat) * s) / 2
  return ([lon, lat]) => [ox + (lon - minLon) * k * s, oy + (maxLat - lat) * s]
}
