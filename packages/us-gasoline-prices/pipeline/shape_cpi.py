"""Shape BLS CPI-U (all items, US city average, not seasonally adjusted) into a monthly table.

Reads  <raw>/cu_allitems.txt (BLS flat file cu.data.1.AllItems)
Writes <out>/cpi.parquet: month (date, first of month), cpi (index, 1982-84=100), series CUUR0000SA0 only.
Annual averages (period M13) are dropped. Months BLS did not publish (value "-", such as October 2025,
when the federal shutdown stopped collection) are left out, never filled in.

Run from the package root:
  uv run --with pandas --with pyarrow python -I pipeline/shape_cpi.py /tmp/raw /tmp/shaped
"""
import sys
from pathlib import Path

import pandas as pd

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
d = pd.read_csv(raw / "cu_allitems.txt", sep="\t", dtype=str)
d.columns = [c.strip() for c in d.columns]
d = d.apply(lambda c: c.str.strip())
d = d[(d.series_id == "CUUR0000SA0") & (d.period != "M13")]
n_in = len(d)
d["cpi"] = pd.to_numeric(d.value, errors="coerce")
missing = d[d.cpi.isna()]
d = d.dropna(subset=["cpi"])
d["month"] = pd.to_datetime(d.year + "-" + d.period.str[1:] + "-01").dt.date
d = d[["month", "cpi"]].sort_values("month")
d.to_parquet(out / "cpi.parquet", index=False)
print(f"months in {n_in}, kept {len(d)}, unpublished {list(missing.year + '-' + missing.period)}, "
      f"{d.month.min()}..{d.month.max()}")
