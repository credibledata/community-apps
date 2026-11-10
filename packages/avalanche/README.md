# Colorado Avalanche Explorer

A data app on Colorado avalanche observations from the Colorado Avalanche Information Center (CAIC), 1951 to 2026.
Coverage is reliable from the 2010-11 season, which the app defaults to. The model is `avalanche.malloy`, with
`avalanche_observations` and `zone_detail(zone_name)`. The app is in `public/`.

## Sources

| Dataset | Publisher | License | Source | Fetched | Rows kept | Shaping |
|---|---|---|---|---|---|---|
| Avalanche observations | Colorado Avalanche Information Center | None stated for the data. CAIC's [terms of use](https://avalanche.state.co.us/terms-use) disclaim accuracy and bar robots and data mining of the site | [CAIC public API](https://api.avalanche.state.co.us/api/v2/avalanche_observations) | 2026-10-02 | 29,010 observations, 1951-04-23 to 2026-05-30 | See `data/README.md`: nested zone, detail and report fields flattened; dates converted to America/Denver; nearly empty columns dropped |
| Forecast-zone boundaries | Colorado Avalanche Information Center | None stated | `public/zones.geojson` (no Grand Mesa polygon is published) | — | — | unmodified |
| Chart.js v4.5.0 | Chart.js contributors | MIT | jsDelivr, sha256 in `public/vendor/README.md` | — | — | unmodified |

## Modeling notes

- One row is an observation, which can report several avalanches: count with `avalanches`, not `observations`.
- `pct_human_triggered` leaves unknown triggers out of the denominator; `pct_dangerous_size` leaves out unrated
  sizes.
- Sentinels are nulled (`U`/`Unkn` sizes, `---` triggers, `U`/`All` aspects). Elevation codes are HTML-escaped in
  the source data (`&#62;TL`).
- Crown depth, vertical fall and width are converted to one unit, with implausible entries discarded.
- Counts reflect observer effort as well as hazard: Gunnison is heavily reported.

## Run it

From `packages/`, as the repo README describes:

```bash
npx @malloy-publisher/server@0.11.2 --server_root . --port 4100 --mcp_port 4140
```

Then open http://localhost:4100/environments/community-apps/packages/avalanche/index.html. The app's pure modules
have tests: `npm test` in this folder.
