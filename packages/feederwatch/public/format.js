// Pure helpers: formatting, validation, the URL-hash contract. No DOM, no globals,
// so node --test can cover every function here (tests/format.test.mjs).

export const SEASON_MIN = 1989;
export const SEASON_MAX = 2024;
/** The two fixed windows the model's history views compare (feederwatch.malloy). */
export const EARLY = { from: 1989, to: 1993, label: "1989–93" };
export const RECENT = { from: 2020, to: 2024, label: "2020–24" };

/** FeederWatch's six trend-graph regions, in the order feederwatch.org lists them. */
export const REGIONS = [
  { code: "AC", name: "Far North", token: "--r-ac" },
  { code: "WE", name: "Northwest", token: "--r-we" },
  { code: "SW", name: "Southwest", token: "--r-sw" },
  { code: "CE", name: "Central", token: "--r-ce" },
  { code: "NE", name: "Northeast", token: "--r-ne" },
  { code: "SO", name: "Southeast", token: "--r-so" },
];
export const REGION_BY_CODE = Object.fromEntries(REGIONS.map((r) => [r.code, r]));
/** FeederWatch region of each state or province, as feederwatch.malloy assigns region_code. */
const REGION_STATES = {
  AC: ["US-AK", "CA-YT", "CA-NT", "CA-NU"],
  WE: ["CA-BC", "CA-AB", "US-WA", "US-OR", "US-ID", "US-MT", "US-WY"],
  CE: ["CA-SK", "CA-MB", "US-ND", "US-SD", "US-NE", "US-KS", "US-MN", "US-IA", "US-MO"],
  NE: ["CA-ON", "CA-QC", "CA-NL", "CA-NS", "CA-PE", "CA-NB", "US-ME", "US-NH", "US-VT", "US-MA", "US-NY", "US-CT", "US-RI",
    "US-PA", "US-MI", "US-OH", "US-WI", "US-IL", "US-IN", "US-KY", "US-WV", "US-VA", "US-NJ", "US-DE", "US-MD", "US-DC"],
  SO: ["US-NC", "US-FL", "US-SC", "US-GA", "US-TN", "US-AR", "US-OK", "US-TX", "US-LA", "US-MS", "US-AL"],
  SW: ["US-CO", "US-NM", "US-UT", "US-AZ", "US-NV", "US-CA"],
};
const REGION_OF = Object.fromEntries(Object.entries(REGION_STATES).flatMap(([r, states]) => states.map((st) => [st, r])));
/** Region code of a state or province; "XX" outside FeederWatch's six regions. */
export const regionOfState = (st) => REGION_OF[st] ?? "XX";

export const HOUSING = ["Rural", "Rural/suburban", "Suburban", "Urban"];

/** Yard features: keys match the model's feat_<key> dimensions and yard_effects columns. */
export const FEATURES = [
  { key: "squirrels", label: "Squirrels take food", group: "Animals" },
  { key: "cats", label: "Cats active near feeders", group: "Animals" },
  { key: "dogs", label: "Dogs active near feeders", group: "Animals" },
  { key: "nearby_feeders", label: "Other feeders within 90 m", group: "Neighbourhood" },
  { key: "woods", label: "Woods within ½ mile", group: "Neighbourhood" },
  { key: "fresh_water", label: "Fresh water within ½ mile", group: "Neighbourhood" },
  { key: "agricultural", label: "Farmland within ½ mile", group: "Neighbourhood" },
  { key: "evergreen_trees", label: "4+ evergreen trees", group: "Yard" },
  { key: "fruit_trees", label: "Fruit trees", group: "Yard" },
  { key: "brush_piles", label: "Brush piles", group: "Yard" },
  { key: "water_sources", label: "Water sources", group: "Yard" },
  { key: "bird_baths", label: "Bird baths", group: "Yard" },
  { key: "suet", label: "Suet feeder", group: "Feeders" },
  { key: "ground", label: "Ground feeding", group: "Feeders" },
  { key: "platform", label: "Platform feeder", group: "Feeders" },
  { key: "thistle", label: "Thistle feeder", group: "Feeders" },
  { key: "fruit_feeder", label: "Fruit feeder", group: "Feeders" },
  { key: "hummingbird", label: "Sugar-water feeder", group: "Feeders" },
];
export const FEATURE_KEYS = new Set(FEATURES.map((f) => f.key));

