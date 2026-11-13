// Entry point: shared state, lazy tile loading, rendering, the zone drawer.
// Queries come only from query.js; drawing only from charts.js.

import * as charts from './charts.js'
import { fmtDate, fmtInt, fmtPct, seasonLabel, share } from './format.js'
import {
  DEFAULT_STATE,
  HUMAN_TRIGGERS,
  hashToState,
  MODEL,
  SOURCE,
  scopeChips,
  sideQuery,
  sideScopeNote,
  stateToHash,
  TRIGGERS,
  tileQuery,
  timelinePick,
  timelineQuery,
  zoneQuery,
} from './query.js'

const $ = (id) => document.getElementById(id)
// ?perf=1 logs each tile's query and render time to the console.
const PERF = new URLSearchParams(location.search).has('perf')
const known = {
  minSeason: 1951,
  maxSeason: 2026,
  zones: [],
  triggers: TRIGGERS,
  problems: [],
}
let state = { ...DEFAULT_STATE }
let roseMetric = 'avalanches'
let allSeasons = []

// Queries go through Publisher's SDK (/sdk/publisher.js), as the other apps in this repo do: it finds the
// environment and package from the page, so the same files work on a local Publisher and inside Credible.
// The data is a static snapshot, so a query's result never changes while the page is open: keep
// results by query text. Revisiting a scope is instant, and tiles that ask for the same thing (the
// danger tile reuses the accident totals) share one request. Failures are not kept.
const cache = new Map()
const CACHE_MAX = 300
function run(malloy) {
  const hit = cache.get(malloy)
  if (hit) {
    cache.delete(malloy) // re-insert: Map order doubles as least-recently-used
    cache.set(malloy, hit)
    return hit
  }
  const p = window.Publisher.query(MODEL, malloy)
  cache.set(malloy, p)
  p.catch(() => cache.delete(malloy))
  if (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value)
  }
  return p
}

// ---- State bus ------------------------------------------------------------------------------
function setState(patch) {
  state = { ...state, ...patch }
  if (state.from !== null && state.to !== null && state.from > state.to) {
    ;[state.from, state.to] = [state.to, state.from]
  }
  history.replaceState(
    null,
    '',
    `${location.pathname}${location.search}${stateToHash(state, drawer.zone)}` ||
      location.pathname
  )
  syncControls()
  for (const t of Object.values(tiles)) {
    t.dirty = true
  }
  refreshVisible()
  if (drawer.zone) {
    renderDrawer()
  }
}

const scopeSeasons = () =>
  allSeasons.filter(
    (s) =>
      (state.from === null || s >= state.from) &&
      (state.to === null || s <= state.to)
  )

/**
 * Links out to CAIC open in a new tab. Inside a sandboxed frame (an embedded preview) the browser
 * can drop that silently, so if no tab opened, copy the link and say so rather than do nothing.
 */
function externalLink(a, href) {
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener'
  a.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    // Opened without 'noopener' so a blocked open is detectable (null); the opener link is cut by hand.
    let opened = null
    try {
      opened = window.open(href, '_blank')
    } catch {
      opened = null
    }
    if (opened) {
      opened.opener = null
      return
    }
    // Blocked (an embedded viewer without popup permission): show the address to copy, and try the clipboard too.
    const note = flash(a, 'New tabs are blocked here. Copy the address:', href)
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(href))
      .then(() => {
        note.firstChild.textContent = 'New tabs are blocked here. Address copied:'
      })
      .catch(() => {})
  })
}

function flash(anchor, text, href) {
  anchor.parentElement.querySelectorAll('.link-note').forEach((n) => n.remove())
  const note = document.createElement('span')
  note.className = 'link-note'
  note.setAttribute('role', 'status')
  const label = document.createElement('span')
  label.textContent = text
  const field = document.createElement('input')
  field.type = 'text'
  field.readOnly = true
  field.value = href
  field.setAttribute('aria-label', 'Report address')
  field.addEventListener('click', (e) => e.stopPropagation())
  note.append(label, field)
  anchor.after(note)
  field.select()
  setTimeout(() => note.remove(), 12000)
  return note
}

/** Trigger as a patroller would say it: a skier's intentional release is a ski cut. */
function triggerText(r) {
  if (r.trigger === 'Skier / rider' && r.trigger_modifier === 'Intentional') {
    return 'Ski cut'
  }
  return r.trigger_modifier ? `${r.trigger}, ${r.trigger_modifier.toLowerCase()}` : r.trigger
}

// ---- Controls -------------------------------------------------------------------------------
function option(sel, value, label) {
  const o = document.createElement('option')
  o.value = value
  o.textContent = label
  sel.appendChild(o)
}

