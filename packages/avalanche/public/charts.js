// The chart layer: the only module that draws. Colors, sizes and fonts come from CSS tokens.
import {
  fmtInt,
  fmtPct,
  makeProjection,
  mix,
  monthTicks,
  rampColor,
  seasonLabel,
  weekLabel,
} from './format.js'

const NS = 'http://www.w3.org/2000/svg'
// CSS tokens are read once and cached: reading computed style while a chart is appending nodes
// forces a style recalculation per read (the season calendar took a second on first draw).
// clearTokens() drops the cache when the theme changes.
const tokenCache = new Map()
export const token = (n) => {
  let v = tokenCache.get(n)
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    tokenCache.set(n, v)
  }
  return v
}
export const clearTokens = () => tokenCache.clear()
const px = (n) => Number.parseFloat(token(n)) || 0
export const seqRamp = () =>
  ['--seq-0', '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5'].map(token)
export const triggerColor = (t) =>
  token(
    {
      Natural: '--natural',
      'Skier / rider': '--human',
      Snowmobile: '--t-snowmobile',
      'Hiker / climber': '--t-hiker',
      'Other human': '--t-other-human',
      Explosives: '--t-explosives',
      Unknown: '--t-unknown',
    }[t] || '--t-unknown'
  )

export function el(tag, attrs = {}, parent = null, text = null) {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) {
      n.setAttribute(k, v)
    }
  }
  if (text !== null) {
    n.textContent = text
  }
  if (parent) {
    parent.appendChild(n)
  }
  return n
}

function freshSvg(container, h) {
  container.querySelectorAll(':scope > svg').forEach((s) => s.remove())
  const w = Math.max(200, container.clientWidth)
  const height = h ?? Math.max(160, container.clientHeight)
  const svg = el('svg', {
    viewBox: `0 0 ${w} ${height}`,
    width: w,
    height,
    role: 'img',
  })
  container.appendChild(svg)
  return { svg, w, h: height }
}

// ---- Tooltip -------------------------------------------------------------------------------
let tip
export function showTip(evt, title, rows) {
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'tooltip'
    document.body.appendChild(tip)
  }
  tip.replaceChildren()
  const b = document.createElement('b')
  b.textContent = title
  tip.appendChild(b)
  for (const [k, v] of rows) {
    const r = document.createElement('div')
    r.className = 'row'
    const a = document.createElement('span')
    a.textContent = k
    const c = document.createElement('span')
    c.textContent = v
    r.append(a, c)
    tip.appendChild(r)
  }
  const pad = px('--sp-3')
  const x = Math.min(
    window.innerWidth - tip.offsetWidth - pad,
    evt.clientX + pad
  )
  const y = Math.min(
    window.innerHeight - tip.offsetHeight - pad,
    evt.clientY + pad
  )
  tip.style.left = `${x}px`
  tip.style.top = `${y}px`
  tip.classList.add('is-on')
}
export function hideTip() {
  tip?.classList.remove('is-on')
}

function hover(node, title, rows) {
  node.addEventListener('mousemove', (e) =>
    showTip(e, typeof title === 'function' ? title() : title, rows())
  )
  node.addEventListener('mouseleave', hideTip)
}

function keyClick(node, fn, label) {
  node.setAttribute('tabindex', '0')
  node.setAttribute('role', 'button')
  if (label) {
    node.setAttribute('aria-label', label)
  }
  node.classList.add('clickable')
  node.addEventListener('click', fn)
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  })
}

