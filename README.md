# 2026 Midterms Simulation Explorer

An educational, single-page Monte Carlo simulation of the 2026 U.S. midterms — Senate, House
and governors — from public data, with interactive scenario controls. It is a Credible example
app: a Malloy semantic model served by Publisher, with the app living in the package's
`public/` directory and the simulation running in the browser. It evaluates the data under
adjustable assumptions; it is not a prediction or an endorsement of any party.

The data is a dated snapshot of public sources (as of 2026-11-02), committed as one Parquet file
per table. [`package/data/README.md`](package/data/README.md) lists every source, its licence
and what is derived here.

## Run it

```bash
pnpm install
pnpm dev          # Publisher on :4000, watching the package
```

- App: http://localhost:4000/environments/elections/packages/midterms2026/index.html
- Publisher console: http://localhost:4000 · MCP: http://localhost:4040/mcp

Other scripts:

```bash
pnpm test                                        # model, query and format tests + the data gate
node scripts/forecast.mjs envShift=2              # headless topline against the running Publisher
node scripts/query.mjs "run: polls -> by_pollster" # any Malloy query, printed as a table
pnpm data:real                                    # re-fetch every source, re-curate, rebuild, validate
pnpm data                                         # rebuild the Parquet from cached downloads (data-raw/)
pnpm data:validate                                # just the validation gate
pnpm data:stub                                    # the old synthetic data, as an offline fixture
pnpm geo                                          # re-project state shapes into public/geo/
```

## What's on the page

- **Topline**: chance of control for each chamber, as "N in 100" with 100 dots, and the change
  from the default forecast whenever the levers move.
- **Levers**: national-environment shift, trust in polls, poll recency, correlated polling
  error, incumbency, college-graduate and voter-of-color swings, and weight on Kalshi prices,
  plus scenario presets. Every change re-runs 6,000 simulations in a Web Worker; the URL hash
  carries the scenario.
- **Per office**: balance of power, a clickable map (geographic for Senate and governors; a
  state map plus a 435-district strip for the House), the seat distribution, the forecast
  over time (re-run weekly with only the data available then) against Kalshi, the "road to a
  majority" snake, and a sortable race table with tipping-point odds.
- **Race drawer** (the interpretability view): the outcome distribution, a waterfall from
  partisan lean to fundamentals, the blend of fundamentals / polls / experts / market, what the
  race means for control, every poll with its house-effect, RV and trend adjustments and
  weight, the market history, past results and demographics — and the Malloy behind it.
- **What's driving the forecast**: the national-environment formula and its inputs, a
  sensitivity tornado, model vs. market, the blend mix by race, pollster house effects and
  special elections.

## Layout

```
publisher.config.json     environment "elections" -> package ./package (midterms2026)
serve.mjs, Dockerfile     production front door, same shape as community/apps/avalanche
scripts/                  data build and validation, geo projection, headless forecast, query CLI
  data/                   fetchers, Wikipedia/Kalshi curation, schema; curated/ is committed
package/
  elections.malloy        the semantic model: sources, measures, views
  data/                   Parquet snapshot + provenance README + build-info.json (as-of date)
  public/                 the app (served by Publisher; no build step)
    index.html styles.css markup and the token contract (blue = D, red = R, nothing else)
    query.js              every query the app runs, id validation, URL-hash codec
    model.js              the forecast model and simulation (pure; tested)
    sim-worker.js         runs model.js off the main thread
    charts.js             SVG drawing, no chart library
    format.js             formatting and colour helpers (pure; tested)
    app.js                boot, levers, rendering, the race drawer
    methodology.html/.js  the data inventory and how the model works, linked from the footer
    publisher.js          POSTs Malloy to Publisher; shared by both pages
    geo/states.json       pre-projected Albers USA state paths (from us-atlas)
  tests/
```

## Where the logic lives

The split is deliberate. The **Malloy model** holds everything deterministic and reviewable:
partisan lean (`historical_results.partisan_lean`), poll adjustments (`polls.adjusted_margin`),
pollster weights, market and approval history. The **browser model** (`public/model.js`)
holds only what a reader can tune: recency-weighted averaging, the blend, and the simulation.
Both are small enough to read end to end; the drawer's waterfall reads the model's named
parts directly, so the explanation cannot drift from the arithmetic.

## Notes and known limits (v1)

- Publisher returns at most 1,000 rows unless a query sets `limit`; row-level views set one.
- `year` is reserved in Malloy, hence `election_year`.
- House districts are not drawn geographically (no 2026 district shapes are bundled yet).
- 179 districts were redrawn for 2026 and have no census tabulation yet; the model reads their
  demographics as national averages. District results start in 2020 (2016 is states only).
- Ratings are Sabato's Crystal Ball only; House and Senate history from MIT is optional (it
  sits behind a Dataverse guestbook, see `package/data/README.md`).
- The forecast is as of the snapshot date, not today; it moves only when the data is rebuilt.
- The simulation uses normal errors; fat tails, candidate-quality effects and a
  primary/nominee layer are natural next steps.
- To host on community.credibledata.com, follow `community/infra/README.md` ("Hosting an app
  under a path") — `serve.mjs` already serves from `/` behind a stripped prefix.
