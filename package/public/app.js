// Entry point: boot queries, the simulation workers, levers, rendering and the race drawer.
// Queries come only from query.js, model arithmetic only from model.js, drawing only from
// charts.js.

import * as charts from './charts.js'
import {
  category,
  fmtDate,
  fmtInt,
  fmtMargin,
  fmtMoney,
  fmtOdds,
  fmtPct,
  fmtSigned,
  probColor,
  probInk,
  STATE_NAMES,
} from './format.js'
import {
  CONTROL_RANGES,
  clampControls,
  DEFAULT_CONTROLS,
  dayOf,
  HIST_MIN,
  historyDates,
  incumbentSign,
  PRESETS,
  pollAverage,
  pollContributions,
  prepare,
} from './model.js'
import { codeBlock } from './editor.js'
import { esc, EXPAND_ICON, loadModelSource, resultsTable, run } from './publisher.js'
import {
  BOOT_QUERIES,
  demographicsQuery,
  hashToState,
  historyQuery,
  MODEL,
  marketQuery,
  stateToHash,
  viewBlock,
} from './query.js'
import { holdHostScroll, onVisibleBand, visibleBand } from './viewport.js'

const $ = (id) => document.getElementById(id)
const OFFICE_KEY = { Senate: 'sen', House: 'hou', Governor: 'gov' }
const SIMS = 10_000

// ---- Workers -------------------------------------------------------------------------------
function makeWorker() {
  const w = new Worker('./sim-worker.js', { type: 'module' })
  const waiting = new Map()
  let seq = 0
  w.onmessage = (e) => {
    const { id, type } = e.data
    const p = waiting.get(id)
    if (!p) {
      return
    }
    waiting.delete(id)
    if (type === 'error') {
      p.reject(new Error(e.data.message))
    } else {
      p.resolve(e.data)
    }
  }
  return (type, payload) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      waiting.set(id, { resolve, reject })
      w.postMessage({ type, id, payload })
    })
}
const live = makeWorker()
const background = makeWorker()

// ---- State ---------------------------------------------------------------------------------
const view = { office: 'Senate', race: null, houseState: null }
let controls = { ...DEFAULT_CONTROLS }
let data = null
let prep = null
let geo = null
let result = null
let baseline = null
let history = null
let baseHistory = null
let sens = null
const table = { sort: 'close', dir: 1, search: '', competitive: true }
const drawerCache = new Map()

const isDefault = () =>
  Object.keys(DEFAULT_CONTROLS).every((k) => controls[k] === DEFAULT_CONTROLS[k])

function writeHash() {
  const hash = stateToHash({ office: view.office, race: view.race }, controls, DEFAULT_CONTROLS)
  window.history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
}

// ---- Live simulation, coalesced ------------------------------------------------------------
let running = false
let pending = null
function requestRun() {
  pending = { ...controls }
  if (!running) {
    pump()
  }
}
async function pump() {
  running = true
  setStatus('Simulating…', true)
  while (pending) {
    const c = pending
    pending = null
    try {
      const r = await live('run', { controls: c, sims: SIMS })
      result = r.result
      renderAll()
    } catch (err) {
      setStatus(`Simulation failed: ${err.message}`)
      running = false
      return
    }
  }
  running = false
  setStatus(isDefault() ? 'Default assumptions' : 'Custom scenario')
}

let bgTimer = null
let bgToken = 0
function scheduleBackground() {
  clearTimeout(bgTimer)
  bgTimer = setTimeout(runBackground, 350)
}
async function runBackground() {
  const token = ++bgToken
  const c = { ...controls }
  try {
    const s = await background('sensitivity', { controls: c, office: view.office })
    if (token !== bgToken) {
      return
    }
    sens = s
    renderTornado()
    const h = await background('history', { controls: c })
    if (token !== bgToken) {
      return
    }
    history = h.points
    if (isDefault()) {
      baseHistory = history
    }
    renderHistory()
    renderEnvironment()
  } catch (err) {
    console.error(err)
  }
}

function setStatus(text, busy = false) {
  const el = $('sim-status')
  el.textContent = text
  el.classList.toggle('busy', busy)
}

// ---- Levers --------------------------------------------------------------------------------
const LEVERS = {
  envShift: {
    label: 'National environment',
    help: 'Shift every race toward Democrats (+) or Republicans (−), on top of what the data shows.',
    fmt: (v) => (v === 0 ? 'No shift' : fmtMargin(v)),
    ends: ['R+10', 'D+10'],
  },
  pollTrust: {
    label: 'Trust in polls',
    help: '0 ignores polls entirely (fundamentals only); 2 doubles their weight.',
    fmt: (v) => `×${v.toFixed(1)}`,
    ends: ['Ignore', 'Double'],
  },
  halfLife: {
    label: 'Poll recency',
    help: 'Half-life of a poll’s weight. Shorter = chase the latest numbers.',
    fmt: (v) => `${Math.round(v)}-day half-life`,
    ends: ['5 days', '90 days'],
  },
  nationalError: {
    label: 'Correlated polling error',
    help: 'How far the polls could miss in the same direction everywhere (1 s.d.). Higher = less certainty.',
    fmt: (v) => `±${v.toFixed(2)} pts`,
    ends: ['Small', 'Large'],
  },
  incumbency: {
    label: 'Incumbency advantage',
    help: 'Points for a member running again (×1.6 for governors).',
    fmt: (v) => `${v.toFixed(2)} pts`,
    ends: ['None', '6 pts'],
  },
  collegeSwing: {
    label: 'College graduates',
    help: 'Extra swing among college-educated voters. Moves each race by swing × their share there.',
    fmt: (v) => (v === 0 ? 'No swing' : fmtMargin(v)),
    ends: ['R+10', 'D+10'],
  },
  nonwhiteSwing: {
    label: 'Voters of color',
    help: 'Extra swing among Black, Hispanic, Asian and other nonwhite voters, weighted by their share.',
    fmt: (v) => (v === 0 ? 'No swing' : fmtMargin(v)),
    ends: ['R+10', 'D+10'],
  },
  marketWeight: {
    label: 'Weight on Kalshi markets',
    help: 'Blend prediction-market prices into races that have a market.',
    fmt: (v) => fmtPct(v),
    ends: ['0%', '60%'],
  },
  blWeight: {
    label: 'Bitecofer–Lichtman layer',
    help: 'An optional structural layer: historical “keys”, midterm turnout patterns and polarization. See the methodology.',
    fmt: (v) => (v === 0 ? 'Off' : `×${v.toFixed(2)}`),
    ends: ['Off', 'Full'],
  },
}

