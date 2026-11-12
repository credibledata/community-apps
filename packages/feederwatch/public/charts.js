// The only module that draws. Every colour, size and duration comes from CSS tokens at draw
// time (token()), so a theme swap is a token swap. Charts are hand-built SVG with d3: direct
// labels instead of legends, faint grids, no axis lines.

/* global d3, topojson */

export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const px = (name) => parseFloat(token(name)) || 12;

const SVGNS = "http://www.w3.org/2000/svg";

// ---------- shared tooltip ----------
let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "chart-tip";
    tipEl.setAttribute("role", "status");
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
/** lines: array of [label, value] pairs or strings. Built with textContent only. */
export function showTip(event, title, lines = []) {
  const t = tip();
  t.replaceChildren();
  const h = document.createElement("div");
  h.className = "chart-tip__title";
  h.textContent = title;
  t.appendChild(h);
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "chart-tip__row";
    if (Array.isArray(line)) {
      const [k, v, color] = line;
      if (color) {
        const sw = document.createElement("span");
        sw.className = "chart-tip__swatch";
        sw.style.background = color;
        row.appendChild(sw);
      }
      const a = document.createElement("span");
      a.textContent = k;
      const b = document.createElement("strong");
      b.textContent = v;
      row.append(a, b);
    } else row.textContent = line;
    t.appendChild(row);
  }
  t.hidden = false;
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = event.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = event.clientY - r.height - pad;
  t.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
}
export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

function measureText(text, size, weight = 500) {
  const c = measureText.c || (measureText.c = document.createElement("canvas").getContext("2d"));
  c.font = `${weight} ${size}px ${token("--font-sans")}`;
  return c.measureText(text).width;
}

function frame(el, height) {
  el.replaceChildren();
  const width = Math.max(260, el.clientWidth || 600);
  const svg = d3.select(el).append("svg").attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  return { svg, width, height };
}

/** Resolve label collisions vertically: items [{y}] sorted, minimum gap, within [min,max]. */
export function dodge(items, gap, min, max) {
  const s = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < s.length; i++) if (s[i].y - s[i - 1].y < gap) s[i].y = s[i - 1].y + gap;
  const over = s.length ? s[s.length - 1].y - max : 0;
  if (over > 0) for (let i = s.length - 1; i >= 0; i--) {
    s[i].y -= over;
    if (i > 0 && s[i].y - s[i - 1].y >= gap) break;
  }
  for (let i = s.length - 2; i >= 0; i--) if (s[i + 1].y - s[i].y < gap) s[i].y = s[i + 1].y - gap;
  for (const it of s) it.y = Math.max(min, it.y);
  return s;
}

// ---------- line chart (multi-series, directly labelled) ----------
/**
 * series: [{ key, label, color, points: [{x, y, n?}], emphasis?: bool, muted?: bool, dash?: bool }]
 * opts: { height, xDomain, yDomain, yFormat, xFormat, xTicks, band: [x0,x1], bandLabel, yLabel, tipTitle(x), tipValue(y, s, p) }
 */
