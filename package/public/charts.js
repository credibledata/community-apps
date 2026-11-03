// Drawing. Plain SVG built with the DOM, no chart library. Every chart takes a container and
// plain data, sizes itself to the container's width, and wires its own tooltip and clicks.
// Colours come from format.js (probability ramp) and the CSS tokens in styles.css.

import { fmtDate, fmtMargin, fmtPct, probColor } from './format.js'
import { visibleBand } from './viewport.js'

const NS = 'http://www.w3.org/2000/svg'

export function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) {
      continue
    }
    if (k.startsWith('on')) {
      n.addEventListener(k.slice(2), v)
    } else {
      n.setAttribute(k, v)
    }
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) {
      n.append(c instanceof Node ? c : document.createTextNode(String(c)))
    }
  }
  return n
}

function frame(container, height, { minWidth = 280 } = {}) {
  container.replaceChildren()
  const width = Math.max(minWidth, container.clientWidth || 600)
  const svg = s('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height,
    role: 'img',
  })
  container.append(svg)
  return { svg, width, height }
}

const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

// ---- Tooltip -------------------------------------------------------------------------------
let tipEl = null
export function tip(evt, html) {
  if (!tipEl) {
    tipEl = document.createElement('div')
    tipEl.className = 'tooltip'
    document.body.append(tipEl)
  }
  tipEl.innerHTML = html
  tipEl.hidden = false
  const pad = 14
  const W = window.innerWidth
  const { top, height } = visibleBand()
  const r = tipEl.getBoundingClientRect()
  let x = evt.clientX + pad
  let y = evt.clientY + pad
  if (x + r.width > W - 8) {
    x = evt.clientX - r.width - pad
  }
  if (y + r.height > top + height - 8) {
    y = evt.clientY - r.height - pad
  }
  tipEl.style.transform = `translate(${x}px, ${y}px)`
}
export function untip() {
  if (tipEl) {
    tipEl.hidden = true
  }
}
const hover = (html) => ({
  onmousemove: (e) => tip(e, typeof html === 'function' ? html() : html),
  onmouseleave: untip,
})

// ---- Scales --------------------------------------------------------------------------------
export function linear([d0, d1], [r0, r1]) {
  const k = (r1 - r0) / (d1 - d0 || 1)
  return (x) => r0 + (x - d0) * k
}

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= count) || mag * 10
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    out.push(Math.round(v * 1e6) / 1e6)
  }
  return out
}

// ---- US map --------------------------------------------------------------------------------
/**
 * Geographic state map. `fill(abbr)` returns a colour or null (no race: drawn muted).
 * Small northeastern states get labelled call-out boxes so they stay clickable.
 */
export function usMap(container, geo, { fill, title, onClick, selected, label }) {
  container.replaceChildren()
  const svg = s('svg', {
    viewBox: `0 0 ${geo.width} ${geo.height}`,
    width: '100%',
    class: 'usmap',
    role: 'img',
  })
  const muted = css('--no-race') || '#e7e3dc'
  const g = s('g')
  for (const [abbr, st] of Object.entries(geo.states)) {
    const f = fill(abbr)
    const active = f !== null
    const path = s('path', {
      d: st.d,
      fill: active ? f : muted,
      class: `state${active ? ' active' : ''}${selected === abbr ? ' selected' : ''}`,
      'data-state': abbr,
      tabindex: active ? 0 : null,
      'aria-label': title ? title(abbr).replace(/<[^>]+>/g, ' ') : abbr,
      ...hover(() => (title ? title(abbr) : st.name)),
      onclick: active && onClick ? () => onClick(abbr) : null,
      onkeydown:
        active && onClick
          ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick(abbr)
          : null,
    })
    g.append(path)
  }
  g.append(s('path', { d: geo.borders, class: 'borders' }))
  svg.append(g)

  // Labels on states big enough to hold them.
  const SMALL = ['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD', 'DC', 'HI']
  const labels = s('g', { class: 'map-labels' })
  for (const [abbr, st] of Object.entries(geo.states)) {
    if (SMALL.includes(abbr) || fill(abbr) === null) {
      continue
    }
    labels.append(
      s(
        'text',
        { x: st.cx, y: st.cy + 4, class: 'map-label', fill: label?.(abbr) || '#1d1b18' },
        abbr
      )
    )
  }
  svg.append(labels)

  // Call-outs for the small states.
  const callouts = s('g', { class: 'callouts' })
  const CALL = ['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD']
  CALL.forEach((abbr, i) => {
    const st = geo.states[abbr]
    const f = fill(abbr)
    const x = 905
    const y = 120 + i * 26
    callouts.append(
      s('line', { x1: st.cx, y1: st.cy, x2: x - 2, y2: y + 9, class: 'callout-line' }),
      s('rect', {
        x,
        y,
        width: 34,
        height: 18,
        rx: 3,
        fill: f ?? muted,
        class: `callout${f !== null ? ' active' : ''}${selected === abbr ? ' selected' : ''}`,
        ...hover(() => (title ? title(abbr) : st.name)),
        onclick: f !== null && onClick ? () => onClick(abbr) : null,
      }),
      s(
        'text',
        { x: x + 17, y: y + 13, class: 'map-label small', fill: f !== null ? label?.(abbr) || '#1d1b18' : '#8a837a' },
        abbr
      )
    )
  })
  svg.append(callouts)
  container.append(svg)
  return svg
}

