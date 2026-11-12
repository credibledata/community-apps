// DESIGN BRIEF (recorded here so a reviewer can correct it in one reply)
//
// Who: backyard birders, FeederWatch participants, educators and analysts. Opened ad hoc, for
//   exploratory sessions; nobody here is reporting against a target.
// Job / decision: "Which birds come to feeders where I am, how has that changed since 1989, and
//   what about a yard goes with a given bird?" (what to watch for, what to plant or put out).
// Archetype: EXPLORER over one population, feeder bird species, with a deep entity page
//   per species, a comparison tray, and a cross-species "what attracts birds" page.
// Leading numbers: percent of sites visited (FeederWatch's own headline measure, verified
//   against feederwatch.org's trend graphs), its change 1989-93 -> 2020-24, average flock size.
// Forms: ranked table with inline bar + sparkline + diverging change rule; state/province
//   choropleth (click to scope) and a half-degree grid; gainers/decliners scatter with labelled
//   outliers; FeederWatch-style regional trend lines labelled directly; within-season timing by
//   era; flock-size histogram; with/without dumbbells for yard features; companion list with lift;
//   review-status bar. Rejected: a KPI row of totals (raw totals mislead across a 4x growth in
//   participation), pies.
// Depth: shared scope (region, state, seasons, housing) as removable chips and in the URL;
//   map click -> state scope; row/point click -> species page; compare tray (up to 4, kept in the
//   URL); a "Query" disclosure on every tile shows the exact Malloy it ran (provenance).
//   Trend tiles ignore the season filter (time is their axis) and shade the selected seasons.
//
// Data: every source is a small pre-aggregated Parquet file in the package's data/ (see
// feederwatch.malloy); nothing is row-level. The headline tiles read bird_trends, a zero-filled
// fact, so a species filter is a plain where:. The other per-species tiles (grid, yards, timing,
// snow, effort, flock sizes, companions, what-attracts-birds) read rollups with a plain species /
// feature where:, and divide the parts here (J) by the matching denominator table, so the app
// never sends a given. The model is reached through index.malloy, the package's published surface.
//
// Every query the app sends is built here, from model view names. Scope always goes through
// scopeWhere(); species codes, states, regions and features are validated before they get here.

import { lit, isSpeciesCode, isStateCode, isRegionCode, isHousing, isSeason, FEATURE_KEYS, regionOfState, EARLY, RECENT } from "./format.js";

export const MODEL = "index.malloy"; // the package's published surface

/**
 * The scope as a Malloy `where:` refinement.
 * ignore: scope keys this tile must not filter on (a tile ignores its own dimension).
 */
export function scopeWhere(scope, opts = {}) {
  const parts = scopeParts(scope, opts);
  return parts.length ? ` + { where: ${parts.join(" and ")} }` : "";
}

/** The same scope as a `where:` clause to open a literal query body ("" when unscoped). */
export function whereClause(scope, opts = {}) {
  const parts = scopeParts(scope, opts);
  return parts.length ? `where: ${parts.join(" and ")}; ` : "";
}

function scopeParts(scope, { prefix = "", ignore = [], extra = [] } = {}) {
  const parts = [];
  const skip = new Set(ignore);
  if (!skip.has("region") && scope.region && (isRegionCode(scope.region) || scope.region === "XX")) parts.push(`${prefix}region_code = ${lit(scope.region)}`);
  if (!skip.has("state") && scope.state && isStateCode(scope.state)) parts.push(`${prefix}state_code = ${lit(scope.state)}`);
  if (!skip.has("season") && isSeason(scope.from) && isSeason(scope.to)) {
    parts.push(`${prefix}season >= ${scope.from} and ${prefix}season <= ${scope.to}`);
  }
  if (!skip.has("housing") && scope.housing && isHousing(scope.housing)) parts.push(`${prefix}housing_density = ${lit(scope.housing)}`);
  parts.push(...extra);
  return parts;
}

function code(c) {
  if (!isSpeciesCode(c)) throw new Error(`Not a species code: ${c}`);
  return lit(c);
}
const speciesIs = (c) => `species_code = ${code(c)}`;
/** species_history's fixed windows: 1989-1993 and 2020-2024. */
const EARLY_LAST = EARLY.to;
const RECENT_FIRST = RECENT.from;
/** Timing tables carry no housing density, so the timing tiles ignore that filter. */
const TIMING = ["housing"];
/**
 * Companion pairs are stored per season x region: a state scope reads its region, and the
 * housing filter is ignored. The denominators (bird_trends) use the same scope.
 */