function buildControls() {
  const from = $('f-from'),
    to = $('f-to')
  for (const s of allSeasons) {
    option(from, s, seasonLabel(s))
  }
  option(to, '', 'now')
  for (const s of allSeasons) {
    option(to, s, seasonLabel(s))
  }
  option($('f-zone'), '', 'All zones')
  known.zones
    .filter((z) => z !== 'Unassigned')
    .forEach((z) => option($('f-zone'), z, z))
  option($('f-trigger'), '', 'Any trigger')
  TRIGGERS.forEach((t) => option($('f-trigger'), t, t))
  option($('f-problem'), '', 'Any problem')
  known.problems.forEach((p) => option($('f-problem'), p, p))

  from.addEventListener('change', () => setState({ from: Number(from.value) }))
  to.addEventListener('change', () =>
    setState({ to: to.value ? Number(to.value) : null })
  )
  $('f-zone').addEventListener('change', (e) =>
    setState({ zone: e.target.value || null })
  )
  $('f-trigger').addEventListener('change', (e) =>
    setState({ trigger: e.target.value || null })
  )
  $('f-problem').addEventListener('change', (e) =>
    setState({ problem: e.target.value || null })
  )
  $('f-people').addEventListener('click', () =>
    setState({ people: !state.people })
  )
  $('f-big').addEventListener('click', () => setState({ big: !state.big }))
  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      $('copy-link').textContent = 'Copied'
    } catch {
      $('copy-link').textContent = 'Copy from address bar'
    }
    setTimeout(() => {
      $('copy-link').textContent = 'Copy link'
    }, 1600)
  })
  for (const [id, metric] of [
    ['rose-count', 'avalanches'],
    ['rose-human', 'human'],
  ]) {
    $(id).addEventListener('click', () => {
      roseMetric = metric
      $('rose-count').setAttribute(
        'aria-pressed',
        String(metric === 'avalanches')
      )
      $('rose-human').setAttribute('aria-pressed', String(metric === 'human'))
      tiles.rose.redraw?.()
    })
  }
}

function syncControls() {
  $('f-from').value = String(state.from ?? known.minSeason)
  $('f-to').value = state.to === null ? '' : String(state.to)
  $('f-zone').value = state.zone ?? ''
  $('f-trigger').value = state.trigger ?? ''
  $('f-problem').value = state.problem ?? ''
  $('f-people').setAttribute('aria-pressed', String(state.people))
  $('f-big').setAttribute('aria-pressed', String(state.big))
  for (const hint of document.querySelectorAll('[data-scope-hint]')) {
    hint.textContent = sideScopeNote(state)
  }
  const box = $('chips')
  box.replaceChildren()
  const chips = scopeChips(state, seasonLabel)
  for (const c of chips) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    const t = document.createElement('span')
    t.textContent = c.label
    const x = document.createElement('button')
    x.type = 'button'
    x.textContent = '×'
    x.setAttribute('aria-label', `Remove ${c.label}`)
    x.addEventListener('click', () => setState(c.clear))
    chip.append(t, x)
    box.appendChild(chip)
  }
  if (chips.length > 1) {
    const all = document.createElement('button')
    all.type = 'button'
    all.className = 'chip clear'
    all.textContent = 'Clear all'
    all.addEventListener('click', () => setState({ ...DEFAULT_STATE }))
    box.appendChild(all)
  }
}

// ---- Tiles: lazy, cancellable, each with its own loading / empty / error -------------------
const tiles = {}
const queue = []
let active = 0
const MAX_CONCURRENT = 4

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()
    active++
    job().finally(() => {
      active--
      pump()
    })
  }
}

function setStatus(body, kind, text) {
  body
    .querySelectorAll(':scope > .state, :scope > .skeleton')
    .forEach((n) => n.remove())
  if (kind === 'loading' && !body.dataset.loaded) {
    const s = document.createElement('div')
    s.className = 'skeleton'
    body.appendChild(s)
  }
  if (kind === 'empty' || kind === 'error') {
    const s = document.createElement('div')
    s.className = `state${kind === 'error' ? ' is-error' : ''}`
    s.textContent = text
    body.appendChild(s)
  }
  body.classList.toggle(
    'is-refreshing',
    kind === 'loading' && !!body.dataset.loaded
  )
}

function clearDrawn(body) {
  body
    .querySelectorAll(
      ':scope > svg, :scope > canvas, :scope > ul, :scope > table, :scope > .chart-stack'
    )
    .forEach((n) => n.remove())
}

function addProvenance(root, getQuery) {
  let footer = root.querySelector('footer')
  if (!footer) {
    footer = document.createElement('footer')
    root.appendChild(footer)
  }
  const d = document.createElement('details')
  const s = document.createElement('summary')
  s.textContent = 'Query'
  const pre = document.createElement('pre')
  d.append(s, pre)
  d.addEventListener('toggle', () => {
    pre.textContent = getQuery()
  })
  footer.appendChild(d)
}

/**
 * Register a tile. `queries()` returns the Malloy strings it needs; `render(results)` draws them.
 * A tile only fetches when on screen; off-screen tiles are marked dirty and fetch on arrival.
 */