function buildLevers() {
  const presets = $('presets')
  for (const [key, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chip'
    b.dataset.preset = key
    b.textContent = p.label
    b.addEventListener('click', () => {
      setControls({ ...DEFAULT_CONTROLS, ...p.patch })
    })
    presets.append(b)
  }
  const box = $('sliders')
  for (const [key, meta] of Object.entries(LEVERS)) {
    const [lo, hi, step] = CONTROL_RANGES[key]
    const wrap = document.createElement('div')
    wrap.className = 'lever'
    wrap.innerHTML = `
      <div class="lever-top">
        <label for="l-${key}">${meta.label}</label>
        <output id="o-${key}" for="l-${key}"></output>
      </div>
      <p>${meta.help}</p>
      <input type="range" id="l-${key}" min="${lo}" max="${hi}" step="${step}">
      <div class="ends"><span>${meta.ends[0]}</span><span>${meta.ends[1]}</span></div>`
    box.append(wrap)
    wrap.querySelector('input').addEventListener('input', (e) => {
      setControls({ ...controls, [key]: Number(e.target.value) })
    })
    wrap.querySelector('input').addEventListener('dblclick', () => {
      setControls({ ...controls, [key]: DEFAULT_CONTROLS[key] })
    })
  }
  $('reset').addEventListener('click', () => setControls({ ...DEFAULT_CONTROLS }))
  $('levers-toggle').addEventListener('click', () => setLeversOpen(!leversOpen()))
  placeLevers()
  onVisibleBand(placeLevers)
  document.fonts?.ready.then(placeLevers)
  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      $('copy-link').textContent = 'Copied'
      setTimeout(() => {
        $('copy-link').textContent = 'Copy link'
      }, 1400)
    } catch {
      /* clipboard unavailable: the URL bar already holds the link */
    }
  })
}

function syncLevers() {
  for (const [key, meta] of Object.entries(LEVERS)) {
    const input = $(`l-${key}`)
    if (Number(input.value) !== controls[key]) {
      input.value = controls[key]
    }
    const out = $(`o-${key}`)
    out.textContent = meta.fmt(controls[key])
    out.classList.toggle('changed', controls[key] !== DEFAULT_CONTROLS[key])
  }
  for (const b of document.querySelectorAll('[data-preset]')) {
    const target = { ...DEFAULT_CONTROLS, ...PRESETS[b.dataset.preset].patch }
    const on = Object.keys(target).every((k) => target[k] === controls[k])
    b.setAttribute('aria-pressed', String(on))
  }
  const changed = Object.keys(LEVERS).filter((k) => controls[k] !== DEFAULT_CONTROLS[k]).length
  $('levers-toggle-count').textContent = changed ? `${changed} changed` : ''
}

// The panel's header and scenarios are always docked in the gutter; the sliders expand below.
function leversOpen() {
  return $('levers').classList.contains('open')
}

function placeLevers() {
  const gap = 16
  const fold = document.querySelector('.masthead').getBoundingClientRect().bottom
  const root = document.documentElement.style
  root.setProperty('--levers-top', `${Math.round(Math.max(visibleBand().top, fold) + gap)}px`)
  // The collapsed bottom bar's height, so the page can pad past it on narrow screens.
  if (!leversOpen()) {
    root.setProperty('--levers-h', `${$('levers').offsetHeight}px`)
  }
}

function setLeversOpen(open) {
  $('levers').classList.toggle('open', open)
  $('levers-toggle').setAttribute('aria-expanded', String(open))
  $('levers-fine').inert = !open
}

function setControls(next) {
  controls = clampControls(next)
  syncLevers()
  writeHash()
  requestRun()
  scheduleBackground()
}

// ---- Office --------------------------------------------------------------------------------
function setOffice(office) {
  if (view.office === office) {
    return
  }
  view.office = office
  view.houseState = null
  sens = null
  writeHash()
  renderAll()
  scheduleBackground()
}

const racesFor = (office) => prep.races.filter((r) => r.office === office)
const res = (id) => result?.races[id]
const baseRes = (id) => baseline?.races[id]

function shortLabel(r) {
  if (r.office === 'House') {
    return r.geo_id
  }
  return r.is_special ? `${r.state}*` : r.state
}

function raceTip(r) {
  const x = res(r.race_id)
  if (!x) {
    return esc(r.race_name)
  }
  const pD = x.pWin
  return `<b>${esc(r.race_name)}</b><br>
    <span style="color:#8fb4ee">D ${fmtPct(pD)}</span> · <span style="color:#f1a1a3">R ${fmtPct(1 - pD)}</span><br>
    ${r.locked_party ? esc(r.matchup_note) : `Avg margin ${fmtMargin(x.meanMargin)}`}<br>
    <span class="muted">Experts: ${esc(r.expert_rating ?? 'not rated')}${x.breakdown.pollCount ? ` · ${x.breakdown.pollCount} polls` : ''}</span>`
}

/** Every named nominee, D side first ("A; B" cells hold top-two finalists from one party). */
function finalists(r) {
  return [r.dem_candidate, r.rep_candidate].flatMap((c) => String(c || '').split(';')).map((s) => s.trim()).filter(Boolean)
}

/** "Ossoff (D) vs. Collins (R)", or "Chan vs. Wiener" when both finalists share a party. Independent stand-ins are labelled by side; matchup_note explains them. */
function matchupLabel(r) {
  if (r.locked_party) {
    return esc(finalists(r).join(' vs. '))
  }
  if (!r.dem_candidate && !r.rep_candidate) {
    return ''
  }
  return `${esc(r.dem_candidate || '—')} (D) vs. ${esc(r.rep_candidate || '—')} (R)`
}

/** "Democratic incumbent" / "Open seat (R held)" / "New seat" / "Independent incumbent (R side)". */
function incumbencyLabel(r) {
  const party = { D: 'Democratic', R: 'Republican', I: 'Independent' }
  if (!r.incumbent_party) {
    return 'New seat'
  }
  if (r.is_open_seat) {
    return `Open seat (${r.incumbent_party} held)`
  }
  const side = r.incumbent_party === 'I' ? ` (${incumbentSign(r) > 0 ? 'D' : 'R'} side)` : ''
  return `${party[r.incumbent_party] || r.incumbent_party} incumbent${side}`
}

// ---- Rendering -----------------------------------------------------------------------------
function renderAll() {
  if (!result) {
    return
  }
  renderTopline()
  renderOffice()
  renderEnvironmentFormula()
  renderMarketScatter()
  renderBlendMix()
  renderHistory()
  if (view.race) {
    renderDrawer()
  }
}

function controlPhrase(office, p) {
  const fav = p >= 0.5 ? 'D' : 'R'
  const q = Math.max(p, 1 - p)
  const party = fav === 'D' ? 'Democrats' : 'Republicans'
  const what = office === 'Governor' ? 'a majority of governorships' : `${office} control`
  if (q < 0.55) {
    return { html: `${office === 'Governor' ? 'A majority of governorships' : `${office} control`} splits roughly evenly across simulations`, fav }
  }
  return { html: `<span class="${fav}">${party} win ${what}</span> in ${Math.round(q * 100)}% of simulations`, fav }
}

function renderTopline() {
  for (const office of ['Senate', 'House', 'Governor']) {
    const k = OFFICE_KEY[office]
    const c = result.chambers[office]
    const p = c.pDemControl
    const fav = p >= 0.5 ? 'D' : 'R'
    const who = $(`t-${k}-who`)
    who.textContent = fav === 'D' ? 'Democrats' : 'Republicans'
    who.className = `who ${fav}`
    $(`t-${k}-odds`).textContent = fmtOdds(Math.max(p, 1 - p))
    const unit = office === 'Governor' ? 'governorships' : 'seats'
    $(`t-${k}-sub`).textContent = `${office === 'Governor' ? 'simulations with a majority of governorships' : `simulations with ${office} control`} · D ${unit} ${c.expectedDemSeats.toFixed(0)} (80%: ${c.p10}–${c.p90})`
    charts.oddsDots($(`t-${k}-dots`), p)
    const b = baseline?.chambers[office]
    const d = $(`t-${k}-delta`)
    if (b && !isDefault()) {
      const diff = p - b.pDemControl
      d.innerHTML = `vs. default: D ${fmtPct(b.pDemControl)} → <b class="${diff >= 0 ? 'up' : 'down'}">${fmtPct(p)}</b> (${diff >= 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(0)} pts)`
    } else {
      d.textContent = ''
    }
  }
  for (const card of document.querySelectorAll('.top-card')) {
    card.setAttribute('aria-current', String(card.dataset.office === view.office))
  }
  for (const tab of document.querySelectorAll('.tabs button')) {
    tab.setAttribute('aria-selected', String(tab.dataset.office === view.office))
  }
  $('sim-count').textContent = fmtInt(result.sims)
}