const companionScope = (s) => ({ from: s.from, to: s.to, region: s.state ? regionOfState(s.state) : s.region });

export const Q = {
  // ---------- lookups (boot) ----------
  speciesList: () =>
    "run: species -> { select: species_code, common_name, scientific_name, family_name, category, taxon_order, n_records; order_by: taxon_order; limit: 1000 }",
  states: () => "run: site_seasons -> { group_by: state_code, region_code; aggregate: site_count; order_by: state_code; limit: 200 }",

  // ---------- birds overview ----------
  /** Participation per season (ignores the season filter: it is the time axis). */
  seasons: (s) => `run: site_seasons -> by_season${scopeWhere(s, { ignore: ["season"] })}`,
  /** Active sites by state/province for the participation map (ignores state and region so the map stays whole). */
  participationMap: (s) => `run: site_seasons -> by_state${scopeWhere(s, { ignore: ["state", "region"] })}`,
  // All-species tiles read bird_trends' non-zero rows (bird_trend_hits) and its scope cells
  // (bird_trend_cells) and divide here: the same rows bird_trends' views return, without building
  // the 8M-row zero-filled grid on every query. Single-species tiles below use bird_trends itself.
  /** bird_trends -> species_ranking */
  ranking: (s) => combine([
    `run: bird_trend_cells -> { ${whereClause(s)}aggregate: site_count }`,
    `run: bird_trend_hits -> { ${whereClause(s)}group_by: species_code, common_name, family_name, category, taxon_order; aggregate: sites_reporting, checklists_reporting, birds; limit: 5000 }`,
  ], J.ranking),
  /** bird_trends -> species_history. Long-run change and sparkline series; never season-filtered (fixed windows). */
  history: (s) => combine([
    `run: bird_trend_cells -> { ${whereClause(s, { ignore: ["season"] })}group_by: season; aggregate: site_count; limit: 1000 }`,
    `run: bird_trend_hits -> { ${whereClause(s, { ignore: ["season"] })}group_by: species_code, season; aggregate: sites_reporting; limit: 100000 }`,
  ], J.history),
  windowSites: (s) => `run: bird_trend_cells -> { ${whereClause(s, { ignore: ["season"] })}aggregate: sites_early is site_count { where: season <= ${EARLY_LAST} }, sites_recent is site_count { where: season >= ${RECENT_FIRST} } }`,

  // ---------- one species: headline numbers from bird_trends (a species filter is safe there) ----------
  summary: (c, s) => `run: bird_trends -> summary${scopeWhere(s, { extra: [speciesIs(c)] })}`,
  speciesHistory: (c, s) => `run: bird_trends -> history${scopeWhere(s, { ignore: ["season"], extra: [speciesIs(c)] })}`,
  trend: (c, s) => `run: bird_trends -> trend${scopeWhere(s, { ignore: ["season"], extra: [speciesIs(c)] })}`,
  /** FeederWatch-style regional lines: ignores region/state (it IS the regional comparison) and seasons. */
  trendByRegion: (c, s) => `run: bird_trends -> trend_by_region${scopeWhere(s, { ignore: ["season", "region", "state"], extra: [speciesIs(c)] })}`,
  stateMap: (c, s) => `run: bird_trends -> state_map${scopeWhere(s, { ignore: ["state", "region"], extra: [speciesIs(c)] })}`,
  byHousing: (c, s) => `run: bird_trends -> by_housing${scopeWhere(s, { ignore: ["housing"], extra: [speciesIs(c)] })}`,

  // ---------- one species at site or checklist grain: stored parts, divided in J below ----------
  // Each returns [denominator query, numerator query]; the J function of the same name combines
  // them into the rows the given-driven view (species_sites, species_checklists, companions) returns.
  grid: (c, s) => {
    const w = { ignore: ["state", "region"] };
    return [
      `run: site_seasons -> { ${whereClause(s, w)}group_by: grid_lat, grid_lon; aggregate: site_count; limit: 5000 }`,
      `run: pfw_grid_species -> { ${whereClause(s, { ...w, extra: [speciesIs(c)] })}group_by: grid_lat, grid_lon; aggregate: sites_reporting is n_sites_reporting.sum(); limit: 5000 }`,
    ];
  },
  yardEffects: (c, s) => [
    `run: pfw_yard_sites -> { ${whereClause(s)}group_by: feature_key, has_feature; aggregate: sites is n_sites.sum() }`,
    `run: pfw_yard_species -> { ${whereClause(s, { extra: [speciesIs(c)] })}group_by: feature_key, has_feature; aggregate: sites_reporting is n_sites_reporting.sum() }`,
  ],
  timingByEra: (c, s) => {
    const w = { ignore: ["season", ...TIMING] };
    return [
      `run: checklist_weeks -> { ${whereClause(s, w)}group_by: era, season_week; aggregate: checklist_count }`,
      `run: species_weeks -> { ${whereClause(s, { ...w, extra: [speciesIs(c)] })}group_by: era, season_week; aggregate: reports }`,
    ];
  },
  weekly: (c, s) => [
    `run: checklist_weeks -> { ${whereClause(s, { ignore: TIMING })}group_by: season_week; aggregate: checklist_count }`,
    `run: species_weeks -> { ${whereClause(s, { ignore: TIMING, extra: [speciesIs(c)] })}group_by: season_week; aggregate: reports, birds }`,
  ],
  bySnow: (c, s) => [
    `run: checklist_counts -> { ${whereClause(s, { extra: ["snow_depth is not null"] })}group_by: snow_depth, snow_order; aggregate: checklist_count }`,
    `run: pfw_snow_species -> { ${whereClause(s, { extra: [speciesIs(c)] })}group_by: snow_depth; aggregate: reports is n_checklists_reporting.sum(), birds is n_birds.sum() }`,
  ],
  byEffort: (c, s) => [
    `run: checklist_counts -> { ${whereClause(s, { extra: ["effort_hours is not null"] })}group_by: effort_hours, effort_order; aggregate: checklist_count }`,
    `run: pfw_effort_species -> { ${whereClause(s, { extra: [speciesIs(c)] })}group_by: effort_hours; aggregate: reports is n_checklists_reporting.sum(), birds is n_birds.sum() }`,
  ],
  flockSizes: (c, s) => `run: report_counts -> flock_sizes${scopeWhere(s, { extra: [speciesIs(c)] })}`,
  reviewStates: (c, s) => `run: report_counts -> review_states${scopeWhere(s, { extra: [speciesIs(c)] })}`,
  companions: (c, s) => [
    combine([
      `run: bird_trend_cells -> { ${whereClause(companionScope(s))}aggregate: checklist_count }`,
      `run: bird_trend_hits -> { ${whereClause(companionScope(s))}group_by: species_code, common_name, category; aggregate: checklists_reporting; limit: 5000 }`,
    ], ([[cells], hits]) => hits.map((r) => ({ ...r, checklist_count: cells?.checklist_count ?? null }))),
    `run: companion_pairs -> { ${whereClause(companionScope(s), { extra: [`focal_code = ${code(c)}`] })}group_by: companion_code; aggregate: together is n_together.sum() }`,
  ],

  // ---------- yards: [sites with/without, species with/without, species names and sites reporting,
  //                    site-seasons with no valid report] ----------
  yardFeature: (f, s) => {
    if (!FEATURE_KEYS.has(f)) throw new Error(`Unknown feature: ${f}`);
    const fk = `feature_key = ${lit(f)}`;
    return [
      `run: pfw_yard_sites -> { ${whereClause(s, { extra: [fk] })}group_by: has_feature; aggregate: sites is n_sites.sum() }`,
      `run: pfw_yard_species -> { ${whereClause(s, { extra: [fk] })}group_by: species_code, has_feature; aggregate: sites_reporting is n_sites_reporting.sum() }`,
      `run: bird_trend_hits -> { ${whereClause(s)}group_by: species_code, common_name, category; aggregate: sites_reporting; limit: 5000 }`,
      `run: pfw_unreported_sites -> { ${whereClause(s)}aggregate: sites is n_sites.sum() }`,
    ];
  },

  // ---------- about ----------
  seasonByRegion: (s) => `run: site_seasons -> season_by_region${scopeWhere(s, { ignore: ["season", "region", "state"] })}`,
  entryMethods: (s) => `run: checklist_counts -> by_entry_method${scopeWhere(s, { ignore: ["season"] })}`,
};

