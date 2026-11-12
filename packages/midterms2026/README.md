# 2026 Midterms Simulation Explorer

An educational, single-page Monte Carlo simulation of the 2026 U.S. midterms — Senate, House
and governors — from public data, with interactive scenario controls. It is a Credible example
app: a Malloy semantic model served by Publisher, with the app living in the package's
`public/` directory and the simulation running in the browser. It evaluates the data under
adjustable assumptions; it is not a prediction or an endorsement of any party.

The data is a dated snapshot of public sources (as of 2026-11-02), committed as one Parquet file
per table. [The data](#the-data-a-dated-snapshot-of-public-sources), below, lists every source, its licence
and what is derived here.

## Run it

From this folder (`packages/midterms2026`):

```bash
pnpm install      # dependencies go to the repo root's node_modules/, outside the package (see .npmrc)
pnpm dev          # Publisher on :4000, watching the package
```

- App: http://localhost:4000/environments/elections/packages/midterms2026/index.html
- Election night: http://localhost:4000/environments/elections/packages/midterms2026/results.html
- Publisher console: http://localhost:4000 · MCP: http://localhost:4040/mcp

Other scripts:

```bash
pnpm test                                        # model, query and format tests + the data gate
node pipeline/forecast.mjs envShift=2            # headless topline against the running Publisher
node pipeline/query.mjs "run: polls -> by_pollster"   # any Malloy query, printed as a table
MODEL=results.malloy node pipeline/query.mjs "run: results -> tally"
pnpm data:validate                               # just the validation gate
pnpm data:stub                                   # the old synthetic data, as an offline fixture
pnpm geo                                         # re-project state shapes into public/geo/
```

Rebuilding the data is under [Rebuilding](#rebuilding), below.

### Updating election-night results

`pnpm results` fetches the current AP count (via the New York Times' results feeds) for every
Senate, House and governor race, saves the raw JSON to `data-raw/results/<time>/` at the repo root, writes a
committed snapshot to `pipeline/data/results/snapshots/<time>.csv`, rebuilds the results Parquet
from every snapshot so far and validates it. Re-run it whenever you want a fresh count; each run
adds a row to the page's "How the count came in" table. It needs network access but not
Publisher.

- `pnpm results --offline` rebuilds from the committed snapshots without fetching.
- The pre-election forecast is frozen in `pipeline/data/results/forecast*.csv` (every scenario
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
packages/midterms2026/
  README.md               this file: how to run it, every source, its licence and what is derived
  package.json, .npmrc    pnpm scripts and dev dependencies (installed into the repo root's node_modules/)
  publisher.config.json   environment "elections" -> this folder (pnpm dev and the image)
  serve.mjs, Dockerfile   the deployed image: Publisher behind a front door that serves the app at "/"
  elections.malloy        the semantic model: sources, measures, views
  forecast.malloy         the forecast's deterministic steps, levers as givens (imports elections.malloy)
  results.malloy          the count against the forecast (imports elections.malloy)
  data/                   Parquet snapshot + build-info.json (as-of date)
  pipeline/               data build and validation, geo projection, headless forecast, query CLI
    forecast-inputs.mjs   loads the simulation's inputs from Publisher (forecast.mjs, results.mjs)
    results.mjs           election-night count: fetch, snapshot, frozen forecast, Parquet
    data/                 fetchers, Wikipedia/Kalshi curation, schema; curated/ is committed
      results/            committed count snapshots, frozen forecast, past House popular vote
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
  sits behind a Dataverse guestbook, see [Rebuilding](#rebuilding)).
- The forecast is as of the snapshot date, not today; it moves only when the data is rebuilt.
- Election-night results are a partial, unofficial count until certified. Early margins move
  with the order places count mail and election-day ballots, which is why comparisons wait for
  90% of the expected vote.
- The simulation uses normal errors; fat tails, candidate-quality effects and a
  primary/nominee layer are natural next steps.
- `serve.mjs` serves the app at `/` and passes on only its query endpoints, so the image can sit
  behind a load balancer that strips a path prefix such as `/elections`.

## The data: a dated snapshot of public sources

Every Parquet file in `data/` is built by `pipeline/build-data.mjs` from public sources, as of the date
in `build-info.json` (currently **2026-11-02**, the day before the election). Nothing after that
date is included, so the forecast is the forecast as of the snapshot, not a live feed.
`pipeline/validate-data.mjs` gates every build (schema, joins, the 2026 map's counts, ranges, no
rows after the snapshot, and certified 2020/2024 results) and runs in `pnpm test`.

Margins everywhere are Democratic minus Republican, in points. "D" and "R" are the two sides of a
race: where a party has no nominee, the leading independent stands in for that side
(`races.matchup_note` says so; Dan Osborn in Nebraska is the D side).

| File | Rows | One row is | Source |
| --- | --- | --- | --- |
| `geographies.parquet` | 485 | A state or a 2026 House district | Census ACS 2024 1-year; presidential margins as in `historical_results` |
| `historical_results.parquet` | 850 | A result: year × office × geography (`geo_id = 'US'` is the nation) | MIT Election Lab (nation and states), The Downballot (districts) |
| `races.parquet` | 506 | A 2026 race: Senate, House or governor | Wikipedia; Sabato's Crystal Ball ratings via Wikipedia; FEC |
| `chambers.parquet` | 3 | Seat arithmetic for a chamber | `unitedstates/congress-legislators`; Wikipedia (governors) |
| `pollsters.parquet` | 188 | A pollster: grade and house effect | FiveThirtyEight ratings; house effects derived |
| `polls.parquet` | 1,177 | A poll: generic ballot (`US-GENERIC`) or a nominee head-to-head | VoteHub |
| `kalshi_prices.parquet` | ~35k | A market-day price for "Yes, the D side wins" | Kalshi public API |
| `approval.parquet` | 362 | A day of the presidential approval average | Derived from VoteHub approval polls |
| `special_elections.parquet` | 110 | A special election since 2025 | The Downballot |

Election night adds five tables, built by `pipeline/results.mjs` (`pnpm results`) rather than
`build-data.mjs`, so refreshing the count never touches the forecast's inputs:

| File | Rows | One row is | Source |
| --- | --- | --- | --- |
| `results.parquet` | 507 per snapshot | A race's count at one snapshot (`race_id = 'US-HOUSE-VOTE'` is the national House vote); `is_latest` marks the newest | AP via the New York Times' results feeds |
| `forecasts.parquet` | 3,036 | A scenario preset's frozen forecast for one race: P(D), mean margin, 10th/50th/90th percentiles | This model, run before polls closed |
| `forecast_chambers.parquet` | 18 | A scenario's forecast for one chamber | This model |
| `forecast_seats.parquet` | 878 | A scenario × chamber × Democratic seat count, with its share of simulations | This model |
| `house_popular_vote.parquet` | 6 | A past House election's national popular vote (2006–2024) and the prior presidential margin | Wikipedia; MIT Election Lab |

## Sources

| Source | Used for | Terms |
| --- | --- | --- |
| [Wikipedia](https://en.wikipedia.org/wiki/2026_United_States_elections): the 2026 Senate, House, gubernatorial and House-ratings articles, and the list of current governors | Race map, nominees, incumbents and their status, Sabato ratings, governors' parties | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/): attribute, share alike |
| [VoteHub polls API](https://votehub.com/) | Polls and approval polls | Public API; confirm redistribution terms before a commercial release |
| [FiveThirtyEight pollster ratings](https://github.com/fivethirtyeight/data/tree/master/pollster-ratings) | Pollster grades | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [The Downballot](https://www.the-downballot.com/) presidential-results-by-district sheets (2024 and 2026 lines) and special-elections tracker | District presidential margins; special elections | Public Google Sheets; credit The Downballot |
| [MIT Election Data and Science Lab](https://electionlab.mit.edu/data), U.S. President 1976–2024 | State and national presidential results | Harvard Dataverse, CC0 |
| [U.S. Census Bureau](https://www.census.gov/programs-surveys/acs), ACS 2024 1-year summary files (tables B01003, B03002, B15003, B01002, B19013) | Demographics | Public domain |
| [FEC bulk data](https://www.fec.gov/data/browse-data/?tab=bulk-data), `weball26` | Candidate total receipts | Public domain |
| [Kalshi trade API](https://kalshi.com/) | Market prices | Public market data; confirm display terms before a commercial release |
| [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators) | Current Senate and House membership | CC0 |
| [The New York Times' election results](https://www.nytimes.com/spotlight/elections) (Associated Press data), the JSON feeds behind its 2026 results pages | Election-night counts and race calls | Unofficial, undocumented feed; credit AP and the Times, and confirm terms (or license AP directly) before a commercial release |

The forecast is independent and not affiliated with or endorsed by any source, rater or market.

## What is derived here, and how

- **Race map.** Parsed from the Wikipedia articles into `pipeline/data/curated/races.csv`
  (committed, with a source URL per row). `locked_party` marks races where both finalists are
  from one party (California's top-two, unopposed seats); polls of those races are dropped.
- **Ratings.** Sabato's Crystal Ball column only, so every rating has one citable source. Races
  Sabato does not rate have a null rating, and the model gives the expert term no weight there.
- **Fundraising.** FEC total receipts (2025–26 cycle) for the two nominees, matched by state,
  office and name. Null for governors (they file with states) and wherever either side is
  missing, so the model never compares a filer against nobody.
- **Polls.** VoteHub polls ending 2026-01-01 through the snapshot, keeping the generic ballot
  and head-to-heads between the actual nominees (primary-season hypotheticals are dropped). A
  missing sample size takes the median.
- **Pollster grades.** FiveThirtyEight's numeric rating mapped to letters (2.8+ A+, 2.5 A, 2.2
  A-, 1.9 B+, 1.6 B, 1.3 B-, 1.0 C+, else C). Pollsters 538 never rated get C. `rating_538`
  names the 538 entry matched.
- **House effects.** For each poll, its margin minus the average of other pollsters' polls of
  the same race within 21 days (at least two of them), averaged per pollster and shrunk toward
  zero (`n / (n + 5)`).
- **Approval.** A daily average of approval polls: weight √n × 0.5^(age / 14 days) over 60 days,
  divided by √(that pollster's poll count) so daily trackers do not dominate.
- **District results.** 2024 and 2020 presidential margins on the 2026 lines. Districts whose
  lines changed for 2026 (`redrawn_for_2026`, 179 of them) have no census tabulation yet, so
  their demographics are null and the model reads them as national averages.
- **Kalshi.** Daily candles: the day's last trade, or the bid/ask midpoint on days without a
  trade. `is_latest` marks each market's last day. Volume is contracts × price.
- **Specials.** Contests with a Democrat and a Republican taking 90%+ of the vote between them.
  The tracker publishes margins, not vote totals, so `total_votes` is null and the "weighted"
  swing is the plain average.
- **Election-night counts.** Each feed race is matched to ours by state, office and seat, and
  each candidate to a side by name against the curated nominees, so independents standing in
  for a side count for it; anyone else is "other". The run fails if a race doesn't match or
  the feed's 2024 presidential margin differs from ours by more than 2.5 points (the
  Downballot sheet is rounded to whole points). Margins are D minus R as a share of all votes
  counted. Calls are AP's; a call can't be withdrawn between snapshots without failing
  validation.
- **Frozen forecast.** Every scenario preset run once with 10,000 simulations (seed 538)
  against this snapshot, before polls closed, and committed as CSV in
  `pipeline/data/results/`. Validation pins the default topline to the published one.
- **Past House popular vote.** The infobox of each election's Wikipedia article; 2010 and 2018
  are checked against the Clerk of the House's certified totals.

## Rebuilding

```sh
pnpm data:real    # fetch every source into data-raw/ (gitignored), re-curate, fetch Kalshi, build, validate
pnpm data         # rebuild the Parquet from the cached downloads and curated CSVs only
pnpm test         # includes the validation gate
pnpm results      # election night: fetch the latest count, add a snapshot, rebuild the results tables
pnpm results --offline   # rebuild the results tables from committed snapshots only
```

Raw downloads go to `data-raw/` at the repo root, outside the package, so they never publish. The build is
deterministic given `data-raw/`. Two optional MIT files (House and Senate results)
sit behind a Dataverse guestbook; download them by hand to `data-raw/mit-house.tab` and
`data-raw/mit-senate.tab` to add those offices to `historical_results`.
