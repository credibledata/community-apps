// Entry point: router, shared scope, tiles, pages. Queries come from query.js; drawing from
// charts.js; formatting from format.js. DOM is built with createElement/textContent only.

import * as F from "./format.js";
import { Q, J, run, queryKey, queryLabel } from "./query.js";
import * as C from "./charts.js";

// ---------------------------------------------------------------- state
const state = {
  ...F.parseHash(location.hash),
  table: { sort: "sites", dir: "desc", q: "", family: "", all: false, others: false },
  regionMetric: "pct",
  mapMode: "states",
  overviewMap: "sites",
};
const lookups = { species: new Map(), speciesList: [], states: [] };
let epoch = 0;

const main = document.getElementById("main");

// ---------------------------------------------------------------- tiny DOM helper
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const tokenColor = (name) => C.token(name);
const regionColor = (code) => tokenColor(F.REGION_BY_CODE[code]?.token || "--c8");
const speciesName = (code) => lookups.species.get(code)?.common_name || code;

// ---------------------------------------------------------------- query cache + lazy runner
const cache = new Map();
function cached(q) {
  const key = queryKey(q);
  if (!cache.has(key)) {
    const p = run(q).catch((err) => { cache.delete(key); throw err; });
    cache.set(key, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
const queue = [];
let active = 0;
const MAX_ACTIVE = 4;
function enqueue(job) { queue.push(job); pump(); }
function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    Promise.resolve().then(job).finally(() => { active--; pump(); });
  }
}
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); e.target.__load?.(); }
}, { rootMargin: "240px" });

/**
 * A tile: title, caption, reserved height, provenance, and its own loading/empty/error states.
 * queries: () => string[]   render: (body, results[]) => void|Promise
 */
function tile({ title, sub, height = 260, queries, render, tools, cls = "", lazy = true, foot }) {
  const body = h("div", { class: "tile__body", style: { "--tile-h": `${height}px` } });
  const pre = h("pre");
  const prov = h("details", { class: "prov" }, h("summary", { text: "Query" }), pre);
  const subEl = sub ? h("p", { class: "tile__sub", text: typeof sub === "string" ? sub : "" }) : null;
  if (sub && typeof sub !== "string") subEl.append(sub);
  const el = h("section", { class: `tile ${cls}` },
    h("div", { class: "tile__head" }, h("h2", { class: "tile__title", text: title }), tools || null),
    subEl, body, h("div", { class: "tile__foot" }, foot || h("span"), prov));
  const myEpoch = epoch;
  const load = () => enqueue(async () => {
    if (myEpoch !== epoch) return;
    let qs;
    try { qs = queries(); } catch (err) { showError(body, err); return; }
    pre.textContent = qs.map(queryLabel).join("\n\n");
    body.replaceChildren(h("div", { class: "skeleton" }));
    try {
      const results = await Promise.all(qs.map(cached));
      if (myEpoch !== epoch) return; // stale: the page or scope moved on
      body.replaceChildren();
      await render(body, results);
      el.dataset.loaded = "1";
    } catch (err) {
      if (myEpoch !== epoch) return;
      showError(body, err);
    }
  });
  el.__load = load;
  body.append(h("div", { class: "skeleton" }));
  if (lazy) queueMicrotask(() => observer.observe(el)); else load();
  el.reload = load;
  return el;
}
function showError(body, err) {
  console.error(err);
  const msg = err?.response?.message || err?.message || String(err);
  body.replaceChildren(h("div", { class: "state-msg is-error", text: `This tile could not load: ${msg.slice(0, 240)}` }));
}
function empty(body, text) { body.replaceChildren(h("div", { class: "state-msg", text })); }

// ---------------------------------------------------------------- navigation
function go(patch, { push = false } = {}) {
  Object.assign(state, patch);
  const hash = F.buildHash(state);
  if (hash !== location.hash) {
    if (push) history.pushState(null, "", hash); else history.replaceState(null, "", hash);
  }
  render({ scrollTop: push });
}
function setScope(patch) {
  const s = { ...state.scope, ...patch };
  if (patch.state) s.region = lookups.states.find((x) => x.state_code === patch.state)?.region_code || s.region;
  if ("region" in patch && !("state" in patch) && s.state) {
    const st = lookups.states.find((x) => x.state_code === s.state);
    if (!patch.region || st?.region_code !== patch.region) s.state = null;
  }
  if (s.from > s.to) [s.from, s.to] = [s.to, s.from];
  go({ scope: s });
}
const openSpecies = (code) => { if (F.isSpeciesCode(code)) go({ page: "species", code }, { push: true }); };
function toggleCompare(code) {
  const set = state.compare.includes(code) ? state.compare.filter((c) => c !== code) : [...state.compare, code].slice(-4);
  state.compare = set;
  history.replaceState(null, "", F.buildHash(state));
  renderTray();
  document.querySelectorAll(`[data-cmp="${code}"]`).forEach((b) => b.setAttribute("aria-pressed", String(set.includes(code))));
}
window.addEventListener("popstate", () => { Object.assign(state, F.parseHash(location.hash)); render({ scrollTop: true }); });
window.addEventListener("hashchange", () => {
  const p = F.parseHash(location.hash);
  if (F.buildHash({ ...state, ...p }) !== F.buildHash(state)) { Object.assign(state, p); render({ scrollTop: true }); }
});

// ---------------------------------------------------------------- scope bar
function option(value, label, selected) { const o = h("option", { value, text: label }); if (selected) o.selected = true; return o; }
function renderScopeBar() {
  const s = state.scope;
  const reg = document.getElementById("f-region");
  reg.replaceChildren(option("", "All regions", !s.region), ...F.REGIONS.map((r) => option(r.code, r.name, s.region === r.code)));
  const st = document.getElementById("f-state");
  const states = lookups.states.filter((x) => x.region_code !== "XX" && (!s.region || x.region_code === s.region))
    .sort((a, b) => F.stateName(a.state_code).localeCompare(F.stateName(b.state_code)));
  st.replaceChildren(option("", s.region ? `All of ${F.REGION_BY_CODE[s.region].name}` : "All", !s.state),
    ...states.map((x) => option(x.state_code, F.stateName(x.state_code), s.state === x.state_code)));
  const seasons = [];
  for (let y = F.SEASON_MAX; y >= F.SEASON_MIN; y--) seasons.push(y);
  document.getElementById("f-from").replaceChildren(...seasons.map((y) => option(y, F.seasonLabel(y), s.from === y)));
  document.getElementById("f-to").replaceChildren(...seasons.map((y) => option(y, F.seasonLabel(y), s.to === y)));
  document.getElementById("f-housing").replaceChildren(option("", "Any", !s.housing), ...F.HOUSING.map((x) => option(x, x, s.housing === x)));

  const chips = document.getElementById("chips");
  const list = [];
  const chip = (label, onclick) => h("button", { class: "chip", type: "button", onclick, "aria-label": `Remove filter: ${label}` }, label, h("span", { "aria-hidden": "true", text: "×" }));
  if (s.state) list.push(chip(F.stateName(s.state), () => setScope({ state: null })));
  else if (s.region) list.push(chip(F.REGION_BY_CODE[s.region].name, () => setScope({ region: null })));
  if (s.from !== F.DEFAULT_SCOPE.from || s.to !== F.DEFAULT_SCOPE.to) {
    list.push(chip(s.from === s.to ? F.seasonLabel(s.from) : `${F.seasonLabel(s.from)} – ${F.seasonLabel(s.to)}`, () => setScope({ from: F.DEFAULT_SCOPE.from, to: F.DEFAULT_SCOPE.to })));
  }
  if (s.housing) list.push(chip(s.housing, () => setScope({ housing: null })));
  if (list.length > 1) list.push(h("button", { class: "linkish", type: "button", text: "Reset all", onclick: () => go({ scope: { ...F.DEFAULT_SCOPE } }) }));
  chips.replaceChildren(...list);
}
function wireScopeBar() {
  document.getElementById("f-region").addEventListener("change", (e) => setScope({ region: e.target.value || null }));
  document.getElementById("f-state").addEventListener("change", (e) => setScope({ state: e.target.value || null }));
  document.getElementById("f-from").addEventListener("change", (e) => setScope({ from: Number(e.target.value) }));
  document.getElementById("f-to").addEventListener("change", (e) => setScope({ to: Number(e.target.value) }));
  document.getElementById("f-housing").addEventListener("change", (e) => setScope({ housing: e.target.value || null }));
}

