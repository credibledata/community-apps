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