function renderOffice() {
  const office = view.office
  const c = result.chambers[office]
  const { html } = controlPhrase(office, c.pDemControl)
  $('office-headline').innerHTML = html
  const racesUp = racesFor(office).length
  const nounPl = office === 'Governor' ? 'governor’s races' : `${office} races`
  $('office-sub').innerHTML =
    office === 'Senate'
      ? `${racesUp} ${nounPl}, including two specials. Republicans hold 53 seats and Democrats 47. With the Vice President breaking ties for Republicans, Democratic control takes <b>51</b>, a net gain of <b>${51 - 47}</b>.`
      : office === 'House'
        ? `All 435 seats are up. Republicans hold 220 to Democrats’ 215; <b>218</b> wins the majority.`
        : `${racesUp} governorships are up. Democrats hold 23 of 50 today; <b>26</b> is a majority.`

  // Balance of power.
  const blue = getComputedStyle(document.documentElement).getPropertyValue('--dem').trim()
  const red = getComputedStyle(document.documentElement).getPropertyValue('--rep').trim()
  const upD = c.expectedDemSeats - c.demNotUp
  const upR = c.total - c.expectedDemSeats - c.repNotUp
  charts.balanceBar($('balance'), {
    total: c.total,
    threshold: c.demNeeds,
    thresholdLabel: `${c.demNeeds} for Democratic control`,
    segments: [
      { value: c.demNotUp, color: blue, hatch: true, label: 'Democrats, not up' },
      { value: upD, color: blue, label: 'Democrats, simulated (average)' },
      { value: upR, color: red, label: 'Republicans, simulated (average)' },
      { value: c.repNotUp, color: red, hatch: true, label: 'Republicans, not up' },
    ],
  })
  $('balance-sub').textContent =
    office === 'House'
      ? 'Average seats across simulations.'
      : 'Average seats across simulations. Faded = not up this year.'

  renderMap()
  charts.seatHistogram($('seat-hist'), {
    hist: c.seatHist,
    threshold: c.demNeeds,
    current: c.current.D,
    label: office === 'Governor' ? 'Democratic governors' : 'Democratic seats',
  })
  $('hist-sub').textContent = `Democratic ${office === 'Governor' ? 'governorships' : 'seats'} after the election in each of ${fmtInt(result.sims)} simulations. Median ${c.p50}; 80% fall between ${c.p10} and ${c.p90}.`

  renderSnake()
  renderTable()
  if (sens?.office !== office) {
    $('tornado').replaceChildren(Object.assign(document.createElement('div'), { className: 'loading-box', textContent: 'Measuring sensitivity…' }))
  }
}

function renderMap() {
  const office = view.office
  const races = racesFor(office)
  if (office === 'House') {
    const byState = new Map()
    for (const r of races) {
      const x = res(r.race_id)
      if (!byState.has(r.state)) {
        byState.set(r.state, { n: 0, d: 0, races: [] })
      }
      const s = byState.get(r.state)
      s.n++
      s.d += x.pWin
      s.races.push(r)
    }
    $('map-title').textContent = 'The House map, state by state'
    $('map-sub').textContent = 'Shaded by the expected Democratic share of each state’s seats. Click a state to list its districts below.'
    charts.usMap($('map'), geo, {
      fill: (a) => (byState.has(a) ? probColor(byState.get(a).d / byState.get(a).n) : null),
      label: (a) => probInk(byState.get(a)?.d / byState.get(a)?.n),
      selected: view.houseState,
      title: (a) => {
        const s = byState.get(a)
        if (!s) {
          return esc(STATE_NAMES[a] || a)
        }
        const now = s.races.filter((r) => r.incumbent_party === 'D').length
        return `<b>${esc(STATE_NAMES[a])}</b><br>${s.n} seat${s.n > 1 ? 's' : ''} · Democrats hold ${now}<br>Simulated: D ${s.d.toFixed(1)} on average`
      },
      onClick: (a) => {
        view.houseState = view.houseState === a ? null : a
        renderMap()
      },
    })
    $('district-strip-wrap').hidden = false
    renderDistrictStrip(races)
  } else {
    const byState = new Map(races.map((r) => [r.state, r]))
    $('map-title').textContent = office === 'Senate' ? 'The Senate map' : 'The governor map'
    $('map-sub').textContent = 'Shaded by the share of simulations each party wins. Grey = no race this year. Click a state to see how its estimate is built.'
    charts.usMap($('map'), geo, {
      fill: (a) => (byState.has(a) ? probColor(res(byState.get(a).race_id).pWin) : null),
      label: (a) => probInk(res(byState.get(a)?.race_id)?.pWin),
      selected: view.race ? prep.raceById.get(view.race)?.state : null,
      title: (a) => (byState.has(a) ? raceTip(byState.get(a)) : `<b>${esc(STATE_NAMES[a] || a)}</b><br><span class="muted">No ${office.toLowerCase()} race in 2026</span>`),
      onClick: (a) => openRace(byState.get(a).race_id),
    })
    $('district-strip-wrap').hidden = true
  }
  const ramp = [
    ['Solid R', 0.02],
    ['Likely R', 0.15],
    ['Lean R', 0.33],
    ['Toss-up', 0.5],
    ['Lean D', 0.67],
    ['Likely D', 0.85],
    ['Solid D', 0.98],
  ]
  $('map-legend').innerHTML = ramp
    .map(([l, p]) => `<span><i style="background:${probColor(p)}"></i>${l}</span>`)
    .join('')
}

function renderDistrictStrip(races) {
  const pool = view.houseState ? races.filter((r) => r.state === view.houseState) : races
  const items = pool
    .map((r) => ({ r, x: res(r.race_id) }))
    .sort((a, b) => b.x.meanMargin - a.x.meanMargin)
    .map(({ r, x }) => ({ id: r.race_id, p: x.pWin, short: r.geo_id.slice(3), tip: raceTip(r) }))
  $('district-title').textContent = view.houseState
    ? `${STATE_NAMES[view.houseState]}’s ${pool.length} district${pool.length > 1 ? 's' : ''}`
    : 'All 435 districts, most Democratic to most Republican'
  const rows = view.houseState ? 1 : 5
  charts.snake($('district-strip'), {
    items,
    startD: 0,
    threshold: view.houseState ? 0 : 218,
    rows,
    selected: view.race,
    onClick: openRace,
  })
}

function renderSnake() {
  const office = view.office
  const c = result.chambers[office]
  const items = racesFor(office)
    .map((r) => ({ r, x: res(r.race_id) }))
    .sort((a, b) => b.x.meanMargin - a.x.meanMargin)
    .map(({ r, x }) => ({ id: r.race_id, p: x.pWin, short: shortLabel(r), tip: raceTip(r) }))
  charts.snake($('snake'), {
    items,
    startD: c.demNotUp,
    threshold: c.demNeeds,
    rows: office === 'House' ? 5 : 1,
    selected: view.race,
    onClick: openRace,
  })
  $('snake-sub').textContent =
    office === 'House'
      ? 'All 435 races ordered by average simulated margin. A majority takes 218.'
      : `Every race ordered by average simulated margin. With ${c.demNotUp} Democratic seats not up, the line falls after the first ${c.demNeeds - c.demNotUp} of these.`
}