export function lineChart(el, series, opts = {}) {
  const fs = px("--fs-xs");
  const height = opts.height || 300;
  const { svg, width } = frame(el, height);
  const labelW = opts.directLabels === false ? 0 : Math.min(150, Math.max(40, ...series.map((s) => measureText(s.label, fs, 600))) + 14);
  const m = { top: 12, right: labelW + 8, bottom: 26, left: 44 };
  const all = series.flatMap((s) => s.points.filter((p) => p.y != null && Number.isFinite(p.y)));
  const xDomain = opts.xDomain || d3.extent(all, (p) => p.x);
  const yMax = opts.yDomain ? opts.yDomain[1] : (d3.max(all, (p) => p.y) || 1) * 1.08;
  const x = d3.scaleLinear().domain(xDomain).range([m.left, width - m.right]);
  const y = d3.scaleLinear().domain(opts.yDomain || [0, yMax]).nice().range([height - m.bottom, m.top]);

  if (opts.band) {
    const [b0, b1] = opts.band;
    svg.append("rect").attr("class", "band")
      .attr("x", x(Math.max(xDomain[0], b0 - 0.5))).attr("y", m.top)
      .attr("width", Math.max(2, x(Math.min(xDomain[1], b1 + 0.5)) - x(Math.max(xDomain[0], b0 - 0.5))))
      .attr("height", height - m.top - m.bottom).attr("fill", token("--band"));
    if (opts.bandLabel) svg.append("text").attr("class", "band-label").attr("x", x(Math.max(xDomain[0], b0 - 0.5)) + 4).attr("y", m.top + fs)
      .attr("fill", token("--text-muted")).attr("font-size", fs).text(opts.bandLabel);
  }
  const yTicks = y.ticks(opts.yTickCount || 5);
  svg.append("g").selectAll("line").data(yTicks).join("line")
    .attr("x1", m.left).attr("x2", width - m.right).attr("y1", (d) => y(d)).attr("y2", (d) => y(d))
    .attr("stroke", token("--grid")).attr("stroke-width", 1);
  svg.append("g").selectAll("text").data(yTicks).join("text")
    .attr("x", m.left - 8).attr("y", (d) => y(d)).attr("dy", "0.32em").attr("text-anchor", "end")
    .attr("fill", token("--tick")).attr("font-size", fs).text((d) => (opts.yFormat || String)(d));
  const xt = opts.xTicks || x.ticks(Math.max(3, Math.floor((width - m.left - m.right) / 70)));
  svg.append("g").selectAll("text").data(xt).join("text")
    .attr("x", (d) => x(d)).attr("y", height - 8).attr("text-anchor", "middle")
    .attr("fill", token("--tick")).attr("font-size", fs).text((d) => (opts.xFormat || String)(d));
  if (opts.yLabel) svg.append("text").attr("x", m.left).attr("y", m.top - 2).attr("fill", token("--text-muted")).attr("font-size", fs).text("");

  const line = d3.line().defined((p) => p.y != null && Number.isFinite(p.y)).x((p) => x(p.x)).y((p) => y(p.y)).curve(d3.curveMonotoneX);
  const ordered = [...series].sort((a, b) => (a.emphasis ? 1 : 0) - (b.emphasis ? 1 : 0) || (b.muted ? 1 : 0) - (a.muted ? 1 : 0));
  const g = svg.append("g");
  for (const s of ordered) {
    g.append("path").attr("d", line(s.points)).attr("fill", "none")
      .attr("stroke", s.color).attr("stroke-width", s.emphasis ? 3 : s.muted ? 1.25 : 2)
      .attr("stroke-opacity", s.muted ? 0.35 : 1).attr("stroke-dasharray", s.dash ? "4 3" : null)
      .attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
  }
  // direct labels at each series' last defined point, dodged
  if (opts.directLabels !== false) {
    const labels = series.map((s) => {
      const last = [...s.points].reverse().find((p) => p.y != null && Number.isFinite(p.y));
      return last ? { s, y: y(last.y), x: x(last.x) } : null;
    }).filter(Boolean);
    dodge(labels, fs + 3, m.top + 4, height - m.bottom);
    for (const L of labels) {
      svg.append("circle").attr("cx", L.x).attr("cy", y([...L.s.points].reverse().find((p) => p.y != null).y)).attr("r", L.s.emphasis ? 3.5 : 2.5)
        .attr("fill", L.s.color).attr("opacity", L.s.muted ? 0.5 : 1);
      svg.append("text").attr("x", width - m.right + 8).attr("y", L.y).attr("dy", "0.32em")
        .attr("fill", L.s.muted ? token("--text-muted") : L.s.color).attr("font-size", fs)
        .attr("font-weight", L.s.emphasis ? 700 : 600).text(L.s.label);
    }
  }
  // hover: vertical rule + tooltip listing every series at that x
  const xs = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
  const rule = svg.append("line").attr("y1", m.top).attr("y2", height - m.bottom).attr("stroke", token("--text-muted")).attr("stroke-width", 1).attr("opacity", 0);
  svg.append("rect").attr("x", m.left).attr("y", m.top).attr("width", width - m.left - m.right).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (event) => {
      const [mx] = d3.pointer(event);
      const xv = xs[d3.minIndex(xs, (v) => Math.abs(x(v) - mx))];
      if (xv == null) return;
      rule.attr("x1", x(xv)).attr("x2", x(xv)).attr("opacity", 0.4);
      const rows = series.map((s) => [s, s.points.find((p) => p.x === xv)])
        .filter(([, p]) => p && p.y != null)
        .sort((a, b) => b[1].y - a[1].y)
        .map(([s, p]) => [s.label, (opts.tipValue || ((v) => String(v)))(p.y, s, p), s.color]);
      showTip(event, (opts.tipTitle || String)(xv), rows);
    })
    .on("mouseleave", () => { rule.attr("opacity", 0); hideTip(); });
  return { x, y };
}