function registerTile(
  id,
  { queries, render, isEmpty = (r) => !r[0]?.length, provenance = true }
) {
  const root = document.querySelector(`[data-tile="${id}"]`)
  const body = root.querySelector('.body') ?? root
  const t = {
    id,
    root,
    body,
    dirty: true,
    visible: false,
    seq: 0,
    last: null,
    chart: [],
  }
  t.redraw = () => {
    if (t.last) {
      draw(t.last)
    }
  }
  const draw = (results) => {
    t.chart.forEach((c) => c.destroy())
    t.chart = []
    clearDrawn(body)
    if (isEmpty(results)) {
      setStatus(body, 'empty', 'Nothing matches this scope.')
      return
    }
    setStatus(body, 'done')
    t.drawnWidth = body.clientWidth
    const r0 = performance.now()
    const made = render(results, body)
    if (PERF) {
      console.debug(`[perf] ${id} render ${Math.round(performance.now() - r0)} ms`)
    }
    if (made) {
      t.chart = [].concat(made)
    }
  }
  t.load = () => {
    t.dirty = false
    const mySeq = ++t.seq
    setStatus(body, 'loading')
    queue.push(() => {
      const q0 = performance.now()
      return Promise.all(queries().map(run))
        .then((results) => {
          if (PERF) {
            console.debug(`[perf] ${id} query ${Math.round(performance.now() - q0)} ms`)
          }
          if (mySeq !== t.seq) {
            return // stale: scope moved on while this was in flight
          }
          body.dataset.loaded = '1'
          t.last = results
          draw(results)
        })
        .catch((err) => {
          if (mySeq !== t.seq) {
            return
          }
          clearDrawn(body)
          setStatus(
            body,
            'error',
            `Couldn't load (${err.status ?? 'error'}): ${err.response?.message ?? err.message}`
          )
          console.error(`[tile ${id}]`, err)
        })
    })
    pump()
  }
  if (provenance && root.tagName === 'ARTICLE') {
    addProvenance(root, () => queries().join('\n\n'))
  }
  tiles[id] = t
  return t
}

function refreshVisible() {
  for (const t of Object.values(tiles)) {
    if (t.visible && t.dirty) {
      t.load()
    }
  }
}

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const t = Object.values(tiles).find((x) => x.root === e.target)
      if (!t) {
        continue
      }
      t.visible = e.isIntersecting
      if (t.visible && t.dirty) {
        t.load()
      }
    }
  },
  { rootMargin: '240px' }
)

// Redraw a tile only when its own width changed. A tile finishing its load changes the page's
// height, and redrawing every visible tile on any resize drew the calendar three times on scroll.
let resizeTimer
const ro = new ResizeObserver(() => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    for (const t of Object.values(tiles)) {
      if (t.visible && t.last && t.body.clientWidth !== t.drawnWidth) {
        t.redraw()
      }
    }
  }, 150)
})

