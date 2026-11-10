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
  stateToHash,
  TRIGGERS,
  tileQuery,
  zoneQuery,
} from './query.js'

const $ = (id) => document.getElementById(id)
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
async function run(malloy) {
  return window.Publisher.query(MODEL, malloy)
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
      ':scope > svg, :scope > canvas, :scope > ul, :scope > table'
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
    const made = render(results, body)
    if (made) {
      t.chart = [].concat(made)
    }
  }
  t.load = () => {
    t.dirty = false
    const mySeq = ++t.seq
    setStatus(body, 'loading')
    queue.push(() =>
      Promise.all(queries().map(run))
        .then((results) => {
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
    )
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

let resizeTimer
const ro = new ResizeObserver(() => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(
    () => Object.values(tiles).forEach((t) => t.visible && t.redraw()),
    150
  )
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
        ? `${fmtInt(k.observations)} observations · ${fmtDate(k.first_observed)} – ${fmtDate(k.last_observed)}`
        : 'No avalanches in scope'
      $('k-human').textContent = fmtPct(k?.pct_human_triggered)
      $('k-human-sub').textContent = k?.avalanches
        ? `${fmtInt(k.human_triggered_avalanches)} avalanches, of those with a known trigger`
        : ' '
      $('k-big').textContent = fmtPct(k?.pct_dangerous_size)
      $('k-big-sub').textContent = k?.avalanches
        ? `${fmtInt(k.dangerous_size_avalanches)} D2+ · ${fmtInt(k.large_avalanches)} D3+ (car-burying)`
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
          open.textContent = 'Profile →'
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
          [r.slope_aspect, r.elevation].filter(Boolean).join(' · ') || '—',
          r.avalanche_problem ?? r.avalanche_type ?? '—',
        ]
        for (const c of cells) {
          tr.insertCell().textContent = c
        }
        const trig = tr.insertCell()
        const tag = document.createElement('span')
        tag.className = `tag ${HUMAN_TRIGGERS.has(r.trigger) ? 'human' : r.trigger === 'Natural' ? 'natural' : 'other'}`
        tag.textContent = r.trigger_modifier
          ? `${r.trigger} · ${r.trigger_modifier}`
          : r.trigger
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
            a.href = r.report_url
            a.target = '_blank'
            a.rel = 'noopener'
            a.textContent = 'Full report on avalanche.state.co.us →'
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
    `Scope: ${chips.length ? chips.join(' · ') : `seasons ${seasonLabel(state.from)} → now`}`
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
        [fmtInt(k?.large_avalanches), 'D3+ (car-burying)'],
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
        when.textContent = `${fmtDate(r.observed_date)} · ${[r.slope_aspect, r.elevation].filter(Boolean).join(' · ')} · ${r.trigger} · ${r.destructive_size ?? 'size ?'}`
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
  const [zones, problems, seasons] = await Promise.all([
    run(
      `run: ${SOURCE} -> { group_by: forecast_zone; order_by: forecast_zone }`
    ),
    run(
      `run: ${SOURCE} -> { where: avalanche_problem is not null; group_by: avalanche_problem; order_by: avalanche_problem }`
    ),
    run(`run: ${SOURCE} -> { group_by: season; order_by: season }`),
  ])
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

boot().catch((err) => {
  const s = document.createElement('div')
  s.className = 'boot-error'
  s.textContent = `Couldn't start: ${err.response?.message ?? err.message}`
  document.querySelector('main').prepend(s)
  console.error(err)
})
