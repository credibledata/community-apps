"""Shape EIA's generation_monthly.xlsx into one row per month x state x producer type x energy source.

Reads  <raw>/generation_monthly.xlsx  (pipeline/fetch.sh)
Writes <out>/generation.parquet

Kept: the 50 states and DC; the five detailed producer types; the 13 detailed energy sources.
Dropped, because each is a sum of rows kept: STATE 'US-TOTAL', TYPE OF PRODUCER 'Total Electric Power
Industry', ENERGY SOURCE 'Total'. The script checks that the kept rows add up to EIA's own US totals.
Columns: month (date, first of month), year, state, producer (short code), source (short code), mwh.

Run: uv run --with pandas --with openpyxl --with pyarrow python -I pipeline/shape_generation.py /tmp/raw /tmp/shaped
"""
import sys, os
import pandas as pd

raw, out = sys.argv[1], sys.argv[2]
x = pd.ExcelFile(os.path.join(raw, "generation_monthly.xlsx"))
frames = []
for s in x.sheet_names:
    head = pd.read_excel(x, s, header=None, nrows=8)
    rows = [i for i in range(len(head)) if str(head.iloc[i, 0]).strip().upper() == "YEAR"]
    if not rows:
        continue
    df = pd.read_excel(x, s, header=rows[0])
    df.columns = [" ".join(str(c).split()) for c in df.columns]
    df = df.rename(columns={"YEAR": "year", "MONTH": "mon", "STATE": "state", "TYPE OF PRODUCER": "producer",
                            "ENERGY SOURCE": "source", "GENERATION (Megawatthours)": "mwh"})
    df["final"] = "Prelim" not in s
    frames.append(df[["year", "mon", "state", "producer", "source", "mwh", "final"]])
a = pd.concat(frames, ignore_index=True)
n_in = len(a)
a = a.dropna(subset=["year", "mon", "state"])
a["state"] = a["state"].str.strip().str.upper()
a["mwh"] = pd.to_numeric(a["mwh"], errors="coerce").fillna(0.0)

PRODUCERS = {
    "Electric Generators, Electric Utilities": "utility",
    "Electric Generators, Independent Power Producers": "ipp",
    "Combined Heat and Power, Electric Power": "chp_electric",
    "Combined Heat and Power, Commercial Power": "chp_commercial",
    "Combined Heat and Power, Industrial Power": "chp_industrial",
}
SOURCES = {
    "Coal": "coal", "Natural Gas": "gas", "Nuclear": "nuclear", "Petroleum": "petroleum",
    "Hydroelectric Conventional": "hydro", "Wind": "wind", "Solar Thermal and Photovoltaic": "solar",
    "Geothermal": "geothermal", "Wood and Wood Derived Fuels": "wood", "Other Biomass": "other_biomass",
    "Other Gases": "other_gases", "Pumped Storage": "pumped_storage", "Other": "other",
}
us = a[(a.state == "US-TOTAL") & (a.producer == "Total Electric Power Industry") & (a.source == "Total")]
k = a[(a.state != "US-TOTAL") & a.producer.isin(PRODUCERS) & a.source.isin(SOURCES)].copy()
k["producer"] = k.producer.map(PRODUCERS)
k["source"] = k.source.map(SOURCES)
k["year"] = k.year.astype(int)
k["month"] = pd.to_datetime(dict(year=k.year, month=k.mon.astype(int), day=1)).dt.date
k = k[["month", "year", "state", "producer", "source", "mwh", "final"]].sort_values(["month", "state", "producer", "source"])
assert not k.duplicated(["month", "state", "producer", "source"]).any()

# check against EIA's own US totals, month by month
chk = k.groupby("month").mwh.sum()
ust = us.assign(month=pd.to_datetime(dict(year=us.year.astype(int), month=us.mon.astype(int), day=1)).dt.date).groupby("month").mwh.sum()
rel = ((chk - ust).abs() / ust).max()
print(f"rows in {n_in:,}, kept {len(k):,}; states {k.state.nunique()}; months {k.month.min()}..{k.month.max()}")
print(f"max monthly deviation from EIA US total: {rel:.6%}")
os.makedirs(out, exist_ok=True)
k.to_parquet(os.path.join(out, "generation.parquet"), index=False)
print("total TWh", round(k.mwh.sum() / 1e6, 1))