// ---- Tile definitions -----------------------------------------------------------------------
function defineTiles() {
  registerTile('kpis', {
    provenance: false,
    queries: () => [
      tileQuery('kpis', state, known),
      tileQuery('spark', state, known),
    ],
    isEmpty: () => false,
    render: ([[k], seasons]) => {
      const inScope = seasons.filter((r) => scopeSeasons().includes(r.season))
      $('k-avalanches').textContent = fmtInt(k?.avalanches)
      $('k-avalanches-sub').textContent = k?.avalanches
        ? `${fmtInt(k.observations)} observations, ${fmtDate(k.first_observed)} to ${fmtDate(k.last_observed)}`
        : 'No avalanches in scope'
      $('k-human').textContent = fmtPct(k?.pct_human_triggered)
      $('k-human-sub').textContent = k?.avalanches
        ? `${fmtInt(k.human_triggered_avalanches)} avalanches, of those with a known trigger`
        : ' '
      $('k-big').textContent = fmtPct(k?.pct_dangerous_size)
      $('k-big-sub').textContent = k?.avalanches
        ? `${fmtInt(k.dangerous_size_avalanches)} D2 or larger, ${fmtInt(k.large_avalanches)} D3 or larger`
        : ' '
      $('k-people').textContent = fmtInt(k?.incident_observations)
      $('k-people-sub').textContent = k?.avalanches
        ? `${fmtPct(share(k.incident_observations, k.observations), 1)} of observations`
        : ' '
      const labels = inScope.map((r) => r.season_label)
      charts.sparkline(
        $('k-spark-avalanches'),
        inScope.map((r) => r.avalanches),
        '--text-strong',
        { labels }
      )
      charts.sparkline(
        $('k-spark-human'),
        inScope.map((r) => r.pct_human_triggered),
        '--human',
        { labels, format: (v) => fmtPct(v) }
      )
      charts.sparkline(
        $('k-spark-people'),
        inScope.map((r) => r.incident_observations),
        '--people',
        { labels }
      )
    },
  })

  registerTile('rose', {
    queries: () => [tileQuery('rose', state, known)],
    render: ([rows], body) =>
      charts.rose(body, rows, {
        metric: roseMetric,
        selected: { aspect: state.aspect, elevation: state.elevation },
        onPick: (aspect, elevation) =>
          setState(
            state.aspect === aspect && state.elevation === elevation
              ? { aspect: null, elevation: null }
              : { aspect, elevation }
          ),
      }),
  })

  registerTile('calendar', {
    queries: () => [tileQuery('calendar', state, known)],
    render: ([rows], body) => {
      const seasons = allSeasons.filter(
        (s) =>
          s >= Math.max(known.minSeason, Math.min(state.from ?? 2011, 2011))
      )
      const selected = new Set(
        state.from !== null && state.from === state.to ? [state.from] : []
      )
      charts.calendar(body, rows, {
        seasons: [...seasons].reverse(),
        selected,
        onPick: (s) =>
          setState(
            selected.has(s)
              ? { from: DEFAULT_STATE.from, to: null }
              : { from: s, to: s }
          ),
      })
    },
  })

  let geo = null
  registerTile('map', {
    queries: () => [tileQuery('map', state, known)],
    render: ([rows], body) =>
      charts.zoneMap(body, geo, rows, {
        selectedZone: state.zone,
        onZone: (z) => setState({ zone: state.zone === z ? null : z }),
      }),
  })
  fetch('./zones.geojson')
    .then((r) => r.json())
    .then((g) => {
      geo = g
      tiles.map.redraw()
    })
    .catch(() => {})

  registerTile('zones', {
    queries: () => [tileQuery('zones', state, known)],
    render: ([rows], body) => {
      const max = Math.max(1, ...rows.map((r) => r.avalanches))
      const ul = document.createElement('ul')
      ul.className = 'rank'
      for (const r of rows) {
        const li = document.createElement('li')
        li.tabIndex = 0
        if (state.zone === r.forecast_zone) {
          li.classList.add('is-selected')
        }
        const name = document.createElement('div')
        name.className = 'name'
        name.textContent = r.forecast_zone
        const reg = document.createElement('span')
        reg.className = 'region'
        reg.textContent = r.mountain_region
        name.appendChild(reg)
        const num = document.createElement('div')
        num.className = 'num'
        num.textContent = fmtInt(r.avalanches)
        const bar = document.createElement('div')
        bar.className = 'bar'
        const human = document.createElement('i')
        human.style.background = 'var(--human)'
        const rest = document.createElement('i')
        rest.style.background = 'var(--natural)'
        const w = (r.avalanches / max) * 100,
          hs = r.pct_human_triggered ?? 0
        human.style.width = `${w * hs}%`
        rest.style.width = `${w * (1 - hs)}%`
        bar.append(human, rest)
        const meta = document.createElement('div')
        meta.className = 'meta'
        for (const txt of [
          `${fmtPct(r.pct_human_triggered)} human-triggered`,
          `${fmtPct(r.pct_dangerous_size)} D2+`,
          `${fmtInt(r.incident_observations)} with people involved`,
        ]) {
          const s = document.createElement('span')
          s.textContent = txt
          meta.appendChild(s)
        }
        if (
          r.forecast_zone !== 'Unassigned' &&
          known.zones.includes(r.forecast_zone)
        ) {
          const open = document.createElement('button')
          open.type = 'button'
          open.className = 'open'
          open.textContent = 'Zone profile'
          open.addEventListener('click', (e) => {
            e.stopPropagation()
            openDrawer(r.forecast_zone)
          })
          meta.appendChild(open)
        }
        li.append(name, num, bar, meta)
        const toggle = () =>
          setState({
            zone: state.zone === r.forecast_zone ? null : r.forecast_zone,
          })
        li.addEventListener('click', toggle)
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            toggle()
          }
        })
        ul.appendChild(li)
      }
      body.appendChild(ul)
    },
  })

  registerTile('triggers', {
    queries: () => [tileQuery('triggers', state, known)],
    render: ([rows], body) => {
      const legend = $('trigger-legend')
      legend.replaceChildren()
      for (const t of TRIGGERS) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'toggle'
        b.setAttribute('aria-pressed', String(state.trigger === t))
        const sw = document.createElement('i')
        sw.style.background = charts.triggerColor(t)
        b.append(sw, document.createTextNode(` ${t}`))
        b.addEventListener('click', () =>
          setState({ trigger: state.trigger === t ? null : t })
        )
        legend.appendChild(b)
      }
      const seasons = scopeSeasons().filter(
        (s) => s >= 2011 || state.from < 2011
      )
      return charts.triggerMix(
        body,
        rows.filter((r) => seasons.includes(r.season)),
        {
          seasons,
          triggers: TRIGGERS,
          selected: state.trigger,
          onPick: (t) => setState({ trigger: state.trigger === t ? null : t }),
        }
      )
    },
  })

  registerTile('sizes', {
    queries: () => [tileQuery('sizes', state, known)],
    render: ([rows], body) => charts.sizePairs(body, rows),
  })

  registerTile('problems', {
    queries: () => [tileQuery('problems', state, known)],
    render: ([rows], body) => {
      const months = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      const names = {
        1: 'Oct',
        2: 'Nov',
        3: 'Dec',
        4: 'Jan',
        5: 'Feb',
        6: 'Mar',
        7: 'Apr',
        8: 'May',
        9: 'Jun',
      }
      const cell = new Map(
        rows.map((r) => [
          `${r.avalanche_problem}|${r.season_month_order}`,
          r.avalanches,
        ])
      )
      const totals = new Map()
      rows.forEach((r) =>
        totals.set(
          r.avalanche_problem,
          (totals.get(r.avalanche_problem) || 0) + r.avalanches
        )
      )
      const problems = [...totals.keys()].sort(
        (a, b) => totals.get(b) - totals.get(a)
      )
      charts.heatmap(body, {
        rowKeys: problems,
        colKeys: months,
        colLabel: (m) => names[m],
        value: (p, m) => cell.get(`${p}|${m}`),
        detail: (p, m, v, total) => [
          ['Avalanches', fmtInt(v)],
          ['Share of this problem', fmtPct(share(v, total))],
        ],
        selectedRow: state.problem,
        onRow: (p) => setState({ problem: state.problem === p ? null : p }),
      })
    },
  })

  registerTile('crown', {
    queries: () => [tileQuery('crown', state, known)],
    render: ([rows], body) => {
      const buckets = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72]
      const cell = new Map(
        rows.map((r) => [
          `${r.avalanche_problem}|${r.crown_bucket_in}`,
          r.avalanches,
        ])
      )
      const totals = new Map()
      rows.forEach((r) =>
        totals.set(
          r.avalanche_problem,
          (totals.get(r.avalanche_problem) || 0) + r.avalanches
        )
      )
      // Order problems by typical depth (weighted mean bucket), shallow to deep.
      const mean = (p) =>
        rows
          .filter((r) => r.avalanche_problem === p)
          .reduce((a, r) => a + r.crown_bucket_in * r.avalanches, 0) /
        totals.get(p)
      const problems = [...totals.keys()]
        .filter((p) => totals.get(p) >= 5)
        .sort((a, b) => mean(a) - mean(b))
      // Normalise each row to its own total, so a rare problem's shape is still readable.
      charts.heatmap(body, {
        rowKeys: problems,
        colKeys: buckets,
        colLabel: (b) =>
          b === 72 ? '6ft+' : b % 12 === 0 ? `${b / 12}ft` : '',
        value: (p, b) => {
          const v = cell.get(`${p}|${b}`)
          return v ? v / totals.get(p) : 0
        },
        detail: (p, b) => [
          ['Depth', b === 72 ? '72 in +' : `${b}–${b + 5} in`],
          ['Avalanches', fmtInt(cell.get(`${p}|${b}`) ?? 0)],
          [
            'Share of this problem',
            fmtPct(share(cell.get(`${p}|${b}`) ?? 0, totals.get(p))),
          ],
          ['Typical depth', `${Math.round(mean(p) + 3)} in`],
        ],
        rowTotals: false,
        colorStops: [
          charts.token('--surface-2'),
          charts.token('--human-soft'),
          charts.token('--human'),
          charts.token('--people'),
        ],
        selectedRow: state.problem,
        onRow: (p) => setState({ problem: state.problem === p ? null : p }),
      })
    },
  })

  registerTile('table', {
    queries: () => [tileQuery('table', state, known)],
    render: ([rows], body) => {
      $('table-sub').textContent =
        rows.length >= 200
          ? "Newest 200 observations in the current scope. Click a row for the observer's notes."
          : `All ${rows.length} observations in the current scope. Click a row for the observer's notes.`
      const table = document.createElement('table')
      table.className = 'obs'
      const head = table.createTHead().insertRow()
      for (const h of [
        'Date',
        'Zone',
        'Place',
        'Aspect / elev.',
        'Type',
        'Trigger',
        'Size',
        '#',
        'Crown',
      ]) {
        const th = document.createElement('th')
        th.textContent = h
        head.appendChild(th)
      }
      const tb = table.createTBody()
      for (const r of rows) {
        const tr = tb.insertRow()
        tr.className = 'obs-row'
        tr.tabIndex = 0
        const cells = [
          fmtDate(r.observed_date),
          r.forecast_zone,
          r.place ?? '—',
          [r.slope_aspect, r.elevation?.toLowerCase()].filter(Boolean).join(', ') || '—',
          r.avalanche_problem ?? r.avalanche_type ?? '—',
        ]
        for (const c of cells) {
          tr.insertCell().textContent = c
        }
        const trig = tr.insertCell()
        const tag = document.createElement('span')
        tag.className = `tag ${HUMAN_TRIGGERS.has(r.trigger) ? 'human' : r.trigger === 'Natural' ? 'natural' : 'other'}`
        tag.textContent = triggerText(r)
        trig.appendChild(tag)
        if (r.involved_people) {
          const p = document.createElement('span')
          p.className = 'tag people'
          p.textContent = 'people involved'
          trig.append(' ', p)
        }
        tr.insertCell().textContent =
          [r.destructive_size, r.relative_size].filter(Boolean).join(' / ') ||
          '—'
        const n = tr.insertCell()
        n.className = 'num'
        n.textContent = fmtInt(r.reported_count ?? 1)
        const cr = tr.insertCell()
        cr.className = 'num'
        cr.textContent =
          r.crown_depth_in == null ? '—' : `${Math.round(r.crown_depth_in)} in`
        let open = null
        const toggle = () => {
          if (open) {
            open.remove()
            open = null
            return
          }
          open = document.createElement('tr')
          open.className = 'desc'
          const td = document.createElement('td')
          td.colSpan = 9
          const p = document.createElement('p')
          p.textContent = r.description || 'No notes on this observation.'
          td.appendChild(p)
          if (
            r.report_url &&
            /^https:\/\/avalanche\.state\.co\.us\//.test(r.report_url)
          ) {
            const a = document.createElement('a')
            externalLink(a, r.report_url)
            a.textContent = 'Read the full report on avalanche.state.co.us'
            td.appendChild(a)
          }
          open.appendChild(td)
          tr.after(open)
        }
        tr.addEventListener('click', toggle)
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            toggle()
          }
        })
      }
      body.appendChild(table)
    },
  })

  // ---- Storms and warm-ups (snow_days) ----
  registerTile('storm', {
    queries: () => [sideQuery('storm', state, known)],
    render: ([rows], body) =>
      charts.bars(body, {
        labels: rows.map((r) => r.storm_label),
        series: [
          { label: 'Natural', data: rows.map((r) => r.natural_per_day), color: charts.token('--natural') },
          { label: 'Triggered by people', data: rows.map((r) => r.human_per_day), color: charts.token('--human') },
        ],
        format: (v) => (v == null ? '—' : v.toFixed(1)),
        tipTitle: (i) => `${rows[i].storm_label} of new SWE in 3 days`,
        tipRows: (i) => [
          ['Natural avalanches per day', rows[i].natural_per_day.toFixed(2)],
          ['Triggered by people per day', rows[i].human_per_day.toFixed(2)],
          ['Days with a D3 or larger', fmtPct(rows[i].pct_days_with_large, 1)],
          ['Zone-days', fmtInt(rows[i].zone_days)],
        ],
      }),
  })

  registerTile('warming', {
    queries: () => [sideQuery('warming', state, known)],
    render: ([rows], body) => {
      const names = {
        '0 Cooling': 'Cooler by 5°F+',
        '1 Steady': 'Within 5°F',
        '2 Warming': 'Warmer by 5-10°F',
        '3 Sharp warming': 'Warmer by 10°F+',
      }
      return charts.bars(body, {
        labels: rows.map((r) => names[r.warming_bin] ?? r.warming_bin),
        series: [
          { label: 'Natural avalanches per day', data: rows.map((r) => r.natural_per_day), color: charts.token('--natural') },
        ],
        format: (v) => (v == null ? '—' : v.toFixed(1)),
        tipRows: (i) => [
          ['Natural avalanches per day', rows[i].natural_per_day.toFixed(2)],
          ['All avalanches per day', rows[i].avalanches_per_day.toFixed(2)],
          ['Zone-days', fmtInt(rows[i].zone_days)],
        ],
      })
    },
  })

  registerTile('timeline', {
    queries: () => [timelineQuery(state, known)],
    render: ([all], body) => {
      // October to June: summer days carry no snow and no avalanches worth the width.
      const rows = all.filter((r) => {
        const m = Number(String(r.snow_date).slice(5, 7))
        return m >= 10 || m <= 6
      })
      const { season, zone } = timelinePick(state, known)
      $('timeline-title').textContent = `${zone}, ${seasonLabel(season)}, day by day`
      const total = rows.reduce((a, r) => a + (r.avalanches || 0), 0)
      const peak = rows.reduce((a, r) => (r.avg_swe_in > (a?.avg_swe_in ?? -1) ? r : a), null)
      $('timeline-caption').textContent =
        `${fmtInt(total)} avalanches seen; snowpack peaked at ${peak?.avg_swe_in?.toFixed(1) ?? '—'} in of SWE on ${peak ? fmtDate(peak.snow_date) : '—'}. ` +
        (state.zone ? '' : `Pick a zone above to see another; `) +
        (state.to === null ? 'set the last season to see another year.' : '')
      return charts.timeline(body, rows)
    },
  })

  // ---- Accidents ----
  registerTile('acc-kpis', {
    provenance: false,
    queries: () => [sideQuery('acc-kpis', state, known)],
    isEmpty: () => false,
    render: ([[k]]) => {
      $('a-reports').textContent = fmtInt(k?.reports)
      $('a-reports-sub').textContent = k?.reports
        ? `${fmtInt(k.fatal_accidents)} with a death`
        : 'No reports in scope'
      $('a-caught').textContent = fmtInt(k?.people_caught)
      $('a-caught-sub').textContent = k?.people_caught ? 'carried by the slide' : ' '
      $('a-buried').textContent = fmtInt(k?.people_buried)
      $('a-buried-sub').textContent = k?.people_caught
        ? `${fmtPct(share(k.people_buried, k.people_caught))} of those caught`
        : ' '
      $('a-killed').textContent = fmtInt(k?.people_killed)
      $('a-killed-sub').textContent = k?.people_caught
        ? `${fmtPct(k.pct_caught_killed)} of those caught`
        : ' '
    },
  })

  registerTile('danger', {
    queries: () => [sideQuery('danger', state, known), sideQuery('acc-kpis', state, known)],
    render: ([rows, [k]], body) => {
      const rated = rows.reduce((a, r) => a + r.reports, 0)
      $('danger-caption').textContent =
        `Only reports that record a rating: ${fmtInt(rated)} of ${fmtInt(k?.reports)} in this scope, nearly all since 2011.`
      charts.dangerRows(body, rows)
    },
  })

  registerTile('acc-seasons', {
    queries: () => [sideQuery('acc-seasons', state, known)],
    render: ([rows], body) => {
      const inScope = new Set(scopeSeasons())
      return charts.bars(body, {
        labels: rows.map((r) => `'${String(r.season % 100).padStart(2, '0')}`),
        stacked: true,
        series: [
          {
            label: 'Killed',
            data: rows.map((r) => r.people_killed),
            color: rows.map((r) => (inScope.has(r.season) ? charts.token('--people') : charts.token('--people-soft'))),
          },
          {
            label: 'Caught and survived',
            data: rows.map((r) => r.people_caught - r.people_killed),
            color: rows.map((r) => (inScope.has(r.season) ? charts.token('--seq-2') : charts.token('--seq-1'))),
          },
        ],
        tipTitle: (i) => rows[i].season_label,
        tipRows: (i) => [
          ['Killed', fmtInt(rows[i].people_killed)],
          ['Caught', fmtInt(rows[i].people_caught)],
          ['Buried', fmtInt(rows[i].people_buried)],
          ['Reports', fmtInt(rows[i].reports)],
        ],
      })
    },
  })

  registerTile('acc-activity', {
    queries: () => [sideQuery('acc-activity', state, known)],
    render: ([rows], body) => {
      const shown = rows.filter((r) => r.people_caught > 0)
      return charts.bars(body, {
        labels: shown.map(
          (r) => `${r.activity_group}, ${fmtPct(share(r.people_killed, r.people_caught))} died`
        ),
        horizontal: true,
        stacked: true,
        series: [
          { label: 'Killed', data: shown.map((r) => r.people_killed), color: charts.token('--people') },
          { label: 'Caught and survived', data: shown.map((r) => r.people_caught - r.people_killed), color: charts.token('--seq-2') },
        ],
        tipRows: (i) => [
          ['People caught', fmtInt(shown[i].people_caught)],
          ['Killed', `${fmtInt(shown[i].people_killed)} (${fmtPct(share(shown[i].people_killed, shown[i].people_caught))} of those caught)`],
          ['Reports', fmtInt(shown[i].reports)],
        ],
      })
    },
  })

  registerTile('acc-rose', {
    queries: () => [sideQuery('acc-rose', state, known)],
    render: ([rows], body) =>
      charts.rose(
        body,
        rows.map((r) => ({ ...r, elevation: 'All elevations' })),
        { metric: 'fatal', rings: ['All elevations'] }
      ),
  })

  registerTile('acc-list', {
    queries: () => [sideQuery('acc-list', state, known)],
    render: ([rows], body) => {
      $('acc-list-sub').textContent =
        rows.length >= 200
          ? "Newest 200 reports in the current scope. Each links to CAIC's full write-up."
          : `All ${rows.length} reports in the current scope. Each links to CAIC's full write-up.`
      const table = document.createElement('table')
      table.className = 'obs'
      const head = table.createTHead().insertRow()
      for (const h of ['Date', 'Zone', 'Place', 'Who', 'Outcome', 'Caught', 'Buried', 'Killed', 'Danger', '']) {
        const th = document.createElement('th')
        th.textContent = h
        head.appendChild(th)
      }
      const tb = table.createTBody()
      for (const r of rows) {
        const tr = tb.insertRow()
        for (const c of [fmtDate(r.observed_date), r.forecast_zone, r.location || '—', r.activity_group]) {
          tr.insertCell().textContent = c
        }
        const oc = tr.insertCell()
        const tag = document.createElement('span')
        tag.className = `tag outcome-${r.outcome.toLowerCase()}`
        tag.textContent = r.outcome
        oc.appendChild(tag)
        for (const v of [r.caught, r.buried, r.killed]) {
          const td = tr.insertCell()
          td.className = 'num'
          td.textContent = fmtInt(v)
        }
        tr.insertCell().textContent = r.danger ?? '—'
        const link = tr.insertCell()
        if (/^https:\/\/avalanche\.state\.co\.us\/report\//.test(r.report_url)) {
          const a = document.createElement('a')
          externalLink(a, r.report_url)
          a.textContent = 'Report'
          a.setAttribute('aria-label', `CAIC report, ${fmtDate(r.observed_date)}, ${r.location || r.forecast_zone}`)
          link.appendChild(a)
        }
      }
      body.appendChild(table)
    },
  })

  for (const t of Object.values(tiles)) {
    io.observe(t.root)
    ro.observe(t.body)
  }
}