// ---------- sparkline ----------
/** points [{x,y}], band [x0,x1]. Draws into a fresh inline SVG and returns it. */
export function sparkline(points, { width = 120, height = 28, band, xDomain, color } = {}) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("spark");
  const valid = points.filter((p) => p.y != null && Number.isFinite(p.y));
  if (valid.length < 2) return svg;
  const x = d3.scaleLinear().domain(xDomain || d3.extent(valid, (p) => p.x)).range([1, width - 3]);
  const y = d3.scaleLinear().domain([0, Math.max(0.05, d3.max(valid, (p) => p.y))]).range([height - 2, 2]);
  const s = d3.select(svg);
  if (band) s.append("rect").attr("x", x(band[0] - 0.5)).attr("width", Math.max(1, x(band[1] + 0.5) - x(band[0] - 0.5))).attr("y", 0).attr("height", height).attr("fill", token("--band"));
  s.append("path").attr("d", d3.line().defined((p) => p.y != null).x((p) => x(p.x)).y((p) => y(p.y))(points))
    .attr("fill", "none").attr("stroke", color || token("--c1")).attr("stroke-width", 1.5).attr("stroke-linejoin", "round");
  const last = valid[valid.length - 1];
  s.append("circle").attr("cx", x(last.x)).attr("cy", y(last.y)).attr("r", 2).attr("fill", color || token("--c1"));
  return svg;
}

// ---------- maps ----------
let topoCache = null;
export async function loadTopo() {
  if (!topoCache) topoCache = fetch("./img/provinces.topo.json").then((r) => { if (!r.ok) throw new Error(`map ${r.status}`); return r.json(); });
  return topoCache;
}
function projectionFor(width, height, features) {
  return d3.geoConicEqualArea().parallels([29.5, 45.5]).rotate([100, 0]).fitExtent([[4, 4], [width - 4, height - 4]], features);
}
function mapLegend(svg, color, domain, fmt, x, y, w) {
  const fs = px("--fs-xs");
  const id = `lg${Math.random().toString(36).slice(2)}`;
  const grad = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.01, 0.1).forEach((t) => grad.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", color(domain[0] + t * (domain[1] - domain[0]))));
  svg.append("rect").attr("x", x).attr("y", y).attr("width", w).attr("height", 8).attr("rx", 2).attr("fill", `url(#${id})`);
  svg.append("text").attr("x", x).attr("y", y + 8 + fs + 2).attr("font-size", fs).attr("fill", token("--tick")).text(fmt(domain[0]));
  svg.append("text").attr("x", x + w).attr("y", y + 8 + fs + 2).attr("text-anchor", "end").attr("font-size", fs).attr("fill", token("--tick")).text(fmt(domain[1]));
}
export function seqColor(domain) {
  return d3.scaleSequential(d3.interpolateRgbBasis([token("--seq-0"), token("--seq-1"), token("--seq-2"), token("--seq-3")])).domain(domain);
}

/**
 * Choropleth by state/province. values: Map(code -> {value, n, label?}).
 * opts: { height, format, domain, selected, onClick(code), tipLines(code, d), min (n below which a state is hatched) }
 */