// ---------- formatting ----------

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** "2023–24" for season 2024 (a season is named by the year it ends). */
export function seasonLabel(season) {
  if (!Number.isInteger(season)) return "—";
  return `${season - 1}–${String(season).slice(2)}`;
}

/** 0.8184 -> "81.8%". Fractions in, percent out: the model stores 0-1 shares. */
export function pct(x, digits = 1) {
  if (!isNum(x)) return "—";
  const v = x * 100;
  if (v > 0 && v < 0.1) return "<0.1%";
  return `${v.toFixed(digits)}%`;
}

/** Change between two shares in percentage points: 0.05 -> "+5.0 pts". */
export function pts(delta, digits = 1) {
  if (!isNum(delta)) return "—";
  const v = delta * 100;
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return `0.0 pts`;
  return `${v > 0 ? "+" : "−"}${s} pts`;
}

/** Thousands separators; compact above a million. */
export function num(x) {
  if (!isNum(x)) return "—";
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  return Math.round(x).toLocaleString("en-US");
}

/** Birds per flock, one decimal. */
export function birds(x) {
  return isNum(x) ? x.toFixed(1) : "—";
}

/** Ratio as "1.4×". */
export function times(x) {
  return isNum(x) ? `${x.toFixed(x >= 10 ? 0 : 1)}×` : "—";
}