// ---- Zone drawer: backed by the parameterised zone_detail source --------------------------
const drawer = { zone: null, charts: [], returnFocus: null, seq: 0 }

function openDrawer(zone) {
  if (!known.zones.includes(zone)) {
    return
  }
  drawer.zone = zone
  drawer.returnFocus = document.activeElement
  $('scrim').hidden = false
  $('drawer').hidden = false
  requestAnimationFrame(() => {
    $('scrim').classList.add('is-open')
    $('drawer').classList.add('is-open')
    $('drawer-close').focus()
  })
  document.addEventListener('keydown', onDrawerKey)
  history.replaceState(
    null,
    '',
    `${location.pathname}${stateToHash(state, zone)}`
  )
  renderDrawer()
}

function closeDrawer() {
  drawer.zone = null
  drawer.seq++
  $('scrim').classList.remove('is-open')
  $('drawer').classList.remove('is-open')
  document.removeEventListener('keydown', onDrawerKey)
  drawer.charts.forEach((c) => c.destroy())
  drawer.charts = []
  setTimeout(() => {
    if (!drawer.zone) {
      $('scrim').hidden = true
      $('drawer').hidden = true
    }
  }, 250)
  history.replaceState(
    null,
    '',
    `${location.pathname}${stateToHash(state)}` || location.pathname
  )
  drawer.returnFocus?.focus?.()
}

