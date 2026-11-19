# Colorado River reservoirs

How full are Lake Powell and Lake Mead, and how close are they to the lines that cut the Lower Basin's water and
change how Glen Canyon Dam releases? This app draws the daily elevation of both lakes from Reclamation's own
records, against the operating lines of the 2007 Interim Guidelines. It also covers the nine other Reclamation
reservoirs on the Colorado and its tributaries: Fontenelle, Flaming Gorge, Taylor Park, Blue Mesa, Morrow Point,
Crystal, Navajo, Mohave and Havasu.

## What it shows

- **Overview**: where Powell and Mead stand on the latest day against their nearest lines, their storage over the
  last ten years, and both lakes' monthly elevation since Powell began filling in 1963, with the lines drawn.
- **Explore**: every reservoir ranked by its share of record storage; the change in elevation over a year; storage
  by water year, stacked; days each water year below each line; inflow and release; how far each reservoir drew
  down each year. Filters for years and basin; a click on a reservoir or a year filters every card.
- **A page per reservoir**: its numbers, every water year overlaid week by week (the year under way in the accent),
  weekly elevation with its lines, water in and out per water year, and its latest readings.
- **Records**, **Compare** (up to four reservoirs) and **About the data**.

## The article it responds to

- Grist, [As the Colorado River shrinks, calls to drain Lake Powell grow](https://grist.org/drought/as-the-colorado-river-shrinks-calls-to-drain-lake-powell-grow/)

## Sources

| Dataset | Publisher | License | Source | Fetched | Rows kept | Shaping |
|---|---|---|---|---|---|---|
| HydroData daily reservoir data, 11 sites (pool elevation, storage, inflow, total release, evaporation) | U.S. Bureau of Reclamation, Upper Colorado Basin Region | Public domain (U.S. federal government work) | [HydroData reservoir data](https://www.usbr.gov/uc/water/hydrodata/reservoir_data/site_map.html) | 2026-11-17 | 281,935 reservoir-days from 48 daily series (about 1.15 million values) | The five series joined into one row per reservoir per day; values rounded (elevation 0.01 ft, the rest to whole units); readings dated after the fetch dropped |
| Operating thresholds for Lake Mead and Lake Powell | U.S. Bureau of Reclamation | Public domain (U.S. federal government work) | [2007 Interim Guidelines Record of Decision](https://www.usbr.gov/lc/region/programs/strategies/RecordofDecision.pdf) | 2026-11-17 | 7 lines | Typed from the Record of Decision with the section each comes from (in `pipeline/shape_readings.py`); not read from the daily data |

Reclamation's daily data are provisional and can be revised. The guidelines run through 2026. Powell's
Equalization line moves by year (about 3,636 to 3,666 ft); the app draws 3,700 ft. Lake Mead's shortage tiers act on
the projected January 1 elevation in Reclamation's August 24-Month Study, not on a daily reading.

## Files

- `colorado_river.malloy`: the sources, measures and views. `index.malloy` exports `readings` (one row per
  reservoir per day), `powell_mead` (the headline question's source), `reservoirs` and `thresholds`.
- `public/`: the data app.
- `pipeline/`: the scripts that rebuild the tables.

The data is not in the package. The model reads three managed tables in the community-apps environment's
`community` database:

| Table | Rows | Written by |
|---|---|---|
| `colorado_river_reservoirs__readings` (date, site_id, elevation_ft, storage_af, inflow_cfs, release_cfs, evaporation_af) | 281,935 | `pipeline/shape_readings.py` → `readings.csv` |
| `colorado_river_reservoirs__reservoirs` | 11 | `pipeline/shape_readings.py` → `reservoirs.csv` |
| `colorado_river_reservoirs__thresholds` | 7 | `pipeline/shape_readings.py` → `thresholds.csv` |

## Rebuild

```sh
pipeline/fetch.sh /tmp/raw
python3 -I pipeline/shape_readings.py /tmp/raw /tmp/shaped
```

Then load each file in `/tmp/shaped` into the `community` database as `colorado_river_reservoirs__<file name>`.
The shaping step needs only the Python standard library. The tables were loaded on 2026-11-18 from the rows the
script wrote from the 2026-11-17 download (281,935 readings). Through the tables, the model returns the same counts
and headline numbers as it did over those files.
