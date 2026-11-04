# The 2026 Wildfire Season

A data app on the 2026 US wildfire season. It opens on the question **"How did 2026's fire season compare with
other years, and where, when and why did the fires burn?"** and answers it from every wildfire US agencies
reported to NIFC's incident system since 2015. The Overview gives this year's acres and fires against the
ten-year average to the same date, a week-by-week season race, a state map and ranked table, and a calendar of
acres by week and year. Explore filters every card by year, state, region, cause and size. There is a page per
state, a records list, a compare view for up to four states, and About the data.

## In the news

- [NPR's wildfire correspondent on one of the Western U.S.'s worst wildfire seasons](https://www.wamc.org/2026-09-06/nprs-wildfire-correspondent-on-one-of-the-western-u-s-s-worst-wildfire-seasons), NPR via WAMC, September 6, 2026
- [National Fire News](https://www.nifc.gov/fire-information/nfn), National Interagency Fire Center (read October 30, 2026)

## Sources

| Dataset | Publisher | License | Source | Fetched | Rows kept | Shaping |
|---|---|---|---|---|---|---|
| WFIGS Wildland Fire Incident Locations | National Interagency Fire Center (WFIGS), from IRWIN records of the USFS, BLM, BIA, NPS, USFWS and state and local agencies | None stated (page carries only a disclaimer). Used with attribution | [dataset page](https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-incident-locations); [feature service](https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations/FeatureServer/0) | 2026-11-04 | All 392,116 wildfire (WF) records read; 193,537 rows written: 112,654 fires of 1 acre or more, one row each, plus 80,883 rows summing 266,822 fires under 1 acre | Discovered 2015-01-01 onward (6 stray earlier records and partial 2014 dropped); fires under 1 acre summed by discovery date, state and cause; Canada and Mexico points of origin dropped in the model; causes, land owners, regions, complexity, behaviour, fuel coded to lookup files with spelling variants merged; acres = FinalAcres, else IncidentSize, else DiscoveryAcres; days to containment computed; coordinates to 4 decimals; split into half-year files |
| State boundaries | us-atlas 3.0.1 (US Census Bureau cartographic boundaries) | ISC; boundaries public domain | jsDelivr, checksum pinned | 2026-11-04 | — | unmodified |

## Caveats

- WFIGS is the incident record agencies file, not NIFC's official statistic. NIFC's National Fire News reported
  67,457 fires and nearly 9.4 million acres (146% of the ten-year average) by October 30, 2026, from situation
  reports. WFIGS shows 38,304 fires and 8,975,717 acres (131% of its own 2016–2025 average to the same date) by
  November 4: it holds fewer small fires and slightly fewer acres.
- A fire counts in the date, state and county where it was discovered. Fires still burning carry their latest size.
- Specific causes are filled for about one fire in five of 1 acre or more; containment times are often missing.

## Rebuild

```sh
pipeline/fetch.sh /tmp/raw                        # downloads every wildfire record, 2,000 a page
python3 -I pipeline/shape_fires.py /tmp/raw data  # writes data/fires_*.csv and data/lookup_*.csv
T="{'id': 'BIGINT', 'name': 'VARCHAR', 'discovered': 'DATE', 'n_fires': 'INTEGER', 'acres': 'DOUBLE', 'cause': 'VARCHAR', 'cause_detail_id': 'INTEGER', 'state': 'VARCHAR', 'fips': 'VARCHAR', 'gacc': 'VARCHAR', 'owner_id': 'INTEGER', 'lat': 'DOUBLE', 'lon': 'DOUBLE', 'days_to_contain': 'INTEGER', 'complexity': 'INTEGER', 'behavior': 'INTEGER', 'fuel_id': 'INTEGER', 'complex_child': 'INTEGER'}"
for f in data/fires_*.csv; do duckdb -c "COPY (SELECT * FROM read_csv('$f', header = true, types = $T)) TO '${f%.csv}.parquet' (FORMAT parquet, COMPRESSION zstd)" && rm "$f"; done
```

The record files ship as Parquet, which DuckDB reads far faster than CSV; the lookups stay CSV. Rerunning the
shaping script from a fresh download on 2026-11-04 reproduced the CSVs byte for byte.

## Files

- `wildfires.malloy`: the model (source `fires`), every field documented. `index.malloy` exports it.
- `public/`: the app. d3 7.9.0 and topojson-client 3.1.0 (ISC), Figtree and Source Serif 4 (SIL OFL 1.1).