// ---- Balance of power ----------------------------------------------------------------------
/** Horizontal stacked bar of seats with the majority line. */
export function balanceBar(container, { segments, total, threshold, thresholdLabel }) {
  const h = 58
  const { svg, width } = frame(container, h)
  const x = linear([0, total], [0, width])
  let acc = 0
  for (const seg of segments) {
    if (seg.value <= 0) {
      continue
    }
    const w = x(seg.value)
    svg.append(
      s('rect', {
        x: x(acc),
        y: 18,
        width: Math.max(0, w - 1),
        height: 24,
        fill: seg.color,
        class: seg.hatch ? 'hatch' : null,
        ...hover(`<b>${seg.label}</b><br>${seg.value.toFixed(seg.value % 1 ? 1 : 0)} seats`),
      })
    )
    if (w > 34) {
      svg.append(
        s(
          'text',
          { x: x(acc) + w / 2, y: 35, class: 'bar-label', fill: seg.ink || '#fff' },
          Math.round(seg.value)
        )
      )
    }
    acc += seg.value
  }
  const tx = x(threshold)
  svg.append(
    s('line', { x1: tx, x2: tx, y1: 12, y2: 48, class: 'threshold' }),
    s('text', { x: tx, y: 9, class: 'threshold-label', 'text-anchor': 'middle' }, thresholdLabel || `${threshold} for control`)
  )
}

