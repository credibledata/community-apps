# New York EV registrations, before and after the federal tax credit

A data app on electric vehicles newly registered in New York State, month by month from November 2024
to September 2026, against every other new registration in the same months. It asks whether New York's EV
registrations fell when the federal clean vehicle tax credit ended for vehicles bought after 30 September 2025,
and lets a reader explore by month, county, region, make, body type and vehicle class.

The app is `public/index.html`, served by Publisher. Views: Overview (`#/`), Explore (`#/explore`), a page per county (`#/county/<name>`),
Compare (`#/compare?ids=a,b`), Records (`#/records`) and About the data (`#/about`).

It responds to:

- [U.S. EV Market Slows in 2025 Despite Record Model Availability and Rising Infrastructure Challenges](https://emobilityplus.com/2026/03/26/u-s-ev-market-slows-in-2025-despite-record-model-availability-and-rising-infrastructure-challenges/), EMobility+, 2026-03-26

## Sources

| Dataset | Publisher | License | Source | Fetched | Rows kept | Shaping |
|---|---|---|---|---|---|---|
| Department of Motor Vehicles Registration Transactions: Two Year Window, electric ORIGINAL transactions | New York State Department of Motor Vehicles | [OPEN-NY Terms of Use](https://data.ny.gov/download/77gx-ii52/application/pdf) | [data.ny.gov/d/s2dd-yksa](https://data.ny.gov/d/s2dd-yksa) | 2026-11-03 | 96,886 of 101,885 | effective months 2024-11 to 2026-09; VIN, city, ZIP, coordinates and use not kept; county, class, make, body type and registrant type coded to integers with `lookup_*.csv`; `ev_registrations_<year>h<half>.parquet` |
| The same dataset, ORIGINAL transactions of every fuel | New York State Department of Motor Vehicles | [OPEN-NY Terms of Use](https://data.ny.gov/download/77gx-ii52/application/pdf) | [data.ny.gov/d/s2dd-yksa](https://data.ny.gov/d/s2dd-yksa) | 2026-11-03 | 46,173 of 50,422 grouped rows | counted on the portal by effective month, county, fuel and registration class; months 2024-11 to 2026-09; `originals_by_month.parquet` |

Source: New York State Department of Motor Vehicles, via data.ny.gov.

The window's exports run from 2024-11-02 to 2026-10-31 (18,492,611 transactions in all). October 2026 is
left out because registrations keep arriving for weeks after their effective date.

County boundaries: New York's 62 counties cut from [us-atlas 3.0.1](https://github.com/topojson/us-atlas)
(US Census Bureau cartographic boundaries, public domain; ISC license) by `pipeline/shape_map.py`.

## Model

`ny_ev.malloy` defines four sources, exported by `index.malloy`:

- `registrations`: ORIGINAL registrations of every fuel by month, county, fuel and class. Measures: `ev_registrations`,
  `new_registrations`, `ev_share`, and the share with and after the credit (`ev_share_with_credit`,
  `ev_share_after_credit`, `ev_share_change`).
- `ev_records`: one row per electric ORIGINAL registration, with make, body type, model year, class, registrant type
  and county.
- `passenger_cars` and `passenger_evs`: the same two, PASSENGER class only. The headline reads these.

## Caveats

- An ORIGINAL registration includes used vehicles brought into New York; the DMV publishes no new-or-used flag.
- The DMV has no hybrid fuel code; hybrids count as gasoline. How plug-in hybrids are filed is not documented.
- The headline share is for the PASSENGER class. In-transit permits (temporary plates) are a separate group.
- Before and after is a comparison in time, not a cause.

## Rebuild

```sh
pipeline/fetch.sh /tmp/raw
uv run --with duckdb python -I pipeline/shape_ny.py /tmp/raw data
python3 -I pipeline/shape_map.py /tmp/raw public/vendor/maps
for f in data/originals_by_month.csv data/ev_registrations_*.csv; do duckdb -c "COPY (SELECT * FROM read_csv_auto('$f')) TO '${f%.csv}.parquet' (FORMAT parquet, COMPRESSION zstd)" && rm "$f"; done
```

The record files ship as Parquet, which DuckDB reads far faster than CSV; the lookups stay CSV. Rerunning the
shaping script on the same downloads reproduces its CSVs byte for byte (checked 2026-11-03). The
source is a rolling two-year window refreshed weekly, so a later download holds a later window.