// ---- Sparkline -----------------------------------------------------------------------------
export function sparkline(
  svgNode,
  values,
  colorToken,
  { format = fmtInt, labels = [] } = {}
) {
  svgNode.replaceChildren()
  const w = svgNode.clientWidth || 200,
    h = svgNode.clientHeight || 40
  svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`)
  const pts = values
    .map((v, i) => [i, v])
    .filter(([, v]) => typeof v === 'number')
  if (pts.length < 2) {
    return
  }
  const max = Math.max(...pts.map(([, v]) => v)),
    min = Math.min(0, ...pts.map(([, v]) => v))
  const X = (i) => (i / (values.length - 1)) * (w - 4) + 2
  const Y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6)
  const d = pts
    .map(([i, v], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)
    .join('')
  const color = token(colorToken)
  el(
    'path',
    {
      d: `${d}L${X(pts.at(-1)[0])},${h}L${X(pts[0][0])},${h}Z`,
      fill: mix(color, token('--bg'), 0.88),
    },
    svgNode
  )
  el(
    'path',
    {
      d,
      fill: 'none',
      stroke: color,
      'stroke-width': 1.75,
      'stroke-linejoin': 'round',
    },
    svgNode
  )
  const [li, lv] = pts.at(-1)
  el('circle', { cx: X(li), cy: Y(lv), r: 2.5, fill: color }, svgNode)
  // Invisible hit columns so each season is inspectable.
  values.forEach((v, i) => {
    const r = el(
      'rect',
      {
        x: X(i) - w / values.length / 2,
        y: 0,
        width: w / values.length,
        height: h,
        fill: 'transparent',
      },
      svgNode
    )
    hover(r, labels[i] ?? String(i), () => [['Value', format(v)]])
  })
}

// ---- Avalanche rose: aspect x elevation ---------------------------------------------------
// Convention from CAIC forecasts: centre ring = above treeline, outer ring = below treeline.
export function rose(
  container,
  rows,
  {
    metric = 'avalanches',
    selected = {},
    onPick,
    size,
    rings = ['Above treeline', 'Near treeline', 'Below treeline'],
  } = {}
) {
  const { svg, w, h } = freshSvg(container, size)
  const cx = w / 2,
    cy = h / 2,
    R = Math.min(w, h) / 2 - px('--sp-5')
  const step = 0.86 / rings.length
  const ring = (i) => [R * (0.14 + i * step), R * (0.14 + (i + 1) * step)]
  const byKey = new Map(
    rows.map((r) => [`${r.slope_aspect}|${r.elevation}`, r])
  )
  const max = Math.max(1, ...rows.map((r) => r.avalanches || 0))
  const maxFatal = Math.max(1, ...rows.map((r) => r.fatal_reports || 0))
  const ramp = seqRamp()
  const aspects = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  // Outlines are drawn as overlays after every petal: a stroke on the petal itself is painted over
  // by the neighbours drawn after it, and the browser's focus ring traces the bounding box.
  const cells = el('g', {}, svg)
  const selLayer = el('g', { 'pointer-events': 'none' }, svg)
  const hoverRing = el(
    'path',
    { class: 'rose-ring hover', fill: 'none', 'pointer-events': 'none', visibility: 'hidden' },
    svg
  )
  const showRing = (d) => {
    hoverRing.setAttribute('d', d)
    hoverRing.setAttribute('visibility', 'visible')
  }
  const hideRing = () => hoverRing.setAttribute('visibility', 'hidden')
  const arc = (r0, r1, a0, a1) => {
    const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)]
    const [x0, y0] = p(r1, a0),
      [x1, y1] = p(r1, a1),
      [x2, y2] = p(r0, a1),
      [x3, y3] = p(r0, a0)
    return `M${x0},${y0}A${r1},${r1} 0 0 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 0 0 ${x3},${y3}Z`
  }
  aspects.forEach((asp, ai) => {
    const a0 = ((ai * 45 - 22.5) * Math.PI) / 180,
      a1 = ((ai * 45 + 22.5) * Math.PI) / 180
    rings.forEach((elev, ei) => {
      const r = byKey.get(`${asp}|${elev}`)
      const v = (metric === 'fatal' ? r?.reports : r?.avalanches) ?? 0
      const fill =
        metric === 'fatal'
          ? r
            ? r.fatal_reports
              ? mix(token('--people-soft'), token('--people'), Math.min(1, r.fatal_reports / maxFatal))
              : token('--seq-1')
            : token('--sunken')
          : metric === 'human'
          ? r && r.pct_human_triggered != null
            ? mix(
                token('--surface-2'),
                token('--human'),
                Math.min(1, r.pct_human_triggered / 0.5)
              )
            : token('--sunken')
          : rampColor(ramp, v, max)
      const [r0, r1] = ring(ei)
      const isSel =
        (selected.aspect === asp || !selected.aspect) &&
        (selected.elevation === elev || !selected.elevation) &&
        (selected.aspect || selected.elevation)
      const d = arc(r0, r1, a0, a1)
      const path = el(
        'path',
        { d, fill, stroke: token('--surface'), 'stroke-width': 1.5, class: 'rose-cell' },
        cells
      )
      path.style.outline = 'none' // focus shows as the overlay ring, never the box around the petal
      if (isSel) {
        el('path', { d, class: 'rose-ring selected', fill: 'none' }, selLayer)
      }
      path.addEventListener('mouseenter', () => showRing(d))
      path.addEventListener('mouseleave', hideRing)
      path.addEventListener('focus', () => showRing(d))
      path.addEventListener('blur', hideRing)
      hover(path, rings.length > 1 ? `${asp}, ${elev.toLowerCase()}` : `${asp} aspect`, () => metric === 'fatal' ? [
        ['Accident reports', fmtInt(r?.reports ?? 0)],
        ['Fatal', fmtInt(r?.fatal_reports ?? 0)],
      ] : [
        ['Avalanches', fmtInt(v)],
        [
          'Human-triggered',
          r
            ? `${fmtInt(r.human_triggered_avalanches)} (${fmtPct(r.pct_human_triggered)})`
            : '—',
        ],
        ['People involved (obs.)', fmtInt(r?.incident_observations ?? 0)],
      ])
      if (onPick) {
        keyClick(path, () => onPick(asp, elev), `${asp} ${elev}`)
      }
    })
    const [lx, ly] = [
      cx + (R + px('--sp-3')) * Math.sin((ai * 45 * Math.PI) / 180),
      cy - (R + px('--sp-3')) * Math.cos((ai * 45 * Math.PI) / 180),
    ]
    el(
      'text',
      {
        x: lx,
        y: ly,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        class: 'label-strong',
      },
      svg,
      asp
    )
  })
}

// ---- Season calendar: season rows x week columns -----------------------------------------
export function calendar(container, rows, { seasons, selected, onPick } = {}) {
  const WEEKS = 40 // Oct 1 to early July
  const labelW = 64,
    totalW = 56,
    top = 20
  const rowH = Math.max(
    12,
    Math.min(
      22,
      (container.clientHeight - top - 4) / Math.max(1, seasons.length)
    )
  )
  const { svg, w } = freshSvg(container, top + rowH * seasons.length + 4)
  const cellW = (w - labelW - totalW) / WEEKS
  const max = Math.max(1, ...rows.map((r) => r.avalanches || 0))
  const ramp = seqRamp()
  const bySeason = new Map()
  for (const r of rows) {
    if (!bySeason.has(r.season)) {
      bySeason.set(r.season, new Map())
    }
    bySeason.get(r.season).set(r.season_week, r)
  }
  for (const t of monthTicks()) {
    if (t.week >= WEEKS) {
      continue
    }
    el('text', { x: labelW + t.week * cellW, y: 12 }, svg, t.label)
  }
  const totals = seasons.map((s) =>
    [...(bySeason.get(s)?.values() ?? [])].reduce((a, r) => a + r.avalanches, 0)
  )
  const maxTotal = Math.max(1, ...totals)
  seasons.forEach((s, si) => {
    const y = top + si * rowH
    const g = el('g', {}, svg)
    const isSel = selected.has(s)
    el(
      'text',
      {
        x: labelW - 8,
        y: y + rowH / 2,
        'text-anchor': 'end',
        'dominant-baseline': 'middle',
        class: isSel ? 'label-strong' : null,
      },
      g,
      seasonLabel(s)
    )
    for (let wk = 0; wk < WEEKS; wk++) {
      const r = bySeason.get(s)?.get(wk)
      const c = el(
        'rect',
        {
          x: labelW + wk * cellW,
          y: y + 1,
          width: Math.max(1, cellW - 1),
          height: rowH - 2,
          rx: 1.5,
          fill: r ? rampColor(ramp, r.avalanches, max) : token('--surface-2'),
        },
        g
      )
      if (r) {
        hover(c, `${seasonLabel(s)} · week of ${weekLabel(wk)}`, () => [
          ['Avalanches', fmtInt(r.avalanches)],
          ['D3+', fmtInt(r.large_avalanches)],
          ['People involved (obs.)', fmtInt(r.incident_observations)],
        ])
      }
    }
    const tw = (totals[si] / maxTotal) * (totalW - 12)
    el(
      'rect',
      {
        x: w - totalW + 6,
        y: y + rowH * 0.25,
        width: tw,
        height: rowH * 0.5,
        rx: 1,
        fill: token('--text-soft'),
      },
      g
    )
    const hit = el(
      'rect',
      { x: 0, y, width: labelW, height: rowH, fill: 'transparent' },
      g
    )
    hover(hit, seasonLabel(s), () => [
      ['Avalanches in season', fmtInt(totals[si])],
      ['Click', 'filter to this season'],
    ])
    keyClick(hit, () => onPick?.(s), `Season ${seasonLabel(s)}`)
    if (isSel) {
      el(
        'rect',
        {
          x: labelW - 2,
          y,
          width: WEEKS * cellW + 2,
          height: rowH,
          fill: 'none',
          stroke: token('--text-strong'),
          'stroke-width': 1.5,
          rx: 2,
        },
        g
      )
    }
  })
}

// ---- Map: zone outlines + gridded observation density -------------------------------------
const CO_BOUNDS = [-109.06, 36.99, -102.04, 41.0]
export function zoneMap(container, geo, rows, { selectedZone, onZone } = {}) {
  const { svg, w, h } = freshSvg(container)
  const proj = makeProjection([-109.1, 36.95, -104.6, 41.05], w, h, 12) // mountains only: east plains cropped
  const co = [
    [CO_BOUNDS[0], CO_BOUNDS[1]],
    [CO_BOUNDS[2], CO_BOUNDS[1]],
    [CO_BOUNDS[2], CO_BOUNDS[3]],
    [CO_BOUNDS[0], CO_BOUNDS[3]],
  ].map(proj)
  el(
    'path',
    {
      d: `M${co.map((p) => p.join(',')).join('L')}Z`,
      fill: token('--surface-2'),
      stroke: token('--border-strong'),
    },
    svg
  )
  const ringPath = (ring) =>
    `M${ring
      .map((c) =>
        proj(c)
          .map((v) => v.toFixed(1))
          .join(',')
      )
      .join('L')}Z`
  for (const f of geo?.features ?? []) {
    const polys =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry.coordinates
    const d = polys.map((p) => p.map(ringPath).join('')).join('')
    const isSel = selectedZone === f.properties.zone
    const p = el(
      'path',
      {
        d,
        fill: isSel ? token('--human-soft') : token('--surface'),
        stroke: isSel ? token('--text-strong') : token('--border-strong'),
        'stroke-width': isSel ? 2 : 1,
        'fill-rule': 'evenodd',
      },
      svg
    )
    hover(p, f.properties.zone, () => [
      ['Click', isSel ? 'clear zone filter' : 'filter to this zone'],
    ])
    keyClick(p, () => onZone?.(f.properties.zone), f.properties.zone)
  }
  const max = Math.max(1, ...rows.map((r) => r.avalanches))
  const maxR = px('--sp-4')
  const sorted = [...rows].sort((a, b) => b.avalanches - a.avalanches)
  for (const r of sorted) {
    const [x, y] = proj([r.lon, r.lat])
    if (x < 0 || x > w || y < 0 || y > h) {
      continue
    }
    const share = r.avalanches ? r.human_triggered_avalanches / r.avalanches : 0
    const R = Math.max(1.5, Math.sqrt(r.avalanches / max) * maxR)
    // Area-true: outer disk = all avalanches, inner orange disk = the human-triggered ones.
    const c = el(
      'circle',
      {
        cx: x,
        cy: y,
        r: R,
        fill: token('--natural'),
        'fill-opacity': 0.55,
        stroke: token('--surface'),
        'stroke-width': 0.5,
      },
      svg
    )
    if (r.human_triggered_avalanches > 0) {
      el(
        'circle',
        {
          cx: x,
          cy: y,
          r: R * Math.sqrt(share),
          fill: token('--human'),
          'pointer-events': 'none',
        },
        svg
      )
    }
    if (r.incident_observations > 0) {
      el(
        'circle',
        {
          cx: x,
          cy: y,
          r: 1.5,
          fill: token('--people'),
          'pointer-events': 'none',
        },
        svg
      )
    }
    hover(c, `${r.lat.toFixed(2)}°N, ${Math.abs(r.lon).toFixed(2)}°W`, () => [
      ['Avalanches', fmtInt(r.avalanches)],
      ['Human-triggered', fmtPct(share)],
      ['People involved (obs.)', fmtInt(r.incident_observations)],
      ['Largest', r.max_d ? `D${r.max_d}` : '—'],
    ])
  }
}

// ---- Generic heatmap: rows x columns ------------------------------------------------------
export function heatmap(
  container,
  {
    rowKeys,
    colKeys,
    colLabel = String,
    value,
    detail,
    rowTotals = true,
    selectedRow,
    onRow,
    colorStops,
  }
) {
  const labelW = Math.min(150, container.clientWidth * 0.32),
    top = 18,
    totalW = rowTotals ? 52 : 0
  const rowH = Math.max(
    18,
    Math.min(30, (container.clientHeight - top) / Math.max(1, rowKeys.length))
  )
  const { svg, w } = freshSvg(container, top + rowH * rowKeys.length + 2)
  const cellW = (w - labelW - totalW) / colKeys.length
  const vals = rowKeys.flatMap((r) => colKeys.map((c) => value(r, c) ?? 0))
  const max = Math.max(1, ...vals)
  const stops = colorStops ?? seqRamp()
  colKeys.forEach((c, ci) =>
    el(
      'text',
      { x: labelW + ci * cellW + cellW / 2, y: 12, 'text-anchor': 'middle' },
      svg,
      colLabel(c)
    )
  )
  rowKeys.forEach((rk, ri) => {
    const y = top + ri * rowH
    const total = colKeys.reduce((a, c) => a + (value(rk, c) ?? 0), 0)
    const isSel = selectedRow === rk
    const label = el(
      'text',
      {
        x: labelW - 8,
        y: y + rowH / 2,
        'text-anchor': 'end',
        'dominant-baseline': 'middle',
        class: isSel ? 'label-strong' : null,
      },
      svg,
      rk
    )
    colKeys.forEach((c, ci) => {
      const v = value(rk, c) ?? 0
      const cell = el(
        'rect',
        {
          x: labelW + ci * cellW,
          y: y + 1,
          width: Math.max(1, cellW - 2),
          height: rowH - 2,
          rx: 2,
          fill: v ? rampColor(stops, v, max) : token('--surface-2'),
        },
        svg
      )
      hover(cell, `${rk} · ${colLabel(c)}`, () => detail(rk, c, v, total))
    })
    if (rowTotals) {
      el(
        'text',
        {
          x: w - 4,
          y: y + rowH / 2,
          'text-anchor': 'end',
          'dominant-baseline': 'middle',
        },
        svg,
        fmtInt(total)
      )
    }
    if (onRow) {
      const hit = el(
        'rect',
        { x: 0, y, width: labelW, height: rowH, fill: 'transparent' },
        svg
      )
      keyClick(hit, () => onRow(rk), rk)
      hover(hit, rk, () => [
        ['Click', isSel ? 'clear filter' : 'filter to this'],
      ])
    }
    if (isSel) {
      el(
        'rect',
        {
          x: labelW - 2,
          y,
          width: colKeys.length * cellW + 2,
          height: rowH,
          fill: 'none',
          stroke: token('--text-strong'),
          'stroke-width': 1.5,
          rx: 2,
        },
        svg
      )
    }
    void label
  })
}

// ---- Chart.js wrappers ---------------------------------------------------------------------
function baseOptions() {
  const tick = token('--tick'),
    grid = token('--grid')
  const font = { family: token('--font-ui'), size: px('--fs-xs') }
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: Number.parseInt(token('--dur-base')) || 0 },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: tick, font },
        border: { color: grid },
      },
      y: {
        grid: { color: grid },
        ticks: { color: tick, font },
        border: { display: false },
      },
    },
  }
}

function externalTip(titleFn, rowsFn) {
  return {
    enabled: false,
    external: ({ chart, tooltip }) => {
      if (!(tooltip.opacity && tooltip.dataPoints?.length)) {
        hideTip()
        return
      }
      const rect = chart.canvas.getBoundingClientRect()
      const dp = tooltip.dataPoints[0]
      showTip(
        {
          clientX: rect.left + tooltip.caretX,
          clientY: rect.top + tooltip.caretY,
        },
        titleFn(dp),
        rowsFn(dp)
      )
    },
  }
}

function canvasIn(container) {
  container.querySelectorAll('canvas, :scope > svg').forEach((n) => n.remove())
  const c = document.createElement('canvas')
  container.appendChild(c)
  return c
}

/** 100% stacked bars: trigger composition per season. `selected` trigger stays saturated. */
export function triggerMix(
  container,
  rows,
  { seasons, triggers, selected, onPick }
) {
  const totals = new Map(seasons.map((s) => [s, 0]))
  const cell = new Map()
  for (const r of rows) {
    totals.set(r.season, (totals.get(r.season) || 0) + r.avalanches)
    cell.set(`${r.season}|${r.trigger}`, r.avalanches)
  }
  const datasets = triggers.map((t) => ({
    label: t,
    data: seasons.map((s) => {
      const v = cell.get(`${s}|${t}`)
      const tot = totals.get(s)
      return v && tot ? (v / tot) * 100 : 0
    }),
    raw: seasons.map((s) => cell.get(`${s}|${t}`) ?? 0),
    backgroundColor:
      selected && selected !== t
        ? mix(triggerColor(t), token('--surface'), 0.7)
        : triggerColor(t),
    borderColor: token('--surface'),
    borderWidth: 1,
    barPercentage: 0.92,
    categoryPercentage: 0.95,
  }))
  const opts = baseOptions()
  opts.scales.x.stacked = true
  opts.scales.y.stacked = true
  opts.scales.y.max = 100
  opts.scales.y.ticks.callback = (v) => `${v}%`
  opts.plugins.tooltip = externalTip(
    (dp) => `${seasonLabel(seasons[dp.dataIndex])} · ${dp.dataset.label}`,
    (dp) => [
      ['Share of season', `${dp.raw.toFixed(1)}%`],
      ['Avalanches', fmtInt(dp.dataset.raw[dp.dataIndex])],
      ['Season total', fmtInt(totals.get(seasons[dp.dataIndex]))],
    ]
  )
  opts.onClick = (_e, els) => {
    if (els[0]) {
      onPick?.(triggers[els[0].datasetIndex])
    }
  }
  opts.onHover = (e, els) => {
    e.native.target.style.cursor = els.length ? 'pointer' : 'default'
  }
  return new Chart(canvasIn(container), {
    type: 'bar',
    data: {
      labels: seasons.map((s) => `'${String(s % 100).padStart(2, '0')}`),
      datasets,
    },
    options: opts,
  })
}