/** Week of the season (0 = week starting 1 Nov) -> "Nov 1". Uses a non-leap season. */
export function weekLabel(week) {
  if (!Number.isInteger(week)) return "";
  const d = new Date(Date.UTC(2022, 10, 1 + week * 7));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Mean of finite numbers, or null when there are none (missing is not zero). */
export function mean(xs) {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Signed difference that stays null when either side is missing. */
export function diff(a, b) {
  return isNum(a) && isNum(b) ? a - b : null;
}

/** Minimum site-seasons behind a share before the app treats it as readable. */
export const MIN_SITES = 30;

// ---------- Malloy literal safety ----------

/** Backslash-escape a value for a single-quoted Malloy string (Malloy does not use ''). */
export function lit(s) {
  return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
export const isSpeciesCode = (s) => typeof s === "string" && /^[a-z0-9]{3,12}$/.test(s);
export const isStateCode = (s) => typeof s === "string" && /^(US|CA)-[A-Z]{2}$/.test(s);
export const isRegionCode = (s) => Object.hasOwn(REGION_BY_CODE, s);
export const isSeason = (n) => Number.isInteger(n) && n >= SEASON_MIN && n <= SEASON_MAX;
export const isHousing = (s) => HOUSING.includes(s);

// ---------- URL hash: #/<page>[/<code>]?r=NE&st=US-NY&from=2020&to=2024&h=Urban&cmp=a,b ----------

export const PAGES = ["birds", "species", "compare", "yards", "about"];
export const DEFAULT_SCOPE = Object.freeze({ region: null, state: null, from: 2020, to: SEASON_MAX, housing: null });

/** Parse and validate a hash. Anything unrecognised falls back to the default. */
export function parseHash(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  let page = PAGES.includes(parts[0]) ? parts[0] : "birds";
  let code = null;
  if (page === "species") {
    code = isSpeciesCode(parts[1]) ? parts[1] : null;
    if (!code) page = "birds";
  }
  const p = new URLSearchParams(query);
  const scope = { ...DEFAULT_SCOPE };
  if (isRegionCode(p.get("r"))) scope.region = p.get("r");
  if (isStateCode(p.get("st"))) scope.state = p.get("st");
  const from = Number(p.get("from"));
  const to = Number(p.get("to"));
  if (p.has("from") && isSeason(from)) scope.from = from;
  if (p.has("to") && isSeason(to)) scope.to = to;
  if (scope.from > scope.to) [scope.from, scope.to] = [scope.to, scope.from];
  if (isHousing(p.get("h"))) scope.housing = p.get("h");
  const compare = (p.get("cmp") || "").split(",").filter(isSpeciesCode).slice(0, 4);
  const feature = FEATURE_KEYS.has(p.get("f")) ? p.get("f") : null;
  return { page, code, scope, compare: [...new Set(compare)], feature };
}

/** Inverse of parseHash. Defaults are omitted so links stay short. */
export function buildHash({ page = "birds", code = null, scope = DEFAULT_SCOPE, compare = [], feature = null }) {
  const path = page === "species" && code ? `#/species/${code}` : `#/${page}`;
  const p = new URLSearchParams();
  if (scope.region) p.set("r", scope.region);
  if (scope.state) p.set("st", scope.state);
  if (scope.from !== DEFAULT_SCOPE.from) p.set("from", String(scope.from));
  if (scope.to !== DEFAULT_SCOPE.to) p.set("to", String(scope.to));
  if (scope.housing) p.set("h", scope.housing);
  if (compare.length) p.set("cmp", compare.join(","));
  if (feature && page === "yards") p.set("f", feature);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

/** Human description of the scope, for captions: "Northeast · NY · 2019–20 to 2023–24 · Suburban". */
export function describeScope(scope, stateName = (s) => s) {
  const parts = [];
  if (scope.state) parts.push(stateName(scope.state));
  else if (scope.region) parts.push(REGION_BY_CODE[scope.region].name);
  else parts.push("All of North America");
  parts.push(scope.from === scope.to ? seasonLabel(scope.from) : `${seasonLabel(scope.from)} to ${seasonLabel(scope.to)}`);
  if (scope.housing) parts.push(`${scope.housing} sites`);
  return parts.join(" · ");
}

/** eBird and All About Birds links for a species. */
export function speciesLinks(code, commonName) {
  const aab = String(commonName || "").replace(/'/g, "").replace(/[\s-]+/g, "_");
  return {
    ebird: `https://ebird.org/species/${encodeURIComponent(code)}`,
    allAboutBirds: `https://www.allaboutbirds.org/guide/${encodeURIComponent(aab)}`,
  };
}

export const STATE_NAMES = {
  "US-AL": "Alabama", "US-AK": "Alaska", "US-AZ": "Arizona", "US-AR": "Arkansas", "US-CA": "California",
  "US-CO": "Colorado", "US-CT": "Connecticut", "US-DE": "Delaware", "US-DC": "District of Columbia",
  "US-FL": "Florida", "US-GA": "Georgia", "US-HI": "Hawaii", "US-ID": "Idaho", "US-IL": "Illinois",
  "US-IN": "Indiana", "US-IA": "Iowa", "US-KS": "Kansas", "US-KY": "Kentucky", "US-LA": "Louisiana",
  "US-ME": "Maine", "US-MD": "Maryland", "US-MA": "Massachusetts", "US-MI": "Michigan", "US-MN": "Minnesota",
  "US-MS": "Mississippi", "US-MO": "Missouri", "US-MT": "Montana", "US-NE": "Nebraska", "US-NV": "Nevada",
  "US-NH": "New Hampshire", "US-NJ": "New Jersey", "US-NM": "New Mexico", "US-NY": "New York",
  "US-NC": "North Carolina", "US-ND": "North Dakota", "US-OH": "Ohio", "US-OK": "Oklahoma", "US-OR": "Oregon",
  "US-PA": "Pennsylvania", "US-RI": "Rhode Island", "US-SC": "South Carolina", "US-SD": "South Dakota",
  "US-TN": "Tennessee", "US-TX": "Texas", "US-UT": "Utah", "US-VT": "Vermont", "US-VA": "Virginia",
  "US-WA": "Washington", "US-WV": "West Virginia", "US-WI": "Wisconsin", "US-WY": "Wyoming",
  "CA-AB": "Alberta", "CA-BC": "British Columbia", "CA-MB": "Manitoba", "CA-NB": "New Brunswick",
  "CA-NL": "Newfoundland and Labrador", "CA-NS": "Nova Scotia", "CA-NT": "Northwest Territories",
  "CA-NU": "Nunavut", "CA-ON": "Ontario", "CA-PE": "Prince Edward Island", "CA-QC": "Quebec",
  "CA-SK": "Saskatchewan", "CA-YT": "Yukon",
};
export const stateName = (code) => STATE_NAMES[code] || code;
