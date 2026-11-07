// Shared helpers for the real-data pipeline: a download cache, CSV in and out, and the few
// wikitext patterns the curation step reads.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export const ROOT = new URL('../../', import.meta.url)
// Raw downloads stay at the repo root, outside the package, so they are never published with it.
export const RAW = new URL('../../data-raw/', ROOT)
export const CURATED = new URL('pipeline/data/curated/', ROOT)
export const OUT = new URL('data/', ROOT)
for (const dir of [RAW, CURATED, OUT]) {
  mkdirSync(dir, { recursive: true })
}

export const REFRESH = process.argv.includes('--refresh')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fetch `url` into data-raw/<name> unless it is already cached; returns the cached text. */
export async function cached(name, url, { binary = false, retries = 3 } = {}) {
  const file = new URL(name, RAW)
  if (!REFRESH && existsSync(file)) {
    return binary ? readFileSync(file) : readFileSync(file, 'utf8')
  }
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'credible-elections-2026 data build (example app)' } })
      if (res.status === 429) {
        await sleep(2000 * (i + 1))
        continue
      }
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText} for ${url}`)
      }
      const body = Buffer.from(await res.arrayBuffer())
      writeFileSync(file, body)
      return binary ? body : body.toString('utf8')
    } catch (err) {
      lastErr = err
      await sleep(1000 * (i + 1))
    }
  }
  throw lastErr
}

export function readRaw(name) {
  return readFileSync(new URL(name, RAW), 'utf8')
}

export function readJson(name) {
  return JSON.parse(readRaw(name))
}

/** RFC 4180 CSV into an array of arrays. */
export function parseCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') {
        quoted = false
      } else {
        cell += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') {
        i++
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += c
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** CSV with a header row into objects. */
export function parseCsv(text, { delimiter = ',' } = {}) {
  const rows = delimiter === ',' ? parseCsvRows(text) : text.split(/\r?\n/).map((l) => l.split(delimiter))
  const [head, ...body] = rows
  return body.filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

export function toCsv(rows, cols = Object.keys(rows[0] || {})) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `${[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')}\n`
}

export function writeCurated(name, rows, cols) {
  writeFileSync(new URL(name, CURATED), toCsv(rows, cols))
  console.log(`curated/${name.padEnd(22)} ${String(rows.length).padStart(6)} rows`)
}

export function readCurated(name) {
  return parseCsv(readFileSync(new URL(name, CURATED), 'utf8'))
}

export const num = (v) => {
  if (v === null || v === undefined) {
    return null
  }
  const s = String(v).replace(/[%,$\s]/g, '')
  if (s === '' || s === '-' || s === 'NA') {
    return null
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
export const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10)
export const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100)

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
}
export const ABBR = Object.fromEntries(Object.entries(STATES).map(([a, n]) => [n.toLowerCase(), a]))

export const REGION = {
  Northeast: 'CT ME MA NH RI VT NJ NY PA',
  Midwest: 'IL IN MI OH WI IA KS MN MO NE ND SD',
  South: 'DE FL GA MD NC SC VA WV AL KY MS TN AR LA OK TX',
  West: 'AZ CO ID MT NV NM UT WY AK CA HI OR WA',
}
export const regionOf = Object.fromEntries(
  Object.entries(REGION).flatMap(([r, s]) => s.split(' ').map((a) => [a, r]))
)

export const geoId = (state, district) =>
  district ? `${state}-${String(district).padStart(2, '0')}` : state

/** Split a wikitext table into rows of raw cell strings, starting at `from`. */
export function wikiTableRows(text, from = 0) {
  const start = text.indexOf('{|', from)
  const end = text.indexOf('\n|}', start)
  return text
    .slice(start, end)
    .split(/\n\|-[^\n]*/)
    .slice(1)
}

/** Plain text from a wikitext fragment: links, sortname, small and refs reduced to their text. */
export function plain(s) {
  return String(s)
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{sortname\|([^|}]+)\|([^|}]+)[^}]*\}\}/gi, '$1 $2')
    .replace(/\{\{(?:small|nowrap)\|([^{}]*)\}\}/gi, '$1')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Candidates in a `{{Party stripe|...}}Name (Party)` plainlist. */
export function wikiCandidates(cell) {
  const out = []
  for (const m of cell.matchAll(/\*\s*\{\{Party stripe\|([^}]*)\}\}(.*)/gi)) {
    // Fusion tickets (NY, CT) stack several stripes; the parenthetical names the main party.
    const rest = m[2].replace(/\{\{Party stripe\|[^}]*\}\}/gi, '')
    const text = plain(rest).replace(/\s*\(.*$/, '').trim()
    const partyText = (rest.match(/\(([^()]*)\)\s*(?:<ref|$)/) || [])[1] || m[1]
    out.push({ name: text, party: partyCode(partyText || m[1]) })
  }
  return out
}

export function partyCode(s) {
  const t = String(s).toLowerCase()
  if (/democrat|dfl/.test(t)) {
    return 'D'
  }
  if (/republican/.test(t)) {
    return 'R'
  }
  if (/independent|nonpartisan|no party|forward|unaffiliated/.test(t)) {
    return 'I'
  }
  return 'O'
}

/**
 * Sabato-style label into the model's seven categories. Tilt counts as Lean; Safe as Solid.
 * `independentAs` is the side an independent candidate stands in for ('D' or 'R'), if any.
 */
export function ratingLabel(cell, { independentAs = null } = {}) {
  const m = String(cell).match(/USRaceRating\|([A-Za-z-]+)(?:\|([A-Z]))?/i)
  if (!m) {
    return null
  }
  const kind = m[1].toLowerCase()
  if (kind === 'tossup' || kind === 'toss-up') {
    return 'Toss-up'
  }
  let side = (m[2] || '').toUpperCase()
  if (side === 'I' && independentAs) {
    side = independentAs
  }
  if (side !== 'D' && side !== 'R') {
    return null
  }
  const word = { safe: 'Solid', solid: 'Solid', likely: 'Likely', lean: 'Lean', tilt: 'Lean' }[kind]
  return word ? `${word} ${side}` : null
}