// ---- Race table ----------------------------------------------------------------------------
const COLUMNS = [
  { key: 'name', label: 'Race' },
  { key: 'rating', label: 'Experts' },
  { key: 'p', label: 'Share of simulations won', num: false },
  { key: 'margin', label: 'Avg margin', num: true },
  { key: 'range', label: '80% range', num: true, nosort: true },
  { key: 'polls', label: 'Polls', num: true },
  { key: 'market', label: 'Kalshi', num: true },
  { key: 'tipping', label: 'Tipping pt.', num: true },
]

function tableRows() {
  const q = table.search.trim().toLowerCase()
  return racesFor(view.office)
    .map((r) => ({ r, x: res(r.race_id), b: baseRes(r.race_id) }))
    .filter(({ r, x }) => {
      if (table.competitive && !(x.pWin > 0.04 && x.pWin < 0.96)) {
        return false
      }
      if (!q) {
        return true
      }
      return (
        r.race_name.toLowerCase().includes(q) ||
        r.race_id.toLowerCase().includes(q) ||
        (STATE_NAMES[r.state] || '').toLowerCase().includes(q)
      )
    })
}

function renderTable() {
  const rows = tableRows()
  const val = {
    name: ({ r }) => r.race_name,
    rating: ({ r }) => -(r.rating_score ?? 0),
    p: ({ x }) => -x.pWin,
    close: ({ x }) => Math.abs(x.pWin - 0.5),
    margin: ({ x }) => -x.meanMargin,
    polls: ({ x }) => -x.breakdown.pollCount,
    market: ({ x }) => -(x.breakdown.marketPrice ?? -1),
    tipping: ({ x }) => -(x.tipping ?? 0),
  }[table.sort]
  rows.sort((a, b) => {
    const va = val(a)
    const vb = val(b)
    return (va < vb ? -1 : va > vb ? 1 : 0) * table.dir
  })
  const el = $('race-table')
  const head = `<thead><tr>${COLUMNS.map(
    (c) =>
      `<th class="${c.num ? 'num' : ''} ${c.nosort ? '' : 'sortable'}" data-sort="${c.key}">${c.label}${table.sort === c.key ? (table.dir > 0 ? ' ↓' : ' ↑') : ''}</th>`
  ).join('')}</tr></thead>`
  const body = rows
    .slice(0, 250)
    .map(({ r, x, b }) => {
      const pD = x.pWin
      const fav = pD >= 0.5 ? 'D' : 'R'
      const ghost = b && !isDefault() ? `<span class="ghost" style="left:calc(${(b.pWin * 100).toFixed(1)}% - 1px)"></span>` : ''
      const mkt = x.breakdown.marketPrice
      const edge = mkt === null ? '' : pD - mkt
      const pill = (rating) => {
        if (!rating) {
          return '<span class="muted">Not rated</span>'
        }
        const p = { 'Solid D': 0.98, 'Likely D': 0.85, 'Lean D': 0.67, 'Toss-up': 0.5, 'Lean R': 0.33, 'Likely R': 0.15, 'Solid R': 0.02 }[rating]
        return `<span class="pill" style="background:${probColor(p)};color:${probInk(p)}">${esc(rating)}</span>`
      }
      return `<tr class="clickable" data-race="${r.race_id}">
        <td><b>${esc(r.race_name)}</b>${r.is_open_seat ? ' <span class="muted">open</span>' : ''}</td>
        <td>${pill(r.expert_rating)}</td>
        <td><span class="prob-cell"><span class="prob-bar"><i style="width:${(pD * 100).toFixed(1)}%"></i>${ghost}</span>
          <b style="color:var(--${fav === 'D' ? 'dem' : 'rep'})">${fav} ${fmtPct(Math.max(pD, 1 - pD))}</b></span></td>
        <td class="num">${fmtMargin(x.meanMargin)}</td>
        <td class="num muted">${fmtMargin(x.p10, 0)} to ${fmtMargin(x.p90, 0)}</td>
        <td class="num">${x.breakdown.pollCount || '<span class="muted">—</span>'}</td>
        <td class="num">${mkt === null ? '<span class="muted">—</span>' : `D ${fmtPct(mkt)} <span class="edge ${edge >= 0 ? 'D' : 'R'}">${fmtSigned(edge * 100, 0)}</span>`}</td>
        <td class="num">${view.office === 'Governor' ? '<span class="muted">—</span>' : fmtPct(x.tipping, 1)}</td>
      </tr>`
    })
    .join('')
  el.innerHTML = `${head}<tbody>${body || '<tr><td colspan="8" class="muted">No races match.</td></tr>'}</tbody>`
}

// ---- Drivers -------------------------------------------------------------------------------
function renderEnvironmentFormula() {
  const env = result.env
  const term = (label, v, w) =>
    `<span class="term">${label}<b>${fmtMargin(v)}${w ? ` × ${w}` : ''}</b></span>`
  $('env-formula').innerHTML = [
    term('Generic ballot', env.genericBallot, '0.7'),
    '<span class="op">+</span>',
    term(`Approval (net ${fmtSigned(env.netApproval, 0)})`, env.approvalPrior, '0.2'),
    '<span class="op">+</span>',
    term('Special elections', env.specialsSignal, '0.1'),
    env.keysShare
      ? `<span class="op">+</span>${term(`Keys (${env.keys.turned} of ${env.keys.keys.length} turned), ${Math.round(env.keysShare * 100)}% pull toward ${fmtMargin(env.keys.environment)}`, env.keysTerm)}`
      : '',
    env.shift ? `<span class="op">+</span>${term('Scenario shift', env.shift)}` : '',
    '<span class="op">=</span>',
    `<span class="term result">Environment<b>${fmtMargin(env.value)}</b></span>`,
  ].join('')
}

function renderEnvironment() {
  if (!prep) {
    return
  }
  const dots = prep.generic.map((p) => ({
    t: p._end,
    v: p.adjusted_margin,
    r: 1.5 + 3 * Math.sqrt((Number(p.grade_weight) || 0.4) * Math.sqrt(p.sample_size / 600)),
    opacity: 0.32,
    tip: `<b>${esc(p.pollster)}</b> (${esc(p.grade)}) · ${fmtDate(p.end_date)}<br>Raw ${fmtMargin(p.raw_margin)} → adjusted ${fmtMargin(p.adjusted_margin)}<br><span class="muted">n=${p.sample_size} ${p.population}</span>`,
  }))
  const avg = historyDates(prep.historyStart, prep.asOf).map((t) => ({
    t,
    v: pollAverage(prep.generic, t, controls.halfLife).avg,
  }))
  const series = [
    { name: 'Generic-ballot polls', color: '#8a6fbf', dots: true, points: dots },
    { name: 'Generic-ballot average', color: '#8a6fbf', points: avg },
  ]
  if (history) {
    series.push({ name: 'Model environment', color: '#1d1b18', points: history.map((h) => ({ t: h.t, v: h.env })) })
  }
  charts.lineChart($('env-chart'), {
    series,
    yDomain: [-8, 14],
    yFormat: (v) => fmtMargin(v, 0),
    refY: 0,
    height: 240,
  })
}

