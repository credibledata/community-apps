"""Shape the SPC tornado database into one row per tornado.

Reads  <raw_dir>/tornadoes.csv            (SPC 1950-2025_actual_tornadoes.csv)
Writes <out_dir>/tornadoes.parquet        (loaded as community.us_tornadoes__tornadoes)

Run from the package root:
    uv run --with duckdb python -I pipeline/shape_tornadoes.py /tmp/raw /tmp/shaped

Shaping:
- tornado_id is year-om; SPC reuses an om for three pairs of distinct tornadoes, which get a -1/-2 suffix;
- keeps every row of the "actual tornadoes" file (whole-track records: sg = 1);
- magnitude -9 (unknown rating) becomes NULL; `rating_estimated` is SPC's fc flag;
- end coordinates of 0 (not recorded) become NULL, as do start coordinates of 0;
- time is local Central Standard Time (tz = 3) as published; the few rows in other zones keep their stated time;
- drops property/crop loss (its units change three times across the record), the per-county FIPS columns
  beyond the first, and the segment bookkeeping columns.
"""
import sys
import duckdb

raw, out = sys.argv[1], sys.argv[2]
con = duckdb.connect()
con.sql(f"""
create table t as select * from read_csv('{raw}/tornadoes.csv', all_varchar = true, header = true)
""")
con.sql(f"""
copy (
  select
    yr || '-' || om || case when count(*) over (partition by yr, om) > 1
      then '-' || row_number() over (partition by yr, om order by date, time, stf, f1) else '' end as tornado_id,
    cast(date as date)                                as event_date,
    cast(yr as integer)                               as year,
    cast(mo as integer)                               as month,
    cast(substr(time, 1, 2) as integer)               as hour_local,
    st                                                as state,
    cast(stf as integer)                              as state_fips,
    case when f1 not in ('0','') then lpad(stf, 2, '0') || lpad(f1, 3, '0') end as county_fips,
    case when mag = '-9' then null else cast(mag as integer) end as magnitude,
    cast(fc as integer) = 1                           as rating_estimated,
    cast(inj as integer)                              as injuries,
    cast(fat as integer)                              as fatalities,
    case when cast(slat as double) = 0 then null else round(cast(slat as double), 4) end as start_lat,
    case when cast(slon as double) = 0 then null else round(cast(slon as double), 4) end as start_lon,
    case when cast(elat as double) = 0 then null else round(cast(elat as double), 4) end as end_lat,
    case when cast(elon as double) = 0 then null else round(cast(elon as double), 4) end as end_lon,
    cast(len as double)                               as length_mi,
    cast(wid as integer)                              as width_yd,
    cast(ns as integer)                               as states_crossed
  from t
  order by event_date, tornado_id
) to '{out}/tornadoes.parquet' (format parquet)
""")
print(con.sql(f"""select count(*) rows, count(distinct tornado_id) ids, sum(fatalities) fat, sum(injuries) inj,
  min(event_date), max(event_date) from '{out}/tornadoes.parquet'"""))
