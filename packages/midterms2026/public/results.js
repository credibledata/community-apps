// Entry point for results.html: the count against the frozen forecast, its scenarios and past
// midterms. Every number comes from results.malloy (query.js RESULTS_QUERIES); this file only
// joins the chosen scenario's forecast onto each race and draws. Rebuilding the data with
// `pnpm results` is all it takes to update the page.

import * as charts from './charts.js'
import { codeBlock } from './editor.js'
import { fmtInt, fmtMargin, fmtPct, fmtSigned, probColor, probInk, STATE_NAMES } from './format.js'
import { esc, loadModelSource, run } from './publisher.js'
import { RESULTS_MODEL, RESULTS_QUERIES, viewBlock } from './query.js'
import { onVisibleBand, visibleBand } from './viewport.js'

const $ = (id) => document.getElementById(id)
const OFFICES = ['Senate', 'House', 'Governor']
const view = { office: 'Senate', scenario: 'forecast' }
const table = { sort: 'close', dir: 1, search: '', filter: 'all' }
let d = null
let geo = null

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`
const etTime = (ts, withDay = true) =>
  `${new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    ...(withDay ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  })} ET`

// ---- Status of a race in the count ---------------------------------------------------------
const STATUS = {
  'called-D': { label: 'Called D', color: '#2460ba', ink: '#fff' },
  'lead-D': { label: 'D ahead', color: '#9dbbe6', ink: '#1d1b18' },
  none: { label: 'No votes yet', color: '#e7e1d6', ink: '#1d1b18' },
  'lead-R': { label: 'R ahead', color: '#eda5a7', ink: '#1d1b18' },
  'called-R': { label: 'Called R', color: '#c8343a', ink: '#fff' },
  'lead-O': { label: 'Other ahead', color: '#cfc9c0', ink: '#1d1b18' },
  'called-O': { label: 'Called other', color: '#6f6a63', ink: '#fff' },
}

function statusKey(r) {
  if (r.call_status === 'called') {
    return `called-${r.winner_side}`
  }
  if (!r.total_votes || !r.leader_side) {
    return 'none'
  }
  return `lead-${r.leader_side}`
}

/** The chosen scenario's forecast for a race, with how the count compares to it. */
function withForecast(r) {
  const f = d.forecast.get(view.scenario)?.get(r.race_id)
  const margin = r.total_votes ? r.margin : null
  return {
    ...r,
    f,
    status: statusKey(r),
    vs: f && margin !== null ? margin - f.mean_margin : null,
    inRange: f && margin !== null ? margin >= f.p10 && margin <= f.p90 : null,
    upset: f && r.call_status === 'called' && r.winner_side !== f.favorite,
  }
}

const racesFor = (office) => d.races.filter((r) => r.office === office).map(withForecast)
const scenarioRow = (key = view.scenario) => d.scenarios.find((s) => s.scenario === key)
const scenarioLabel = (key = view.scenario) => scenarioRow(key)?.scenario_label ?? key
const scenarioPhrase = (key) => scenarioLabel(key).replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())
const chamberForecast = (office, key = view.scenario) =>
  d.forecastChambers.find((c) => c.scenario === key && c.chamber === office)

/** Seats each side has locked in: not up this year plus races called. */
function seatsSoFar(office) {
  const ch = d.chambers.find((c) => c.chamber === office)
  const rs = racesFor(office)
  const dCalled = rs.filter((r) => r.status === 'called-D').length
  const rCalled = rs.filter((r) => r.status === 'called-R').length
  const oCalled = rs.filter((r) => r.status === 'called-O').length
  const uncalled = rs.length - dCalled - rCalled - oCalled
  const dSeats = ch.dem_seats_not_up + dCalled
  const rSeats = ch.rep_seats_not_up + rCalled
  const winner = dSeats >= ch.dem_needs ? 'D' : rSeats >= ch.rep_needs ? 'R' : null
  return { ch, rs, dCalled, rCalled, oCalled, uncalled, dSeats, rSeats, winner, possible: [dSeats, dSeats + uncalled] }
}

function raceTip(r) {
  const st = STATUS[r.status]
  const counted = r.total_votes ? `${fmtMargin(r.margin)} with ${fmtPct(r.pct_expected_counted / 100)} of the expected vote counted` : 'No votes counted yet'
  const call = r.call_status === 'called' ? `<b>Called: ${esc(r.winner_name)} (${r.winner_side === 'O' ? 'neither side' : `${r.winner_side} side`})</b><br>` : ''
  const fc = r.f
    ? `Forecast (${esc(scenarioLabel())}): ${fmtMargin(r.f.mean_margin)}, 80% range ${fmtMargin(r.f.p10, 0)} to ${fmtMargin(r.f.p90, 0)}; D wins ${fmtPct(r.f.p_dem)}`
    : ''
  const vs = r.vs !== null && r.is_two_sided ? `<br>Count vs. forecast: ${fmtSigned(r.vs)} pts${r.inRange ? '' : ' (outside the 80% range)'}` : ''
  const swing = Number.isFinite(r.swing_from_2024) && r.is_two_sided ? `<br>2024 president ${fmtMargin(r.pres_2024_margin)} · swing ${fmtSigned(r.swing_from_2024)}` : ''
  const note = r.locked_party ? `<br><span class="muted">${esc(r.matchup_note || 'Both finalists from one party')}</span>` : ''
  return `<b>${esc(r.race_name)}</b> <span class="muted">${st.label}</span><br>${call}${counted}<br><span class="muted">${fc}</span>${vs}${swing}${note}`
}

// ---- Topline -------------------------------------------------------------------------------
function renderTopline() {
  const blue = css('--dem')
  const red = css('--rep')
  for (const office of OFFICES) {
    const s = seatsSoFar(office)
    const unit = office === 'Governor' ? 'governorships' : 'seats'
    $(`t-${office}-seats`).innerHTML = `<span class="D">D ${s.dSeats}</span> <span class="sep">·</span> <span class="R">R ${s.rSeats}</span>`
    const what = office === 'Governor' ? 'a majority' : 'control'
    $(`t-${office}-sub`).innerHTML = s.winner
      ? `<b class="${s.winner}">${s.winner === 'D' ? 'Democrats' : 'Republicans'} have won ${what}</b> · ${plural(s.uncalled, 'race')} not yet called`
      : `${plural(s.uncalled, 'race')} not yet called · ${s.ch.dem_needs} ${unit} for D ${what}`
    charts.balanceBar($(`t-${office}-bar`), {
      total: s.ch.total_seats,
      threshold: s.ch.dem_needs,
      thresholdLabel: `${s.ch.dem_needs}`,
      segments: [
        { value: s.dSeats, color: blue, label: 'Democrats, held or called' },
        { value: s.uncalled + s.oCalled, color: '#d9d3c9', ink: '#5d574f', label: 'Not yet called (or other)' },
        { value: s.rSeats, color: red, label: 'Republicans, held or called' },
      ],
    })
    const fc = chamberForecast(office)
    $(`t-${office}-fc`).innerHTML = fc
      ? `Forecast: D ${fc.expected_dem_seats.toFixed(1)} ${unit} (80%: ${fc.p10}–${fc.p90}), D ${what} in ${fmtPct(fc.p_dem_control)} of simulations`
      : ''
  }
  for (const card of document.querySelectorAll('.top-card')) {
    card.setAttribute('aria-current', String(card.dataset.office === view.office))
  }
  for (const tab of document.querySelectorAll('.tabs button')) {
    tab.setAttribute('aria-selected', String(tab.dataset.office === view.office))
  }
}

// ---- One office ----------------------------------------------------------------------------
function renderOffice() {
  const office = view.office
  const s = seatsSoFar(office)
  const noun = office === 'Governor' ? 'governor races' : `${office} races`
  const called = s.dCalled + s.rCalled + s.oCalled
  const what = office === 'Governor' ? 'a majority of governorships' : `the ${office}`
  if (s.winner) {
    $('office-headline').innerHTML = `<span class="${s.winner}">${s.winner === 'D' ? 'Democrats' : 'Republicans'} have won ${what}</span>`
  } else if (s.dCalled !== s.rCalled) {
    const lead = s.dCalled > s.rCalled ? 'D' : 'R'
    $('office-headline').innerHTML = `<span class="${lead}">${lead === 'D' ? 'Democrats' : 'Republicans'} lead the called ${noun}</span>, ${Math.max(s.dCalled, s.rCalled)} to ${Math.min(s.dCalled, s.rCalled)}`
  } else {
    $('office-headline').textContent = `The called ${noun} are split ${s.dCalled} to ${s.rCalled}`
  }
  const upsets = s.rs.filter((r) => r.upset)
  const asForecast = s.rs.filter((r) => r.call_status === 'called' && !r.upset).length
  const tally = d.tally.find((t) => t.office === office)
  $('office-sub').innerHTML = [
    `${plural(called, 'race')} called of ${s.rs.length}; ${plural(s.uncalled, 'is', 'are')} still being counted.`,
    called
      ? `The ${esc(scenarioPhrase())} forecast favoured the winner in <b>${asForecast} of ${called}</b>${upsets.length ? `; called against it: ${upsets.map((r) => `<b>${esc(r.race_name)}</b> (${esc(r.winner_name)})`).join(', ')}` : ''}.`
      : '',
    tally?.comparable_races
      ? `Across the ${plural(tally.comparable_races, 'race')} at least 90% counted, the average swing from 2024 is <b>${fmtSigned(tally.avg_swing)}</b> points toward ${tally.avg_swing >= 0 ? 'Democrats' : 'Republicans'}.`
      : '',
  ].join(' ')

  charts.balanceBar($('balance'), {
    total: s.ch.total_seats,
    threshold: s.ch.dem_needs,
    thresholdLabel: `${s.ch.dem_needs} for Democratic control`,
    segments: [
      { value: s.ch.dem_seats_not_up, color: css('--dem'), hatch: true, label: 'Democrats, not up' },
      { value: s.dCalled, color: css('--dem'), label: 'Democrats, called' },
      { value: s.uncalled, color: '#d9d3c9', ink: '#5d574f', label: 'Not yet called' },
      { value: s.oCalled, color: STATUS['called-O'].color, label: 'Called for neither side' },
      { value: s.rCalled, color: css('--rep'), label: 'Republicans, called' },
      { value: s.ch.rep_seats_not_up, color: css('--rep'), hatch: true, label: 'Republicans, not up' },
    ],
  })
  $('balance-sub').textContent =
    office === 'House' ? 'Called races. Grey = not yet called.' : 'Called races, plus seats not up this year (faded). Grey = not yet called.'

  renderMap(s.rs)
  renderScatters(s.rs)
  renderSeatHist(s)
  renderSnake(s)
  renderTable()
}

function statusLegend(el) {
  el.innerHTML = ['called-D', 'lead-D', 'none', 'lead-R', 'called-R', 'lead-O', 'called-O']
    .map((k) => `<span><i style="background:${STATUS[k].color}"></i>${STATUS[k].label}</span>`)
    .join('')
}

function shareLegend(el) {
  el.innerHTML = [
    [1, 'All D'],
    [0.75, '75% D'],
    [0.5, 'Even'],
    [0.25, '25% D'],
    [0, 'All R'],
  ]
    .map(([p, label]) => `<span><i style="background:${probColor(p)}"></i>${label}</span>`)
    .concat(`<span><i style="background:${STATUS.none.color}"></i>None called</span>`)
    .join('')
}

function renderMap(rs) {
  const office = view.office
  if (office === 'House') {
    const byState = Map.groupBy(rs, (r) => r.state)
    $('map-title').textContent = 'The House map, state by state'
    $('map-sub').textContent = 'Shaded by the Democratic share of each state’s called seats. Click a state to list its districts in the table.'
    const share = (a) => {
      const called = (byState.get(a) || []).filter((r) => r.call_status === 'called')
      return called.length ? called.filter((r) => r.winner_side === 'D').length / called.length : null
    }
    charts.usMap($('map'), geo, {
      fill: (a) => (byState.has(a) ? (share(a) === null ? STATUS.none.color : probColor(share(a))) : null),
      label: (a) => (share(a) === null ? '#1d1b18' : probInk(share(a))),
      selected: STATE_NAMES[table.search.toUpperCase()] ? table.search.toUpperCase() : null,
      title: (a) => {
        const list = byState.get(a)
        if (!list) {
          return esc(STATE_NAMES[a] || a)
        }
        const n = (k) => list.filter((r) => r.status === k).length
        return `<b>${esc(STATE_NAMES[a])}</b> · ${plural(list.length, 'seat')}<br>Called: D ${n('called-D')} · R ${n('called-R')}${n('called-O') ? ` · other ${n('called-O')}` : ''}<br>Not yet called: ${list.filter((r) => r.call_status !== 'called').length}`
      },
      onClick: (a) => {
        table.search = table.search.toUpperCase() === a ? '' : a
        $('race-search').value = table.search
        renderMap(rs)
        renderTable()
      },
    })
    shareLegend($('map-legend'))
  } else {
    const byState = new Map(rs.filter((r) => !/special/i.test(r.race_name)).map((r) => [r.state, r]))
    for (const r of rs) {
      byState.set(r.state, byState.get(r.state) ?? r)
    }
    $('map-title').textContent = office === 'Senate' ? 'The Senate map' : 'The governor map'
    $('map-sub').textContent = 'Solid = called; light = ahead in the count so far. Grey = no race this year.'
    charts.usMap($('map'), geo, {
      fill: (a) => (byState.has(a) ? STATUS[byState.get(a).status].color : null),
      label: (a) => (byState.has(a) ? STATUS[byState.get(a).status].ink : '#1d1b18'),
      title: (a) => (byState.has(a) ? rs.filter((r) => r.state === a).map(raceTip).join('<hr>') : `<b>${esc(STATE_NAMES[a] || a)}</b><br><span class="muted">No ${office.toLowerCase()} race in 2026</span>`),
      onClick: (a) => {
        table.search = a
        $('race-search').value = a
        renderTable()
        $('race-table').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      },
    })
    statusLegend($('map-legend'))
  }
}

function renderScatters(rs) {
  const office = view.office
  const pts = rs.filter((r) => r.is_two_sided)
  const color = (r) => (r.leader_side === 'D' ? css('--dem') : r.leader_side === 'R' ? css('--rep') : '#8a837a')
  const point = (r, x) => ({
    x,
    y: r.margin,
    r: office === 'House' ? 3.5 : 6,
    color: color(r),
    opacity: r.is_comparable ? 0.85 : 0.22,
    tip: raceTip(r),
  })
  const fit = d.scenarioOffices.find((x) => x.scenario === view.scenario && x.office === office)
  charts.marginScatter($('vs-scatter'), {
    points: pts.filter((r) => r.f).map((r) => point(r, r.f.mean_margin)),
    xLabel: `Forecast margin (${scenarioLabel()})`,
    yLabel: 'Margin so far',
    offset: fit?.races_compared ? fit.avg_error : null,
  })
  $('vs-sub').textContent = `Each dot is a race: the ${scenarioPhrase()} forecast’s average margin (across) against the margin so far (up). Above the diagonal = bluer than forecast. Faded = under 90% counted.${fit?.races_compared ? ` Over the ${fit.races_compared} races at least 90% counted, the count runs ${fmtSigned(fit.avg_error)} points from the forecast on average (dashed).` : ''}`
  const tally = d.tally.find((t) => t.office === office)
  charts.marginScatter($('swing-scatter'), {
    points: pts.filter((r) => Number.isFinite(r.pres_2024_margin)).map((r) => point(r, r.pres_2024_margin)),
    xLabel: '2024 presidential margin',
    yLabel: 'Margin so far',
    offset: tally?.comparable_races ? tally.avg_swing : null,
  })
  $('swing-sub').textContent = `The 2024 presidential margin in the same state or district (across) against the margin so far (up). Above the diagonal = a swing toward Democrats.${tally?.comparable_races ? ` Dashed: the average swing across races at least 90% counted, ${fmtSigned(tally.avg_swing)} points.` : ''}`
}

function renderSeatHist(s) {
  const office = view.office
  const rows = d.seats.filter((x) => x.scenario === view.scenario && x.chamber === office)
  const hist = new Array(s.ch.total_seats + 1).fill(0)
  for (const x of rows) {
    hist[x.dem_seats] = x.share
  }
  const unit = office === 'Governor' ? 'governorships' : 'seats'
  const fc = chamberForecast(office)
  charts.seatHistogram($('seat-hist'), {
    hist,
    threshold: s.ch.dem_needs,
    label: office === 'Governor' ? 'Democratic governors' : 'Democratic seats',
    possible: s.possible,
  })
  const stillIn = rows.filter((x) => x.dem_seats >= s.possible[0] && x.dem_seats <= s.possible[1]).reduce((a, x) => a + x.share, 0)
  $('hist-sub').textContent = `Democratic ${unit} across the ${scenarioPhrase()} forecast’s 10,000 simulations (80%: ${fc.p10}–${fc.p90}). Grey = ruled out by the calls so far: Democrats will finish with ${s.possible[0]} to ${s.possible[1]}. ${fmtPct(stillIn)} of simulations are still possible.`
}

function shortLabel(r) {
  return r.office === 'House' ? r.race_id.slice(4) : /special/i.test(r.race_name) ? `${r.state}*` : r.state
}

function renderSnake(s) {
  const office = view.office
  const items = s.rs
    .filter((r) => r.f)
    .sort((a, b) => b.f.mean_margin - a.f.mean_margin)
    .map((r) => ({ id: r.race_id, p: r.f.p_dem, color: STATUS[r.status].color, ink: STATUS[r.status].ink, short: shortLabel(r), tip: raceTip(r) }))
  charts.snake($('snake'), {
    items,
    startD: office === 'House' ? 0 : s.ch.dem_seats_not_up,
    threshold: s.ch.dem_needs,
    rows: office === 'House' ? 5 : 1,
    onClick: (id) => {
      table.search = id
      $('race-search').value = id
      renderTable()
    },
  })
  $('snake-title').textContent = office === 'House' ? 'All 435 races in forecast order' : 'Races in forecast order'
  $('snake-sub').textContent = `Ordered by the ${scenarioPhrase()} forecast, most Democratic first, coloured by the count. The line marks the seat that would decide control if the forecast’s order held.`
  statusLegend($('snake-legend'))
}

// ---- Race table ----------------------------------------------------------------------------
const COLUMNS = [
  { key: 'name', label: 'Race' },
  { key: 'status', label: 'Count' },
  { key: 'counted', label: 'Counted', num: true },
  { key: 'margin', label: 'Margin', num: true },
  { key: 'forecast', label: 'Forecast', num: true },
  { key: 'vs', label: 'vs. forecast', num: true },
  { key: 'pres', label: '2024 pres.', num: true },
  { key: 'swing', label: 'Swing', num: true },
]
const STATUS_ORDER = Object.keys(STATUS)

function renderTable() {
  const q = table.search.trim().toLowerCase()
  const keep = {
    all: () => true,
    called: (r) => r.call_status === 'called',
    uncalled: (r) => r.call_status !== 'called',
    upsets: (r) => r.upset,
    outside: (r) => r.is_comparable && r.inRange === false,
  }[table.filter]
  const rows = racesFor(view.office).filter(
    (r) =>
      keep(r) &&
      (!q ||
        r.race_name.toLowerCase().includes(q) ||
        r.race_id.toLowerCase().includes(q) ||
        r.state.toLowerCase() === q ||
        (STATE_NAMES[r.state] || '').toLowerCase().includes(q))
  )
  const val = {
    name: (r) => r.race_name,
    status: (r) => STATUS_ORDER.indexOf(r.status),
    counted: (r) => -r.pct_expected_counted,
    margin: (r) => -(r.total_votes ? r.margin : -999),
    forecast: (r) => -(r.f?.mean_margin ?? -999),
    close: (r) => Math.abs((r.f?.p_dem ?? 0) - 0.5),
    vs: (r) => -Math.abs(r.is_two_sided ? (r.vs ?? 0) : 0),
    pres: (r) => -(r.pres_2024_margin ?? -999),
    swing: (r) => -(r.is_two_sided && Number.isFinite(r.swing_from_2024) ? r.swing_from_2024 : -999),
  }[table.sort]
  rows.sort((a, b) => {
    const va = val(a)
    const vb = val(b)
    return (va < vb ? -1 : va > vb ? 1 : 0) * table.dir
  })
  const muted = '<span class="muted">—</span>'
  const head = `<thead><tr>${COLUMNS.map(
    (c) => `<th class="${c.num ? 'num' : ''} ${c.nosort ? '' : 'sortable'}" data-sort="${c.key}">${c.label}${table.sort === c.key ? (table.dir > 0 ? ' ↓' : ' ↑') : ''}</th>`
  ).join('')}</tr></thead>`
  const body = rows
    .map((r) => {
      const st = STATUS[r.status]
      const two = r.is_two_sided
      const fc = r.f
      const who = r.call_status === 'called' ? `<br><span class="muted small">${esc(r.winner_name)}</span>` : ''
      return `<tr class="${r.upset ? 'upset' : ''}" title="${r.upset ? 'Called against the forecast' : ''}">
        <td class="wrap"><b>${esc(r.race_name)}</b>${r.locked_party ? '<br><span class="muted small">same party</span>' : ''}${r.is_uncontested ? '<br><span class="muted small">uncontested</span>' : ''}</td>
        <td class="wrap"><span class="pill" style="background:${st.color};color:${st.ink}">${st.label}</span>${who}</td>
        <td class="num"><span class="count-bar"><i style="width:${Math.min(100, r.pct_expected_counted).toFixed(0)}%"></i></span> ${r.total_votes ? fmtPct(r.pct_expected_counted / 100) : muted}</td>
        <td class="num">${r.total_votes && two ? `<b class="${r.margin >= 0 ? 'D' : 'R'}">${fmtMargin(r.margin)}</b>` : muted}</td>
        <td class="num"${fc ? ` title="80% range: ${fmtMargin(fc.p10, 0)} to ${fmtMargin(fc.p90, 0)}"` : ''}>${fc ? `${fmtMargin(fc.mean_margin)} <span class="muted">D ${fmtPct(fc.p_dem)}</span>` : muted}</td>
        <td class="num"${two && r.vs !== null && !r.inRange ? ' title="Outside the forecast’s 80% range"' : ''}>${two && r.vs !== null ? `<span class="edge ${r.vs >= 0 ? 'D' : 'R'}${r.inRange ? '' : ' strong'}">${fmtSigned(r.vs)}</span>` : muted}</td>
        <td class="num">${fmtMargin(r.pres_2024_margin)}</td>
        <td class="num">${two && r.total_votes && Number.isFinite(r.swing_from_2024) ? `<span class="edge ${r.swing_from_2024 >= 0 ? 'D' : 'R'}">${fmtSigned(r.swing_from_2024)}</span>` : muted}</td>
      </tr>`
    })
    .join('')
  $('race-table').innerHTML = `${head}<tbody>${body || `<tr><td colspan="${COLUMNS.length}" class="muted">No races match.</td></tr>`}</tbody>`
}

// ---- The swing -----------------------------------------------------------------------------
function renderSwing() {
  const nat = d.national.find((x) => x.is_latest)
  const y2024 = d.midterms.find((m) => m.election_year === 2024)
  const past = d.midterms.filter((m) => m.is_midterm)
  if (!nat || !y2024) {
    return
  }
  const swingPres = nat.margin - y2024.prior_pres_margin
  const swingHouse = nat.margin - y2024.margin
  const bigger = past.filter((m) => m.swing_to_out_party > swingPres)
  const ranking = bigger.length
    ? `Of the midterms since 2006, only ${bigger.map((m) => `${m.election_year} (${m.swing_to_out_party.toFixed(1)} toward ${m.out_party === 'D' ? 'Democrats' : 'Republicans'})`).join(' and ')} swung harder against the president’s party.`
    : 'That is a bigger swing against the president’s party than any midterm since 2006.'
  $('swing-lede').innerHTML = `The national House vote so far is <b class="${nat.margin >= 0 ? 'D' : 'R'}">${fmtMargin(nat.margin)}</b> with ${fmtPct(nat.pct_expected_counted / 100)} of the expected vote counted (${fmtInt(nat.total_votes)} votes): a <b>${Math.abs(swingPres).toFixed(1)}-point</b> swing toward ${swingPres >= 0 ? 'Democrats' : 'Republicans'} from the 2024 presidential margin (${fmtMargin(y2024.prior_pres_margin)}), and ${Math.abs(swingHouse).toFixed(1)} from the 2024 House vote (${fmtMargin(y2024.margin)}). ${swingPres >= 0 ? ranking : ''} West Coast states count slowly, so the national figure has further to move.`
  const party = (p) => (p === 'D' ? css('--dem') : css('--rep'))
  charts.signedBars($('midterm-bars'), [
    ...past.map((m) => ({
      label: `${m.election_year} (${m.white_house_party === 'D' ? 'Dem.' : 'Rep.'} president)`,
      value: m.swing_to_out_party,
      color: party(m.out_party),
      tip: `<b>${m.election_year}</b>: House ${fmtMargin(m.margin)} after ${m.prior_pres_year} president ${fmtMargin(m.prior_pres_margin)}<br>${m.swing_to_out_party.toFixed(1)} points toward ${m.out_party === 'D' ? 'Democrats' : 'Republicans'}`,
    })),
    {
      label: '2026 so far',
      value: swingPres,
      color: party('D'),
      highlight: true,
      tip: `<b>2026 so far</b>: House ${fmtMargin(nat.margin)} (${fmtPct(nat.pct_expected_counted / 100)} counted) after 2024 president ${fmtMargin(y2024.prior_pres_margin)}`,
    },
  ])
  const envRows = d.scenarios.map((sc) => ({
    label: sc.scenario_label,
    value: sc.national_environment,
    color: sc.national_environment >= 0 ? css('--dem') : css('--rep'),
    highlight: sc.scenario === view.scenario,
    tip: `<b>${esc(sc.scenario_label)}</b><br>National environment ${fmtMargin(sc.national_environment)}<br>House vote so far ${fmtMargin(nat.margin)} (${fmtSigned(nat.margin - sc.national_environment)})`,
  }))
  charts.signedBars($('env-bars'), [
    ...envRows,
    { label: 'House vote so far', value: nat.margin, color: '#1d1b18', highlight: true, tip: `<b>House vote so far</b><br>${fmtMargin(nat.margin)}, ${fmtPct(nat.pct_expected_counted / 100)} counted` },
  ])
}

// ---- Scenarios -----------------------------------------------------------------------------
function bestScenario() {
  return d.scenarios.filter((s) => s.races_compared).sort((a, b) => a.mean_abs_error - b.mean_abs_error)[0] ?? null
}

function renderScenarios() {
  const best = bestScenario()
  const base = scenarioRow('forecast')
  if (best && base?.races_compared) {
    $('scen-lede').innerHTML =
      best.scenario === 'forecast'
        ? `The default assumptions fit the count best so far, missing by <b>${best.mean_abs_error.toFixed(1)} points</b> on average across ${best.races_compared} races at least 90% counted.`
        : `<b>${esc(best.scenario_label)}</b> fits the count best so far: an average miss of <b>${best.mean_abs_error.toFixed(1)} points</b>, against ${base.mean_abs_error.toFixed(1)} under the default assumptions, across ${best.races_compared} races at least 90% counted. ${Math.abs(best.avg_error) >= 1 ? `Even that scenario runs ${Math.abs(best.avg_error).toFixed(1)} points ${best.avg_error > 0 ? 'redder' : 'bluer'} than the count.` : ''} These are the app’s preset scenarios, frozen before polls closed; the count can also miss them all in the same direction.`
  }
  const seats = (key, office) => {
    const c = chamberForecast(office, key)
    return c ? `${c.expected_dem_seats.toFixed(1)} <span class="muted">${fmtPct(c.p_dem_control)}</span>` : '—'
  }
  const now = Object.fromEntries(OFFICES.map((o) => [o, seatsSoFar(o)]))
  const rowStart = (sc) => `<tr class="clickable${sc.scenario === view.scenario ? ' selected' : ''}" data-scenario="${esc(sc.scenario)}">
        <td><b>${esc(sc.scenario_label)}</b>${sc.scenario === best?.scenario ? ' <span class="tag">best fit</span>' : ''}</td>`
  $('scenario-table').innerHTML = `<thead><tr>
      <th>Scenario</th><th class="num">Environment</th>
      <th class="num">Error</th><th class="num">Avg. miss</th><th class="num">In 80% range</th><th class="num">Winners favoured</th>
    </tr></thead><tbody>
    ${d.scenarios
      .map(
        (sc) => `${rowStart(sc)}
        <td class="num">${fmtMargin(sc.national_environment)}</td>
        <td class="num"><span class="edge ${sc.avg_error >= 0 ? 'D' : 'R'}">${fmtSigned(sc.avg_error)}</span></td>
        <td class="num">${sc.mean_abs_error?.toFixed(1) ?? '—'}</td>
        <td class="num">${fmtPct(sc.share_in_range)}</td>
        <td class="num">${sc.called_correctly} of ${sc.races_called}</td>
      </tr>`
      )
      .join('')}
    <tr class="now"><td><b>House vote so far</b></td><td class="num">${fmtMargin(d.national.find((x) => x.is_latest)?.margin)}</td><td colspan="4"></td></tr>
    </tbody>`
  $('scenario-seats-table').innerHTML = `<thead><tr>
      <th>Scenario</th><th class="num">Senate D seats</th><th class="num">House D seats</th><th class="num">D governors</th>
    </tr></thead><tbody>
    ${d.scenarios
      .map(
        (sc) => `${rowStart(sc)}
        ${OFFICES.map((o) => `<td class="num">${seats(sc.scenario, o)}</td>`).join('')}
      </tr>`
      )
      .join('')}
    <tr class="now"><td><b>Called so far</b> <span class="muted">incl. not up</span></td>
      ${OFFICES.map((o) => `<td class="num">${now[o].dSeats} <span class="muted">+${now[o].uncalled} open</span></td>`).join('')}</tr>
    </tbody>`
}

function renderPresets() {
  const best = bestScenario()
  $('presets').innerHTML = d.scenarios
    .map(
      (sc) => `<button type="button" class="chip" data-scenario="${esc(sc.scenario)}" aria-pressed="${sc.scenario === view.scenario}">
        ${esc(sc.scenario_label)} <span class="chip-num">${sc.mean_abs_error?.toFixed(1) ?? '—'}</span>${sc.scenario === best?.scenario ? ' <span class="tag">best fit</span>' : ''}
      </button>`
    )
    .join('')
}

// ---- How the night unfolded ----------------------------------------------------------------
function renderSnapshots() {
  const times = [...new Set(d.snapshots.map((x) => x.snapshot_at))].sort().reverse()
  const cell = (t, o) => {
    const x = d.snapshots.find((y) => y.snapshot_at === t && y.office === o)
    return x ? `<span class="D">${x.d_called}</span>–<span class="R">${x.r_called}</span>${x.other_called ? `–${x.other_called}` : ''}` : '—'
  }
  $('snapshot-table').innerHTML = `<thead><tr><th>Snapshot</th><th class="num">House vote</th><th class="num">Counted</th>
      <th class="num">Senate calls</th><th class="num">House calls</th><th class="num">Gov. calls</th><th class="num">House swing</th></tr></thead>
    <tbody>${times
      .map((t) => {
        const n = d.national.find((x) => x.snapshot_at === t)
        const h = d.snapshots.find((y) => y.snapshot_at === t && y.office === 'House')
        return `<tr><td>${etTime(t)}</td>
          <td class="num">${n ? fmtMargin(n.margin) : '—'}</td>
          <td class="num">${n ? fmtPct(n.pct_expected_counted / 100) : '—'}</td>
          ${OFFICES.map((o) => `<td class="num">${cell(t, o)}</td>`).join('')}
          <td class="num">${h?.comparable_races ? fmtSigned(h.avg_swing) : '—'}</td></tr>`
      })
      .join('')}</tbody>`
}

// ---- The Malloy ----------------------------------------------------------------------------
const QUERY_NOTES = {
  races: 'Every race in the newest snapshot, with its default forecast',
  tally: 'Calls and comparisons per office',
  national: 'The national House vote in each snapshot',
  snapshots: 'Calls per office in each snapshot',
  forecasts: 'Every scenario’s frozen forecast for every race',
  scenarios: 'Each scenario against the count',
  scenarioOffices: 'Each scenario against the count, per office',
  forecastChambers: 'Each scenario’s chamber forecast',
  seats: 'Each scenario’s seat distribution',
  chambers: 'Seats not up and what control takes (from elections.malloy)',
  midterms: 'The House vote in past midterms',
}

async function renderQueries() {
  let text = null
  try {
    text = await loadModelSource(RESULTS_MODEL)
  } catch {
    /* the queries are still listed without their definitions */
  }
  $('queries').innerHTML = Object.entries(RESULTS_QUERIES)
    .map(([k, q]) => {
      const [, source, name] = q.match(/^run: (\w+) -> (\w+|\{)/)
      const def = text && name !== '{' ? viewBlock(text, source, name) : null
      return `<details class="query"><summary><code>${esc(q)}</code> <span class="muted">${esc(QUERY_NOTES[k] || '')}</span></summary>
        ${def ? codeBlock(def) : ''}</details>`
    })
    .join('')
}

// ---- State, wiring, boot -------------------------------------------------------------------
function writeHash() {
  const p = new URLSearchParams()
  if (view.office !== 'Senate') {
    p.set('office', view.office)
  }
  if (view.scenario !== 'forecast') {
    p.set('scenario', view.scenario)
  }
  const s = p.toString()
  window.history.replaceState(null, '', `${location.pathname}${location.search}${s ? `#${s}` : ''}`)
}

function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''))
  if (OFFICES.includes(p.get('office'))) {
    view.office = p.get('office')
  }
  if (d.forecast.has(p.get('scenario'))) {
    view.scenario = p.get('scenario')
  }
}

function setScenario(key) {
  if (!d.forecast.has(key) || key === view.scenario) {
    return
  }
  view.scenario = key
  writeHash()
  renderAll()
}

function setOffice(office) {
  if (office === view.office) {
    return
  }
  view.office = office
  table.search = ''
  $('race-search').value = ''
  writeHash()
  renderTopline()
  renderOffice()
}

function renderAll() {
  renderTopline()
  renderOffice()
  renderSwing()
  renderScenarios()
  renderPresets()
}

function placePanel() {
  const fold = document.querySelector('.masthead').getBoundingClientRect().bottom
  const root = document.documentElement.style
  root.setProperty('--levers-top', `${Math.round(Math.max(visibleBand().top, fold) + 16)}px`)
  root.setProperty('--levers-h', `${$('levers').offsetHeight}px`)
}

function wire() {
  for (const el of document.querySelectorAll('.top-card, .tabs button')) {
    el.addEventListener('click', () => setOffice(el.dataset.office))
  }
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scenario]')
    if (b) {
      setScenario(b.dataset.scenario)
    }
  })
  for (const id of ['scenario-table', 'scenario-seats-table']) {
    $(id).addEventListener('click', (e) => {
      const tr = e.target.closest('[data-scenario]')
      if (tr) {
        setScenario(tr.dataset.scenario)
      }
    })
  }
  $('race-table').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable')
    if (th) {
      table.dir = table.sort === th.dataset.sort ? -table.dir : 1
      table.sort = th.dataset.sort
      renderTable()
    }
  })
  $('race-search').addEventListener('input', (e) => {
    table.search = e.target.value
    renderTable()
  })
  $('race-filter').addEventListener('change', (e) => {
    table.filter = e.target.value
    renderTable()
  })
  placePanel()
  onVisibleBand(placePanel)
  let resizeTimer = null
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      renderAll()
      placePanel()
    }, 150)
  })
}

async function boot() {
  wire()
  renderQueries()
  try {
    const [g, ...rows] = await Promise.all([
      fetch('./geo/states.json').then((r) => r.json()),
      ...Object.values(RESULTS_QUERIES).map((q) => run(q, RESULTS_MODEL)),
    ])
    geo = g
    d = Object.fromEntries(Object.keys(RESULTS_QUERIES).map((k, i) => [k, rows[i]]))
  } catch (err) {
    $('status').textContent = 'Could not load'
    $('office-headline').textContent = 'The results could not load.'
    $('office-sub').textContent = `${err.message}. Is Publisher running? (pnpm dev)`
    return
  }
  d.forecast = new Map()
  for (const f of d.forecasts) {
    if (!d.forecast.has(f.scenario)) {
      d.forecast.set(f.scenario, new Map())
    }
    d.forecast.get(f.scenario).set(f.race_id, f)
  }
  readHash()
  const latest = d.national.find((x) => x.is_latest)?.snapshot_at ?? d.races[0]?.source_updated_at
  $('as-of').textContent = latest ? etTime(latest) : '—'
  $('status').textContent = latest ? `Count as of ${etTime(latest, false)}` : ''
  renderAll()
  renderSnapshots()
  placePanel()
}

boot()