export async function choropleth(el, values, opts = {}) {
  const topo = await loadTopo();
  const feats = topojson.feature(topo, topo.objects.layer1);
  const height = opts.height || 380;
  const { svg, width } = frame(el, height);
  const proj = projectionFor(width, height - 34, feats);
  const path = d3.geoPath(proj);
  const vals = [...values.values()].filter((d) => d.value != null && (d.n ?? Infinity) >= (opts.min || 0)).map((d) => d.value);
  const domain = opts.domain || [d3.min(vals) ?? 0, d3.max(vals) ?? 1];
  const color = seqColor(domain[0] === domain[1] ? [0, domain[1] || 1] : domain);
  svg.append("g").selectAll("path").data(feats.features).join("path")
    .attr("d", path)
    .attr("class", (f) => `prov${opts.onClick && values.has(f.id) ? " is-clickable" : ""}${opts.selected === f.id ? " is-selected" : ""}`)
    .attr("fill", (f) => {
      const d = values.get(f.id);
      if (!d || d.value == null) return token("--surface-2");
      if ((d.n ?? Infinity) < (opts.min || 0)) return token("--surface-3");
      return color(d.value);
    })
    .attr("stroke", (f) => (opts.selected === f.id ? token("--accent") : token("--surface")))
    .attr("stroke-width", (f) => (opts.selected === f.id ? 2.5 : 0.75))
    .on("mousemove", (event, f) => {
      const d = values.get(f.id);
      showTip(event, f.properties?.name || opts.nameOf?.(f.id) || f.id, d ? opts.tipLines(f.id, d) : ["No FeederWatch sites in scope"]);
    })
    .on("mouseleave", hideTip)
    .on("click", (event, f) => { if (opts.onClick && values.has(f.id)) { hideTip(); opts.onClick(f.id); } });
  svg.selectAll("path.is-selected").raise();
  mapLegend(svg, color, domain, opts.format || String, width - 180, height - 30, 170);
  if (opts.legendTitle) svg.append("text").attr("x", width - 180).attr("y", height - 34).attr("font-size", px("--fs-xs")).attr("fill", token("--text-muted")).text(opts.legendTitle);
}

/** Half-degree grid cells over the same base map. cells [{lat, lon, value, n}] */
export async function gridMap(el, cells, opts = {}) {
  const topo = await loadTopo();
  const feats = topojson.feature(topo, topo.objects.layer1);
  const height = opts.height || 380;
  const { svg, width } = frame(el, height);
  const proj = projectionFor(width, height - 34, feats);
  const path = d3.geoPath(proj);
  svg.append("g").selectAll("path").data(feats.features).join("path").attr("d", path)
    .attr("fill", token("--surface-2")).attr("stroke", token("--surface")).attr("stroke-width", 0.75);
  const shown = cells.filter((c) => c.n >= (opts.min || 1));
  const domain = opts.domain || [0, d3.max(shown, (c) => c.value) || 1];
  const color = seqColor(domain);
  svg.append("g").selectAll("path").data(shown).join("path")
    .attr("d", (c) => path({ type: "Polygon", coordinates: [[[c.lon, c.lat], [c.lon, c.lat + 0.5], [c.lon + 0.5, c.lat + 0.5], [c.lon + 0.5, c.lat], [c.lon, c.lat]]] }))
    .attr("fill", (c) => color(c.value)).attr("stroke", "none")
    .on("mousemove", (event, c) => showTip(event, `${c.lat.toFixed(1)}°, ${c.lon.toFixed(1)}°`, opts.tipLines(c)))
    .on("mouseleave", hideTip);
  mapLegend(svg, color, domain, opts.format || String, width - 180, height - 30, 170);
  if (opts.legendTitle) svg.append("text").attr("x", width - 180).attr("y", height - 34).attr("font-size", px("--fs-xs")).attr("fill", token("--text-muted")).text(opts.legendTitle);
}

// ---------- scatter: early vs recent, labelled outliers ----------
/**
 * points [{id, label, x, y, n}]; opts { height, format, onClick(id), highlight:set, labelCount, xLabel, yLabel }
 */