function renderHistory() {
  if (!history) {
    return
  }
  const office = view.office
  const series = [{ name: isDefault() ? 'Simulation' : 'Custom scenario', color: '#1d1b18', points: history.map((h) => ({ t: h.t, v: h[office] })) }]
  if (!isDefault() && baseHistory) {
    series.push({ name: 'Default assumptions', color: '#a39d94', dash: '4 3', width: 1.75, points: baseHistory.map((h) => ({ t: h.t, v: h[office] })) })
  }
  const mk = { Senate: 'US-SENATE', House: 'US-HOUSE' }[office]
  if (mk) {
    const arr = prep.marketsByRace.get(mk) || []
    series.push({ name: 'Kalshi price', color: '#3e8f84', dash: '5 3', points: arr.map((m) => ({ t: m.t, v: m.price })) })
  }
  charts.lineChart($('history'), { series, yDomain: [0, 1], refY: 0.5, height: 220 })
  $('history').classList.remove('loading-box')
  $('history-legend').innerHTML = series
    .map((se) => `<span><i class="${se.dash ? 'dash' : ''}" style="background:${se.color};color:${se.color}"></i>${se.name}</span>`)
    .join('')
}

function renderTornado() {
  if (!sens || sens.office !== view.office) {
    return
  }
  const box = $('tornado')
  box.classList.remove('loading-box')
  charts.tornado(box, sens.rows, {
    labels: Object.fromEntries(Object.entries(LEVERS).map(([k, m]) => [k, m.label])),
    fmtStep: (key, step) => LEVERS[key].fmt(step).replace(/^No shift$/, '0'),
  })
  const base = sens.rows[0]?.base
  $('tornado-sub').textContent = `Change in the share of simulations where Democrats win ${view.office === 'Governor' ? 'a majority of governorships' : `the ${view.office}`} (now ${fmtPct(base)}) when each lever moves one step down (faded) or up (solid). Points of probability.`
}

function renderMarketScatter() {
  const points = []
  for (const r of prep.races) {
    const x = res(r.race_id)
    if (!x || x.breakdown.marketPrice === null) {
      continue
    }
    const gap = x.pWin - x.breakdown.marketPrice
    points.push({
      x: x.pWin,
      y: x.breakdown.marketPrice,
      r: 5.5,
      color: probColor(x.pWin),
      label: Math.abs(gap) > 0.18 ? shortLabel(r) : null,
      tip: `<b>${esc(r.race_name)}</b><br>Model D ${fmtPct(x.pWin)} · Kalshi D ${fmtPct(x.breakdown.marketPrice)}<br>${gap >= 0 ? 'Model is bluer' : 'Model is redder'} by ${Math.abs(gap * 100).toFixed(0)} pts`,
      onClick: () => openRace(r.race_id),
    })
  }
  for (const [office, id] of [['Senate', 'US-SENATE'], ['House', 'US-HOUSE']]) {
    const arr = prep.marketsByRace.get(id) || []
    const price = arr.at(-1)?.price
    if (price === undefined) {
      continue
    }
    points.push({
      x: result.chambers[office].pDemControl,
      y: price,
      r: 9,
      color: '#1d1b18',
      label: `${office} control`,
      tip: `<b>${office} control</b><br>Model D ${fmtPct(result.chambers[office].pDemControl)} · Kalshi D ${fmtPct(price)}`,
    })
  }
  charts.scatter($('market-scatter'), {
    points,
    xLabel: 'Model: share of simulations Democrat wins',
    yLabel: 'Kalshi: price of “Democrat wins”',
    height: 300,
  })
}

function renderBlendMix() {
  const rows = racesFor(view.office)
    .map((r) => ({ r, x: res(r.race_id) }))
    .filter(({ x }) => x.pWin > 0.1 && x.pWin < 0.9)
    .sort((a, b) => Math.abs(a.x.pWin - 0.5) - Math.abs(b.x.pWin - 0.5))
    .slice(0, 14)
  const box = $('blend-mix')
  box.replaceChildren()
  if (!rows.length) {
    box.innerHTML = '<p class="muted">No races between 10% and 90% under these assumptions.</p>'
    return
  }
  const legend = document.createElement('div')
  legend.className = 'legend'
  legend.innerHTML = [
    ['Fundamentals', '#5b554c'],
    ['Polls', '#8a6fbf'],
    ['Experts', '#b8a46a'],
    ['Market', '#3e8f84'],
  ]
    .map(([l, c]) => `<span><i style="background:${c};height:10px"></i>${l}</span>`)
    .join('')
  for (const { r, x } of rows) {
    const bd = x.breakdown
    const row = document.createElement('div')
    row.className = 'mix-row'
    const name = document.createElement('button')
    name.type = 'button'
    name.textContent = r.office === 'House' ? r.geo_id : `${STATE_NAMES[r.state]}${r.is_special ? '*' : ''}`
    name.addEventListener('click', () => openRace(r.race_id))
    const bar = document.createElement('div')
    charts.blendBar(bar, blendParts(bd))
    const m = document.createElement('span')
    m.className = 'm'
    m.textContent = fmtMargin(bd.mean)
    row.append(name, bar, m)
    box.append(row)
  }
  box.append(legend)
}

function blendParts(bd) {
  return [
    { key: 'fundamentals', label: 'Fundamentals', weight: bd.weights.fundamentals, value: bd.fundamentals, note: 'Lean, environment, incumbency, money, demographics' },
    { key: 'polls', label: 'Polls', weight: bd.weights.polls, value: bd.pollAvg, note: `${bd.pollCount} polls, weighted for recency, grade and size` },
    { key: 'expert', label: 'Experts', weight: bd.weights.expert, value: bd.expert, note: 'Expert rating read as a margin' },
    { key: 'market', label: 'Market', weight: bd.weights.market, value: bd.market, note: bd.marketPrice !== null ? `Kalshi D ${fmtPct(bd.marketPrice)} read as a margin` : '' },
  ]
}

function renderPollsters() {
  const rows = data.pollsters
  $('pollster-table').innerHTML = `<thead><tr><th>Pollster</th><th class="num">House effect</th><th class="num">Polls</th><th class="num">Avg raw</th><th class="num">Avg adjusted</th></tr></thead><tbody>${rows
    .map(
      (p) => `<tr title="${esc(p.pollster)}${p.methodology ? ` · ${esc(p.methodology)}` : ''}"><td class="name"><span class="clamp"><b>${esc(p.pollster)}</b> <span class="muted">${esc(p.grade)}</span></span></td>
      <td class="num"><span class="edge ${p.house_effect >= 0 ? 'D' : 'R'}">${fmtMargin(p.house_effect)}</span></td>
      <td class="num">${p.poll_count}</td><td class="num">${fmtMargin(p.avg_raw_margin)}</td><td class="num">${fmtMargin(p.avg_adjusted_margin)}</td></tr>`
    )
    .join('')}</tbody>`
}

