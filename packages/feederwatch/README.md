# Project FeederWatch explorer

A data app on Project FeederWatch, the winter count of birds at feeders run by the Cornell Lab of Ornithology and
Birds Canada since 1987. It covers seasons 1988-89 to 2023-24: 45 million bird counts from 4.1 million checklists
at more than 100,000 North American feeder sites, pre-aggregated to small Parquet files. Start with
`bird_trends` in `index.malloy`. The app is in `public/`.

## Sources

| Dataset | Publisher | License | Source | Release | Shaping |
|---|---|---|---|---|---|
| Project FeederWatch raw data | Cornell Lab of Ornithology and Birds Canada | Listed as a Public Domain Dedication on the Mendeley Data copy; not confirmed on feederwatch.org. Cite Bonter, D. N. and E. I. Greig (2021), "Over 30 years of standardized bird counts at supplementary feeding stations in North America: A citizen science data report for Project FeederWatch" | [feederwatch.org raw data](https://feederwatch.org/explore/raw-dataset-requests/); [Mendeley Data](https://data.mendeley.com/datasets/cptx336tt5) | Public release of 5 June 2024 | Valid records only; forms rolled up to species per eBird's taxonomy; sites offering no food dropped; pre-aggregated by site, season, week and grid cell. No row-level records ship |
| States and provinces map | Not recorded in the package | Not recorded | `public/img/provinces.topo.json` | — | unmodified |
| Figtree, Source Serif 4 fonts | Their authors | SIL Open Font License; texts in `public/fonts/` | `public/fonts/` | — | unmodified |

The 15 files in `data/` (39 MB) were built outside this package from the raw extracts. The build is not in this
repo. `feederwatch.malloy` explains every table and measure, and the checks behind the headline measure.

This explorer is independent and not endorsed by the Cornell Lab of Ornithology or Birds Canada. Their logos in
`public/img/` credit the data source.

## Run it

From `packages/`, as the repo README describes:

```bash
npx @malloy-publisher/server@0.11.2 --server_root . --port 4100 --mcp_port 4140
```

Then open http://localhost:4100/environments/community-apps/packages/feederwatch/index.html
