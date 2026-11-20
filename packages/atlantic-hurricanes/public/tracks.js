// Storm tracks on a map of the Atlantic: the form the hurricane field draws, a line per storm along its best track.
// Drawn with d3 into SVG, to the chart module's bar: marks named directly, a tooltip on hover and keyboard focus, a
// click that opens the storm, and a redraw when the box changes width.
import * as C from './charts.js'

const WORLD = './vendor/maps/countries-110m.json'

/**
 * Tracks. tracks: [{ id, name, color (a token name), points: [{ lat, lon, ... }] }], each in time order.
 * opts: segColor(point) -> token name (colours each leg by the point it starts from, instead of the track's colour),
 * tip(track, point) -> lines for the tooltip, onOpen(id) (a track's click), marks ([{ lat, lon, label, color }]:
 * dots named beside them, such as landfalls), labels (ids of tracks to name at their end), key ([{ name, color }]),
 * extent ([[west, south], [east, north]]; default: the tracks' own), height, label (what the map shows, for readers).
 */
export async function trackMap(el, tracks, opts = {}) {
  const topo = await C.loadTopo(WORLD)
  const land = topojson.feature(topo, topo.objects.countries)
  el.classList.add('tm')
  const draw = () => {
    const width = el.clientWidth || 600
    if (width === el.__w) return
    el.__w = width
    el.replaceChildren()
    const height = opts.height || Math.round(Math.min(560, Math.max(300, width * 0.62)))
    const pts = tracks.flatMap((t) => t.points)
    const [[w, s], [e, n]] = opts.extent || [
      [d3.min(pts, (p) => p.lon) - 3, d3.min(pts, (p) => p.lat) - 3],
      [d3.max(pts, (p) => p.lon) + 3, d3.max(pts, (p) => p.lat) + 3],
    ]
    // Corner points, not a polygon: a ring wound the wrong way reads as the whole globe less the box.
    const box = { type: 'MultiPoint', coordinates: [[w, s], [e, n], [w, n], [e, s], [(w + e) / 2, n]] }
    const proj = d3.geoMercator().fitExtent([[4, 4], [width - 4, height - 4]], box)
    const path = d3.geoPath(proj)
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
      .attr('role', 'img').attr('aria-label', opts.label || 'Storm tracks on a map of the Atlantic')
    svg.append('rect').attr('class', 'tm__sea').attr('width', width).attr('height', height)
    svg.append('path').attr('class', 'tm__land').attr('d', path(land))
    const tip = d3.select(el).append('div').attr('class', 'tm__tip').attr('hidden', true)
    const line = d3.line().x((p) => proj([p.lon, p.lat])[0]).y((p) => proj([p.lon, p.lat])[1])
    const many = tracks.length > 60
    const g = svg.append('g').attr('class', 'tm__tracks')
    const show = (t, p, x, y) => {
      const lines = opts.tip ? opts.tip(t, p) : [t.name]
      tip.attr('hidden', null).html('').selectAll('div').data(lines).join('div').text((d) => d)
      const tw = tip.node().offsetWidth
      tip.style('left', `${Math.max(0, Math.min(width - tw, x + 12))}px`).style('top', `${Math.max(0, y - 10)}px`)
    }
    const hide = () => tip.attr('hidden', true)
    for (const t of tracks) {
      const tg = g.append('g').attr('class', 'tm__track').attr('data-id', t.id)
      if (opts.segColor) {
        for (let i = 0; i < t.points.length - 1; i++) {
          tg.append('path').attr('d', line([t.points[i], t.points[i + 1]])).attr('stroke', C.token(opts.segColor(t.points[i])))
        }
      } else tg.append('path').attr('d', line(t.points)).attr('stroke', C.token(t.color || '--c-bar'))
      // A wide invisible line takes the pointer, so a thin track is easy to hover and click.
      const hit = tg.append('path').attr('class', 'tm__hit').attr('d', line(t.points))
      const near = (ev) => {
        const [mx, my] = d3.pointer(ev, svg.node())
        return d3.least(t.points, (p) => { const [x, y] = proj([p.lon, p.lat]); return (x - mx) ** 2 + (y - my) ** 2 })
      }
      hit.on('pointermove', (ev) => {
        g.classed('is-hover', true)
        tg.classed('is-on', true).raise()
        const [x, y] = d3.pointer(ev, el)
        show(t, near(ev), x, y)
      }).on('pointerleave', () => {
        g.classed('is-hover', false)
        tg.classed('is-on', false)
        hide()
      })
      if (opts.onOpen) {
        hit.style('cursor', 'pointer').on('click', () => opts.onOpen(t.id))
        if (!many) {
          tg.attr('tabindex', 0).attr('role', 'link').attr('aria-label', (opts.tip ? opts.tip(t, null) : [t.name]).join(', '))
            .on('focus', () => {
              g.classed('is-hover', true)
              tg.classed('is-on', true)
              const last = t.points[t.points.length - 1]
              const [x, y] = proj([last.lon, last.lat])
              show(t, null, x, y)
            })
            .on('blur', () => { g.classed('is-hover', false); tg.classed('is-on', false); hide() })
            .on('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), opts.onOpen(t.id)))
        }
      }
    }
    for (const id of opts.labels || []) {
      const t = tracks.find((x) => x.id === id)
      if (!t) continue
      const peak = t.points[t.points.length - 1]
      const [x, y] = proj([peak.lon, peak.lat])
      svg.append('text').attr('class', 'tm__name').attr('x', x + 4).attr('y', y - 4).attr('text-anchor', x > width - 90 ? 'end' : 'start').text(t.name)
    }
    const mg = svg.append('g').attr('class', 'tm__marks')
    for (const m of opts.marks || []) {
      const [x, y] = proj([m.lon, m.lat])
      mg.append('circle').attr('cx', x).attr('cy', y).attr('r', 4.5).attr('fill', C.token(m.color || '--c5'))
      if (m.label) mg.append('text').attr('class', 'tm__name').attr('x', x + 7).attr('y', y + 4).attr('text-anchor', x > width - 120 ? 'end' : 'start').attr('dx', x > width - 120 ? -14 : 0).text(m.label)
    }
    if (opts.key?.length) {
      const k = d3.select(el).append('div').attr('class', 'tm__key')
      for (const it of opts.key) k.append('span').html('').call((sp) => { sp.append('i').style('background', C.token(it.color)); sp.append('span').text(it.name) })
    }
    if (C.MOTION) g.attr('opacity', 0).transition().duration(C.DUR * 2).attr('opacity', 1)
  }
  draw()
  el.__ro?.disconnect()
  el.__ro = new ResizeObserver(() => draw())
  el.__ro.observe(el)
}