// ---------- J: combine the stored parts the multi-query builders return ----------
// Each takes the results of its Q builder (same name, same order) and returns the rows the
// given-driven view it replaces returned: same field names, same denominators, same nulls
// (a ratio is null when its denominator is missing or zero, 0 when only the numerator is).

const ratio = (n, d) => (d ? (n ?? 0) / d : null);
const sum = (rows, f) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
const keyOf = (...xs) => xs.join("\u0000");
const indexBy = (rows, f) => new Map(rows.map((r) => [f(r), r]));

/** Snow depth or hours watched: share of checklists and average flock per band. */
function byBand([cells, hits], band, order) {
  const n = indexBy(hits, (r) => r[band]);
  return cells.map((r) => {
    const x = n.get(r[band]);
    return { ...r, pct_checklists: ratio(x?.reports, r.checklist_count), avg_flock_size: x?.reports ? x.birds / x.reports : null };
  }).sort((a, b) => a[order] - b[order]);
}

export const J = {
  /** bird_trends -> species_ranking: every taxon reported in scope, by sites reporting it. */
  ranking: ([[cells], hits]) => hits.map((r) => ({
    species_code: r.species_code, common_name: r.common_name, family_name: r.family_name, category: r.category,
    taxon_order: r.taxon_order, sites_reporting: r.sites_reporting,
    pct_sites: ratio(r.sites_reporting, cells?.site_count),
    avg_flock_size: r.checklists_reporting ? r.birds / r.checklists_reporting : null,
  })).sort((a, b) => b.sites_reporting - a.sites_reporting).slice(0, 800),
  /**
   * bird_trends -> species_history: per species, sites reporting and percent of sites in the two
   * fixed windows (null when the scope has no sites then), and a per-season series that, like the
   * zero-filled view, has a point (possibly 0) for every season with sites in scope.
   */
  history: ([cells, hits]) => {
    const seasons = [...cells].sort((a, b) => a.season - b.season);
    const early = seasons.filter((c) => c.season <= EARLY_LAST);
    const recent = seasons.filter((c) => c.season >= RECENT_FIRST);
    const bySpecies = new Map();
    for (const r of hits) {
      if (!bySpecies.has(r.species_code)) bySpecies.set(r.species_code, new Map());
      bySpecies.get(r.species_code).set(r.season, r.sites_reporting);
    }
    const win = (w, m) => (w.length ? sum(w, (c) => m.get(c.season)) : null);
    return [...bySpecies].map(([species_code, m]) => {
      const reports_early = win(early, m), reports_recent = win(recent, m);
      return {
        species_code, reports_early, reports_recent,
        pct_early: early.length ? ratio(reports_early, sum(early, (c) => c.site_count)) : null,
        pct_recent: recent.length ? ratio(reports_recent, sum(recent, (c) => c.site_count)) : null,
        trend: seasons.map((c) => ({ season: c.season, season_pct: ratio(m.get(c.season), c.site_count) })),
      };
    }).sort((a, b) => (b.reports_recent ?? -1) - (a.reports_recent ?? -1)).slice(0, 800);
  },
  /** species_sites -> grid */
  grid: ([cells, hits]) => {
    const n = indexBy(hits, (r) => keyOf(r.grid_lat, r.grid_lon));
    return cells.map((r) => ({ ...r, pct_sites: ratio(n.get(keyOf(r.grid_lat, r.grid_lon))?.sites_reporting, r.site_count) }));
  },
  /** species_sites -> yard_effects: one row of <feature>_yes / <feature>_no */
  yardEffects: ([sites, hits]) => {
    const d = indexBy(sites, (r) => keyOf(r.feature_key, r.has_feature));
    const n = indexBy(hits, (r) => keyOf(r.feature_key, r.has_feature));
    const row = {};
    for (const f of FEATURE_KEYS) {
      for (const [has, suffix] of [[true, "yes"], [false, "no"]]) {
        row[`${f}_${suffix}`] = ratio(n.get(keyOf(f, has))?.sites_reporting, d.get(keyOf(f, has))?.sites);
      }
    }
    return row;
  },
  /** species_checklists -> by_week_era */
  timingByEra: ([cells, hits]) => {
    const n = indexBy(hits, (r) => keyOf(r.era, r.season_week));
    return cells.map((r) => ({ ...r, pct_checklists: ratio(n.get(keyOf(r.era, r.season_week))?.reports, r.checklist_count) }))
      .sort((a, b) => a.era.localeCompare(b.era) || a.season_week - b.season_week);
  },
  /** species_checklists -> weekly */
  weekly: ([cells, hits]) => {
    const n = indexBy(hits, (r) => r.season_week);
    return cells.map((r) => {
      const x = n.get(r.season_week);
      return { ...r, pct_checklists: ratio(x?.reports, r.checklist_count), avg_flock_size: x?.reports ? x.birds / x.reports : null };
    }).sort((a, b) => a.season_week - b.season_week);
  },
  /** species_checklists -> by_snow */
  bySnow: (results) => byBand(results, "snow_depth", "snow_order"),
  /** species_checklists -> by_effort */
  byEffort: (results) => byBand(results, "effort_hours", "effort_order"),
  /** companions -> top_companions (focal species included, top 45 by share) */
  companions: ([species, pairs], focalCode) => {
    const focal = species.find((r) => r.species_code === focalCode);
    const n = indexBy(pairs, (r) => r.companion_code);
    return species.map((r) => {
      // No pair row = never together: 0, as the model's pr.n_together.sum() returns (null only with no focal checklists).
      const share_with_focal = ratio(n.get(r.species_code)?.together, focal?.checklists_reporting);
      const share_overall = ratio(r.checklists_reporting, focal?.checklist_count);
      const lift = share_with_focal == null || !share_overall ? null : share_with_focal / share_overall;
      return { species_code: r.species_code, common_name: r.common_name, category: r.category, share_with_focal, share_overall, lift };
    }).sort((a, b) => (b.share_with_focal ?? -1) - (a.share_with_focal ?? -1)).slice(0, 45);
  },
  /** yard_feature -> species_lift (top 400 by sites reporting) */
  yardFeature: ([sites, hits, species, unreported]) => {
    const den = (has) => sites.find((r) => r.has_feature === has)?.sites ?? 0;
    const sites_with = den(true);
    const sites_without = den(false);
    const n = indexBy(hits, (r) => keyOf(r.species_code, r.has_feature));
    const rows = species.map((r) => ({
      species_code: r.species_code, common_name: r.common_name, category: r.category, sites_reporting: r.sites_reporting,
      pct_with: ratio(n.get(keyOf(r.species_code, true))?.sites_reporting, sites_with),
      pct_without: ratio(n.get(keyOf(r.species_code, false))?.sites_reporting, sites_without),
      sites_with, sites_without,
    }));
    // A site-season with no valid report gives the model's left join one null-species row (0 sites reporting).
    if (unreported[0]?.sites > 0) {
      rows.push({ species_code: null, common_name: null, category: null, sites_reporting: 0,
        pct_with: ratio(0, sites_with), pct_without: ratio(0, sites_without), sites_with, sites_without });
    }
    return rows.sort((a, b) => b.sites_reporting - a.sites_reporting).slice(0, 400);
  },
};

/**
 * A query is Malloy text, { query, givens }, or a combined query { parts, join }: several queries
 * run together and joined here into the rows one model view would return. These normalise them.
 */
function combine(parts, join) { return { parts, join }; }
export const queryText = (q) => (typeof q === "string" ? q : q.parts ? q.parts.map(queryText).join("\n\n") : q.query);
export const queryGivens = (q) => (typeof q === "string" || q.parts ? null : q.givens);
/** Stable cache key, givens included. */
export const queryKey = (q) => (typeof q === "string" ? q : q.parts ? q.parts.map(queryKey).join("\u0001") : `${q.query}\u0000${JSON.stringify(q.givens)}`);
/** Human-readable form for the provenance disclosure. */
export const queryLabel = (q) => (typeof q === "string" ? q : q.parts ? q.parts.map(queryLabel).join("\n\n") : `${q.query}\n-- givens: ${JSON.stringify(q.givens)}`);

/** Run a query through the Publisher runtime; givens are bound server-side, never pasted in. */
export function run(q) {
  if (q.parts) return Promise.all(q.parts.map(run)).then(q.join);
  const givens = queryGivens(q);
  return window.Publisher.query(MODEL, queryText(q), givens ? { givens } : undefined);
}