function renderSpecials() {
  const pts = data.specialList.map((s) => ({
    t: dayOf(s.election_date),
    v: s.swing,
    r: s.total_votes ? 3 + Math.sqrt(s.total_votes / 4000) : 4.5,
    opacity: 0.55,
    tip: `<b>${esc(STATE_NAMES[s.state])} ${esc(s.chamber)}</b> · ${fmtDate(s.election_date, { month: 'short', day: 'numeric', year: 'numeric' })}<br>2024: ${fmtMargin(s.pres_2024_margin)} → result ${fmtMargin(s.result_margin)}<br>Swing ${fmtSigned(s.swing)} pts`,
  }))
  charts.lineChart($('specials-chart'), {
    series: [{ name: 'Special elections', color: getComputedStyle(document.documentElement).getPropertyValue('--dem').trim(), dots: true, points: pts }],
    yDomain: [-15, 35],
    yFormat: (v) => fmtSigned(v, 0),
    refY: data.specials.weighted_swing,
    refLabel: `average ${fmtSigned(data.specials.weighted_swing)} pts`,
    height: 230,
  })
}

// ---- Expanded tiles ------------------------------------------------------------------------
// The tile's own body nodes move into the modal while it is open, so live re-renders, tooltips
// and clicks keep working, and the chart redraws at the modal's width.
const TILES = {
  environment: { queries: ['polls', 'approval', 'specials'], render: () => renderEnvironment() },
  markets: { queries: ['markets'], render: () => result && renderMarketScatter() },
  pollsters: { queries: ['pollsters'], render: () => data && renderPollsters() },
  specials: { queries: ['specialList'], render: () => data && renderSpecials() },
}
let expanded = null
let modelText = null
let drawerQueries = []

/**
 * A query as the model defines its view. A refined view (`timeline + { where: ... }`) shows
 * the query first, then the view. Until the model loads, or for inline queries, the query itself.
 */
function definition(query) {
  const [, source, view, refinement] = query.match(/^run: (\w+) -> (\w+)(\s*\+[\s\S]*)?$/) ?? []
  const block = modelText && source && viewBlock(modelText, source, view)
  if (!block) {
    return query
  }
  return refinement ? `${query}\n\n${block}` : block
}

/** Each query's definition, then its rows when `rows` is given. */
function renderQueries(list) {
  $('tm-queries').innerHTML = list
    .map(({ query, rows }) => `<section class="tm-query">
        <div class="tm-label">${esc(query.match(/^run: (\w+)/)?.[1] ?? '')} · defined in ${MODEL}</div>
        ${codeBlock(definition(query))}
        ${rows === undefined ? '' : resultsTable(rows)}
      </section>`)
    .join('')
}

/** Opens the modal on `state` ({ spec, list, ... }) and fills in definitions once the model arrives. */
function showModal(state) {
  expanded = { ...state, opener: document.activeElement }
  renderQueries(state.list)
  if (modelText === null) {
    loadModelSource()
      .then((text) => {
        modelText = text
        if (expanded?.list === state.list) {
          renderQueries(state.list)
        }
      })
      .catch(() => {})
  }
  $('tile-modal').hidden = false
  $('tile-scrim').hidden = false
  $('tile-modal').scrollTop = 0
  document.body.classList.add('modal-open')
  state.spec?.render()
  $('tile-modal-close').focus({ preventScroll: true })
}

/** The race drawer's queries, over the drawer. */
function openRaceQueries() {
  if (expanded) {
    closeTile()
  }
  const r = prep.raceById.get(view.race)
  $('tm-title').textContent = `The Malloy behind ${r?.race_name ?? 'this race'}`
  $('tm-sub').textContent = `Every query this race's estimate reads, as ${MODEL} defines it.`
  $('tm-chart').replaceChildren()
  showModal({ list: drawerQueries.map((query) => ({ query })) })
}

function addExpandButtons() {
  for (const tile of document.querySelectorAll('[data-tile]')) {
    const head = tile.querySelector('.panel-head')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'expand'
    btn.innerHTML = EXPAND_ICON
    btn.title = 'Expand: chart, query and results'
    btn.setAttribute('aria-label', `Expand “${head.querySelector('h3').textContent}”`)
    btn.addEventListener('click', () => openTile(tile))
    head.classList.add('with-expand')
    head.append(btn)
  }
}

function openTile(tile) {
  if (expanded) {
    closeTile()
  }
  const spec = TILES[tile.dataset.tile]
  const head = tile.querySelector('.panel-head')
  $('tm-title').textContent = head.querySelector('h3').textContent
  $('tm-sub').innerHTML = head.querySelector('p')?.innerHTML ?? ''
  const nodes = [...tile.children].filter((n) => n !== head)
  $('tm-chart').replaceChildren(...nodes)
  showModal({ tile, spec, nodes, list: spec.queries.map((k) => ({ query: BOOT_QUERIES[k], rows: data?.[k] })) })
}

function closeTile() {
  if (!expanded) {
    return
  }
  const { tile, spec, nodes, opener } = expanded
  expanded = null
  tile?.append(...nodes)
  $('tile-modal').hidden = true
  $('tile-scrim').hidden = true
  document.body.classList.remove('modal-open')
  charts.untip()
  spec?.render()
  opener?.focus?.({ preventScroll: true })
}

// ---- Drawer --------------------------------------------------------------------------------
function openRace(id) {
  if (!prep.raceById.has(id)) {
    return
  }
  closeTile()
  charts.untip()
  view.race = id
  writeHash()
  $('drawer').hidden = false
  $('scrim').hidden = false
  $('drawer').scrollTop = 0
  renderDrawer()
  renderMap()
  $('drawer-close').focus({ preventScroll: true })
}

function closeDrawer() {
  view.race = null
  writeHash()
  $('drawer').hidden = true
  $('scrim').hidden = true
  charts.untip()
  if (result) {
    renderMap()
  }
}