/** Paired distribution: share of each group's avalanches at each D size. Shares, not counts:
    natural avalanches outnumber human ones ~3:1, so counts would hide the shape. */
export function sizePairs(container, rows) {
  const sizes = [...new Set(rows.map((r) => r.d_size))].sort((a, b) => a - b)
  const groups = ['Human', 'Natural']
  const tot = Object.fromEntries(
    groups.map((g) => [
      g,
      rows
        .filter((r) => r.trigger_group === g)
        .reduce((a, r) => a + r.avalanches, 0),
    ])
  )
  const val = (g, s) =>
    rows.find((r) => r.trigger_group === g && r.d_size === s)?.avalanches ?? 0
  const datasets = groups.map((g) => ({
    label: g,
    data: sizes.map((s) => (tot[g] ? (val(g, s) / tot[g]) * 100 : null)),
    raw: sizes.map((s) => val(g, s)),
    backgroundColor: g === 'Human' ? token('--human') : token('--natural'),
    borderRadius: { topLeft: 4, topRight: 4 },
    maxBarThickness: 24,
    barPercentage: 0.9,
    categoryPercentage: 0.8,
  }))
  const opts = baseOptions()
  opts.scales.y.ticks.callback = (v) => `${v}%`
  opts.plugins.tooltip = externalTip(
    (dp) => `D${sizes[dp.dataIndex]} · ${dp.dataset.label}-triggered`,
    (dp) => [
      ['Share of group', `${(dp.raw ?? 0).toFixed(1)}%`],
      ['Avalanches', fmtInt(dp.dataset.raw[dp.dataIndex])],
      ['Group total', fmtInt(tot[dp.dataset.label])],
    ]
  )
  return new Chart(canvasIn(container), {
    type: 'bar',
    data: { labels: sizes.map((s) => `D${s}`), datasets },
    options: opts,
  })
}

