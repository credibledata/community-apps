# Shaken: earthquakes in the contiguous US since 2000

A data app on every earthquake of magnitude 2.5 and up in the 48 contiguous states and DC since January 2000, from
the USGS earthquake catalog (ComCat). It leads with one question: **how did Oklahoma go from a handful of
earthquakes a year to more than California, and what happened after the state limited wastewater injection?**

- **Overview**: Oklahoma's and California's earthquakes a year, with the 2009–2015 surge marked and the 2015–16
  injection limits noted; each state's yearly rate before, during and after the surge; every state ranked; the
  largest earthquakes.
- **Explore**: every card filtered by years, state and magnitude class: earthquakes by year, a month-by-year
  calendar, a map, states, counties, magnitude and depth.
- **A page per state** (`#/state/OK`): its numbers against the contiguous US, its years, its map, counties, depths,
  largest and latest earthquakes.
- **Records**: the earthquakes in scope, newest first, each linked to its USGS event page.
- **Compare**: up to four states side by side.
- **About the data**: sources, what was reshaped, and caveats.

## Sources

| Dataset | Publisher | License | Source | Fetched | Rows kept | Shaping |
|---|---|---|---|---|---|---|
| ComCat earthquake catalog, M2.5+, 2000-01-01 onward | US Geological Survey, Earthquake Hazards Program | Public domain (US federal government work) | [FDSN event web service](https://earthquake.usgs.gov/fdsnws/event/1/) | 2026-11-18 | 58,087 of 78,931 events read | Fetched a year at a time over the box 24–50°N, 125.5–66°W; deduplicated on event id; non-earthquake events (quarry blasts, explosions, mine collapses) dropped, leaving 71,690; placed in a state and county by point-in-polygon, keeping only events inside the 48 contiguous states and DC; times in UTC; coordinates to 4 decimals |
| Cartographic boundary files, states and counties, 1:500,000 | US Census Bureau | Public domain | [GENZ2023](https://www2.census.gov/geo/tiger/GENZ2023/shp/) | 2026-11-18 | — | used only to place each event; not shipped |

The shaped events are the managed table `community.us_earthquakes__events` (58,087 rows; magnitudes sum to
168,226.32; first event 2000-01-01 03:58:39 UTC, latest 2026-11-17 14:25:27 UTC). The table is not in this package.

## Caveats

- Detection improved over the period, notably in Oklahoma after 2010 as seismometers were added; at M2.5 and up the
  catalog is broadly complete, but early counts in quiet states may be slightly low.
- California's spikes in 2010 and 2019 are aftershock sequences (El Mayor–Cucapah near the border, and Ridgecrest).
- Magnitudes come in several types (`ml`, `md`, `mw` and others) and are not strictly comparable across networks.
- The app shows when and where earthquakes happened, not why. The link between wastewater injection and Oklahoma's
  earthquakes is the finding of USGS and Oklahoma Geological Survey research, not something this data proves.
- Yearly comparisons use whole years only; 2026 is partial.

## Rebuild

```sh
pipeline/fetch.sh /tmp/raw                     # ComCat one year per request, and the Census boundary zips
uv run --with geopandas --with pyarrow python -I pipeline/shape_events.py /tmp/raw /tmp/shaped
# then load /tmp/shaped/events.parquet into the managed table community.us_earthquakes__events
```

`shape_events.py` prints the rows read, kept and the magnitude sum, to compare with the numbers above.

## Files

- `us_earthquakes.malloy`: the model. Source `earthquakes` (one row per earthquake) and `oklahoma_vs_california`
  (the headline views), every field documented. `index.malloy` exports both.
- `public/`: the app. d3 7.9.0 (ISC) and its fonts (SIL OFL 1.1); see `public/vendor/README.md`.
- `card.svg` and `community-card.json`: the catalogue card.

An independent app, not produced by or affiliated with the USGS.