function renderDrawer() {
  const r = prep.raceById.get(view.race)
  const x = res(view.race)
  if (!r || !x) {
    return
  }
  const bd = x.breakdown
  const b = baseRes(view.race)
  $('d-eyebrow').textContent = `2026 ${r.office === 'Governor' ? 'governor' : r.office} · ${STATE_NAMES[r.state]}`
  $('d-title').textContent = r.race_name
  $('d-meta').innerHTML = [
    incumbencyLabel(r),
    matchupLabel(r),
    r.matchup_note ? esc(r.matchup_note) : '',
    `Experts: ${esc(r.expert_rating ?? 'not rated')}`,
    r.dem_raised_m !== null ? `Raised: D ${fmtMoney(r.dem_raised_m)} · R ${fmtMoney(r.rep_raised_m)}` : '',
    `Partisan lean ${fmtMargin(bd.lean)}`,
    r.is_special ? 'Special election' : '',
  ]
    .filter(Boolean)
    .map((t) => `<span>${t}</span>`)
    .join('')

  const pD = x.pWin
  const ghost = b && !isDefault() ? `<span class="ghost" style="left:calc(${(b.pWin * 100).toFixed(1)}% - 1px)" title="Default assumptions"></span>` : ''
  $('d-odds-bar').innerHTML = `<div class="d" style="flex:${pD}"></div><div class="r" style="flex:${1 - pD}"></div>${ghost}`
  $('d-odds-labels').innerHTML = `<span class="D">${fmtPct(pD)}<small>Democrat</small></span><span class="R" style="text-align:right">${fmtPct(1 - pD)}<small>Republican</small></span>`
  const fav = pD >= 0.5 ? 'The Democrat' : 'The Republican'
  const lockedNames = finalists(r)
  const lockedParty = r.locked_party === 'D' ? ['Democrat', 'Democrats', 'Democratic'] : ['Republican', 'Republicans', 'Republican']
  $('d-summary').innerHTML = r.locked_party
    ? `Decided before Election Day: ${lockedNames.length > 1 ? `both finalists are ${lockedParty[1]}` : `the only candidate is a ${lockedParty[0]}`}, so the seat stays ${lockedParty[2]} in every simulation.`
    : `${fav} wins in <b>${Math.round(Math.max(pD, 1 - pD) * 100)} of 100</b> simulations — ${category(pD).toLowerCase()}. Average margin <b>${fmtMargin(x.meanMargin)}</b>; 80% of outcomes fall between ${fmtMargin(x.p10)} and ${fmtMargin(x.p90)}.${b && !isDefault() ? ` <span class="muted">(Default assumptions: D ${fmtPct(b.pWin)}.)</span>` : ''}`

  charts.marginHistogram($('d-hist'), { hist: x.hist, min: HIST_MIN, p10: x.p10, p90: x.p90, mean: x.meanMargin })

  const steps = [
    { label: 'Partisan lean', value: bd.leanTerm, note: `${fmtMargin(bd.lean)} vs. the nation (50/30/20 presidential)${r.office === 'Governor' ? ' × 0.72 for governors' : ''}` },
    { label: 'National environment', value: bd.envTerm, note: `${fmtMargin(result.env.value)} nationally${r.office === 'Governor' ? ' × 0.7 for governors' : ''}` },
    { label: 'Incumbency', value: bd.incTerm, note: bd.incTerm ? `${controls.incumbency} pts for the ${incumbentSign(r) > 0 ? 'D' : 'R'}-side incumbent` : `${incumbencyLabel(r)}: none` },
    {
      label: 'Fundraising',
      value: bd.moneyTerm,
      note:
        r.dem_raised_m !== null && r.rep_raised_m !== null
          ? `log(D ${fmtMoney(r.dem_raised_m)} / R ${fmtMoney(r.rep_raised_m)}), capped at ±3`
          : r.office === 'Governor'
            ? 'Not used: governors file with states, not the FEC'
            : 'Not used: one side has no FEC filing',
    },
  ]
  if (bd.collegeTerm) {
    steps.push({ label: 'College-grad swing', value: bd.collegeTerm, note: `${controls.collegeSwing} pts × ${r.pct_college}% college grads` })
  }
  if (bd.nonwhiteTerm) {
    steps.push({ label: 'Voters-of-color swing', value: bd.nonwhiteTerm, note: `${controls.nonwhiteSwing} pts × ${r.pct_nonwhite.toFixed(0)}% nonwhite` })
  }
  if (bd.blTerm) {
    steps.push({
      label: 'Bitecofer–Lichtman',
      value: bd.blTerm,
      note: `Off-ballot electorate ${fmtMargin(bd.bl.college + bd.bl.offBallot)}, polarization ${fmtMargin(bd.bl.incumbency + bd.bl.money)}; polls ${fmtMargin(bd.bl.polls)}`,
    })
  }
  steps.push({ label: 'Fundamentals', value: bd.fundamentals, total: true })
  if (bd.pollAvg !== null) {
    steps.push({ label: 'Poll average', value: bd.pollAvg, total: true, note: `${bd.pollCount} polls, adjusted` })
  }
  steps.push({ label: 'Estimated margin', value: bd.mean, total: true, note: 'Weighted blend, below' })
  charts.waterfall($('d-waterfall'), steps)
  charts.blendBar($('d-blend'), blendParts(bd))

  const stakes = []
  if (r.office !== 'Governor') {
    const never = (who) => `<div>The ${who} wins here in none of the simulations<b>—</b></div>`
    stakes.push(x.controlIfWin === null ? never('Democrat') : `<div>In simulations the Democrat wins here, Democrats control the ${r.office}<b>${fmtPct(x.controlIfWin)}</b>of the time</div>`)
    stakes.push(x.controlIfLoss === null ? never('Republican') : `<div>In simulations the Republican wins here, Democrats control the ${r.office}<b>${fmtPct(x.controlIfLoss)}</b>of the time</div>`)
    stakes.push(`<div>Share of simulations where this is the tipping-point race<b>${fmtPct(x.tipping, 1)}</b></div>`)
    stakes.push(`<div>Race-level uncertainty (1 s.d.), before shared errors<b>±${bd.sigma.toFixed(1)} pts</b></div>`)
  }
  $('d-stakes').innerHTML = stakes.join('')

  renderDrawerPolls(r, bd)
  renderDrawerRemote(r, x)
}

function renderDrawerPolls(r, bd) {
  const rows = pollContributions(prep, r, controls)
  const chart = $('d-polls-chart')
  if (!rows.length) {
    chart.innerHTML = `<p class="d-note">No public polls. The estimate relies on fundamentals (${fmtPct(bd.weights.fundamentals)}) and the expert rating.</p>`
    $('d-polls').innerHTML = ''
    return
  }
  const pts = rows.map((p) => ({
    t: p._end,
    v: p.adjusted_margin,
    r: 3 + 9 * Math.sqrt(p.share),
    opacity: 0.55,
    tip: `<b>${esc(p.pollster)}</b> · ${fmtDate(p.end_date)}<br>Raw ${fmtMargin(p.raw_margin)} → adjusted ${fmtMargin(p.adjusted_margin)}<br>With trend adjustment ${fmtMargin(p.final)} · ${fmtPct(p.share, 1)} of today's average`,
  }))
  const t0 = Math.min(...rows.map((p) => p._end))
  const line = historyDates(Math.min(prep.asOf, Math.max(prep.historyStart, t0)), prep.asOf).map((t) => ({
    t,
    v: pollAverage(prep.pollsByRace.get(r.race_id) || [], t, controls.halfLife).avg,
  }))
  charts.lineChart(chart, {
    series: [
      { name: 'Polls', color: '#8a6fbf', dots: true, points: pts },
      { name: 'Poll average', color: '#8a6fbf', points: line.filter((p) => p.v !== null) },
    ],
    yDomain: [Math.min(-10, ...pts.map((p) => p.v)) - 2, Math.max(10, ...pts.map((p) => p.v)) + 2],
    yFormat: (v) => fmtMargin(v, 0),
    refY: 0,
    height: 190,
  })
  chart.insertAdjacentHTML(
    'beforeend',
    `<p class="d-note">Dots: each poll after house-effect and likely-voter adjustments, sized by its weight today. Line: their weighted average over time. The model also shifts every poll by how far the generic ballot has moved since it was taken (the trend column), so its poll average is <b>${fmtMargin(bd.pollAvg)}</b>.</p>`
  )
  $('d-polls').innerHTML = `<thead><tr><th>Pollster</th><th>Ends</th><th class="num">Sample</th><th class="num">Raw</th><th class="num">House eff.</th><th class="num">RV adj.</th><th class="num">Trend adj.</th><th class="num">Final</th><th class="num">Weight</th></tr></thead><tbody>${rows
    .slice(0, 30)
    .map(
      (p) => `<tr><td class="name" title="${esc(p.pollster)}"><span class="clamp">${esc(p.pollster)} <span class="muted">${esc(p.grade)}</span></span></td><td>${fmtDate(p.end_date)}</td>
      <td class="num">${p.sample_size} ${p.population}</td><td class="num">${fmtMargin(p.raw_margin)}</td>
      <td class="num">${fmtSigned(-p.house_effect)}</td><td class="num">${p.population_adjustment ? fmtSigned(-p.population_adjustment) : '—'}</td>
      <td class="num">${fmtSigned(p.trendAdj)}</td><td class="num"><b>${fmtMargin(p.final)}</b></td><td class="num">${fmtPct(p.share, 1)}</td></tr>`
    )
    .join('')}</tbody>`
}

