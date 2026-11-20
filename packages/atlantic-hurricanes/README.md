# Atlantic hurricanes since 1851

A data app on every Atlantic tropical cyclone in NOAA's best-track record, 1851 to 2025, published as the 2026
season closes on November 30. It leads with one question: have hurricanes reaching major strength (category 3 or
more, 96 kt and up) become more common since weather satellites began watching the whole basin in 1966? It answers
by putting the satellite era's two 30-season halves, 1966-1995 and 1996-2025, side by side, and says plainly that
counts before 1966 are floors: storms that stayed far from ships and land could go unrecorded.

Views:

- **Overview**: the answer, the halves side by side, major hurricanes per season since 1851, a map of every
  satellite-era major hurricane's track, the strongest storms, and landfalls by country.
- **Explore**: filter by seasons, peak strength, start month, landfall and US landfall. Its cards cover storms per
  season, peak strength by decade, start month in each half, track density, landfalls by country and US state, and
  the strongest and most energetic storms.
- **A storm's page**: its numbers, its track coloured by strength with landfalls marked, and its wind over time.
- **Storms**: every storm, newest first. **Compare**: up to four storms. **About the data**.

No articles were given with the brief.

## Sources

| Dataset | Publisher | License | Fetched | Used for |
|---|---|---|---|---|
| [HURDAT2, Atlantic hurricane database, 1851-2025](https://www.nhc.noaa.gov/data/#hurdat) (`hurdat2-1851-2025-092326.txt`) | NOAA National Hurricane Center | Public domain (US government work) | 2026-11-19 | Every storm and track entry |
| [Natural Earth](https://www.naturalearthdata.com/) admin-0 countries (1:10m) and admin-1 states and provinces (1:50m) | Natural Earth | Public domain | 2026-11-19 | Placing landfalls in a country and state |
| [world-atlas](https://github.com/topojson/world-atlas) 2.0.2, countries-110m | Mike Bostock, from Natural Earth | ISC | vendored | Coastlines on the maps |

## Data

Two managed tables in the environment's `community` database:

- `atlantic_hurricanes__storms`: one row per storm (1,988 rows), with peak wind, lowest pressure, category, ACE
  and landfall counts computed from its own track.
- `atlantic_hurricanes__track_points`: one row per best-track entry (55,524 rows), with position, wind, pressure,
  status, record type, and, for landfalls, the country and state.

`hurricanes.malloy` models them; `index.malloy` exports `satellite_era_storms` (the lead question's source),
`storms` and `track_points`.

## Rebuild

```sh
bash pipeline/fetch.sh /tmp/raw
python3 pipeline/shape_hurdat2.py /tmp/raw /tmp/shaped
```

Then load `/tmp/shaped/storms.parquet` and `/tmp/shaped/track_points.parquet` into the `community` database as the two tables above.

## Caveats

- Before 1966 (satellites) and 1944 (aircraft reconnaissance), storms far from ships and land could be missed, and
  peak winds were often underestimated.
- The two satellite halves also differ in natural cycles: the Atlantic Multidecadal Oscillation was mostly in a
  quiet phase from about 1970 to 1994. The app counts storms; it does not attribute the change to a cause.
- Landfall entries (record type L) are used consistently only from 1991.
