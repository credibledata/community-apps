"""Shape CDC measles and kindergarten-vaccination files into four tables for measles-2026.

Reads (from the raw directory, written by pipeline/fetch.sh):
  MeaslesCasesYear.json, MeaslesCasesWeekly.json, MeaslesCasesMap.json, kindergarten.json
Writes (to the output directory) as CSV:
  yearly_cases.csv   one row per year 1985-2026: year, cases, is_partial_year
  weekly_cases.csv   one row per rash-onset week since 2022: week_start, week_end, year, cases
  state_cases.csv    one row per jurisdiction and year 2024-2026: jurisdiction, state_code, year, cases
  kindergarten.csv   one row per geography and school year 2009-10 onward, MMR coverage and exemptions

Run from the package root:
  uv run --with pandas python -I pipeline/shape_measles.py /tmp/raw /tmp/shaped
"""
import json
import sys
from pathlib import Path

import pandas as pd

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

CODES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA",
    "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT",
    "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}


def load(name):
    d = json.loads((raw / name).read_text())
    return d, (d["data"] if isinstance(d, dict) else d)


def report(name, rows_in, df):
    print(f"{name}: {rows_in} rows in, {len(df)} rows out")
    df.to_csv(out / f"{name}.csv", index=False)


# Yearly cases: CDC lists each year twice (filters 1985-Present and 2000-Present) plus one row with no year.
meta, rows = load("MeaslesCasesYear.json")
y = pd.DataFrame([r for r in rows if r.get("year") and r["filter"].startswith("1985")])
y = y.assign(year=y.year.astype(int), cases=y.cases.astype(int))[["year", "cases"]].sort_values("year")
assert y.year.is_unique
y["is_partial_year"] = y.year == y.year.max()
report("yearly_cases", len(rows), y)
print("  as of", meta["lastUpdated"])

_, rows = load("MeaslesCasesWeekly.json")
w = pd.DataFrame(rows)
w["cases"] = w.cases.astype(int)
w["year"] = w.week_start.str[:4].astype(int)
report("weekly_cases", len(rows), w[["week_start", "week_end", "year", "cases"]])

# State cases: each row repeats the three years' totals; keep year and cases_calendar_year.
_, rows = load("MeaslesCasesMap.json")
s = pd.DataFrame(rows).rename(columns={"geography": "jurisdiction", "cases_calendar_year": "cases"})
s["year"] = s.year.astype(int)
s["cases"] = s.cases.astype(int)
s["state_code"] = s.jurisdiction.map(CODES).fillna("NYC")
report("state_cases", len(rows), s[["jurisdiction", "state_code", "year", "cases"]])

# Kindergarten coverage and exemptions: long (vaccine, dose) rows to one row per geography and school year.
_, rows = load("kindergarten.json")
k = pd.DataFrame(rows)
k["pct"] = pd.to_numeric(k.coverage_estimate, errors="coerce")  # "NA" -> blank
k["n"] = pd.to_numeric(k.get("number_of_exemptions"), errors="coerce")
k["pop"] = pd.to_numeric(k.population_sample_size, errors="coerce")
k["kind"] = k.vaccine.where(k.vaccine == "MMR", k.dose.str.lower().str.replace(" exemption", "").str.replace("-", "_").str.replace(" ", "_"))
keys = ["geography_type", "geography", "year_season"]
mmr = k[k.kind == "MMR"].set_index(keys)
kg = pd.DataFrame(index=k.set_index(keys).index.unique())
kg["mmr_coverage_pct"] = mmr.pct
kg["kindergarten_population"] = mmr["pop"]
kg["mmr_percent_surveyed"] = pd.to_numeric(mmr.percent_surveyed, errors="coerce")
kg["survey_type"] = mmr.survey_type
for kind in ["any", "medical", "non_medical"]:
    e = k[k.kind == kind].set_index(keys)
    kg[f"{kind}_exemption_pct"] = e.pct
    kg[f"{kind}_exemptions"] = e.n
    if kind == "any":
        kg["exemption_population"] = e["pop"]
kg = kg.reset_index().rename(columns={"year_season": "school_year"})
kg["geography_type"] = kg.geography_type.map({"States": "State", "National": "National"})
kg.loc[kg.geography.str.contains("-"), "geography_type"] = "Sub-state"
kg["state_code"] = kg.geography.map(CODES)
kg["school_year_start"] = kg.school_year.str[:4].astype(int)
for c in ["kindergarten_population", "any_exemptions", "medical_exemptions", "non_medical_exemptions", "exemption_population"]:
    kg[c] = kg[c].astype("Int64")
kg["survey_type"] = kg.survey_type.fillna("").replace("NaN", "")
kg = kg.sort_values(["school_year_start", "geography_type", "geography"])
cols = ["geography", "geography_type", "state_code", "school_year", "school_year_start", "mmr_coverage_pct",
        "kindergarten_population", "mmr_percent_surveyed", "survey_type", "any_exemption_pct", "any_exemptions",
        "medical_exemption_pct", "medical_exemptions", "non_medical_exemption_pct", "non_medical_exemptions",
        "exemption_population"]
report("kindergarten", len(rows), kg[cols])
