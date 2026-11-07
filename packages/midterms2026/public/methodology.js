// Entry point for methodology.html: the data inventory, with live counts from each source.
// Each source card expands into a modal with its Malloy definition and a sample of its rows.

import { codeBlock } from './editor.js'
import { fmtDate, fmtInt, fmtSigned } from './format.js'
import { esc, EXPAND_ICON, loadModelSource, resultsTable, run } from './publisher.js'
import { INVENTORY_QUERIES, MODEL, sampleQuery, sourceBlock } from './query.js'
import { holdHostScroll } from './viewport.js'

const $ = (id) => document.getElementById(id)

const SOURCES = [
  ['geographies', 'Demographics', 'Every state and 2026 House district: population, race and ethnicity, education, age and income from the Census Bureau’s 2024 ACS, and presidential margins. Districts redrawn for 2026 have no census tabulation yet.', (r) => `${fmtInt(r.geography_count)} places`],
  ['historical_results', 'Historical results', 'President 2016–24 for the nation and every state (MIT Election Data and Science Lab), and 2020–24 on the 2026 district lines (The Downballot).', (r) => `${fmtInt(r.results)} results`],
  ['races', 'Races', 'All 506 races on the 2026 ballot from Wikipedia: nominees, incumbency, Sabato’s Crystal Ball ratings and FEC fundraising.', (r) => `${fmtInt(r.race_count)} races · ${r.competitive_races} rated competitive`],
  ['polls', 'Recent polls', 'Generic-ballot and nominee head-to-head polls from VoteHub, with house-effect and likely-voter adjustments.', (r) => `${fmtInt(r.poll_count)} polls · latest ${fmtDate(r.latest_poll)}`],
  ['pollsters', 'Pollster ratings', 'FiveThirtyEight grades, and house effects estimated from how each pollster’s polls compare with others’.', (r) => `${r.n} pollsters`],
  ['kalshi_prices', 'Kalshi odds history', 'Daily prices on Kalshi’s chamber-control and race markets.', (r) => `${fmtInt(r.days_traded)} market-days · $${(r.total_volume_usd / 1e6).toFixed(1)}M traded`],
  ['approval', 'Presidential approval', 'Daily average of VoteHub’s approval polls, feeding the environment prior.', (r) => `${fmtInt(r.n)} days · net ${fmtSigned(r.avg_net_approval)}`],
  ['special_elections', 'Special elections', 'Results since 2025 against the 2024 presidential margin in the same seat, from The Downballot’s tracker.', (r) => `${r.special_count} elections · avg swing ${fmtSigned(r.avg_swing)}`],
]

const samples = new Map()
let modelText = null
let open = null
let opener = null

async function renderSources() {
  $('sources').innerHTML = SOURCES.map(
    ([name, kind, desc]) => `<div class="source">
      <button type="button" class="expand" data-source="${name}" title="Expand: definition and sample rows"
        aria-label="Expand “${esc(kind)}”">${EXPAND_ICON}</button>
      <div class="kind">${kind}</div><h4>${name}</h4>
      <div class="count" id="src-${name}">…</div><p>${desc}</p>
    </div>`
  ).join('')
  await Promise.all(
    SOURCES.map(async ([name, , , fmt]) => {
      try {
        const [row] = await run(INVENTORY_QUERIES[name])
        $(`src-${name}`).textContent = fmt(row)
      } catch {
        $(`src-${name}`).textContent = 'unavailable'
      }
    })
  )
}

function definitionHtml(name) {
  if (modelText === null) {
    return '<p class="tm-quiet">Loading the model…</p>'
  }
  const block = modelText instanceof Error ? null : sourceBlock(modelText, name)
  return block ? codeBlock(block) : `<p class="tm-quiet">Couldn’t load this source from ${MODEL}.</p>`
}

function sampleHtml(name) {
  const rows = samples.get(name)
  if (rows === undefined) {
    return '<p class="tm-quiet">Loading a few rows…</p>'
  }
  if (rows instanceof Error) {
    return '<p class="tm-quiet">Couldn’t load sample rows.</p>'
  }
  return resultsTable(rows, { count: false })
}

/** Re-rendered as the model text and the sample rows arrive. */
function renderModalBody(name) {
  $('tm-body').innerHTML = `<div class="tm-label">Defined in ${MODEL}</div>
    ${definitionHtml(name)}
    <div class="tm-label">A sample of its dimensions</div>
    ${sampleHtml(name)}`
}

function openSource(name, from) {
  const [, kind, desc] = SOURCES.find(([n]) => n === name)
  open = name
  opener = from
  $('tm-name').textContent = name
  $('tm-title').textContent = kind
  $('tm-sub').textContent = desc
  renderModalBody(name)
  $('tile-modal').hidden = false
  $('tile-scrim').hidden = false
  $('tile-modal').scrollTop = 0
  document.body.classList.add('modal-open')
  $('tile-modal-close').focus({ preventScroll: true })
  const rerender = () => open === name && renderModalBody(name)
  if (modelText === null || modelText instanceof Error) {
    modelText = null
    loadModelSource()
      .then((text) => (modelText = text))
      .catch((err) => (modelText = err))
      .then(rerender)
  }
  if (!samples.has(name) || samples.get(name) instanceof Error) {
    samples.delete(name)
    run(sampleQuery(name))
      .then((rows) => samples.set(name, rows))
      .catch((err) => samples.set(name, err))
      .then(rerender)
  }
}

function closeSource() {
  if (!open) {
    return
  }
  open = null
  $('tile-modal').hidden = true
  $('tile-scrim').hidden = true
  document.body.classList.remove('modal-open')
  opener?.focus?.({ preventScroll: true })
}

$('sources').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-source]')
  if (btn) {
    openSource(btn.dataset.source, btn)
  }
})
$('tile-modal-close').addEventListener('click', closeSource)
$('tile-scrim').addEventListener('click', closeSource)
holdHostScroll($('tile-scrim'))
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSource()
  }
})

renderSources()