export function changeScatter(el, points, opts = {}) {
  const fs = px("--fs-xs");
  const height = opts.height || 420;
  const { svg, width } = frame(el, height);
  const m = { top: 16, right: 16, bottom: 40, left: 50 };
  const max = Math.min(1, (d3.max(points, (p) => Math.max(p.x, p.y)) || 1) * 1.05);
  const x = d3.scaleLinear().domain([0, max]).range([m.left, width - m.right]);
  const y = d3.scaleLinear().domain([0, max]).range([height - m.bottom, m.top]);
  const ticks = x.ticks(5);
  svg.append("g").selectAll("line").data(ticks).join("line").attr("x1", m.left).attr("x2", width - m.right)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d)).attr("stroke", token("--grid"));
  svg.append("g").selectAll("text").data(ticks).join("text").attr("x", m.left - 8).attr("y", (d) => y(d)).attr("dy", "0.32em")
    .attr("text-anchor", "end").attr("font-size", fs).attr("fill", token("--tick")).text(opts.format);
  svg.append("g").selectAll("text").data(ticks).join("text").attr("x", (d) => x(d)).attr("y", height - m.bottom + 16)
    .attr("text-anchor", "middle").attr("font-size", fs).attr("fill", token("--tick")).text(opts.format);
  svg.append("text").attr("x", width - m.right).attr("y", height - 6).attr("text-anchor", "end").attr("font-size", fs).attr("fill", token("--text-muted")).text(opts.xLabel);
  svg.append("text").attr("x", m.left).attr("y", m.top - 4).attr("font-size", fs).attr("fill", token("--text-muted")).text(opts.yLabel);
  // the no-change diagonal, annotated
  svg.append("line").attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(max)).attr("y2", y(max)).attr("stroke", token("--text-soft")).attr("stroke-dasharray", "3 3");
  svg.append("text").attr("x", x(0) + 10).attr("y", y(max) + fs + 6).attr("font-size", fs).attr("font-weight", 600).attr("fill", token("--positive"))
    .text("↖ at more sites now");
  svg.append("text").attr("x", x(max) - 4).attr("y", y(0) - 10).attr("text-anchor", "end").attr("font-size", fs).attr("font-weight", 600).attr("fill", token("--negative"))
    .text("at fewer sites now ↘");
  const r = d3.scaleSqrt().domain([0, d3.max(points, (p) => p.n) || 1]).range([2.5, 9]);
  const col = (p) => (p.y - p.x >= 0 ? token("--positive") : token("--negative"));
  const g = svg.append("g");
  g.selectAll("circle").data(points).join("circle")
    .attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y)).attr("r", (p) => r(p.n))
    .attr("fill", (p) => (opts.highlight?.has(p.id) ? token("--accent") : col(p)))
    .attr("fill-opacity", (p) => (opts.highlight?.has(p.id) ? 1 : 0.45))
    .attr("stroke", (p) => (opts.highlight?.has(p.id) ? token("--accent") : "none"))
    .attr("class", "is-clickable")
    .on("mousemove", (event, p) => showTip(event, p.label, opts.tipLines(p)))
    .on("mouseleave", hideTip)
    .on("click", (event, p) => { hideTip(); opts.onClick?.(p.id); });
  // label the biggest movers either way and anything highlighted
  const k = opts.labelCount ?? 6;
  const byDelta = [...points].sort((a, b) => (b.y - b.x) - (a.y - a.x));
  const pick = new Set([...byDelta.slice(0, k), ...byDelta.slice(-k), ...points.filter((p) => opts.highlight?.has(p.id))]);
  const labels = [...pick].map((p) => ({ p, y: y(p.y), x: x(p.x) }));
  dodge(labels, fs + 2, m.top, height - m.bottom);
  for (const L of labels) {
    const right = L.x < width * 0.62;
    svg.append("text").attr("x", L.x + (right ? 8 : -8)).attr("y", L.y).attr("dy", "0.32em")
      .attr("text-anchor", right ? "start" : "end").attr("font-size", fs).attr("font-weight", 600)
      .attr("fill", opts.highlight?.has(L.p.id) ? token("--accent") : token("--text")).attr("paint-order", "stroke")
      .attr("stroke", token("--surface")).attr("stroke-width", 3).attr("class", "is-clickable")
      .text(L.p.label).on("click", () => opts.onClick?.(L.p.id));
  }
}