async function renderDrawerRemote(r, x) {
  const id = r.race_id
  const queries = {
    history: historyQuery(r.geo_id),
    demographics: demographicsQuery(r.geo_id),
    ...(x.breakdown.marketPrice !== null ? { market: marketQuery(id) } : {}),
  }
  drawerQueries = [BOOT_QUERIES.races, BOOT_QUERIES.polls, ...Object.values(queries)]
  $('d-market-wrap').hidden = !queries.market
  if (!drawerCache.has(id)) {
    drawerCache.set(
      id,
      Promise.all(Object.entries(queries).map(async ([k, q]) => [k, await run(q)])).then(Object.fromEntries)
    )
  }
  let got
  try {
    got = await drawerCache.get(id)
  } catch (err) {
    $('d-history').textContent = `Could not load: ${err.message}`
    drawerCache.delete(id)
    return
  }
  if (view.race !== id) {
    return
  }
  const hist = got.history
    .filter((h) => h.office === 'President' || h.office === r.office)
    .sort((a, b) => b.election_year - a.election_year || a.office.localeCompare(b.office))
  charts.resultBars($('d-history'), hist)

  const [here, state] = [got.demographics.find((g) => g.geo_id === r.geo_id), got.demographics.find((g) => g.geo_id === r.state)]
  const nat = data.nationalDemo[0]
  const blue = getComputedStyle(document.documentElement).getPropertyValue('--dem').trim()
  const cmp = r.office === 'House' && state ? state : null
  if (here.pct_white === null) {
    $('d-demo').innerHTML = `<p class="d-note">${esc(here.name)} was redrawn for 2026 and the Census Bureau has not tabulated the new lines yet, so the model reads its demographics as the nation’s.</p>`
  } else {
    renderDemographics(here, cmp, nat, blue)
  }

  if (got.market) {
    const pts = got.market.map((m) => ({ t: dayOf(m.price_date), v: m.yes_price }))
    charts.lineChart($('d-market'), {
      series: [{ name: 'Kalshi “Democrat wins”', color: '#3e8f84', points: pts }],
      yDomain: [0, 1],
      refY: x.pWin,
      refLabel: `model today: D ${fmtPct(x.pWin)}`,
      height: 170,
    })
  }
}

function renderDemographics(here, cmp, nat, blue) {
  const rowsDemo = [
    ['White', 'pct_white'],
    ['Black', 'pct_black'],
    ['Hispanic', 'pct_hispanic'],
    ['Asian', 'pct_asian'],
    ['College grads', 'pct_college'],
  ].map(([label, k]) => ({
    label,
    values: [
      { v: here[k], color: blue, name: here.name },
      cmp ? { v: cmp[k], color: '#b9b2a6', name: cmp.name } : { v: nat[k], color: '#b9b2a6', name: 'United States' },
    ],
  }))
  charts.compareBars($('d-demo'), { rows: rowsDemo, max: 100 })
  $('d-demo').insertAdjacentHTML(
    'beforeend',
    `<p class="d-note">Blue: ${esc(here.name)} · grey: ${cmp ? esc(cmp.name) : 'United States'}. Median age ${here.median_age ?? '—'}, median household income ${here.median_income_k === null ? '—' : `$${here.median_income_k}k`}, population ${fmtInt(here.population)}.</p>`
  )
}

// ---- Wiring --------------------------------------------------------------------------------
function wire() {
  for (const el of document.querySelectorAll('[data-office]')) {
    el.addEventListener('click', () => setOffice(el.dataset.office))
  }
  $('race-table').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable')
    if (th) {
      const key = th.dataset.sort
      table.dir = table.sort === key ? -table.dir : 1
      table.sort = key
      renderTable()
      return
    }
    const tr = e.target.closest('tr[data-race]')
    if (tr) {
      openRace(tr.dataset.race)
    }
  })
  $('race-search').addEventListener('input', (e) => {
    table.search = e.target.value
    renderTable()
  })
  $('race-competitive').addEventListener('change', (e) => {
    table.competitive = e.target.checked
    renderTable()
  })
  $('drawer-close').addEventListener('click', closeDrawer)
  $('scrim').addEventListener('click', closeDrawer)
  $('d-malloy').insertAdjacentHTML('afterbegin', EXPAND_ICON)
  $('d-malloy').addEventListener('click', openRaceQueries)
  $('tile-modal-close').addEventListener('click', closeTile)
  $('tile-scrim').addEventListener('click', closeTile)
  holdHostScroll($('scrim'), $('tile-scrim'))
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') {
      return
    }
    if (expanded) {
      closeTile()
    } else if (view.race) {
      closeDrawer()
    } else if (leversOpen() && $('levers').contains(document.activeElement)) {
      setLeversOpen(false)
      $('levers-toggle').focus({ preventScroll: true })
    }
  })
  let resizeTimer = null
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      renderAll()
      renderTornado()
      renderEnvironment()
      renderSpecials()
    }, 150)
  })
}

async function boot() {
  setStatus('Loading data…', true)
  const parsed = hashToState(location.hash, DEFAULT_CONTROLS)
  view.office = parsed.view.office
  controls = clampControls(parsed.controls)
  buildLevers()
  syncLevers()
  wire()
  addExpandButtons()

  const queries = {
    ...BOOT_QUERIES,
    nationalDemo:
      'run: geographies -> { where: is_state; aggregate: pct_white is sum(population * pct_white) / sum(population), pct_black is sum(population * pct_black) / sum(population), pct_hispanic is sum(population * pct_hispanic) / sum(population), pct_asian is sum(population * pct_asian) / sum(population), pct_college is avg_pct_college }',
  }
  try {
    const [g, ...rows] = await Promise.all([
      fetch('./geo/states.json').then((r) => r.json()),
      ...Object.values(queries).map((q) => run(q)),
    ])
    geo = g
    data = Object.fromEntries(Object.keys(queries).map((k, i) => [k, rows[i]]))
  } catch (err) {
    setStatus('Could not load data')
    $('office-headline').textContent = 'The simulation could not load.'
    $('office-sub').textContent = `${err.message}. Is Publisher running? (pnpm dev)`
    return
  }
  data.specials = data.specials[0]
  prep = prepare(data)
  $('as-of').textContent = fmtDate(prep.asOf, { month: 'short', day: 'numeric', year: 'numeric' })

  const modelData = {
    races: data.races,
    polls: data.polls,
    chambers: data.chambers,
    markets: data.markets,
    approval: data.approval,
    specials: data.specials,
  }
  await Promise.all([live('init', { data: modelData }), background('init', { data: modelData })])

  setStatus('Simulating…', true)
  const base = await live('run', { controls: DEFAULT_CONTROLS, sims: SIMS })
  baseline = base.result
  result = baseline
  renderAll()
  renderPollsters()
  renderSpecials()
  renderEnvironment()
  if (!isDefault()) {
    requestRun()
  } else {
    setStatus('Default assumptions')
  }
  if (parsed.view.race) {
    openRace(parsed.view.race)
  }
  // Default history first, so a shared link with custom levers still has a comparison line.
  if (!isDefault()) {
    background('history', { controls: DEFAULT_CONTROLS }).then((h) => {
      baseHistory = h.points
      renderHistory()
    })
  }
  scheduleBackground()
}

boot()
