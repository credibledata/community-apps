# Project FeederWatch explorer

A data app on Project FeederWatch, the winter count of birds at feeders run by the Cornell Lab of Ornithology and
Birds Canada since 1987. It covers seasons 1988-89 to 2023-24: 45 million bird counts from 4.1 million checklists
at more than 100,000 North American feeder sites, pre-aggregated to small Parquet files. Start with
`bird_trends` in `index.malloy`. The app is in `public/`.

## Sources

[Project FeederWatch](https://feederwatch.org) raw data from the Cornell Lab of Ornithology and Birds Canada, public
release of 5 June 2024 ([raw data requests](https://feederwatch.org/explore/raw-dataset-requests/),
[Mendeley Data](https://data.mendeley.com/datasets/cptx336tt5)). Cite: Bonter, D. N. and E. I. Greig (2021), "Over 30
years of standardized bird counts at supplementary feeding stations in North America: A citizen science data report
for Project FeederWatch".

Valid records only; forms rolled up to species per eBird's taxonomy; sites offering no food dropped; pre-aggregated
by site, season, week and grid cell, so no row-level records ship. The 15 files in `data/` are 39 MB.
`feederwatch.malloy` explains every table and measure, and the checks behind the headline measure.

Fonts: Figtree and Source Serif 4, SIL Open Font License, with their texts in `public/fonts/`.

This explorer is independent and not endorsed by the Cornell Lab of Ornithology or Birds Canada. Their logos in
`public/img/` credit the data source.

## Run it

From `packages/`, as the repo README describes:

```bash
npx @malloy-publisher/server@0.11.2 --server_root . --port 4100 --mcp_port 4140
```

Then open http://localhost:4100/environments/community-apps/packages/feederwatch/index.html