function onDrawerKey(e) {
  if (e.key === 'Escape') {
    closeDrawer()
    return
  }
  if (e.key !== 'Tab') {
    return
  }
  const f = [
    ...$('drawer').querySelectorAll("button, a[href], [tabindex='0']"),
  ].filter((n) => n.offsetParent !== null)
  if (!f.length) {
    return
  }
  const first = f[0],
    last = f.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

function renderDrawer() {
  const zone = drawer.zone
  const mySeq = ++drawer.seq
  $('drawer-title').textContent = zone
  const chips = scopeChips({ ...state, zone: null }, seasonLabel).map(
    (c) => c.label
  )
  $('drawer-scope').textContent =
    `Scope: ${chips.length ? chips.join(', ') : `seasons ${seasonLabel(state.from)} to now`}`
  for (const id of ['drawer-stats', 'drawer-recent']) {
    $(id).replaceChildren()
  }
  const loading = document.createElement('div')
  loading.className = 'state'
  loading.textContent = 'Loading…'
  $('drawer-stats').appendChild(loading)
  Promise.all([
    run(zoneQuery(zone, 'kpis', state, known)),
    run(zoneQuery(zone, 'by_season', state, known)),
    run(zoneQuery(zone, 'rose', state, known)),
    run(zoneQuery(zone, 'observation_list', state, known, 'limit: 6')),
  ])
    .then(([[k], seasons, roseRows, recent]) => {
      if (mySeq !== drawer.seq || drawer.zone !== zone) {
        return // stale-response guard
      }
      drawer.charts.forEach((c) => c.destroy())
      drawer.charts = []
      const stats = $('drawer-stats')
      stats.replaceChildren()
      for (const [v, l] of [
        [fmtInt(k?.avalanches), 'avalanches'],
        [fmtPct(k?.pct_human_triggered), 'human-triggered'],
        [fmtPct(k?.pct_dangerous_size), 'D2 or larger'],
        [fmtInt(k?.large_avalanches), 'D3 or larger'],
        [fmtInt(k?.incident_observations), 'with people involved'],
        [fmtInt(k?.active_days), 'days with avalanches'],
      ]) {
        const d = document.createElement('div')
        d.className = 'stat'
        const a = document.createElement('div')
        a.className = 'v'
        a.textContent = v
        const b = document.createElement('div')
        b.className = 'l'
        b.textContent = l
        d.append(a, b)
        stats.appendChild(d)
      }
      const inScope = seasons.filter(
        (r) => r.season >= 2011 || (state.from ?? 2011) < 2011
      )
      $('drawer-seasons').replaceChildren()
      if (inScope.length) {
        drawer.charts.push(charts.seasonBars($('drawer-seasons'), inScope))
      }
      $('drawer-rose').replaceChildren()
      charts.rose($('drawer-rose'), roseRows, {
        metric: 'avalanches',
        size: 300,
      })
      const ul = $('drawer-recent')
      for (const r of recent) {
        const li = document.createElement('li')
        const when = document.createElement('div')
        when.className = 'when'
        when.textContent = [
          fmtDate(r.observed_date),
          [r.slope_aspect, r.elevation?.toLowerCase()].filter(Boolean).join(' '),
          triggerText(r),
          r.destructive_size ?? 'size not rated',
        ]
          .filter(Boolean)
          .join(', ')
        const what = document.createElement('div')
        what.textContent = r.description
          ? r.description.length > 220
            ? `${r.description.slice(0, 220)}…`
            : r.description
          : (r.place ?? 'No notes.')
        li.append(when, what)
        ul.appendChild(li)
      }
      if (!recent.length) {
        const li = document.createElement('li')
        li.textContent = 'No observations in this scope.'
        ul.appendChild(li)
      }
    })
    .catch((err) => {
      if (mySeq !== drawer.seq) {
        return
      }
      const s = $('drawer-stats')
      s.replaceChildren()
      const e = document.createElement('div')
      e.className = 'state is-error'
      e.textContent = `Couldn't load zone: ${err.response?.message ?? err.message}`
      s.appendChild(e)
    })
}

// ---- Boot -----------------------------------------------------------------------------------
async function boot() {
  // One request for the three lists the controls are built from (Publisher runs queries one at a time).
  const [{ zones, problems, seasons }] = await run(
    `run: ${SOURCE} -> {
      nest: zones is { group_by: forecast_zone; order_by: forecast_zone }
      nest: problems is { where: avalanche_problem is not null; group_by: avalanche_problem; order_by: avalanche_problem }
      nest: seasons is { group_by: season; order_by: season }
    }`
  )
  known.zones = zones.map((r) => r.forecast_zone)
  known.problems = problems.map((r) => r.avalanche_problem)
  allSeasons = seasons.map((r) => r.season)
  known.minSeason = allSeasons[0]
  known.maxSeason = allSeasons.at(-1)
  const parsed = hashToState(location.hash, known)
  state = parsed.state
  buildControls()
  syncControls()
  defineTiles()
  $('drawer-close').addEventListener('click', closeDrawer)
  $('scrim').addEventListener('click', closeDrawer)
  $('drawer-filter').addEventListener('click', () => {
    const z = drawer.zone
    closeDrawer()
    setState({ zone: z })
  })
  if (parsed.drawer) {
    openDrawer(parsed.drawer)
  }
}

// Charts read colour tokens when they draw, so redraw when the theme flips: the OS setting, or a
// host page stamping data-theme on <html>.
const redrawAll = () => {
  charts.clearTokens()
  for (const t of Object.values(tiles)) {
    t.redraw()
  }
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', redrawAll)
new MutationObserver(redrawAll).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
})

boot().catch((err) => {
  const s = document.createElement('div')
  s.className = 'boot-error'
  s.textContent = `Couldn't start: ${err.response?.message ?? err.message}`
  document.querySelector('main').prepend(s)
  console.error(err)
})
