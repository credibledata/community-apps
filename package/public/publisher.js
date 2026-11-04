// Talking to Publisher, shared by every page: run a Malloy query and show one.

import { fmtInt } from './format.js'
import { MODEL, modelUrl, queryUrl } from './query.js'

const RESULT_ROW_LIMIT = 100

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export async function run(malloy, model = MODEL) {
  const res = await fetch(queryUrl(location.pathname, model), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ compactJson: true, query: malloy }),
  })
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`Publisher returned a non-JSON response (${res.status})`)
  }
  if (!res.ok) {
    const err = new Error(`Query failed: ${json?.message || res.statusText}`)
    err.status = res.status
    throw err
  }
  return JSON.parse(json.result)
}

const modelSources = new Map()

/** The model's source text, fetched once per page. */
export function loadModelSource(model = MODEL) {
  if (!modelSources.has(model)) {
    const p = fetch(modelUrl(location.pathname, model), { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Model request failed (${res.status})`))))
      .then((json) => {
        if (typeof json?.sourceText !== 'string') {
          throw new Error('Publisher returned no model source')
        }
        return json.sourceText
      })
    p.catch(() => modelSources.delete(model))
    modelSources.set(model, p)
  }
  return modelSources.get(model)
}

export const EXPAND_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
  stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg>`

function cellValue(v) {
  if (v === null || v === undefined) {
    return '<span class="muted">null</span>'
  }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
  }
  if (typeof v === 'object') {
    return esc(JSON.stringify(v))
  }
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?Z$/.test(v)) {
    return esc(v.slice(0, 10))
  }
  return esc(v)
}

/** A query's rows as a table, first RESULT_ROW_LIMIT shown. */
export function resultsTable(rows, { count = true } = {}) {
  if (!rows) {
    return '<p class="muted">Results load with the page…</p>'
  }
  const list = Array.isArray(rows) ? rows : [rows]
  if (!list.length) {
    return '<p class="muted">No rows.</p>'
  }
  const cols = Object.keys(list[0]).filter((c) => !c.startsWith('_'))
  const shown = list.slice(0, RESULT_ROW_LIMIT)
  const isNum = cols.map((c) => typeof list[0][c] === 'number')
  const summary = list.length > shown.length ? `First ${shown.length} of ${fmtInt(list.length)} rows` : `${fmtInt(list.length)} row${list.length === 1 ? '' : 's'}`
  return `${count ? `<div class="q-count">${summary}</div>` : ''}
    <div class="table-wrap short"><table class="results">
      <thead><tr>${cols.map((c, i) => `<th${isNum[i] ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((r) => `<tr>${cols.map((c, i) => `<td${isNum[i] ? ' class="num"' : ''}>${cellValue(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`
}
