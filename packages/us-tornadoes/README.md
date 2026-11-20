# US tornadoes since 1950: has tornado country moved?

A data app over every US tornado NOAA's Storm Prediction Center has recorded since 1950, one row per tornado. It leads
with one question: has tornado activity shifted from the Great Plains toward the Southeast, decade by decade?

The answer, on (E)F1-and-stronger tornadoes (the counts least changed by better reporting): the Great Plains' share fell
from 41% in the 1950s to 21% in the 2020s, while the Southeast's rose from 19% to 37%; the two crossed in the 2000s.
The Southeast also carries 43% of all tornado deaths since 1950.

## What is in the app

- **Overview**: the answer, four headline numbers with sparklines, the two regions' shares by decade, and the states
  with the most (E)F1+ tornadoes.
- **Explore**: tornadoes per year (drag to pick a period), (E)F1+ per year by region and decade, where the average
  strong tornado touches down, the Southeast's share of tornadoes against its share of deaths, states, night-time
  tornadoes by region, deaths by rating, and month-by-hour and season charts. Clicking a bar or row filters every card.
- **A page per state**, **Records** (the newest 50 tornadoes under the filters), **Compare** (up to four states) and
  **About the data** (sources, region definitions, caveats).

No articles were given with the brief; the app answers the question as posed.

## Files

- `tornadoes.malloy`: the semantic model (source `tornadoes`, over managed table `community.us_tornadoes__tornadoes`),
  every measure and view with a `#(doc)`.
- `index.malloy`: the root model, exporting `tornadoes`.
- `public/`: the data app (hand-written HTML, CSS and JavaScript; d3 and fonts vendored, licenses in `public/vendor/`).
- `pipeline/`: the scripts that fetch and shape SPC's file.
- `community-card.json`, `card.svg`: the community catalogue card and its art.

## Caveats

Weak-tornado reporting rose sharply with Doppler radar, so the app compares regions on (E)F1+ and on shares. Ratings
moved from the Fujita to the Enhanced Fujita scale on 1 February 2007. The 2020s hold six years (2020-2025). Times are
local standard time. A tornado counts in the state it began in. The regions are this app's grouping of states,
defined in `tornadoes.malloy` and on the About view.

## Sources

| Dataset | Publisher | License | Source | Fetched | Rows kept | Shaping |
|---|---|---|---|---|---|---|
| Actual tornadoes, 1950-2025 | NOAA Storm Prediction Center, Severe Weather Database | Public domain (US federal government work). Source: NOAA Storm Prediction Center | https://www.spc.noaa.gov/wcm/ | 2026-11-18 | 73,458 of 73,458 | one row per tornado; columns renamed to snake_case; rating -9 and zero coordinates become blank; loss columns dropped; three reused tornado numbers given a suffix |

## Rebuild

1. `pipeline/fetch.sh /tmp/raw`
2. `uv run --with duckdb python -I pipeline/shape_tornadoes.py /tmp/raw /tmp/shaped`
3. Load `/tmp/shaped/tornadoes.parquet` into managed table `community.us_tornadoes__tornadoes` (73,458 rows; 6,341 deaths, 99,311 injuries).
