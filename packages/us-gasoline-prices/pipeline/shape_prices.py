"""Shape EIA weekly retail gasoline and diesel prices into one long table.

Reads  <raw>/eia_gnd_weekly.xls and <raw>/eia_EPM0.xls, eia_EPMR.xls, eia_EPMM.xls, eia_EPMP.xls, eia_EPD2D.xls
Writes <out>/prices.parquet: one row per week, fuel series and area:
  week (date, the Monday EIA dates the survey), product (gasoline|diesel),
  grade (All grades|Regular|Midgrade|Premium|Diesel), formulation (All|Conventional|Reformulated|
  Ultra low sulfur|Low sulfur|All diesel), area, area_type (Nation|PADD|Sub-PADD|State|City),
  series_id (EIA's source key), price (dollars per gallon, nominal).
Weeks a series does not report are left out rather than stored blank. Duplicate (series_id, week)
rows across the files are kept once.

Run from the package root:
  uv run --with pandas --with xlrd --with pyarrow python -I pipeline/shape_prices.py /tmp/raw /tmp/shaped
"""
import re
import sys
from pathlib import Path

import pandas as pd

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

FILES = ["eia_gnd_weekly.xls", "eia_EPM0.xls", "eia_EPMR.xls", "eia_EPMM.xls", "eia_EPMP.xls", "eia_EPD2D.xls"]
PADD = {"East Coast": "PADD", "Midwest": "PADD", "Gulf Coast": "PADD", "Rocky Mountain": "PADD", "West Coast": "PADD"}
CITIES = {"Boston, MA": "Boston", "Chicago": "Chicago", "Cleveland, OH": "Cleveland", "Denver": "Denver",
          "Houston": "Houston", "Los Angeles": "Los Angeles", "Miami, FL": "Miami", "New York City": "New York City",
          "San Francisco": "San Francisco", "Seattle, WA": "Seattle"}
STATES = {"California", "Colorado", "Florida", "Massachusetts", "Minnesota", "New York", "Ohio", "Texas", "Washington"}
SUBPADD = {"New England (PADD 1A)": "New England", "Central Atlantic (PADD 1B)": "Central Atlantic",
           "Lower Atlantic (PADD 1C)": "Lower Atlantic",
           "West Coast (PADD 5) Except California": "West Coast except California"}


def parse(name):
    """Split an EIA series name into product, grade, formulation, area, area_type."""
    s = re.sub(r"\s+", " ", name.replace("Weekly ", "").replace("(Dollars per Gallon)", "")).strip()
    m = re.match(r"(.*?) (All Grades|Regular|Midgrade|Premium) (All Formulations|Conventional|Reformulated) "
                 r"Retail Gasoline Prices$", s)
    if m:
        area, grade, form = m.groups()
        product = "gasoline"
        grade = "All grades" if grade == "All Grades" else grade
        form = "All" if form == "All Formulations" else form
    else:
        m = re.match(r"(.*?) No 2 Diesel(?: (Ultra Low Sulfur|Low Sulfur))?.*Retail Prices$", s)
        if not m:
            raise ValueError(f"unparsed series name: {name!r}")
        area, sulfur = m.groups()
        product, grade = "diesel", "Diesel"
        form = {"Ultra Low Sulfur": "Ultra low sulfur", "Low Sulfur": "Low sulfur", None: "All diesel"}[sulfur]
    area = area.strip()
    if area == "U.S.":
        return product, grade, form, "United States", "Nation"
    if area in PADD:
        return product, grade, form, area, "PADD"
    if area in SUBPADD:
        return product, grade, form, SUBPADD[area], "Sub-PADD"
    if area in STATES:
        return product, grade, form, area, "State"
    if area in CITIES:
        return product, grade, form, CITIES[area], "City"
    raise ValueError(f"unknown area: {area!r} in {name!r}")


rows, seen_in = [], 0
for f in FILES:
    x = pd.ExcelFile(raw / f, engine="xlrd")
    for sheet in x.sheet_names:
        if not sheet.startswith("Data"):
            continue
        d = pd.read_excel(x, sheet, header=None)
        keys, names = d.iloc[1, 1:], d.iloc[2, 1:]
        body = d.iloc[3:]
        for col, key, name in zip(d.columns[1:], keys, names):
            product, grade, form, area, area_type = parse(str(name))
            v = pd.DataFrame({"week": pd.to_datetime(body[0]).dt.date, "price": pd.to_numeric(body[col], errors="coerce")})
            seen_in += len(v)
            v = v.dropna(subset=["price"])
            v = v.assign(product=product, grade=grade, formulation=form, area=area, area_type=area_type,
                         series_id=str(key).strip())
            rows.append(v)

df = pd.concat(rows, ignore_index=True)
before = len(df)
df = df.drop_duplicates(subset=["series_id", "week"]).sort_values(["series_id", "week"])
df["price"] = df["price"].round(3)
df = df[["week", "product", "grade", "formulation", "area", "area_type", "series_id", "price"]]
df.to_parquet(out / "prices.parquet", index=False)
print(f"cells read {seen_in}, priced rows {before}, after dedupe {len(df)}, series {df.series_id.nunique()}, "
      f"weeks {df.week.min()}..{df.week.max()}")
print(df.groupby(["area_type"]).series_id.nunique().to_string())
