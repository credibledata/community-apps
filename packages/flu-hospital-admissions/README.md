# Flu in US hospitals

A data app on weekly flu hospital admissions in the United States: this flu season against the last five at the same
week of the season, for the country, every state and territory, with COVID-19, RSV, admissions by age and the share of
hospital beds each virus fills.

It responds to [The CDC stays quiet on flu as an early season catches many Americans off-guard](https://www.cnn.com/2026/11/24/health/flu-season-vaccines-cdc)
(CNN, November 24, 2026). Its numbers come from the data below, not from the article.

## What it shows

- **Overview**: the latest week's flu admissions in the US against the same week of the last five seasons, the season
  curve, the season so far, and the states with the highest rates now.
- **Explore**: pick a region or a state; the season curve, season to date, ages, regions, three-week risers, the
  state ranking, flu against COVID-19 and RSV, and bed shares follow.
- **A state's page**: its latest week and rank, its season curve per 100,000, ages, and flu, COVID-19 and RSV
  admissions and beds.
- **Records** (every state's week), **Compare** (up to four states), **About the data**.

## Caveats

Hospital reporting was voluntary from May to October 2024, so counts in those weeks are low and not comparable. The
data is by state and week, not by hospital. These are reported admissions, not the CDC's modelled burden estimates.
Ages are reported from 2024-2025 only.

## Sources

| Dataset | Publisher | License | Source | Fetched | Rows kept | Shaping |
|---|---|---|---|---|---|---|
| Weekly Hospital Respiratory Data (HRD) Metrics by Jurisdiction | US CDC, National Healthcare Safety Network | Public Domain U.S. Government (data.cdc.gov page) | https://data.cdc.gov/Public-Health-Surveillance/Weekly-Hospital-Respiratory-Data-HRD-Metrics-by-Ju/ua7e-t2fy | 2026-11-24 | 21,976 of 21,976 (weeks ending 2020-08-08 to 2026-11-14; 67 jurisdictions) | 44 additive count columns of 322 kept; CDC's percentages, per-100k rates and week-on-week changes dropped |
| State population estimates, Vintage 2025 (NST-EST2025-ALLDATA) | US Census Bureau | Public domain (US government work) | https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/ | 2026-11-24 | 52 of 66 rows (50 states, DC, Puerto Rico) | joined by state and calendar year (2025 for 2026 weeks); USA = their sum |

## Rebuild

1. `pipeline/fetch.sh /tmp/raw`
2. `uv run --with duckdb python -I pipeline/shape_weekly.py /tmp/raw /tmp/shaped`

This writes `weekly.parquet` (21,976 rows; USA total flu admissions 1,532,520, COVID 8,225,751, RSV 336,902) and
`jurisdictions.parquet` (67 rows). These were loaded as managed tables `community.flu_hospital_admissions__weekly`
and `community.flu_hospital_admissions__jurisdictions`.

Built by Credible's app-builder.
