"""Shape USGS ComCat events into one row per earthquake in the contiguous US.

Reads  <raw>/comcat/*.csv (from fetch.sh) and the Census state and county boundary zips.
Writes <out>/events.parquet.

Keeps events whose USGS `type` is `earthquake` (drops explosions, quarry blasts, mine collapses and
other non-tectonic events) and whose epicentre falls inside one of the 48 contiguous states or DC,
by point-in-polygon against the Census 2023 1:500,000 cartographic boundaries. Offshore events and
events in Canada or Mexico are dropped. Times are UTC.

Run from the package root:
  uv run --with geopandas --with pyarrow python -I pipeline/shape_events.py /tmp/raw /tmp/shaped
"""
import glob
import os
import sys

import geopandas as gpd
import pandas as pd

raw, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

ev = pd.concat([pd.read_csv(f, dtype={"id": str}) for f in sorted(glob.glob(f"{raw}/comcat/*.csv"))])
n_in = len(ev)
ev = ev.drop_duplicates("id")
ev = ev[ev["type"] == "earthquake"]
n_eq = len(ev)

NOT_CONTIGUOUS = {"02", "15", "60", "66", "69", "72", "78"}
states = gpd.read_file(f"zip://{raw}/cb_2023_us_state_500k.zip")
states = states[~states.STATEFP.isin(NOT_CONTIGUOUS)][["STATEFP", "STUSPS", "NAME", "geometry"]]
states = states.rename(columns={"STATEFP": "state_fips", "STUSPS": "state", "NAME": "state_name"})
counties = gpd.read_file(f"zip://{raw}/cb_2023_us_county_500k.zip")
counties = counties[~counties.STATEFP.isin(NOT_CONTIGUOUS)][["GEOID", "NAMELSAD", "geometry"]]
counties = counties.rename(columns={"GEOID": "county_fips", "NAMELSAD": "county"})

pts = gpd.GeoDataFrame(ev, geometry=gpd.points_from_xy(ev.longitude, ev.latitude), crs="EPSG:4269")
pts = gpd.sjoin(pts, states.to_crs("EPSG:4269"), predicate="within", how="inner").drop(columns="index_right")
pts = gpd.sjoin(pts, counties.to_crs("EPSG:4269"), predicate="within", how="left").drop(columns="index_right")
pts = pts.drop_duplicates("id")

t = pd.to_datetime(pts["time"], utc=True)
df = pd.DataFrame({
    "event_id": pts["id"],
    "event_time": t.dt.tz_localize(None).dt.floor("s"),
    "latitude": pts["latitude"].round(4),
    "longitude": pts["longitude"].round(4),
    "depth_km": pts["depth"].round(2),
    "magnitude": pts["mag"].round(2),
    "mag_type": pts["magType"].str.lower(),
    "state": pts["state"],
    "state_name": pts["state_name"],
    "county_fips": pts["county_fips"],
    "county": pts["county"],
    "place": pts["place"],
    "network": pts["net"],
    "review_status": pts["status"],
}).sort_values("event_time")
df.to_parquet(f"{out}/events.parquet", index=False)
print(f"rows read {n_in}, earthquakes {n_eq}, in contiguous states {len(df)}, "
      f"no county {df.county.isna().sum()}, magnitude sum {df.magnitude.sum():.2f}, "
      f"span {df.event_time.min()} .. {df.event_time.max()}")