// ---------------------------------------------------------------- species search (combobox)
function wireSearch() {
  const input = document.getElementById("search");
  const list = document.getElementById("search-list");
  let items = [];
  let idx = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); idx = -1; };
  const choose = (code) => { close(); input.value = ""; input.blur(); openSpecies(code); };
  const paint = () => {
    list.replaceChildren(...items.map((s, i) => {
      const li = h("li", { role: "option", id: `opt-${s.species_code}`, "aria-selected": String(i === idx) },
        h("span", { text: s.common_name }), h("small", { text: s.family_name || "" }));
      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(s.species_code); });
      return li;
    }));
    list.hidden = !items.length;
    input.setAttribute("aria-expanded", String(!!items.length));
    if (idx >= 0) input.setAttribute("aria-activedescendant", `opt-${items[idx].species_code}`);
  };
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { items = []; paint(); return; }
    items = lookups.speciesList
      .filter((s) => s.common_name.toLowerCase().includes(q) || (s.scientific_name || "").toLowerCase().includes(q) || s.species_code === q)
      .sort((a, b) => (a.category === "species" ? 0 : 1) - (b.category === "species" ? 0 : 1)
        || (a.common_name.toLowerCase().startsWith(q) ? 0 : 1) - (b.common_name.toLowerCase().startsWith(q) ? 0 : 1)
        || b.n_records - a.n_records)
      .slice(0, 12);
    idx = items.length ? 0 : -1;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { idx = Math.min(items.length - 1, idx + 1); paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { idx = Math.max(0, idx - 1); paint(); e.preventDefault(); }
    else if (e.key === "Enter" && idx >= 0) { choose(items[idx].species_code); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

// ---------------------------------------------------------------- compare tray
function renderTray() {
  const tray = document.getElementById("tray");
  if (!state.compare.length || state.page === "compare") { tray.hidden = true; return; }
  tray.hidden = false;
  tray.replaceChildren(
    h("span", { text: "Compare" }),
    ...state.compare.map((c) => h("button", { class: "chip", type: "button", onclick: () => toggleCompare(c), "aria-label": `Remove ${speciesName(c)} from comparison` },
      speciesName(c), h("span", { "aria-hidden": "true", text: "×" }))),
    h("a", { class: "btn btn--primary", href: F.buildHash({ ...state, page: "compare" }), text: `Compare ${state.compare.length}` }),
  );
}
function compareButton(code, small = true) {
  const on = state.compare.includes(code);
  if (small) {
    return h("button", { class: "add-btn", type: "button", "data-cmp": code, "aria-pressed": String(on), title: "Add to comparison",
      "aria-label": `Add ${speciesName(code)} to comparison`, onclick: (e) => { e.stopPropagation(); toggleCompare(code); } }, "+");
  }
  return h("button", { class: "btn", type: "button", "data-cmp": code, "aria-pressed": String(on), onclick: () => toggleCompare(code) }, "+ Compare");
}

// ---------------------------------------------------------------- shared pieces
const scopeText = () => F.describeScope(state.scope, F.stateName);
const scopeNoSeason = () => {
  const s = state.scope;
  const parts = [s.state ? F.stateName(s.state) : s.region ? F.REGION_BY_CODE[s.region].name : "All of North America"];
  if (s.housing) parts.push(`${s.housing} sites`);
  return parts.join(" · ");
};
const band = () => [state.scope.from, state.scope.to];
const bandLabel = () => (state.scope.from === state.scope.to ? "selected season" : "selected seasons");
function deltaSpan(delta, fmt = F.pts) {
  if (delta == null) return h("span", { class: "delta", text: "—" });
  return h("span", { class: `delta ${delta > 0.0005 ? "up" : delta < -0.0005 ? "down" : ""}`, text: fmt(delta) });
}
function trendPoints(trend, key = "season_pct") {
  const by = new Map((trend || []).map((t) => [t.season, t[key]]));
  const out = [];
  for (let y = F.SEASON_MIN; y <= F.SEASON_MAX; y++) out.push({ x: y, y: by.has(y) ? by.get(y) : null });
  return out;
}
function seg(options, value, onChange, label) {
  return h("div", { class: "seg", role: "group", "aria-label": label },
    ...options.map(([v, text]) => h("button", { type: "button", "aria-pressed": String(v === value), onclick: () => onChange(v) }, text)));
}

// ================================================================= PAGE: feeder birds
function pageBirds() {
  const lede = h("p", { class: "lede" }, "Loading the population…");
  const hero = h("div", { class: "hero" });
  const page = h("div", { class: "page wrap" },
    h("h1", { class: "title", text: "Feeder birds" }), lede, hero);

  // hero + lede: participation per season, the species count, the top bird
  Promise.all([cached(Q.seasons(state.scope)), cached(Q.ranking(state.scope))]).then(([seasons, ranking]) => {
    const my = seasons; const s = state.scope;
    const inRange = my.filter((r) => r.season >= s.from && r.season <= s.to);
    const last = my.find((r) => r.season === s.to);
    const first = my.find((r) => r.season === F.SEASON_MIN);
    const full = ranking.filter((r) => r.category === "species");
    const top = full[0];
    const siteSeasons = inRange.reduce((a, r) => a + r.site_count, 0);
    lede.replaceChildren(
      `In ${scopeText()}, FeederWatchers reported `, h("strong", { text: `${F.num(full.length)} species` }),
      ` across ${F.num(siteSeasons)} site-seasons of counts.`,
      ...(top ? [" ", h("strong", { text: top.common_name }), ` turned up at the most sites: ${F.pct(top.pct_sites, 0)} of them.`] : []),
      " Pick any bird to see where, when and how its numbers have changed.");
    hero.replaceChildren(
      h("div", { class: "hero__cell hero__lead" },
        h("p", { class: "kicker hero__full", text: `Active count sites, ${F.seasonLabel(s.to)}` }),
        h("p", { class: "big", text: last ? F.num(last.site_count) : "—" }),
        h("div", { class: "spark-wrap" }, C.sparkline(my.map((r) => ({ x: r.season, y: r.site_count })), { width: 180, height: 52, band: band(), xDomain: [F.SEASON_MIN, F.SEASON_MAX] })),
        h("p", { class: "note hero__full" }, first && last ? `${F.num(first.site_count)} in ${F.seasonLabel(F.SEASON_MIN)}; the shaded band is the selected seasons` : "No sites in scope")),
      h("div", { class: "hero__cell" }, h("p", { class: "kicker", text: "Species per site" }),
        h("p", { class: "mid", text: last ? last.avg_species_per_site.toFixed(1) : "—" }),
        h("p", { class: "note" }, `average over a season, ${F.seasonLabel(s.to)}; ${first ? first.avg_species_per_site.toFixed(1) : "—"} in ${F.seasonLabel(F.SEASON_MIN)}`)),
      h("div", { class: "hero__cell" }, h("p", { class: "kicker", text: "Checklists" }),
        h("p", { class: "mid", text: F.num(inRange.reduce((a, r) => a + r.checklist_count, 0)) }),
        h("p", { class: "note", text: `two-day counts, ${s.from === s.to ? F.seasonLabel(s.to) : `${F.seasonLabel(s.from)} to ${F.seasonLabel(s.to)}`}` })),
      h("div", { class: "hero__cell" }, h("p", { class: "kicker", text: "Species reported" }),
        h("p", { class: "mid", text: F.num(full.length) }),
        h("p", { class: "note", text: `plus ${F.num(ranking.length - full.length)} slashes, hybrids and “sp.” reports` })));
  }).catch((err) => { lede.textContent = `Could not load the summary: ${err.message}`; });

  // ranked table + participation map
  const tableTile = tile({
    title: "Which birds visit the most feeders",
    sub: "Percent of sites visited: the share of count sites where the species was reported at least once in a season, FeederWatch’s own headline measure. Click a bird to explore it.",
    height: 900, lazy: false,
    queries: () => [Q.ranking(state.scope), Q.history(state.scope), Q.windowSites(state.scope)],
    render: (body, [ranking, history, [win]]) => renderRankTable(body, ranking, history, win),
  });
  const mapTile = tile({
    title: "Where FeederWatchers count",
    sub: "Count sites per state or province in the selected seasons. Click one to narrow the whole page to it.",
    height: 400, cls: "is-sticky", lazy: false,
    tools: seg([["sites", "Sites"], ["richness", "Species per site"]], state.overviewMap, (v) => { state.overviewMap = v; mapTile.reload(); }, "Map metric"),
    queries: () => [Q.participationMap(state.scope)],
    render: (body, [rows]) => {
      const rich = state.overviewMap === "richness";
      const values = new Map(rows.filter((r) => F.isStateCode(r.state_code)).map((r) => [r.state_code, { value: rich ? r.avg_species_per_site : r.site_count, n: r.site_count, r }]));
      if (!values.size) return empty(body, "No sites in this scope.");
      return C.choropleth(body, values, {
        height: 400, selected: state.scope.state, min: rich ? 10 : 0,
        format: rich ? (v) => v.toFixed(0) : F.num,
        legendTitle: rich ? "Species per site-season" : "Site-seasons",
        domain: rich ? undefined : [0, Math.max(...[...values.values()].map((d) => d.value))],
        nameOf: F.stateName,
        tipLines: (code, d) => [["Site-seasons", F.num(d.r.site_count)], ["Distinct sites", F.num(d.r.distinct_sites)], ["Checklists", F.num(d.r.checklist_count)], ["Species per site", d.r.avg_species_per_site.toFixed(1)]],
        onClick: (code) => setScope({ state: state.scope.state === code ? null : code }),
      });
    },
  });
  page.append(h("div", { class: "grid grid--wide" }, tableTile, mapTile));

  // gainers and decliners
  const moversTile = tile({
    title: "Who’s gaining, who’s losing",
    sub: `Percent of sites visited in ${F.EARLY.label} against ${F.RECENT.label}, in ${scopeNoSeason()}. These two windows are fixed so the comparison means the same thing everywhere; the season filter does not apply. Dot size is sites reporting it recently.`,
    height: 460,
    queries: () => [Q.history(state.scope), Q.windowSites(state.scope)],
    render: (body, [history, [win]]) => renderMovers(body, history, win),
  });
  page.append(h("div", { class: "grid" }, moversTile));
  return page;
}

function renderRankTable(body, ranking, history, win) {
  const hist = new Map(history.map((r) => [r.species_code, r]));
  const T = state.table;
  const lowEarly = (win?.sites_early || 0) < F.MIN_SITES;
  const lowRecent = (win?.sites_recent || 0) < F.MIN_SITES;
  const rows = ranking.map((r) => {
    const hr = hist.get(r.species_code);
    const change = lowEarly || lowRecent || !hr ? null : F.diff(hr.pct_recent, hr.pct_early);
    return { ...r, change, trend: hr?.trend || [] };
  });
  const families = [...new Set(rows.filter((r) => r.category === "species").map((r) => r.family_name).filter(Boolean))].sort();

  const search = h("input", { type: "search", placeholder: "Filter by name…", value: T.q, "aria-label": "Filter birds by name" });
  const fam = h("select", { "aria-label": "Family" }, option("", "All families", !T.family), ...families.map((f) => option(f, f, T.family === f)));
  const others = h("input", { type: "checkbox" }); others.checked = T.others;
  const tableWrap = h("div", { class: "table-scroll" });
  const more = h("div", { class: "more" });
  body.append(h("div", { class: "table-tools" }, search, fam, h("label", {}, others, "Include slashes, hybrids, “sp.”")), tableWrap, more);

  const cols = [
    { key: "rank", label: "#", cls: "rk" },
    { key: "name", label: "Species", sort: (a, b) => a.common_name.localeCompare(b.common_name) },
    { key: "sites", label: "Sites visited", num: true, sort: (a, b) => a.sites_reporting - b.sites_reporting },
    { key: "trend", label: `${F.SEASON_MIN}–${String(F.SEASON_MAX).slice(2)}` },
    { key: "change", label: `Since ${F.EARLY.label}`, num: true, sort: (a, b) => (a.change ?? -9) - (b.change ?? -9) },
    { key: "flock", label: "Avg flock", num: true, sort: (a, b) => (a.avg_flock_size ?? 0) - (b.avg_flock_size ?? 0) },
    { key: "cmp", label: "" },
  ];
  const maxChange = Math.max(0.1, ...rows.map((r) => Math.abs(r.change ?? 0)));
  const maxPct = Math.max(...rows.map((r) => r.pct_sites || 0), 0.01);

  const draw = () => {
    const q = T.q.trim().toLowerCase();
    let list = rows.filter((r) => (T.others || r.category === "species") && (!T.family || r.family_name === T.family)
      && (!q || r.common_name.toLowerCase().includes(q)));
    const col = cols.find((c) => c.key === T.sort) || cols[2];
    list.sort((a, b) => (T.dir === "asc" ? 1 : -1) * col.sort(a, b) || b.sites_reporting - a.sites_reporting);
    const total = list.length;
    if (!T.all) list = list.slice(0, 40);
    const thead = h("thead", {}, h("tr", {}, ...cols.map((c) => {
      const th = h("th", { class: c.num ? "num" : "", scope: "col" });
      if (c.sort) {
        th.setAttribute("aria-sort", T.sort === c.key ? (T.dir === "asc" ? "ascending" : "descending") : "none");
        th.append(h("button", { type: "button", text: c.label, onclick: () => { if (T.sort === c.key) T.dir = T.dir === "asc" ? "desc" : "asc"; else { T.sort = c.key; T.dir = c.key === "name" ? "asc" : "desc"; } draw(); } }));
      } else th.textContent = c.label;
      return th;
    })));
    const tbody = h("tbody");
    list.forEach((r, i) => {
      const changeCell = h("td", { class: "num" });
      if (r.change == null) changeCell.append(h("span", { class: "lowdata", text: "—" }));
      else {
        const w = Math.max(1, (Math.abs(r.change) / maxChange) * 50);
        const rule = h("span", { class: "div-rule" }, h("span", { style: { left: r.change >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: r.change >= 0 ? tokenColor("--positive") : tokenColor("--negative") } }));
        changeCell.append(h("span", { class: "inline-row" }, rule, deltaSpan(r.change)));
      }
      const tr = h("tr", { tabindex: "0", onclick: () => openSpecies(r.species_code), onkeydown: (e) => { if (e.key === "Enter") openSpecies(r.species_code); } },
        h("td", { class: "rk", text: String(i + 1) }),
        h("td", {}, h("span", { class: "nm", text: r.common_name }), r.category !== "species" ? h("span", { class: "tag", text: r.category }) : null, h("span", { class: "fam", text: r.family_name || "" })),
        h("td", { class: "num" }, h("span", { class: "inline-row" },
          h("span", { class: "bar bar--rank" }, h("span", { style: { width: `${(r.pct_sites / maxPct) * 100}%` } })),
          h("span", { class: "num-cell", text: F.pct(r.pct_sites) }))),
        h("td", {}, C.sparkline(trendPoints(r.trend), { width: 92, height: 24, band: band(), xDomain: [F.SEASON_MIN, F.SEASON_MAX], color: tokenColor("--ocean-blue") })),
        changeCell,
        h("td", { class: "num", text: F.birds(r.avg_flock_size) }),
        h("td", {}, compareButton(r.species_code)));
      tbody.append(tr);
    });
    tableWrap.replaceChildren(h("table", { class: "rank" }, thead, tbody));
    more.replaceChildren(total > 40 ? h("button", { class: "btn", type: "button", text: T.all ? "Show top 40" : `Show all ${F.num(total)}`, onclick: () => { T.all = !T.all; draw(); } }) : "",
      lowEarly ? h("p", { class: "note", text: `Too few sites in this scope in ${F.EARLY.label} to measure change.` }) : "");
    if (!total) tableWrap.replaceChildren(h("div", { class: "state-msg", text: "No birds match these filters." }));
  };
  search.addEventListener("input", () => { T.q = search.value; draw(); });
  fam.addEventListener("change", () => { T.family = fam.value; draw(); });
  others.addEventListener("change", () => { T.others = others.checked; draw(); });
  draw();
}

function renderMovers(body, history, win) {
  if ((win?.sites_early || 0) < F.MIN_SITES || (win?.sites_recent || 0) < F.MIN_SITES) {
    return empty(body, `Too few count sites in ${scopeNoSeason()} in ${F.EARLY.label} (${F.num(win?.sites_early || 0)}) to compare eras.`);
  }
  const sp = history.filter((r) => lookups.species.get(r.species_code)?.category === "species" && r.pct_early != null && r.pct_recent != null
    && Math.max(r.pct_early, r.pct_recent) >= 0.03);
  const withD = sp.map((r) => ({ ...r, d: r.pct_recent - r.pct_early })).sort((a, b) => b.d - a.d);
  const list = (rows, cls, title) => h("div", {}, h("h3", { class: `list-h ${cls}`, text: title }),
    h("table", { class: "mini" }, h("tbody", {}, ...rows.map((r) => h("tr", { class: "is-clickable", tabindex: "0", onclick: () => openSpecies(r.species_code), onkeydown: (e) => { if (e.key === "Enter") openSpecies(r.species_code); } },
      h("td", { text: speciesName(r.species_code) }),
      h("td", { class: "num muted", text: `${F.pct(r.pct_early, 0)} → ${F.pct(r.pct_recent, 0)}` }),
      h("td", { class: "num" }, deltaSpan(r.d)))))));
  const chart = h("div");
  body.append(h("div", { class: "grid grid--2r grid--flush" },
    h("div", { class: "stack stack--tight" }, list(withD.slice(0, 10), "up", "Visiting more sites"), list(withD.slice(-10).reverse(), "down", "Visiting fewer sites")),
    chart));
  requestAnimationFrame(() => C.changeScatter(chart, withD.map((r) => ({ id: r.species_code, label: speciesName(r.species_code), x: r.pct_early, y: r.pct_recent, n: r.reports_recent })), {
    height: 520, format: (v) => F.pct(v, 0), xLabel: `% of sites, ${F.EARLY.label} →`, yLabel: `↑ % of sites, ${F.RECENT.label}`,
    labelCount: 7, highlight: new Set(state.compare), onClick: openSpecies,
    tipLines: (p) => [[F.EARLY.label, F.pct(p.x)], [F.RECENT.label, F.pct(p.y)], ["Change", F.pts(p.y - p.x)]],
  }));
}

// ================================================================= PAGE: one species
function pageSpecies() {
  const code = state.code;
  const sp = lookups.species.get(code);
  if (!sp) return h("div", { class: "page wrap" }, h("h1", { class: "title", text: "Not found" }), h("p", { class: "lede", text: `No FeederWatch records for “${code}”.` }));
  const links = F.speciesLinks(code, sp.common_name);
  const hero = h("div", { class: "hero" }, h("div", { class: "hero__cell" }, h("div", { class: "skeleton skeleton--hero" })));
  const page = h("div", { class: "page wrap" },
    h("p", { class: "crumbs" }, h("a", { href: F.buildHash({ ...state, page: "birds", code: null }), text: "Feeder birds" }), ` / ${sp.family_name || ""}`),
    h("h1", { class: "title", text: sp.common_name }),
    h("p", { class: "sci-line" }, h("span", { class: "sci", text: sp.scientific_name }), sp.category !== "species" ? h("span", { class: "tag", text: sp.category }) : null),
    h("div", { class: "actions" }, compareButton(code, false),
      h("a", { class: "btn", href: links.ebird, target: "_blank", rel: "noopener", text: "eBird species page ↗" }),
      sp.category === "species" ? h("a", { class: "btn", href: links.allAboutBirds, target: "_blank", rel: "noopener", text: "All About Birds ↗" }) : null),
    hero);

  Promise.all([cached(Q.summary(code, state.scope)), cached(Q.speciesHistory(code, state.scope)), cached(Q.trend(code, state.scope)), cached(Q.ranking(state.scope))])
    .then(([[sum], [hist], trend, ranking]) => {
      if (!sum || !sum.site_count) { hero.replaceChildren(h("div", { class: "hero__cell" }, h("p", { class: "note", text: "No count sites in this scope." }))); return; }
      const full = ranking.filter((r) => r.category === "species");
      const rank = full.findIndex((r) => r.species_code === code);
      const lowEarly = (hist?.sites_early || 0) < F.MIN_SITES;
      const change = lowEarly ? null : F.diff(hist.pct_recent, hist.pct_early);
      const pts = trend.map((t) => ({ x: t.season, y: t.site_count >= F.MIN_SITES ? t.pct_sites : null }));
      hero.replaceChildren(
        h("div", { class: "hero__cell hero__lead" },
          h("p", { class: "kicker hero__full", text: "Percent of sites visited" }),
          h("p", { class: "big", text: F.pct(sum.pct_sites) }),
          h("div", { class: "spark-wrap" }, C.sparkline(pts, { width: 180, height: 52, band: band(), xDomain: [F.SEASON_MIN, F.SEASON_MAX], color: tokenColor("--accent") })),
          h("p", { class: "note hero__full" }, `${F.num(sum.sites_reporting)} of ${F.num(sum.site_count)} site-seasons · ${scopeText()}`),
          h("p", { class: "note hero__full" }, `${F.EARLY.label} → ${F.RECENT.label}: `, lowEarly ? "too few early sites " : `${F.pct(hist.pct_early, 0)} → ${F.pct(hist.pct_recent, 0)} `, deltaSpan(change))),
        h("div", { class: "hero__cell" }, h("p", { class: "kicker", text: "Average flock size" }),
          h("p", { class: "mid", text: F.birds(sum.avg_flock_size) }),
          h("p", { class: "note" }, "birds per count when seen; ", lowEarly ? "" : `${F.birds(hist.flock_early)} → ${F.birds(hist.flock_recent)} since ${F.EARLY.label}`)),
        h("div", { class: "hero__cell" }, h("p", { class: "kicker", text: "Share of checklists" }),
          h("p", { class: "mid", text: F.pct(sum.pct_checklists) }),
          h("p", { class: "note", text: `of two-day counts reported it; largest count ${F.num(sum.max_count)}` })),
        h("div", { class: "hero__cell" }, h("p", { class: "kicker", text: "Rank by sites" }),
          h("p", { class: "mid", text: rank >= 0 ? `#${rank + 1}` : "—" }),
          h("p", { class: "note", text: rank >= 0 ? `of ${F.num(full.length)} species in scope` : "not reported in scope" })));
    }).catch((err) => hero.replaceChildren(h("div", { class: "hero__cell" }, h("p", { class: "note", text: `Could not load: ${err.message}` }))));

  // FeederWatch-style regional trend
  const regionTile = tile({
    title: "Trend by region",
    sub: "The six FeederWatch regions, as on feederwatch.org’s trend graphs. Seasons with fewer than 30 count sites in a region are left out rather than plotted from a handful of yards.",
    height: 340, lazy: false,
    tools: seg([["pct", "% of sites"], ["flock", "Avg flock size"]], state.regionMetric, (v) => { state.regionMetric = v; regionTile.reload(); }, "Trend metric"),
    queries: () => [Q.trendByRegion(code, state.scope), Q.trend(code, state.scope)],
    render: (body, [rows, overall]) => {
      const flock = state.regionMetric === "flock";
      const key = flock ? "avg_flock_size" : "pct_sites";
      const focus = state.scope.region;
      const series = F.REGIONS.map((r) => ({
        key: r.code, label: r.name, color: regionColor(r.code),
        emphasis: focus === r.code, muted: !!focus && focus !== r.code,
        points: rows.filter((x) => x.region_code === r.code).map((x) => ({ x: x.season, y: x.site_count >= F.MIN_SITES ? x[key] : null, n: x.site_count })),
      })).filter((s) => s.points.some((p) => p.y != null && (flock || p.y > 0.002)));
      // The scope line: all of North America when unscoped; the state or housing scope when set.
      // A region alone needs no extra line: its own regional line already is the scope.
      const s0 = state.scope;
      if (!s0.region || s0.state || s0.housing) {
        const scoped = !!(s0.region || s0.state || s0.housing);
        series.push({ key: "all", label: scoped ? scopeNoSeason() : "All regions", color: tokenColor("--warm-black"), dash: !scoped, emphasis: scoped,
          points: overall.map((x) => ({ x: x.season, y: x.site_count >= F.MIN_SITES ? x[key] : null, n: x.site_count })) });
      }
      if (!series.some((s) => s.points.some((p) => p.y != null))) return empty(body, "Not reported in any region.");
      C.lineChart(body, series, {
        height: 340, xDomain: [F.SEASON_MIN, F.SEASON_MAX], band: band(), bandLabel: bandLabel(),
        yFormat: flock ? (v) => v.toFixed(0) : (v) => F.pct(v, 0), xFormat: (v) => String(v),
        tipTitle: (x) => `${F.seasonLabel(x)} season`, tipValue: (v, s, p) => `${flock ? F.birds(v) : F.pct(v)} · ${F.num(p.n)} sites`,
      });
    },
  });
  page.append(h("div", { class: "grid" }, regionTile));

  // map + housing + yard
  const mapTile = tile({
    title: "Where it visits feeders",
    sub: `Percent of sites visited, ${state.scope.from === state.scope.to ? F.seasonLabel(state.scope.from) : `${F.seasonLabel(state.scope.from)} to ${F.seasonLabel(state.scope.to)}`}. Click a state or province to focus on it; grey means fewer than 20 site-seasons.`,
    height: 420,
    tools: seg([["states", "States & provinces"], ["grid", "Half-degree grid"]], state.mapMode, (v) => { state.mapMode = v; mapTile.reload(); }, "Map detail"),
    queries: () => (state.mapMode === "grid" ? Q.grid(code, state.scope) : [Q.stateMap(code, state.scope)]),
    render: (body, results) => {
      const [rows] = results;
      if (state.mapMode === "grid") {
        return C.gridMap(body, J.grid(results).map((r) => ({ lat: r.grid_lat, lon: r.grid_lon, value: r.pct_sites, n: r.site_count })), {
          height: 420, min: 3, format: (v) => F.pct(v, 0), legendTitle: "% of sites (cells with 3+ sites)", domain: [0, 1],
          tipLines: (c) => [["% of sites", F.pct(c.value)], ["Site-seasons", F.num(c.n)]],
        });
      }
      const values = new Map(rows.filter((r) => F.isStateCode(r.state_code)).map((r) => [r.state_code, { value: r.pct_sites, n: r.site_count, r }]));
      return C.choropleth(body, values, {
        height: 420, selected: state.scope.state, min: 20, domain: [0, Math.max(0.05, ...rows.filter((r) => r.site_count >= 20).map((r) => r.pct_sites))],
        format: (v) => F.pct(v, 0), legendTitle: "% of sites visited", nameOf: F.stateName,
        tipLines: (c, d) => [["% of sites", F.pct(d.value)], ["Sites reporting", `${F.num(d.r.sites_reporting)} of ${F.num(d.r.site_count)}`], ["Avg flock", F.birds(d.r.avg_flock_size)]],
        onClick: (c) => setScope({ state: state.scope.state === c ? null : c }),
      });
    },
  });
  const housingTile = tile({
    title: "Rural to urban",
    sub: "Percent of sites visited by the housing density the participant described. Ignores the housing filter.",
    height: 200,
    queries: () => [Q.byHousing(code, state.scope)],
    render: (body, [rows]) => {
      if (!rows.length) return empty(body, "No described sites in scope.");
      C.columns(body, rows.map((r) => ({ label: r.housing_density, value: r.site_count >= F.MIN_SITES ? r.pct_sites : null, r })), {
        height: 200, format: (v) => F.pct(v, 0), accent: state.scope.housing,
        tipLines: (x) => [["% of sites", F.pct(x.r.pct_sites)], ["Site-seasons", F.num(x.r.site_count)], ["Avg flock", F.birds(x.r.avg_flock_size)]],
      });
    },
  });
  
  const yardTile = tile({
    title: "Yards where it turns up",
    sub: "Percent of sites visited at sites with each feature (filled dot) and without it (open dot), among sites that answered. These are associations: yards differ in many ways at once, and region matters most, so narrow the region for a fairer comparison.",
    height: 520,
    queries: () => Q.yardEffects(code, state.scope),
    render: (body, results) => {
      const row = J.yardEffects(results);
      const items = F.FEATURES.map((f) => ({ label: f.label, a: row[`${f.key}_yes`], b: row[`${f.key}_no`], key: f.key }))
        .sort((x, y) => ((y.a ?? -1) - (y.b ?? 0)) - ((x.a ?? -1) - (x.b ?? 0)));
      C.dumbbell(body, items, {
        format: (v) => F.pct(v, 0), deltaFormat: F.pts,
        tipLines: (r) => [["With", F.pct(r.a)], ["Without", F.pct(r.b)], ["Difference", F.pts(F.diff(r.a, r.b))]],
      });
    },
  });
  const timingTile = tile({
    title: "When in the season",
    sub: "Share of two-day counts reporting it, week by week from 1 November, in each era of the project. Ignores the season and housing filters.",
    height: 300,
    queries: () => Q.timingByEra(code, state.scope),
    render: (body, results) => {
      const rows = J.timingByEra(results);
      const eras = [["1989-1999", "--c8"], ["2000-2009", "--c2"], ["2010-2019", "--c3"], ["2020-2024", "--accent"]];
      const series = eras.map(([era, tok]) => ({ key: era, label: era.replace("-", "–"), color: tokenColor(tok), emphasis: era === "2020-2024",
        points: rows.filter((r) => r.era === era).map((r) => ({ x: r.season_week, y: r.checklist_count >= 500 ? r.pct_checklists : null, n: r.checklist_count })) }))
        .filter((s) => s.points.some((p) => p.y != null));
      if (!series.length) return empty(body, "Too few checklists in this scope.");
      C.lineChart(body, series, {
        height: 300, xDomain: [0, 25], xTicks: [0, 4, 9, 13, 17, 22], xFormat: F.weekLabel, yFormat: (v) => F.pct(v, 0),
        tipTitle: (w) => `Week of ${F.weekLabel(w)}`, tipValue: (v, s, p) => `${F.pct(v)} · ${F.num(p.n)} counts`,
      });
    },
  });
  const yardRow = h("div", { class: "grid grid--2r" }, yardTile, h("div", { class: "stack" }, timingTile,
    h("div", { class: "grid grid--even grid--flush" },
      tile({
        title: "Snow on the ground", sub: "Share of counts reporting it, by snow depth.", height: 190,
        queries: () => Q.bySnow(code, state.scope),
        render: (body, results, rows = J.bySnow(results)) => rows.length ? C.columns(body, rows.map((r) => ({ label: r.snow_depth.replace("Under ", "<").replace("Over ", ">"), value: r.pct_checklists, r })), {
          height: 190, format: (v) => F.pct(v, 0), tipLines: (x) => [["Share of counts", F.pct(x.r.pct_checklists)], ["Counts", F.num(x.r.checklist_count)], ["Avg flock", F.birds(x.r.avg_flock_size)]] }) : empty(body, "No snow data."),
      }),
      tile({
        title: "Hours watched", sub: "More time watching finds more birds: effort matters.", height: 190,
        queries: () => Q.byEffort(code, state.scope),
        render: (body, results, rows = J.byEffort(results)) => rows.length ? C.columns(body, rows.map((r) => ({ label: r.effort_hours.replace(" hours", "h").replace(" hour", "h").replace("Under ", "<").replace("Over ", ">"), value: r.pct_checklists, r })), {
          height: 190, format: (v) => F.pct(v, 0), tipLines: (x) => [["Share of counts", F.pct(x.r.pct_checklists)], ["Counts", F.num(x.r.checklist_count)]] }) : empty(body, "No effort data."),
      }),
    )));

  const flockTile = tile({
    title: "How many at once",
    sub: "Each report is the most birds seen at one time during a two-day count. Accepted reports only.",
    height: 220,
    queries: () => [Q.flockSizes(code, state.scope)],
    render: (body, [rows]) => {
      const total = rows.reduce((a, r) => a + r.records, 0);
      if (!total) return empty(body, "No reports in scope.");
      const modal = rows.reduce((a, r) => (r.records > a.records ? r : a), rows[0]);
      C.columns(body, rows.map((r) => ({ label: r.flock_band, value: r.records / total, r })), {
        height: 220, format: (v) => F.pct(v, 0), accent: modal.flock_band,
        tipLines: (x) => [["Share of reports", F.pct(x.value)], ["Reports", F.num(x.r.records)]],
      });
    },
  });
  const companionsTile = tile({
    title: "Seen alongside",
    sub: "Other species on the same two-day counts: the share of this bird’s counts that also had them, and lift, how much more often than on counts in general (1× = no different). Lift partly reflects shared range and habitat. Read for the whole region (a selected state reads its region); ignores the housing filter.",
    height: 420,
    queries: () => Q.companions(code, state.scope),
    render: (body, results) => {
      const list = J.companions(results, code).filter((r) => r.species_code !== code && r.category === "species").slice(0, 15);
      if (!list.length) return empty(body, "No companions in scope.");
      const max = Math.max(...list.map((r) => r.share_with_focal));
      body.append(h("table", { class: "mini" },
        h("thead", {}, h("tr", {}, h("th", { text: "Species" }), h("th", { class: "num", text: "Share of its counts" }), h("th", { class: "num", text: "Lift" }))),
        h("tbody", {}, ...list.map((r) => h("tr", { class: "is-clickable", tabindex: "0", onclick: () => openSpecies(r.species_code), onkeydown: (e) => { if (e.key === "Enter") openSpecies(r.species_code); } },
          h("td", { text: r.common_name }),
          h("td", { class: "num" }, h("span", { class: "inline-row" },
            h("span", { class: "bar bar--rank" }, h("span", { style: { width: `${(r.share_with_focal / max) * 100}%` } })), F.pct(r.share_with_focal, 0))),
          h("td", { class: "num" }, h("span", { class: `delta ${r.lift >= 1.25 ? "up" : r.lift <= 0.8 ? "down" : ""}`, text: F.times(r.lift) })))))));
    },
  });

  const qualityTile = tile({
    title: "How reports were checked",
    sub: "FeederWatch flags unexpected species and high counts for its state or province and month; experts review them. Only accepted and approved reports count anywhere else on this page.",
    height: 60,
    queries: () => [Q.reviewStates(code, state.scope)],
    render: (body, [rows]) => {
      const total = rows.reduce((a, r) => a + r.records, 0);
      if (!total) return empty(body, "No reports in scope.");
      const order = ["Accepted (not flagged)", "Approved after review", "Awaiting review", "Unconfirmed after review"];
      const colors = { "Accepted (not flagged)": "--forest-green", "Approved after review": "--forest-green-tint-1", "Awaiting review": "--gold", "Unconfirmed after review": "--negative" };
      const sorted = order.map((k) => rows.find((r) => r.review_status === k)).filter(Boolean);
      body.append(h("div", { class: "strip" },
        ...sorted.map((r) => h("span", { title: `${r.review_status}: ${F.num(r.records)}`, style: { width: `${(r.records / total) * 100}%`, background: tokenColor(colors[r.review_status]) } }))));
      body.append(h("div", { class: "legend-row" },
        ...sorted.map((r) => h("span", {}, h("span", { class: "swatch", style: { background: tokenColor(colors[r.review_status]) } }),
          `${r.review_status}: `, h("strong", { text: `${F.num(r.records)}` }), ` (${F.pct(r.records / total)})`))));
    },
  });
  page.append(h("div", { class: "grid grid--2" }, mapTile, h("div", { class: "stack" }, housingTile, flockTile)), yardRow, h("div", { class: "grid grid--2" }, companionsTile, qualityTile));
  return page;
}

// ================================================================= PAGE: compare
function pageCompare() {
  const codes = state.compare.filter((c) => lookups.species.has(c));
  const palette = ["--c1", "--c2", "--c3", "--c4"].map(tokenColor);
  const colorOf = (c) => palette[codes.indexOf(c)];
  const picker = h("select", { "aria-label": "Add a species" }, option("", codes.length >= 4 ? "Remove one to add another" : "+ Add a species…", true),
    ...lookups.speciesList.filter((s) => s.category === "species" && !codes.includes(s.species_code)).sort((a, b) => b.n_records - a.n_records).slice(0, 300)
      .map((s) => option(s.species_code, s.common_name, false)));
  picker.disabled = codes.length >= 4;
  picker.addEventListener("change", () => { if (picker.value) { toggleCompare(picker.value); render({}); } });
  const page = h("div", { class: "page wrap" },
    h("h1", { class: "title", text: "Compare birds" }),
    h("p", { class: "lede", text: `Up to four species side by side, with identical definitions, in ${scopeNoSeason()}. Add birds from the ranked list with +, from a species page, or here.` }),
    h("div", { class: "compare-legend" },
      ...codes.map((c) => h("button", { class: "chip", type: "button", style: { background: colorOf(c) }, onclick: () => { toggleCompare(c); render({}); } },
        speciesName(c), h("span", { "aria-hidden": "true", text: "×" }))),
      h("div", { class: "table-tools", style: { margin: 0 } }, picker)));
  if (!codes.length) {
    const sugg = ["daejun", "amegfi", "pinsis", "evegro", "houfin", "purfin"].filter((c) => lookups.species.has(c));
    page.append(h("div", { class: "grid" }, h("div", { class: "tile" },
      h("p", { class: "tile__sub", text: "Nothing to compare yet. A good start, the irruptive finches:" }),
      h("button", { class: "btn btn--primary", type: "button", text: "Compare Pine Siskin, Evening Grosbeak, Purple Finch and House Finch",
        onclick: () => { state.compare = ["pinsis", "evegro", "purfin", "houfin"]; history.replaceState(null, "", F.buildHash(state)); render({}); } }),
      h("p", { class: "note note--spaced", text: `Or start from ${sugg.map(speciesName).join(", ")}.` }))));
    return page;
  }
  const trendTile = tile({
    title: "Percent of sites visited, every season", height: 340, lazy: false,
    sub: "Seasons with fewer than 30 count sites in scope are left out. Ignores the season filter; the shaded band is the selection.",
    queries: () => codes.map((c) => Q.trend(c, state.scope)),
    render: (body, results) => C.lineChart(body, codes.map((c, i) => ({ key: c, label: speciesName(c), color: colorOf(c),
      points: results[i].map((r) => ({ x: r.season, y: r.site_count >= F.MIN_SITES ? r.pct_sites : null, n: r.site_count })) })), {
      height: 340, xDomain: [F.SEASON_MIN, F.SEASON_MAX], band: band(), bandLabel: bandLabel(), yFormat: (v) => F.pct(v, 0),
      tipTitle: (x) => `${F.seasonLabel(x)} season`, tipValue: (v) => F.pct(v),
    }),
  });
  const weekTile = tile({
    title: "When in the season", height: 300, lazy: false,
    sub: "Share of two-day counts reporting each species, by week from 1 November, in the selected seasons. Ignores the housing filter.",
    queries: () => codes.flatMap((c) => Q.weekly(c, state.scope)),
    render: (body, results) => C.lineChart(body, codes.map((c, i) => ({ key: c, label: speciesName(c), color: colorOf(c),
      points: J.weekly(results.slice(i * 2, i * 2 + 2)).map((r) => ({ x: r.season_week, y: r.checklist_count >= 100 ? r.pct_checklists : null, n: r.checklist_count })) })), {
      height: 300, xDomain: [0, 25], xTicks: [0, 4, 9, 13, 17, 22], xFormat: F.weekLabel, yFormat: (v) => F.pct(v, 0),
      tipTitle: (w) => `Week of ${F.weekLabel(w)}`, tipValue: (v) => F.pct(v),
    }),
  });
  const tableTile = tile({
    title: "Side by side", height: 160, lazy: false,
    sub: `In ${scopeText()}. Change compares ${F.EARLY.label} with ${F.RECENT.label} and ignores the season filter.`,
    queries: () => codes.flatMap((c) => [Q.summary(c, state.scope), Q.speciesHistory(c, state.scope)]),
    render: (body, results) => {
      const rowsOf = (k) => codes.map((c, i) => ({ c, s: results[i * 2][0], hh: results[i * 2 + 1][0] }));
      const data = rowsOf();
      const line = (label, f) => h("tr", {}, h("td", { text: label }), ...data.map((d) => h("td", { class: "num" }, f(d))));
      body.append(h("div", { class: "table-scroll" }, h("table", { class: "mini" },
        h("thead", {}, h("tr", {}, h("th", { text: "" }), ...data.map((d) => h("th", { class: "num" }, h("a", { href: F.buildHash({ ...state, page: "species", code: d.c }), style: { color: colorOf(d.c) }, text: speciesName(d.c) }))))),
        h("tbody", {},
          line("% of sites visited", (d) => F.pct(d.s?.pct_sites)),
          line("Sites reporting", (d) => F.num(d.s?.sites_reporting)),
          line("Average flock size", (d) => F.birds(d.s?.avg_flock_size)),
          line("Share of checklists", (d) => F.pct(d.s?.pct_checklists)),
          line("Largest count", (d) => F.num(d.s?.max_count)),
          line(`% of sites ${F.EARLY.label}`, (d) => ((d.hh?.sites_early || 0) < F.MIN_SITES ? "—" : F.pct(d.hh.pct_early))),
          line(`% of sites ${F.RECENT.label}`, (d) => F.pct(d.hh?.pct_recent)),
          line("Change", (d) => deltaSpan((d.hh?.sites_early || 0) < F.MIN_SITES ? null : F.diff(d.hh.pct_recent, d.hh.pct_early)))))));
    },
  });
  const mapsTile = tile({
    title: "Where each visits", height: 640,
    sub: "Percent of sites visited by state and province, on one shared scale so the maps compare directly.",
    queries: () => codes.map((c) => Q.stateMap(c, state.scope)),
    render: async (body, results) => {
      const max = Math.max(0.05, ...results.flat().filter((r) => r.site_count >= 20).map((r) => r.pct_sites));
      const wrap = h("div", { class: "maps-4" });
      body.append(wrap);
      for (let i = 0; i < codes.length; i++) {
        const box = h("div");
        wrap.append(h("div", {}, h("h3", { text: speciesName(codes[i]), style: { color: colorOf(codes[i]) } }), box));
        const values = new Map(results[i].filter((r) => F.isStateCode(r.state_code)).map((r) => [r.state_code, { value: r.pct_sites, n: r.site_count, r }]));
        await C.choropleth(box, values, { height: 300, min: 20, domain: [0, max], format: (v) => F.pct(v, 0), legendTitle: "% of sites", nameOf: F.stateName,
          selected: state.scope.state, tipLines: (cc, d) => [["% of sites", F.pct(d.value)], ["Site-seasons", F.num(d.n)]], onClick: (cc) => setScope({ state: state.scope.state === cc ? null : cc }) });
      }
    },
  });
  page.append(h("div", { class: "grid" }, trendTile), h("div", { class: "grid grid--2" }, weekTile, tableTile), h("div", { class: "grid" }, mapsTile));
  return page;
}

// ================================================================= PAGE: what attracts birds
function pageYards() {
  const feature = state.feature || "evergreen_trees";
  const f = F.FEATURES.find((x) => x.key === feature);
  const groups = [...new Set(F.FEATURES.map((x) => x.group))];
  const page = h("div", { class: "page wrap" },
    h("h1", { class: "title", text: "What attracts birds?" }),
    h("p", { class: "lede", text: `Pick something about a yard. Every species is compared at count sites that have it and sites that don’t, in ${scopeText()}. Participants describe their site each season; only sites that answered count.` }),
    h("div", { class: "picker" }, ...groups.map((g) => h("div", {}, h("h3", { text: g }), h("div", { class: "opts" },
      ...F.FEATURES.filter((x) => x.group === g).map((x) => h("button", { class: "pill", type: "button", "aria-pressed": String(x.key === feature),
        onclick: () => go({ feature: x.key }) }, x.label)))))));
  const lift = tile({
    title: `${f.label}: who shows up more, who less`,
    sub: "Percent of sites visited with the feature (filled dot) and without (open dot). Ranked by the ratio, among species seen at 5% or more of either group. Associations, not causes: narrow the region to compare like with like.",
    height: 640, lazy: false,
    queries: () => Q.yardFeature(feature, state.scope),
    render: (body, results) => {
      const rows = J.yardFeature(results);
      const any = rows[0];
      if (!any || !any.sites_with || !any.sites_without) {
        return empty(body, `No site in this scope answered both ways about “${f.label.toLowerCase()}”. ${feature === "thistle" ? "FeederWatch retired the thistle-feeder question after 2004–05; widen the seasons to include earlier years." : "Widen the scope."}`);
      }
      const low = any.sites_with < 100 || any.sites_without < 100;
      body.append(h("p", { class: "note note--below" }, `${F.num(any.sites_with)} site-seasons with, ${F.num(any.sites_without)} without.`,
        low ? h("span", { class: "delta down", text: " Small groups: read with care." }) : ""));
      const sp = rows.filter((r) => r.category === "species" && r.pct_with != null && r.pct_without != null && Math.max(r.pct_with, r.pct_without) >= 0.05)
        .map((r) => ({ ...r, ratio: (r.pct_with + 0.005) / (r.pct_without + 0.005) }))
        .sort((a, b) => b.ratio - a.ratio);
      const toRows = (list) => list.map((r) => ({ id: r.species_code, label: r.common_name, a: r.pct_with, b: r.pct_without, ratio: r.ratio }));
      const left = h("div"); const right = h("div");
      body.append(h("div", { class: "grid grid--even", style: { marginTop: 0 } },
        h("div", {}, h("h3", { class: "list-h up", text: "More often where it’s present" }), left),
        h("div", {}, h("h3", { class: "list-h down", text: "Less often where it’s present" }), right)));
      const opts = { format: (v) => F.pct(v, 0), deltaFormat: F.pts, onClick: (r) => openSpecies(r.id),
        tipLines: (r) => [["With", F.pct(r.a)], ["Without", F.pct(r.b)], ["Ratio", F.times(r.ratio)]] };
      requestAnimationFrame(() => {
        C.dumbbell(left, toRows(sp.slice(0, 15)), opts);
        C.dumbbell(right, toRows(sp.slice(-15).reverse()), opts);
      });
    },
  });
  page.append(h("div", { class: "grid" }, lift));
  return page;
}

// ================================================================= PAGE: about the data
function pageAbout() {
  const dl = (pairs) => h("dl", {}, ...pairs.flatMap(([t, d]) => [h("dt", { text: t }), h("dd", { text: d })]));
  const page = h("div", { class: "page wrap" },
    h("h1", { class: "title", text: "About the data" }),
    h("p", { class: "lede", text: "Project FeederWatch is a November-to-April survey of the birds that visit feeders, gardens and nature centres across the United States and Canada, run by the Cornell Lab of Ornithology and Birds Canada since 1987." }));
  const participation = tile({
    title: "Who counts, and where", height: 280, lazy: false,
    sub: "Count sites per season in each FeederWatch region. Participation roughly quadrupled, and jumped in 2020–21. Shares, not totals, are comparable across years.",
    queries: () => [Q.seasonByRegion(state.scope)],
    render: (body, [rows]) => {
      const keys = F.REGIONS.map((r) => ({ key: r.code, label: r.name, color: regionColor(r.code) }));
      const bySeason = new Map();
      for (const r of rows) {
        if (!bySeason.has(r.season)) bySeason.set(r.season, Object.fromEntries([["x", r.season], ...keys.map((k) => [k.key, 0])]));
        if (r.region_code !== "XX") bySeason.get(r.season)[r.region_code] = r.site_count;
      }
      C.stackedShare(body, [...bySeason.values()].sort((a, b) => a.x - b.x), keys, { height: 280, yFormat: F.num, tipTitle: (x) => `${F.seasonLabel(x)} season`, tipValue: (v, t) => `${F.num(v)} (${F.pct(v / t, 0)})` });
    },
  });
  const entry = tile({
    title: "How counts were sent in", height: 280, lazy: false,
    sub: "Share of checklists by entry method, recorded from 1997–98. Paper forms carried 87% of counts that season and were gone by 2014–15; the mobile app, launched in 2019–20, now carries a quarter.",
    queries: () => [Q.entryMethods(state.scope)],
    render: (body, [rows]) => {
      const keys = [["Paper form", "--c4"], ["Web", "--c2"], ["Mobile app", "--c1"]].map(([k, t]) => ({ key: k, label: k, color: tokenColor(t) }));
      const by = new Map();
      for (const r of rows) {
        if (!r.entry_method || r.season < 1998) continue; // not recorded before 1997-98
        if (!by.has(r.season)) by.set(r.season, Object.fromEntries([["x", r.season], ...keys.map((k) => [k.key, 0])]));
        by.get(r.season)[r.entry_method] = r.checklist_count;
      }
      C.stackedShare(body, [...by.values()].sort((a, b) => a.x - b.x), keys, { share: true, height: 280, yFormat: (v) => F.pct(v, 0), tipTitle: (x) => `${F.seasonLabel(x)} season`, tipValue: (v, t) => `${F.pct(v / t, 0)} · ${F.num(v)}` });
    },
  });
  page.append(h("div", { class: "grid grid--even" }, participation, entry));
  const prose = h("div", { class: "prose" },
    h("h2", { text: "How to read the numbers" }),
    dl([
      ["Season", "Counts run from November to April. A season is named by its two calendar years: 2023–24 is November 2023 to April 2024. Seasons 1988–89 to 2023–24 are here; the 1987–88 pilot (17 counts) is left out."],
      ["Site and checklist", "A site is one participant’s count area. A checklist is one two-day count there, recording for each species the most individuals seen at one time."],
      ["Percent of sites visited", "Of the site-seasons in scope, the share that reported the species at least once. This is FeederWatch’s own headline measure; across several seasons it is the share of all site-seasons in them."],
      ["Average flock size", "The average count on checklists where the species was reported."],
      ["Share of checklists", "The share of two-day counts in scope that reported the species."],
      ["Regions", "FeederWatch’s six trend-graph regions: Far North, Northwest, Southwest, Central, Northeast and Southeast. Sites outside them are counted in North American totals only."],
    ]),
    h("h2", { text: "What was done to the raw data" }),
    dl([
      ["Only valid reports", "FeederWatch flags unexpected species and high counts for review. Reports that were flagged and not confirmed (0.5% of records) are left out of every measure; each species page shows how its reports were checked."],
      ["Taxonomic roll-up", "Recognisable forms such as Oregon Junco and feral Rock Pigeon are counted as their species, following eBird’s 2023 taxonomy. Forms reported on the same checklist are added together, as in FeederWatch’s own roll-up code."],
      ["Sites without feeders", "Since 2021–22 people may count without offering food. FeederWatch recommends leaving those sites out, so 767 site-seasons that reported no supplementary food are excluded."],
      ["Site descriptions", "Housing density, habitat, feeders and yard features are what the participant reported for that season. Many sites leave questions blank, and the questionnaire changed over time: the thistle-feeder and water-dispenser questions were retired after 2004–05."],
    ]),
    h("h2", { text: "Checked against FeederWatch" }),
    h("p", { text: "Percent of sites visited here reproduces feederwatch.org’s trend graphs. Recent seasons can differ by about a point, because the website draws on a later data release than the public download used here." }),
    h("table", { class: "check" },
      h("thead", {}, h("tr", {}, h("th", { text: "Species, region, season" }), h("th", { text: "feederwatch.org" }), h("th", { text: "This explorer" }))),
      h("tbody", {}, ...[
        ["Dark-eyed Junco, Far North, 1991–92", "59.3%", "59.3%"], ["Dark-eyed Junco, Central, 1991–92", "90.0%", "90.0%"],
        ["Dark-eyed Junco, Northeast, 1991–92", "87.2%", "87.1%"], ["Dark-eyed Junco, Southeast, 1991–92", "65.7%", "65.7%"],
        ["Northern Cardinal, Southeast, 1991–92", "96.6%", "96.6%"], ["American Goldfinch, Central, 1991–92", "72.3%", "72.3%"],
      ].map(([a, b, c]) => h("tr", {}, h("td", { text: a }), h("td", { text: b }), h("td", { text: c })))),
    ),
    h("h2", { text: "Caveats worth keeping in mind" }),
    h("ul", {},
      h("li", { text: "Participation grew about fourfold, and new participants are not a random sample of yards. Compare shares within a scope, not raw totals across years." }),
      h("li", { text: "The average flock size across all species fell steadily, from 6.4 birds in 1988–89 to 3.4 in 2023–24, with no single break. Read flock-size trends alongside that." }),
      h("li", { text: "Detection depends on effort: people who watch longer report more species. Each species page shows that effect." }),
      h("li", { text: "Misidentifications that look plausible, such as Downy for Hairy Woodpecker, are not caught by the flagging system." }),
      h("li", { text: "Yard-feature comparisons are associations. Sites with woods also differ in region, size and many other things." }),
    ),
    h("h2", { text: "Sources and credit" }),
    h("p", {}, "Data: Project FeederWatch raw data, release of 5 June 2024, ", h("a", { href: "https://feederwatch.org/explore/raw-dataset-requests/", target: "_blank", rel: "noopener", text: "feederwatch.org/explore/raw-dataset-requests" }),
      ". Taxonomy: eBird/Clements 2023. Description of the dataset: Bonter, D. N. and E. I. Greig (2021), Over 30 years of standardized bird counts at supplementary feeding stations in North America, ",
      h("em", { text: "Frontiers in Ecology and Evolution" }), " 9:619682."),
    h("p", { text: "Thanks to the tens of thousands of FeederWatch participants, the Cornell Lab of Ornithology, and Birds Canada. This explorer is an independent project and is not endorsed by either organisation." }),
  );
  page.append(h("div", { class: "grid" }, h("div", { class: "tile" }, prose)));
  return page;
}

// ---------------------------------------------------------------- render
function render({ scrollTop = false } = {}) {
  epoch++;
  hideTipSafe();
  renderScopeBar();
  document.querySelector(".wordmark").setAttribute("href", F.buildHash({ ...state, page: "birds", code: null }));
  document.querySelectorAll(".site-nav a").forEach((a) => {
    a.setAttribute("href", F.buildHash({ ...state, page: a.dataset.page, code: null }));
    const on = a.dataset.page === state.page || (a.dataset.page === "birds" && state.page === "species");
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const y = window.scrollY;
  const pages = { birds: pageBirds, species: pageSpecies, compare: pageCompare, yards: pageYards, about: pageAbout };
  main.replaceChildren((pages[state.page] || pageBirds)());
  document.title = state.page === "species" && lookups.species.has(state.code)
    ? `${speciesName(state.code)} · FeederWatch Data Explorer` : "FeederWatch Data Explorer";
  renderTray();
  if (scrollTop) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); } else window.scrollTo(0, y);
}
function hideTipSafe() { try { C.hideTip(); } catch { /* no tooltip yet */ } }

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => document.querySelectorAll(".tile[data-loaded]").forEach((t) => t.reload?.()), 250);
});

// ---------------------------------------------------------------- boot
async function boot() {
  wireScopeBar();
  wireSearch();
  try {
    const [species, states] = await Promise.all([cached(Q.speciesList()), cached(Q.states())]);
    for (const s of species) lookups.species.set(s.species_code, s);
    lookups.speciesList = species;
    lookups.states = states;
  } catch (err) {
    main.replaceChildren(h("div", { class: "page wrap" }, h("div", { class: "state-msg is-error", text: `Could not reach the FeederWatch model: ${err.message}` })));
    return;
  }
  render({});
}
boot();