// ---------- dumbbell: with vs without ----------
/** rows [{label, a, b, note, muted}], a = with (filled), b = without (open). */
export function dumbbell(el, rows, opts = {}) {
  const fs = px("--fs-xs");
  const rowH = 26;
  const labelW = Math.min(190, Math.max(...rows.map((r) => measureText(r.label, fs, 500)), 60) + 12);
  const height = rows.length * rowH + 40;
  const { svg, width } = frame(el, height);
  const m = { top: 26, right: 64, bottom: 14, left: labelW };
  const vals = rows.flatMap((r) => [r.a, r.b]).filter((v) => v != null);
  const x = d3.scaleLinear().domain(opts.domain || [Math.max(0, (d3.min(vals) ?? 0) - 0.05), Math.min(1, (d3.max(vals) ?? 1) + 0.03)]).nice().range([m.left, width - m.right]);
  const ticks = x.ticks(4);
  svg.append("g").selectAll("line").data(ticks).join("line").attr("x1", (d) => x(d)).attr("x2", (d) => x(d))
    .attr("y1", m.top - 6).attr("y2", height - m.bottom).attr("stroke", token("--grid"));
  svg.append("g").selectAll("text").data(ticks).join("text").attr("x", (d) => x(d)).attr("y", m.top - 12)
    .attr("text-anchor", "middle").attr("font-size", fs).attr("fill", token("--tick")).text(opts.format);
  rows.forEach((r, i) => {
    const cy = m.top + i * rowH + rowH / 2;
    const g = svg.append("g").attr("opacity", r.muted ? 0.45 : 1).attr("class", opts.onClick ? "is-clickable" : null)
      .on("mousemove", (event) => showTip(event, r.label, opts.tipLines(r)))
      .on("mouseleave", hideTip)
      .on("click", () => { if (opts.onClick) { hideTip(); opts.onClick(r); } });
    g.append("rect").attr("x", 0).attr("y", cy - rowH / 2).attr("width", width).attr("height", rowH).attr("fill", "transparent");
    g.append("text").attr("x", m.left - 10).attr("y", cy).attr("dy", "0.32em").attr("text-anchor", "end").attr("font-size", fs).attr("fill", token("--text")).text(r.label);
    if (r.a == null || r.b == null) {
      g.append("text").attr("x", m.left).attr("y", cy).attr("dy", "0.32em").attr("font-size", fs).attr("fill", token("--text-muted")).text(r.note || "Not asked in this scope");
      return;
    }
    const up = r.a >= r.b;
    g.append("line").attr("x1", x(r.b)).attr("x2", x(r.a)).attr("y1", cy).attr("y2", cy)
      .attr("stroke", up ? token("--positive") : token("--negative")).attr("stroke-width", 3).attr("stroke-linecap", "round");
    g.append("circle").attr("cx", x(r.b)).attr("cy", cy).attr("r", 4.5).attr("fill", token("--surface")).attr("stroke", token("--text-muted")).attr("stroke-width", 1.5);
    g.append("circle").attr("cx", x(r.a)).attr("cy", cy).attr("r", 5).attr("fill", up ? token("--positive") : token("--negative"));
    g.append("text").attr("x", width - m.right + 8).attr("y", cy).attr("dy", "0.32em").attr("font-size", fs).attr("font-weight", 600)
      .attr("fill", up ? token("--positive") : token("--negative")).text(opts.deltaFormat(r.a - r.b));
  });
}

// ---------- bars ----------
/**
 * Vertical bars. rows [{label, value, sub}]. opts { height, format, accent: label to accent, tipLines }
 */
export function columns(el, rows, opts = {}) {
  const fs = px("--fs-xs");
  const height = opts.height || 220;
  const { svg, width } = frame(el, height);
  const m = { top: 20, right: 8, bottom: 30, left: 8 };
  const x = d3.scaleBand().domain(rows.map((r) => r.label)).range([m.left, width - m.right]).padding(0.28);
  const max = d3.max(rows, (r) => r.value) || 1;
  const y = d3.scaleLinear().domain([0, max]).range([height - m.bottom, m.top + 4]);
  svg.append("line").attr("x1", m.left).attr("x2", width - m.right).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", token("--border-strong"));
  const g = svg.append("g").selectAll("g").data(rows).join("g")
    .on("mousemove", (event, r) => opts.tipLines && showTip(event, r.label, opts.tipLines(r)))
    .on("mouseleave", hideTip);
  g.append("rect").attr("x", (r) => x(r.label)).attr("width", x.bandwidth())
    .attr("y", (r) => (r.value == null ? y(0) : y(r.value))).attr("height", (r) => (r.value == null ? 0 : y(0) - y(r.value)))
    .attr("rx", 2).attr("fill", (r) => (r.label === opts.accent ? token("--accent") : token("--c-bar")));
  g.append("text").attr("x", (r) => x(r.label) + x.bandwidth() / 2).attr("y", (r) => (r.value == null ? y(0) : y(r.value)) - 5)
    .attr("text-anchor", "middle").attr("font-size", fs).attr("font-weight", 600).attr("fill", token("--text"))
    .text((r) => (r.value == null ? "—" : opts.format(r.value)));
  g.append("text").attr("x", (r) => x(r.label) + x.bandwidth() / 2).attr("y", height - 10)
    .attr("text-anchor", "middle").attr("font-size", fs).attr("fill", token("--text-muted")).text((r) => r.label);
}

