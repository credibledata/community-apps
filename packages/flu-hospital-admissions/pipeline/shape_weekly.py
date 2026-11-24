"""Shape CDC NHSN hospital respiratory data into one row per jurisdiction per week.

Reads  <raw>/hrd.csv, <raw>/hrd_meta.json, <raw>/pop.csv  (from pipeline/fetch.sh)
Writes <out>/weekly.parquet  (jurisdiction x week: admissions, patients and beds for COVID-19, flu and RSV)
       <out>/jurisdictions.parquet  (code, name, level, census region, 2025 population)

Run from the package root:
  uv run --with duckdb python -I pipeline/shape_weekly.py /tmp/raw /tmp/shaped

Kept: the additive counts only. CDC's percentages, per-100k rates and week-on-week changes are dropped,
since the model recomputes them from the counts at any grain. `population` is the Census estimate for the
week's calendar year (2025 for 2026 weeks, the latest vintage); it is blank for American Samoa, Guam, the
Northern Mariana Islands and the US Virgin Islands, which the Census state file does not cover. The USA row's
population is the sum of the 50 states, DC and Puerto Rico.
"""
import json
import sys
from pathlib import Path

import duckdb

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
meta = json.loads((raw / "hrd_meta.json").read_text())
name_of = {c["fieldName"]: c["name"].strip() for c in meta["columns"]}

VIRUS = {"covid": "c19", "flu": "flu", "rsv": "rsv"}
cols = {
    "inpatient_beds": "numinptbeds",
    "inpatient_beds_occupied": "numinptbedsocc",
    "icu_beds": "numicubeds",
    "icu_beds_occupied": "numicubedsocc",
    "hospitals_reporting_beds": "numinptbedshosprep",
}
for v, k in VIRUS.items():
    cols |= {
        f"{v}_admissions": f"totalconf{k}newadm",
        f"{v}_admissions_adult": f"totalconf{k}newadmadult",
        f"{v}_admissions_ped": f"totalconf{k}newadmped",
        f"{v}_adm_0_4": f"numconf{k}newadmped0to4",
        f"{v}_adm_5_17": f"numconf{k}newadmped5to17",
        f"{v}_adm_18_49": f"numconf{k}newadmadult18to49",
        f"{v}_adm_50_64": f"numconf{k}newadmadult50to64",
        f"{v}_adm_65_74": f"numconf{k}newadmadult65to74",
        f"{v}_adm_75_plus": f"numconf{k}newadmadult75plus",
        f"{v}_adm_unknown_age": f"numconf{k}newadmunk",
        f"{v}_inpatients": f"totalconf{k}hosppats",
        f"{v}_icu_patients": f"totalconf{k}icupats",
        f"{v}_hospitals_reporting": f"totalconf{k}newadmhosprep",
    }

con = duckdb.connect()
con.execute(f"create view h as select * from read_csv('{raw / 'hrd.csv'}', header=true, all_varchar=true)")
con.execute(f"create view p as select * from read_csv('{raw / 'pop.csv'}', header=true, all_varchar=true)")

STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC "
          "ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR").split()
FIPS = dict(zip(STATES, "01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 "
                        "34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56 72".split()))
TERR = {"AS": "American Samoa", "GU": "Guam", "MP": "Northern Mariana Islands", "VI": "U.S. Virgin Islands"}
con.execute("create table fips(code varchar, fips varchar)")
con.executemany("insert into fips values (?, ?)", list(FIPS.items()))

# population by jurisdiction and year, 2020-2025, long
con.execute("""
create table pop as
select f.code, p.NAME as name, p.REGION as region_code, y.year,
       cast(case y.year when 2020 then POPESTIMATE2020 when 2021 then POPESTIMATE2021 when 2022 then POPESTIMATE2022
            when 2023 then POPESTIMATE2023 when 2024 then POPESTIMATE2024 else POPESTIMATE2025 end as bigint) as population
from p join fips f on p.STATE = f.fips and p.SUMLEV = '040'
cross join (select unnest(range(2020, 2026)) as year) y
""")
con.execute("insert into pop select 'USA', 'United States', '0', year, sum(population) from pop group by year")

sel = ",\n".join(f'try_cast(nullif("{name_of[f]}", \'\') as integer) as {n}' for n, f in cols.items())
con.execute(f"""
create table weekly as
select cast("Week Ending Date" as date) as week_ending,
       "Geographic aggregation" as jurisdiction,
       case when "Geographic aggregation" = 'USA' then 'nation'
            when "Geographic aggregation" like 'Region %' then 'hhs_region'
            when "Geographic aggregation" in ('AS', 'GU', 'MP', 'VI', 'PR') then 'territory' else 'state' end as geo_level,
       "Respiratory Virus Season" as season,
       {sel}
from h
""")
con.execute("""
create table weekly_out as
select w.*, pop.population
from weekly w left join pop on pop.code = w.jurisdiction and pop.year = least(year(w.week_ending), 2025)
order by jurisdiction, week_ending
""")
con.execute(f"copy weekly_out to '{out / 'weekly.parquet'}' (format parquet)")

REGION = {"1": "Northeast", "2": "Midwest", "3": "South", "4": "West", "0": None}
con.execute("create table j(code varchar, name varchar, geo_level varchar, census_region varchar, population_2025 bigint)")
rows = con.sql("select code, name, region_code, population from pop where year = 2025").fetchall()
con.executemany("insert into j values (?, ?, ?, ?, ?)",
                [(c, n, "nation" if c == "USA" else "territory" if c == "PR" else "state", REGION.get(r) if c != "PR" else None, pop)
                 for c, n, r, pop in rows])
con.executemany("insert into j values (?, ?, 'territory', null, null)", list(TERR.items()))
con.executemany("insert into j values (?, ?, 'hhs_region', null, null)",
                [(f"Region {i}", f"HHS Region {i}") for i in range(1, 11)])
con.execute(f"copy (select * from j order by code) to '{out / 'jurisdictions.parquet'}' (format parquet)")

n_in = con.sql("select count(*) from h").fetchall()[0][0]
n_out = con.sql("select count(*) from weekly_out").fetchall()[0][0]
unmatched = con.sql("select count(distinct jurisdiction) from weekly_out w where jurisdiction not in (select code from j)").fetchall()[0][0]
print(f"weekly: {n_in} rows in, {n_out} out, {len(cols)} measures; jurisdictions without a lookup row: {unmatched}")
print(con.sql("select count(*), sum(flu_admissions), sum(covid_admissions), sum(rsv_admissions) from weekly_out where geo_level='nation'").fetchall())
print(con.sql("select count(*) from j").fetchall())