/** Simple bars per season (drawer), human portion stacked on natural+other. */
export function seasonBars(container, rows) {
  const opts = baseOptions()
  opts.scales.x.stacked = true
  opts.scales.y.stacked = true
  opts.plugins.tooltip = externalTip(
    (dp) => rows[dp.dataIndex].season_label,
    (dp) => [
      ['Avalanches', fmtInt(rows[dp.dataIndex].avalanches)],
      [
        'Human-triggered',
        fmtInt(rows[dp.dataIndex].human_triggered_avalanches),
      ],
    ]
  )
  return new Chart(canvasIn(container), {
    type: 'bar',
    data: {
      labels: rows.map((r) => `'${String(r.season % 100).padStart(2, '0')}`),
      datasets: [
        {
          label: 'Human',
          data: rows.map((r) => r.human_triggered_avalanches),
          backgroundColor: token('--human'),
          borderWidth: 0,
        },
        {
          label: 'Other',
          data: rows.map((r) => r.avalanches - r.human_triggered_avalanches),
          backgroundColor: token('--natural-soft'),
          borderWidth: 0,
        },
      ],
    },
    options: opts,
  })
}

/**
 * Bars for any small categorical breakdown. `series`: [{ label, data, color }]; one axis, one unit.
 * Stacked segments get a 2px surface gap; bar ends are rounded only at the data end.
 */