/** Stacked area of shares (each x sums to 1). keys [{key,label,color}], rows [{x, [key]: value}] */
export function stackedShare(el, rows, keys, opts = {}) {
  const fs = px("--fs-xs");
  const height = opts.height || 260;
  const { svg, width } = frame(el, height);
  const labelW = Math.max(...keys.map((k) => measureText(k.label, fs, 600))) + 14;
  const m = { top: 10, right: labelW + 6, bottom: 26, left: 40 };
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.x)).range([m.left, width - m.right]);
  const stack = d3.stack().keys(keys.map((k) => k.key)).offset(opts.share ? d3.stackOffsetExpand : d3.stackOffsetNone)(rows);
  const yMax = opts.share ? 1 : d3.max(stack[stack.length - 1], (d) => d[1]);
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([height - m.bottom, m.top]);
  const area = d3.area().x((d) => x(d.data.x)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("g").selectAll("text").data(y.ticks(4)).join("text").attr("x", m.left - 8).attr("y", (d) => y(d)).attr("dy", "0.32em")
    .attr("text-anchor", "end").attr("font-size", fs).attr("fill", token("--tick")).text(opts.yFormat || String);
  svg.append("g").selectAll("text").data(x.ticks(6)).join("text").attr("x", (d) => x(d)).attr("y", height - 8)
    .attr("text-anchor", "middle").attr("font-size", fs).attr("fill", token("--tick")).text(opts.xFormat || String);
  svg.append("g").selectAll("path").data(stack).join("path").attr("d", area)
    .attr("fill", (s, i) => keys[i].color).attr("fill-opacity", 0.85).attr("stroke", token("--surface")).attr("stroke-width", 0.5);
  const lastIdx = rows.length - 1;
  const labels = stack.map((s, i) => ({ k: keys[i], y: y((s[lastIdx][0] + s[lastIdx][1]) / 2), span: y(s[lastIdx][0]) - y(s[lastIdx][1]) }))
    .filter((L) => L.span > 0.5);
  dodge(labels, fs + 2, m.top + 4, height - m.bottom);
  for (const L of labels) svg.append("text").attr("x", width - m.right + 6).attr("y", L.y).attr("dy", "0.32em")
    .attr("font-size", fs).attr("font-weight", 600).attr("fill", L.k.color).text(L.k.label);
  // a series that has shrunk to nothing by the end is labelled inside its band, where it was widest
  stack.forEach((s, i) => {
    if (labels.some((L) => L.k === keys[i])) return;
    const j = d3.maxIndex(s, (d) => d[1] - d[0]);
    if (j < 0 || y(s[j][0]) - y(s[j][1]) < fs + 4) return;
    svg.append("text").attr("x", x(rows[j].x) + 6).attr("y", y((s[j][0] + s[j][1]) / 2)).attr("dy", "0.32em")
      .attr("font-size", fs).attr("font-weight", 600).attr("fill", token("--text-inverse")).text(keys[i].label);
  });
  const xs = rows.map((r) => r.x);
  const rule = svg.append("line").attr("y1", m.top).attr("y2", height - m.bottom).attr("stroke", token("--text")).attr("opacity", 0);
  svg.append("rect").attr("x", m.left).attr("y", m.top).attr("width", width - m.left - m.right).attr("height", height - m.top - m.bottom).attr("fill", "transparent")
    .on("mousemove", (event) => {
      const [mx] = d3.pointer(event);
      const i = d3.minIndex(xs, (v) => Math.abs(x(v) - mx));
      const r = rows[i];
      rule.attr("x1", x(r.x)).attr("x2", x(r.x)).attr("opacity", 0.35);
      const total = keys.reduce((a, k) => a + (r[k.key] || 0), 0);
      showTip(event, (opts.tipTitle || String)(r.x), [...keys].reverse().map((k) => [k.label, opts.tipValue(r[k.key] || 0, total), k.color]));
    })
    .on("mouseleave", () => { rule.attr("opacity", 0); hideTip(); });
}
