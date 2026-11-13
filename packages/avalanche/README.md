# Colorado Avalanche Explorer

A data app on Colorado avalanches: the observations reported to the Colorado Avalanche Information Center (CAIC),
the accidents CAIC wrote up, and the SNOTEL snowpack in each forecast zone. Coverage is reliable from the 2010-11
season, which the app defaults to. The model is `avalanche.malloy`:

- `avalanche_observations` and `zone_detail(zone_name)`: one row per observation, 1951 to 2026.
- `accidents`: one row per Colorado accident or incident report, with people caught, buried, injured and killed.
- `accident_avalanches`: links each report to its avalanche observations.
- `snow_days`: SNOTEL readings per zone and day from October 2010, joined to that day's avalanches.

The app is in `public/`; `pipeline/` fetches and shapes the accident and SNOTEL tables.

## Sources

- Avalanche observations and forecast-zone boundaries from the [Colorado Avalanche Information Center](https://avalanche.state.co.us)
  (CAIC), through its public API, fetched 2026-10-02: 29,010 observations from 1951-04-23 to 2026-05-30.
- Accident and incident reports from CAIC, through the same API, fetched 2026-11-13: 1,326 Colorado reports from
  1951 to 2026-11-03. Only counts, dates, places, activity and danger rating are kept; each row links to CAIC's report.
- Daily snow water equivalent, snow depth and temperature for 115 Colorado SNOTEL stations from the USDA NRCS
  [Air and Water Database](https://wcc.sc.egov.usda.gov/awdbRestApi/), fetched 2026-11-13, October 2010 to September 2026.

`data/README.md` describes how each file was prepared. Chart.js v4.5.0 (MIT) is in `public/vendor/`; the Barlow
fonts (SIL Open Font License 1.1) are in `public/fonts/`.

CAIC's [terms of use](https://avalanche.state.co.us/terms-use) do not grant redistribution and prohibit automated
collection; this package ships CAIC-derived files pending CAIC's written permission.

## Modeling notes

- One row is an observation, which can report several avalanches: count with `avalanches`, not `observations`.
- `pct_human_triggered` leaves unknown triggers out of the denominator; `pct_dangerous_size` leaves out unrated
  sizes.
- Sentinels are nulled (`U`/`Unkn` sizes, `---` triggers, `U`/`All` aspects). Elevation codes are HTML-escaped in
  the source data (`&#62;TL`).
- Crown depth, vertical fall and width are converted to one unit, with implausible entries discarded.
- Counts reflect observer effort as well as hazard: Gunnison is heavily reported.
- Ski areas rarely send control results to CAIC: about 1% of avalanches since 2010-11 are operational.
- SWAG defines trigger modifiers only for artificial triggers, so a modifier on a natural avalanche is nulled.
- Accidents: a report in both CAIC's accident and incident records is kept once. Deaths per season match CAIC's
  published Colorado fatality table. Since 2011 the avalanches in fatal reports rarely carry an elevation band or
  problem, so the app breaks accidents down by aspect and activity instead.
- SNOTEL: a zone's value is the mean over its stations; zones have 4 (Gunnison) to 28 (Front Range) stations, and
  Grand Mesa, with no published boundary, has none. New SWE is the day's rise in snow water equivalent.

## Run it

From `packages/`, as the repo README describes:

```bash
npx @malloy-publisher/server@0.11.2 --server_root . --port 4100 --mcp_port 4140
```

Then open http://localhost:4100/environments/community-apps/packages/avalanche/index.html. The app's pure modules
have tests: `npm test` in this folder.

## Rebuild the accident and SNOTEL tables

```bash
pipeline/fetch.sh /tmp/avalanche-raw          # SNOTEL only; add --caic with CAIC's permission
uv run --with duckdb==1.1.3 python -I pipeline/shape.py /tmp/avalanche-raw data
```