export function bars(
  container,
  { labels, series, stacked = false, horizontal = false, format = fmtInt, tipTitle, tipRows }
) {
  const opts = baseOptions()
  if (horizontal) {
    opts.indexAxis = 'y'
    const { x, y } = opts.scales
    opts.scales = { x: y, y: x }
  }
  const valueAxis = horizontal ? opts.scales.x : opts.scales.y
  valueAxis.ticks.callback = (v) => format(v)
  valueAxis.beginAtZero = true
  opts.scales.x.stacked = stacked
  opts.scales.y.stacked = stacked
  const last = series.length - 1
  const end = horizontal ? { topRight: 4, bottomRight: 4 } : { topLeft: 4, topRight: 4 }
  const datasets = series.map((sr, i) => ({
    label: sr.label,
    data: sr.data,
    backgroundColor: sr.color,
    borderColor: token('--surface'),
    borderWidth: stacked ? 1 : 0,
    borderSkipped: stacked ? false : 'start',
    borderRadius: !stacked || i === last ? end : 0,
    maxBarThickness: 24,
    categoryPercentage: stacked ? 0.8 : 0.7,
    barPercentage: 0.9,
  }))
  opts.plugins.tooltip = externalTip(
    (dp) => (tipTitle ? tipTitle(dp.dataIndex) : labels[dp.dataIndex]),
    (dp) =>
      tipRows
        ? tipRows(dp.dataIndex)
        : series.map((sr) => [sr.label, format(sr.data[dp.dataIndex])])
  )
  opts.interaction = { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' }
  return new Chart(canvasIn(container), {
    type: 'bar',
    data: { labels, datasets },
    options: opts,
  })
}

/** Danger-rating rows: the official rating colour as a numbered swatch beside its name, then people caught with the killed part in red. */
export function dangerRows(container, rows) {
  container.querySelectorAll(':scope > ul').forEach((n) => n.remove())
  const ul = document.createElement('ul')
  ul.className = 'danger-rows'
  const max = Math.max(1, ...rows.map((r) => r.people_caught || 0))
  for (const r of rows) {
    const li = document.createElement('li')
    const name = document.createElement('div')
    name.className = 'danger-name'
    const sw = document.createElement('span')
    sw.className = `danger-swatch d${r.danger_order}`
    sw.textContent = String(r.danger_order)
    sw.setAttribute('aria-hidden', 'true')
    const t = document.createElement('span')
    t.textContent = r.danger
    name.append(sw, t)
    const bar = document.createElement('div')
    bar.className = 'danger-bar'
    const killed = document.createElement('i')
    killed.className = 'killed'
    killed.style.width = `${((r.people_killed || 0) / max) * 100}%`
    const rest = document.createElement('i')
    rest.className = 'rest'
    rest.style.width = `${(((r.people_caught || 0) - (r.people_killed || 0)) / max) * 100}%`
    bar.append(killed, rest)
    const num = document.createElement('div')
    num.className = 'danger-num'
    const k = document.createElement('b')
    k.textContent = fmtInt(r.people_killed)
    num.append(k, document.createTextNode(` killed of ${fmtInt(r.people_caught)} caught`))
    li.append(name, bar, num)
    li.tabIndex = 0
    const title = `${r.danger} (${r.danger_order})`
    const rowsFn = () => [
      ['People killed', fmtInt(r.people_killed)],
      ['People caught', fmtInt(r.people_caught)],
      ['Reports', fmtInt(r.reports)],
      ['Reports with a death', fmtInt(r.fatal_accidents)],
    ]
    li.addEventListener('mousemove', (e) => showTip(e, title, rowsFn()))
    li.addEventListener('mouseleave', hideTip)
    li.addEventListener('focus', () => {
      const b = li.getBoundingClientRect()
      showTip({ clientX: b.left + b.width / 2, clientY: b.bottom }, title, rowsFn())
    })
    li.addEventListener('blur', hideTip)
    ul.appendChild(li)
  }
  container.appendChild(ul)
}

/**
 * One season day by day, as two charts on one date axis: the zone's SWE (a line) above, the
 * avalanches seen each day (columns) below. Two charts, never two y-scales on one.
 */
export function timeline(container, rows) {
  container.querySelectorAll(':scope > .chart-stack').forEach((n) => n.remove())
  const stack = document.createElement('div')
  stack.className = 'chart-stack'
  const top = document.createElement('div')
  top.className = 'stack-top'
  const bottom = document.createElement('div')
  bottom.className = 'stack-bottom'
  stack.append(top, bottom)
  container.appendChild(stack)
  const labels = rows.map((r) => String(r.snow_date).slice(0, 10))
  const monthTick = (i) => {
    const d = labels[i]
    return d?.endsWith('-01')
      ? new Date(`${d}T12:00:00`).toLocaleString('en-US', { month: 'short' })
      : ''
  }
  const fmtDay = (i) =>
    new Date(`${labels[i]}T12:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  const inches = (v, d = 1) => (v == null ? '—' : `${v.toFixed(d)} in`)
  const tipRows = (i) => [
    ['Snow water equivalent', inches(rows[i].avg_swe_in)],
    ['New SWE', inches(rows[i].total_new_swe_in, 2)],
    ['Snow depth', inches(rows[i].avg_depth_in, 0)],
    ['Avalanches seen', fmtInt(rows[i].avalanches)],
    ['Triggered by people', fmtInt(rows[i].human_triggered_avalanches)],
  ]
  const common = (o) => {
    o.scales.x.ticks.autoSkip = false
    o.scales.x.ticks.maxRotation = 0
    // Keep only month-start ticks: laying out ~270 daily ticks per chart was most of the draw time.
    o.scales.x.afterBuildTicks = (axis) => {
      axis.ticks = axis.ticks.filter((t) => labels[t.value]?.endsWith('-01'))
    }
    o.scales.x.ticks.callback = (v) => monthTick(v)
    o.interaction = { mode: 'index', intersect: false }
    o.plugins.tooltip = externalTip(
      (dp) => fmtDay(dp.dataIndex),
      (dp) => tipRows(dp.dataIndex)
    )
    o.animation = false
    o.layout = { padding: { left: 0 } }
    o.scales.y.afterFit = (axis) => {
      axis.width = 48 // same gutter on both charts so the dates line up
    }
    return o
  }
  const o1 = common(baseOptions())
  o1.scales.x.ticks.display = false
  o1.scales.y.ticks.callback = (v) => `${v} in`
  o1.scales.y.beginAtZero = true
  const natural = token('--natural')
  const c1 = new Chart(appendCanvas(top), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'SWE',
          data: rows.map((r) => r.avg_swe_in),
          borderColor: natural,
          backgroundColor: mix(natural, token('--surface'), 0.9),
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          spanGaps: true,
        },
      ],
    },
    options: o1,
  })
  const o2 = common(baseOptions())
  o2.scales.x.stacked = true
  o2.scales.y.stacked = true
  o2.scales.y.beginAtZero = true
  o2.scales.y.ticks.precision = 0
  const c2 = new Chart(appendCanvas(bottom), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Triggered by people',
          data: rows.map((r) => r.human_triggered_avalanches),
          backgroundColor: token('--human'),
          barPercentage: 1,
          categoryPercentage: 0.9,
        },
        {
          label: 'Other avalanches',
          data: rows.map((r) => r.avalanches - r.human_triggered_avalanches),
          backgroundColor: token('--seq-2'),
          barPercentage: 1,
          categoryPercentage: 0.9,
        },
      ],
    },
    options: o2,
  })
  return [c1, c2]
}

function appendCanvas(parent) {
  const c = document.createElement('canvas')
  parent.appendChild(c)
  return c
}