// ---- Seat distribution ---------------------------------------------------------------------
/** Histogram of Democratic seats across simulations, coloured by who controls. */
export function seatHistogram(container, { hist, threshold, current, label = 'Democratic seats' }) {
  const h = 190
  const { svg, width } = frame(container, h)
  const total = hist.reduce((a, b) => a + b, 0) || 1
  let lo = hist.findIndex((v) => v > 0)
  let hi = hist.length - 1 - [...hist].reverse().findIndex((v) => v > 0)
  lo = Math.max(0, Math.min(lo, threshold - 3) - 2)
  hi = Math.min(hist.length - 1, Math.max(hi, threshold + 3) + 2)
  const m = { l: 34, r: 10, t: 14, b: 30 }
  const x = linear([lo - 0.5, hi + 0.5], [m.l, width - m.r])
  const maxV = Math.max(...hist.slice(lo, hi + 1)) / total
  const y = linear([0, maxV * 1.08], [h - m.b, m.t])
  const bw = Math.max(1, x(1) - x(0) - (hi - lo > 80 ? 0 : 1))
  const blue = css('--dem') || '#2460ba'
  const red = css('--rep') || '#c8343a'
  for (let v = lo; v <= hi; v++) {
    const p = hist[v] / total
    if (p <= 0) {
      continue
    }
    svg.append(
      s('rect', {
        x: x(v) - bw / 2,
        y: y(p),
        width: bw,
        height: h - m.b - y(p),
        fill: v >= threshold ? blue : red,
        opacity: 0.88,
        ...hover(`<b>${v} ${label}</b><br>${fmtPct(p, 1)} of simulations`),
      })
    )
  }
  for (const t of niceTicks(0, maxV, 4)) {
    svg.append(
      s('line', { x1: m.l, x2: width - m.r, y1: y(t), y2: y(t), class: 'gridline' }),
      s('text', { x: m.l - 6, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, fmtPct(t))
    )
  }
  for (const t of niceTicks(lo, hi, 8).filter(Number.isInteger)) {
    svg.append(s('text', { x: x(t), y: h - m.b + 16, class: 'tick', 'text-anchor': 'middle' }, t))
  }
  svg.append(
    s('line', { x1: x(threshold - 0.5), x2: x(threshold - 0.5), y1: m.t - 6, y2: h - m.b, class: 'threshold' }),
    s('text', { x: x(threshold - 0.5) + 4, y: m.t + 2, class: 'threshold-label' }, `${threshold}+ = D control`)
  )
  if (current !== undefined) {
    svg.append(
      s('line', { x1: x(current), x2: x(current), y1: h - m.b, y2: h - m.b + 5, class: 'axis' }),
      s('text', { x: x(current), y: h - 2, class: 'tick strong', 'text-anchor': 'middle' }, `now ${current}`)
    )
  }
}

// ---- Snake: races ordered from safest D to safest R ----------------------------------------
/**
 * Each race is a cell sized by seats, ordered by forecast margin, with the majority mark at
 * the seat that clinches control. Wraps into rows for the House.
 */
export function snake(container, { items, startD, threshold, onClick, selected, rows = 1 }) {
  const total = items.length
  const perRow = Math.ceil(total / rows)
  const rowH = rows > 1 ? 26 : 44
  const h = rows * (rowH + 6) + 30
  const { svg, width } = frame(container, h)
  const m = { l: 4, r: 4 }
  const cw = (width - m.l - m.r) / perRow
  items.forEach((it, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    const xx = m.l + col * cw
    const yy = 18 + row * (rowH + 6)
    svg.append(
      s('rect', {
        x: xx,
        y: yy,
        width: Math.max(1, cw - (cw > 6 ? 1.5 : 0.5)),
        height: rowH,
        fill: probColor(it.p),
        class: `cell${selected === it.id ? ' selected' : ''}`,
        ...hover(it.tip),
        onclick: onClick ? () => onClick(it.id) : null,
      })
    )
    if (cw > 22 && rows === 1) {
      svg.append(
        s('text', { x: xx + cw / 2, y: yy + rowH / 2 + 4, class: 'cell-label', fill: it.p > 0.8 || it.p < 0.2 ? '#fff' : '#1d1b18' }, it.short)
      )
    }
  })
  // Majority mark: Democrats need (threshold - startD) of these races.
  const need = threshold - startD
  if (need > 0 && need <= total) {
    const i = need - 1
    const row = Math.floor(i / perRow)
    const col = (i % perRow) + 1
    const xx = m.l + col * cw - 0.75
    const yy = 18 + row * (rowH + 6)
    svg.append(
      s('line', { x1: xx, x2: xx, y1: yy - 6, y2: yy + rowH + 4, class: 'threshold' }),
      s('text', { x: xx, y: yy - 8, class: 'threshold-label', 'text-anchor': xx > width - 120 ? 'end' : 'middle' }, `${threshold}th seat`)
    )
  }
  svg.append(
    s('text', { x: m.l, y: h - 4, class: 'tick' }, '← Safest Democratic'),
    s('text', { x: width - m.r, y: h - 4, class: 'tick', 'text-anchor': 'end' }, 'Safest Republican →')
  )
}

// ---- Line chart ----------------------------------------------------------------------------
/** Multi-series time chart. Points are { t: epoch ms, v }. */
export function lineChart(
  container,
  { series, yDomain = [0, 1], yFormat = (v) => fmtPct(v), height = 220, refY = null, refLabel = '', bands = [] }
) {
  const { svg, width, height: h } = frame(container, height)
  const m = { l: 42, r: 54, t: 12, b: 26 }
  const all = series.flatMap((se) => se.points)
  if (!all.length) {
    return
  }
  const t0 = Math.min(...all.map((p) => p.t))
  const t1 = Math.max(...all.map((p) => p.t))
  const x = linear([t0, t1], [m.l, width - m.r])
  const y = linear(yDomain, [h - m.b, m.t])
  for (const b of bands) {
    svg.append(s('rect', { x: m.l, width: width - m.l - m.r, y: y(b.to), height: y(b.from) - y(b.to), fill: b.fill }))
  }
  for (const t of niceTicks(yDomain[0], yDomain[1], 4)) {
    svg.append(
      s('line', { x1: m.l, x2: width - m.r, y1: y(t), y2: y(t), class: 'gridline' }),
      s('text', { x: m.l - 6, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, yFormat(t))
    )
  }
  if (refY !== null) {
    svg.append(
      s('line', { x1: m.l, x2: width - m.r, y1: y(refY), y2: y(refY), class: 'ref' }),
      refLabel ? s('text', { x: m.l + 4, y: y(refY) - 4, class: 'tick' }, refLabel) : null
    )
  }
  const months = []
  for (let d = new Date(t0); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    months.push(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  }
  // Thin month labels to fit; on a multi-year axis, name the year wherever it changes.
  const every = Math.max(1, Math.ceil(34 / ((width - m.l - m.r) / Math.max(1, months.length))))
  const multiYear = new Date(t0).getUTCFullYear() !== new Date(t1).getUTCFullYear()
  let lastYear = null
  months
    .filter((mt) => mt >= t0)
    .forEach((mt, i) => {
      if (i % every) {
        return
      }
      const year = new Date(mt).getUTCFullYear()
      const label = multiYear && year !== lastYear ? fmtDate(mt, { month: 'short', year: '2-digit' }) : fmtDate(mt, { month: 'short' })
      lastYear = year
      svg.append(s('text', { x: x(mt), y: h - 8, class: 'tick', 'text-anchor': 'middle' }, label))
    })
  for (const se of series) {
    const pts = se.points.filter((p) => Number.isFinite(p.v))
    if (!pts.length) {
      continue
    }
    if (se.dots) {
      for (const p of pts) {
        svg.append(
          s('circle', {
            cx: x(p.t),
            cy: y(Math.max(yDomain[0], Math.min(yDomain[1], p.v))),
            r: p.r ?? 2.5,
            fill: se.color,
            opacity: p.opacity ?? 0.35,
            ...(p.tip ? hover(p.tip) : {}),
          })
        )
      }
      continue
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
    svg.append(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': se.width ?? 2.25, 'stroke-dasharray': se.dash || null }))
    const last = pts.at(-1)
    svg.append(
      s('circle', { cx: x(last.t), cy: y(last.v), r: 3.5, fill: se.color }),
      s('text', { x: x(last.t) + 6, y: y(last.v) + 4, class: 'end-label', fill: se.color }, yFormat(last.v))
    )
  }
  // Crosshair readout.
  const cross = s('line', { y1: m.t, y2: h - m.b, class: 'crosshair', visibility: 'hidden' })
  svg.append(cross)
  svg.append(
    s('rect', {
      x: m.l,
      y: m.t,
      width: width - m.l - m.r,
      height: h - m.t - m.b,
      fill: 'transparent',
      onmousemove: (e) => {
        const r = svg.getBoundingClientRect()
        const px = ((e.clientX - r.left) / r.width) * width
        const t = t0 + ((px - m.l) / (width - m.l - m.r)) * (t1 - t0)
        cross.setAttribute('x1', px)
        cross.setAttribute('x2', px)
        cross.setAttribute('visibility', 'visible')
        const rows = series
          .filter((se) => !se.dots)
          .map((se) => {
            let best = null
            for (const p of se.points) {
              if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) {
                best = p
              }
            }
            return best ? `<span style="color:${se.color}">●</span> ${se.name}: <b>${yFormat(best.v)}</b>` : ''
          })
        tip(e, `<b>${fmtDate(t, { month: 'short', day: 'numeric' })}</b><br>${rows.join('<br>')}`)
      },
      onmouseleave: () => {
        cross.setAttribute('visibility', 'hidden')
        untip()
      },
    })
  )
}

// ---- Waterfall -----------------------------------------------------------------------------
/**
 * Steps: { label, value, total?: true, note }. Deltas float from the running sum; totals
 * drop to zero. Values are D-minus-R margins, so bars right of zero are blue.
 */
export function waterfall(container, steps) {
  const rowH = 26
  const h = steps.length * rowH + 30
  const { svg, width } = frame(container, h)
  const m = { l: 150, r: 64, t: 6, b: 22 }
  let run = 0
  const spans = steps.map((st) => {
    if (st.total) {
      run = st.value
      return [0, st.value]
    }
    const a = run
    run += st.value
    return [a, run]
  })
  const ext = Math.max(4, ...spans.flat().map(Math.abs)) * 1.1
  const x = linear([-ext, ext], [m.l, width - m.r])
  const blue = css('--dem') || '#2460ba'
  const red = css('--rep') || '#c8343a'
  for (const t of niceTicks(-ext, ext, 6)) {
    svg.append(
      s('line', { x1: x(t), x2: x(t), y1: m.t, y2: h - m.b, class: t === 0 ? 'axis' : 'gridline' }),
      s('text', { x: x(t), y: h - 6, class: 'tick', 'text-anchor': 'middle' }, t === 0 ? 'EVEN' : fmtMargin(t, 0))
    )
  }
  steps.forEach((st, i) => {
    const [a, b] = spans[i]
    const yy = m.t + i * rowH
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const color = st.total ? (b >= 0 ? blue : red) : st.value >= 0 ? blue : red
    svg.append(
      s('text', { x: m.l - 8, y: yy + rowH / 2 + 4, class: `wf-label${st.total ? ' total' : ''}`, 'text-anchor': 'end' }, st.label),
      s('rect', {
        x: x(lo),
        y: yy + 5,
        width: Math.max(1.5, x(hi) - x(lo)),
        height: rowH - 10,
        fill: color,
        opacity: st.total ? 1 : 0.55,
        rx: 2,
        ...hover(`<b>${st.label}</b><br>${st.total ? fmtMargin(st.value) : (st.value >= 0 ? '+' : '') + st.value.toFixed(1) + ' pts'}${st.note ? `<br><span class="muted">${st.note}</span>` : ''}`),
      }),
      s('text', { x: width - m.r + 6, y: yy + rowH / 2 + 4, class: `wf-value${st.total ? ' total' : ''}` }, st.total ? fmtMargin(st.value) : `${st.value >= 0 ? '+' : '−'}${Math.abs(st.value).toFixed(1)}`)
    )
    if (i < steps.length - 1 && !steps[i + 1].total) {
      svg.append(s('line', { x1: x(b), x2: x(b), y1: yy + rowH - 5, y2: yy + rowH + 5, class: 'connector' }))
    }
  })
}

// ---- Blend bar -----------------------------------------------------------------------------
/** How the expected margin is assembled: weight x signal per input. */
export function blendBar(container, parts) {
  container.replaceChildren()
  const bar = document.createElement('div')
  bar.className = 'blend'
  for (const p of parts) {
    if (p.weight <= 0.001) {
      continue
    }
    const seg = document.createElement('div')
    seg.className = `blend-seg ${p.key}`
    seg.style.flex = `${p.weight} 0 0`
    seg.innerHTML = `<span>${p.label}</span><b>${fmtPct(p.weight)}</b>`
    seg.addEventListener('mousemove', (e) =>
      tip(e, `<b>${p.label}</b>: ${fmtPct(p.weight)} of the blend<br>Signal: ${fmtMargin(p.value)}${p.note ? `<br><span class="muted">${p.note}</span>` : ''}`)
    )
    seg.addEventListener('mouseleave', untip)
    bar.append(seg)
  }
  container.append(bar)
}

// ---- Margin distribution -------------------------------------------------------------------
export function marginHistogram(container, { hist, min, p10, p90, mean }) {
  const h = 150
  const { svg, width } = frame(container, h)
  const m = { l: 10, r: 10, t: 16, b: 26 }
  const n = hist.length
  const total = hist.reduce((a, b) => a + b, 0) || 1
  const x = linear([min - 0.5, min + n - 0.5], [m.l, width - m.r])
  const maxV = Math.max(...hist) / total
  const y = linear([0, maxV * 1.1], [h - m.b, m.t])
  const blue = css('--dem') || '#2460ba'
  const red = css('--rep') || '#c8343a'
  hist.forEach((c, i) => {
    const v = min + i
    const p = c / total
    if (p <= 0) {
      return
    }
    svg.append(
      s('rect', {
        x: x(v - 0.5) + 0.5,
        y: y(p),
        width: Math.max(1, x(1) - x(0) - 1),
        height: h - m.b - y(p),
        fill: v > 0 ? blue : v < 0 ? red : '#b9b2a6',
        opacity: v >= p10 && v <= p90 ? 0.95 : 0.45,
        ...hover(`<b>${v === min ? '≤ ' : v === min + n - 1 ? '≥ ' : ''}${fmtMargin(v, 0)}</b><br>${fmtPct(p, 1)} of simulations`),
      })
    )
  })
  for (const t of [-30, -20, -10, 0, 10, 20, 30]) {
    svg.append(s('text', { x: x(t), y: h - 8, class: 'tick', 'text-anchor': 'middle' }, t === 0 ? 'EVEN' : fmtMargin(t, 0)))
  }
  svg.append(
    s('line', { x1: x(mean), x2: x(mean), y1: m.t - 8, y2: h - m.b, class: 'threshold' }),
    s('text', { x: x(mean), y: m.t - 9 + 8, class: 'threshold-label', 'text-anchor': 'middle', dy: -2 }, `avg ${fmtMargin(mean)}`)
  )
}

// ---- Tornado (sensitivity) ----------------------------------------------------------------
export function tornado(container, rows, { labels, fmtStep }) {
  const rowH = 30
  const h = rows.length * rowH + 30
  const { svg, width } = frame(container, h)
  const m = { l: 190, r: 50, t: 6, b: 22 }
  const ext = Math.max(0.02, ...rows.flatMap((r) => [Math.abs(r.lo), Math.abs(r.hi)])) * 1.15
  const x = linear([-ext, ext], [m.l, width - m.r])
  const blue = css('--dem') || '#2460ba'
  const red = css('--rep') || '#c8343a'
  for (const t of niceTicks(-ext, ext, 6)) {
    svg.append(
      s('line', { x1: x(t), x2: x(t), y1: m.t, y2: h - m.b, class: t === 0 ? 'axis' : 'gridline' }),
      s('text', { x: x(t), y: h - 6, class: 'tick', 'text-anchor': 'middle' }, `${t > 0 ? '+' : ''}${Math.round(t * 100)}`)
    )
  }
  const sorted = [...rows].sort((a, b) => Math.abs(b.hi - b.lo) - Math.abs(a.hi - a.lo))
  sorted.forEach((r, i) => {
    const yy = m.t + i * rowH
    const bar = (v, side) => {
      const lo = Math.min(0, v)
      const hi = Math.max(0, v)
      return s('rect', {
        x: x(lo),
        y: yy + 6,
        width: Math.max(1, x(hi) - x(lo)),
        height: rowH - 12,
        fill: v >= 0 ? blue : red,
        opacity: side === 'hi' ? 0.9 : 0.5,
        ...hover(`<b>${labels[r.key]}</b> ${side === 'hi' ? '+' : '−'}${fmtStep(r.key, r.step)}<br>Chance of D control ${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)} pts`),
      })
    }
    svg.append(
      s('text', { x: m.l - 8, y: yy + rowH / 2 + 4, class: 'wf-label', 'text-anchor': 'end' }, labels[r.key]),
      bar(r.lo, 'lo'),
      bar(r.hi, 'hi')
    )
  })
}

// ---- Scatter -------------------------------------------------------------------------------
export function scatter(container, { points, xLabel, yLabel, height = 300, diag = true }) {
  const { svg, width, height: h } = frame(container, height)
  const m = { l: 46, r: 14, t: 12, b: 40 }
  const x = linear([0, 1], [m.l, width - m.r])
  const y = linear([0, 1], [h - m.b, m.t])
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(
      s('line', { x1: x(t), x2: x(t), y1: m.t, y2: h - m.b, class: 'gridline' }),
      s('line', { x1: m.l, x2: width - m.r, y1: y(t), y2: y(t), class: 'gridline' }),
      s('text', { x: x(t), y: h - m.b + 15, class: 'tick', 'text-anchor': 'middle' }, fmtPct(t)),
      s('text', { x: m.l - 6, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, fmtPct(t))
    )
  }
  if (diag) {
    svg.append(s('line', { x1: x(0), y1: y(0), x2: x(1), y2: y(1), class: 'ref' }))
  }
  svg.append(
    s('text', { x: (m.l + width - m.r) / 2, y: h - 4, class: 'axis-title', 'text-anchor': 'middle' }, xLabel),
    s('text', { x: 12, y: (m.t + h - m.b) / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 12 ${(m.t + h - m.b) / 2})` }, yLabel)
  )
  for (const p of points) {
    svg.append(
      s('circle', {
        cx: x(p.x),
        cy: y(p.y),
        r: p.r ?? 6,
        fill: p.color ?? probColor(p.x),
        stroke: '#fff',
        'stroke-width': 1.5,
        class: p.onClick ? 'clickable' : null,
        ...hover(p.tip),
        onclick: p.onClick,
      })
    )
    if (p.label) {
      svg.append(s('text', { x: x(p.x) + 8, y: y(p.y) + 4, class: 'point-label' }, p.label))
    }
  }
}

// ---- Horizontal comparison bars ------------------------------------------------------------
/** Rows of { label, values: [{ v, color, name }] } on a shared 0-max scale. */
export function compareBars(container, { rows, max, fmt = (v) => `${Math.round(v)}%` }) {
  const rowH = 22
  const h = rows.length * rowH + 8
  const { svg, width } = frame(container, h, { minWidth: 220 })
  const m = { l: 92, r: 40 }
  const x = linear([0, max], [m.l, width - m.r])
  rows.forEach((r, i) => {
    const yy = 4 + i * rowH
    svg.append(s('text', { x: m.l - 8, y: yy + 13, class: 'wf-label', 'text-anchor': 'end' }, r.label))
    const k = r.values.length
    r.values.forEach((val, j) => {
      const bh = (rowH - 6) / k
      svg.append(
        s('rect', {
          x: m.l,
          y: yy + j * bh,
          width: Math.max(1, x(val.v) - m.l),
          height: bh - 1,
          fill: val.color,
          ...hover(`<b>${r.label}</b><br>${val.name}: ${fmt(val.v)}`),
        })
      )
    })
    svg.append(s('text', { x: x(r.values[0].v) + 4, y: yy + 11, class: 'tick strong' }, fmt(r.values[0].v)))
  })
}

// ---- Historical results bars ---------------------------------------------------------------
/** One bar per past result: margin, plus the margin relative to the nation as a tick. */
export function resultBars(container, rows) {
  const rowH = 24
  const h = rows.length * rowH + 26
  const { svg, width } = frame(container, h)
  const m = { l: 110, r: 56, t: 4, b: 20 }
  const ext = Math.max(10, ...rows.map((r) => Math.abs(r.margin))) * 1.08
  const x = linear([-ext, ext], [m.l, width - m.r])
  const blue = css('--dem') || '#2460ba'
  const red = css('--rep') || '#c8343a'
  for (const t of niceTicks(-ext, ext, 6)) {
    svg.append(
      s('line', { x1: x(t), x2: x(t), y1: m.t, y2: h - m.b, class: t === 0 ? 'axis' : 'gridline' }),
      s('text', { x: x(t), y: h - 5, class: 'tick', 'text-anchor': 'middle' }, t === 0 ? 'EVEN' : fmtMargin(t, 0))
    )
  }
  rows.forEach((r, i) => {
    const yy = m.t + i * rowH
    svg.append(
      s('text', { x: m.l - 8, y: yy + 15, class: 'wf-label', 'text-anchor': 'end' }, `${r.election_year} ${r.office}`),
      s('rect', {
        x: x(Math.min(0, r.margin)),
        y: yy + 5,
        width: Math.max(1.5, Math.abs(x(r.margin) - x(0))),
        height: rowH - 10,
        fill: r.margin >= 0 ? blue : red,
        opacity: 0.8,
        rx: 2,
        ...hover(`<b>${r.election_year} ${r.office}</b><br>D ${r.dem_pct}% · R ${r.rep_pct}%<br>${fmtMargin(r.margin)} (${fmtMargin(r.relative_margin)} vs. nation)`),
      }),
      Number.isFinite(r.relative_margin)
        ? s('line', { x1: x(r.relative_margin), x2: x(r.relative_margin), y1: yy + 2, y2: yy + rowH - 2, class: 'rel-tick' })
        : null,
      s('text', { x: width - m.r + 6, y: yy + 16, class: 'wf-value' }, fmtMargin(r.margin))
    )
  })
}

// ---- Odds dots -----------------------------------------------------------------------------
/** 100 dots, Democratic wins first: the FiveThirtyEight "N in 100" picture. */
export function oddsDots(container, p) {
  container.replaceChildren()
  const cols = 25
  const rows = 4
  const pitch = 8
  const r = 2.75
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'odds-dots')
  svg.setAttribute('viewBox', `0 0 ${cols * pitch} ${rows * pitch}`)
  svg.setAttribute('aria-hidden', 'true')
  const d = Math.round(p * 100)
  for (let i = 0; i < cols * rows; i++) {
    const dot = document.createElementNS(NS, 'circle')
    dot.setAttribute('cx', (i % cols) * pitch + pitch / 2)
    dot.setAttribute('cy', Math.floor(i / cols) * pitch + pitch / 2)
    dot.setAttribute('r', r)
    dot.setAttribute('class', i < d ? 'd' : 'r')
    svg.append(dot)
  }
  container.append(svg)
}
