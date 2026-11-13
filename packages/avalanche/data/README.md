# Data

`avalanche_observations.parquet` — every avalanche observation returned by the CAIC public API
(`https://api.avalanche.state.co.us/api/v2/avalanche_observations`), fetched month by month on
2026-10-02, 29,010 rows, observed 1951-04-23 to 2026-05-30.

Prep done outside Malloy (everything else is in `avalanche.malloy`):
- nested `backcountry_zone` flattened to `zone` (title) and `region` (parent zone slug)
- nested `avalanche_detail.description` and `observation_report` id/url flattened
- `observed_date` = `observed_at` (UTC) converted to the America/Denver local date
- unused, nearly-empty columns (road effects, grain sizes, …) dropped

Source: Colorado Avalanche Information Center, avalanche.state.co.us. Observations are reported by
forecasters, professionals, and the public; coverage is reliable from the 2011 season onward.

## Accidents and SNOTEL

Built by `pipeline/shape.py` from the downloads `pipeline/fetch.sh` makes.

`accidents.parquet`: one row per Colorado report from CAIC's accident_reports and incident_reports endpoints
(`https://api.avalanche.state.co.us/api/v2/…`), fetched 2026-11-13, 1,326 rows. A report in both is kept once, as
the accident. People caught, buried, injured and killed are counted from the report's affected groups (its summary
counts where groups are missing); a person killed or buried counts as caught. Dates are Mountain time. Names,
staff names and narrative text are dropped; `report_url` links to the report on avalanche.state.co.us.

`accident_observations.parquet`: report_id to observation id, for every avalanche observation a report embeds (1,440
links; 1,405 match a row in `avalanche_observations.parquet`).

`snotel_stations.parquet`: the 120 Colorado SNOTEL stations from the NRCS AWDB REST API, with the CAIC zone each falls
in (point in polygon against `public/zones.geojson`); 115 have daily data.

`snotel_zone_daily.parquet`: per zone and day, 2010-10-01 to 2026-09-30, the mean over the zone's reporting stations of
snow water equivalent, snow depth, daily high and low (°F) and new SWE (the day's rise in SWE at a station).
`new_swe_3d_in` sums the zone's new SWE over the day and the two before it; `tmax_change_f` is the day's high minus
the day before's.

Source: USDA Natural Resources Conservation Service, National Water and Climate Center, SNOTEL network.
