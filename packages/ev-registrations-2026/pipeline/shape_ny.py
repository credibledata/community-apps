"""Shape the NY DMV registration downloads into data/.

Reads  <raw>/ny_ev_original.csv and <raw>/ny_original_by_month.csv (written by pipeline/fetch.sh).
Writes <out>/ev_registrations_<yyyy>h<n>.csv  one row per electric ORIGINAL registration, coded
       <out>/originals_by_month.csv            ORIGINAL registrations of every fuel by month, county, fuel, class
       <out>/lookup_<column>.csv               id -> text for each coded column

Keeps effective months 2024-11 through 2026-09: the window's first export is 2024-11-02 and its
last is 2026-10-31, so October 2026 is still filling in. Rows dated outside that span are dropped.

Run from the package root:
  uv run --with duckdb python -I pipeline/shape_ny.py /tmp/raw data
"""
import sys
import duckdb

raw, out = sys.argv[1], sys.argv[2]
FIRST, LAST = "2024-11-01", "2026-09-30"
c = duckdb.connect()
c.sql(f"""create table ev as select * from read_csv('{raw}/ny_ev_original.csv', all_varchar = true)
          where effective_date::date between '{FIRST}' and '{LAST}'""")
c.sql(f"""create table agg as select * from read_csv('{raw}/ny_original_by_month.csv', all_varchar = true)
          where month::date between '{FIRST}' and '{LAST}'""")

def norm(col):
    return f"coalesce(nullif(trim({col}), ''), 'UNKNOWN')"

# One lookup per coded column, ids ordered by frequency so the common values get short codes.
lookups = {
    "county": ("residence_county", ["ev", "agg"]),
    "class": ("registration_class", ["ev", "agg"]),
    "make": ("make_code", ["ev"]),
    "body": ("body_type", ["ev"]),
    "registrant": ("registrant", ["ev"]),
    "fuel": ("fuel", ["agg"]),
}
for name, (col, tables) in lookups.items():
    weight = {"ev": "1", "agg": "n::bigint"}
    union = " union all ".join(f"select {norm(col)} as v, {weight[t]} as w from {t}" for t in tables)
    c.sql(f"""create table lk_{name} as
              select row_number() over (order by sum(w) desc, v) as id, v as {name}
              from ({union}) group by v""")
    c.sql(f"copy (select * from lk_{name} order by id) to '{out}/lookup_{name}.csv' (header)")

c.sql(f"""create table ev_out as
  select strftime(e.effective_date::date, '%Y-%m-%d') as reg_date,
         cty.id as county_id, cls.id as class_id, mk.id as make_id, bd.id as body_id, rg.id as registrant_id,
         try_cast(e.model_year as integer) as model_year
  from ev e
  join lk_county cty on cty.county = {norm('e.residence_county')}
  join lk_class cls on cls.class = {norm('e.registration_class')}
  join lk_make mk on mk.make = {norm('e.make_code')}
  join lk_body bd on bd.body = {norm('e.body_type')}
  join lk_registrant rg on rg.registrant = {norm('e.registrant')}
""")
for y, h, lo, hi in [(2024, 2, "2024-07-01", "2024-12-31"), (2025, 1, "2025-01-01", "2025-06-30"),
                     (2025, 2, "2025-07-01", "2025-12-31"), (2026, 1, "2026-01-01", "2026-06-30"),
                     (2026, 2, "2026-07-01", "2026-12-31")]:
    c.sql(f"""copy (select * from ev_out where reg_date between '{lo}' and '{hi}'
              order by reg_date, county_id, class_id, make_id, body_id, registrant_id, model_year)
              to '{out}/ev_registrations_{y}h{h}.csv' (header)""")

c.sql(f"""copy (
  select strftime(a.month::date, '%Y-%m-%d') as month, cty.id as county_id, f.id as fuel_id, cls.id as class_id,
         sum(a.n::bigint) as registrations
  from agg a
  join lk_county cty on cty.county = {norm('a.residence_county')}
  join lk_fuel f on f.fuel = {norm('a.fuel')}
  join lk_class cls on cls.class = {norm('a.registration_class')}
  group by all order by all) to '{out}/originals_by_month.csv' (header)""")

print("ev rows in:", c.sql("select count(*) from read_csv('" + raw + "/ny_ev_original.csv')").fetchall()[0][0],
      "kept:", c.sql("select count(*) from ev_out").fetchall()[0][0])
print("agg rows in:", c.sql("select count(*) from read_csv('" + raw + "/ny_original_by_month.csv')").fetchall()[0][0],
      "kept:", c.sql("select count(*) from agg").fetchall()[0][0])
