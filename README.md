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
- Election night: http://localhost:4000/environments/elections/packages/midterms2026/results.html
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
pnpm results                                      # fetch the latest count, add a snapshot, rebuild results Parquet
MODEL=results.malloy node scripts/query.mjs "run: results -> tally"
```

### Updating election-night results

`pnpm results` fetches the current AP count (via the New York Times' results feeds) for every
Senate, House and governor race, saves the raw JSON to `data-raw/results/<time>/`, writes a
committed snapshot to `scripts/data/results/snapshots/<time>.csv`, rebuilds the results Parquet
from every snapshot so far and validates it. Re-run it whenever you want a fresh count; each run
adds a row to the page's "How the count came in" table. It needs network access but not
Publisher.

- `pnpm results --offline` rebuilds from the committed snapshots without fetching.
- The pre-election forecast is frozen in `scripts/data/results/forecast*.csv` (every scenario
  preset, 10,000 simulations, seed 538). It is only recomputed with `--refreeze`, which needs
  `pnpm dev` running; don't, unless the model or its data changed on purpose.
- The run fails loudly if a race in the feed can't be matched to ours or its 2024 presidential
  margin disagrees with our data, rather than guessing.
- Don't run `pnpm data` on election night just to refresh results: it re-dates the forecast
  snapshot. The results pipeline is separate on purpose.

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
- **Election night** (`results.html`, linked from the masthead): the count so far for each
  office against the frozen pre-election forecast — seats called, a status map, the count vs.
  the forecast and vs. the 2024 presidential margin per race, which simulated outcomes the
  calls have ruled out, and a race table with upsets and races outside the 80% range. Below,
  the national House vote's swing against past midterms (2006–2022), every scenario preset
  scored against the count (pick one to compare with throughout), and one row per snapshot.
  Comparisons use only races at least 90% counted.

## Layout

```
publisher.config.json     environment "elections" -> package ./package (midterms2026)
serve.mjs, Dockerfile     production front door, same shape as community/apps/avalanche
scripts/                  data build and validation, geo projection, headless forecast, query CLI
  forecast-inputs.mjs     loads the simulation's inputs from Publisher (forecast.mjs, results.mjs)
  results.mjs             election-night count: fetch, snapshot, frozen forecast, Parquet
  data/                   fetchers, Wikipedia/Kalshi curation, schema; curated/ is committed
    results/              committed count snapshots, frozen forecast, past House popular vote
package/
  elections.malloy        the semantic model: sources, measures, views
  forecast.malloy         the forecast's deterministic steps, levers as givens (imports elections.malloy)
  results.malloy          the count against the forecast (imports elections.malloy)
  data/                   Parquet snapshot + provenance README + build-info.json (as-of date)
  public/                 the app (served by Publisher; no build step)
    index.html styles.css markup and the token contract (blue = D, red = R, nothing else)
    query.js              every query the app runs, id validation, URL-hash codec
    model.js              the simulation, levers and presets (pure; tested)
    sim-worker.js         runs model.js off the main thread
    charts.js             SVG drawing, no chart library
    format.js             formatting and colour helpers (pure; tested)
    app.js                boot, levers, rendering, the race drawer
    methodology.html/.js  the data inventory and how the model works, linked from the footer
    results.html/.js      election night: the count against the forecast and past midterms
    publisher.js          POSTs Malloy to Publisher; shared by both pages
    geo/states.json       pre-projected Albers USA state paths (from us-atlas)
  tests/
```

## Where the logic lives

The **Malloy model** holds everything deterministic. `elections.malloy` has the inputs: partisan
lean (`historical_results.partisan_lean`), poll adjustments (`polls.adjusted_margin`), pollster
weights, market and approval history. `forecast.malloy` builds the forecast from them: the
national environment (`national`), each race's recency-weighted, trend-adjusted poll average
(`race_poll_average`, `poll_contributions`), and the blend of fundamentals, polls, experts and
market into an expected margin, sigma and win probability (`race_breakdown`).

The app's levers are Malloy givens, sent with each query, and `AS_OF_DAYS` picks the forecast
days (a Malloy date filter; the snapshot day by default):

```json
{ "query": "run: race_breakdown -> sim_inputs",
  "givens": { "ENV_SHIFT": 2, "AS_OF_DAYS": "2026-10-26 or 2026-11-02" } }
```

The **browser** (`public/model.js`) holds only the simulation: it takes each race's mean and
sigma and plays the election out 10,000 times with shared national, regional and education
errors. A lever move asks `forecast.malloy` for the new inputs (two queries), the history chart
asks for every week in one query, and the sensitivity chart asks for one breakdown per lever
setting once it is on screen. The drawer's waterfall reads the model's named parts directly, so
the explanation cannot drift from the arithmetic.

## Notes and known limits (v1)

- Publisher returns at most 1,000 rows unless a query sets `limit`; row-level views set one.
- `year` is reserved in Malloy, hence `election_year`.
- House districts are not drawn geographically (no 2026 district shapes are bundled yet).
- 179 districts were redrawn for 2026 and have no census tabulation yet; the model reads their
  demographics as national averages. District results start in 2020 (2016 is states only).
- Ratings are Sabato's Crystal Ball only; House and Senate history from MIT is optional (it
  sits behind a Dataverse guestbook, see `package/data/README.md`).
- The forecast is as of the snapshot date, not today; it moves only when the data is rebuilt.
- Election-night results are a partial, unofficial count until certified. Early margins move
  with the order places count mail and election-day ballots, which is why comparisons wait for
  90% of the expected vote.
- The simulation uses normal errors; fat tails, candidate-quality effects and a
  primary/nominee layer are natural next steps.
- To host on community.credibledata.com, follow `community/infra/README.md` ("Hosting an app
  under a path") — `serve.mjs` already serves from `/` behind a stripped prefix.

## License

The code is [MIT](LICENSE). The data in `package/data/` and `scripts/data/curated/` is derived
from third-party sources and keeps their licences (Wikipedia-derived tables are CC BY-SA 4.0,
FiveThirtyEight pollster ratings are CC BY 4.0); see
[`package/data/README.md`](package/data/README.md).
