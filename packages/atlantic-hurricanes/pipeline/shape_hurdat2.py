"""Shape NOAA's Atlantic HURDAT2 best track into two Parquet tables.

Reads  <raw>/hurdat2.txt and <raw>/ne/ne_10m_admin_0_countries.zip, ne_50m_admin_1_states_provinces.zip
Writes <out>/track_points.parquet  one row per best-track entry (six-hourly fixes plus
                                    special entries such as landfalls), 1851-2025
       <out>/storms.parquet        one row per storm, summarising its track points

Run from the package root:
  uv run --with pandas --with pyarrow --with shapely --with pyshp python -I pipeline/shape_hurdat2.py /tmp/raw /tmp/shaped

What it does
- Parses the header line of each storm (basin+number+year id, name) and its entries.
- Coordinates become signed decimal degrees (S and W negative). -999 sentinels become null.
  The 2004+ wind-radii columns are dropped (not used by the app).
- category: Saffir-Simpson category from max sustained wind for status HU only
  (1: 64-82 kt, 2: 83-95, 3: 96-112, 4: 113-136, 5: >=137). Null for other statuses.
- landfall_country / landfall_admin1: for record identifier L only, the Natural Earth
  country and state/province whose polygon holds the point, else the nearest within
  0.5 degrees (landfall points sit on the coastline, which a polygon may miss).
- Storm table: peak wind, minimum pressure, peak category, whether it reached
  tropical-storm / hurricane / major-hurricane strength while tropical or subtropical
  (status TS, HU, SS), Accumulated Cyclone Energy (sum of wind^2/10^4 over 00/06/12/18 UTC
  fixes with status TS, SS or HU and wind >= 35 kt, the NHC definition), landfall counts,
  and the strongest landfall wind.
"""
import io, sys, zipfile
from pathlib import Path
import pandas as pd
import shapefile
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

def num(s):
    s = s.strip()
    return None if s in ("", "-999", "-99") else int(s)

def coord(s):
    s = s.strip()
    v = float(s[:-1])
    return -v if s[-1] in "SW" else v

def category(status, wind):
    if status != "HU" or wind is None:
        return None
    return 5 if wind >= 137 else 4 if wind >= 113 else 3 if wind >= 96 else 2 if wind >= 83 else 1

rows, storms = [], []
lines = (raw / "hurdat2.txt").read_text().splitlines()
i = 0
while i < len(lines):
    h = [x.strip() for x in lines[i].split(",")]
    sid, name, n = h[0], h[1], int(h[2])
    for ln in lines[i + 1:i + 1 + n]:
        f = [x.strip() for x in ln.split(",")]
        wind, pres = num(f[6]), num(f[7])
        d, t = f[0], f[1].zfill(4)
        rows.append(dict(
            storm_id=sid, storm_name=name, season=int(sid[4:8]),
            observed_at=pd.Timestamp(f"{d[:4]}-{d[4:6]}-{d[6:]} {t[:2]}:{t[2:]}"),
            record_id=f[2] or None, status=f[3],
            lat=coord(f[4]), lon=coord(f[5]), wind_kt=wind, pressure_mb=pres,
            category=category(f[3], wind)))
    i += 1 + n
pts = pd.DataFrame(rows)
print("track points:", len(pts), "storms:", pts.storm_id.nunique())

def load(zipname, fields):
    z = zipfile.ZipFile(raw / "ne" / zipname)
    stem = zipname[:-4]
    r = shapefile.Reader(shp=io.BytesIO(z.read(stem + ".shp")), dbf=io.BytesIO(z.read(stem + ".dbf")),
                         shx=io.BytesIO(z.read(stem + ".shx")), encoding="utf-8")
    names = [fl[0] for fl in r.fields[1:]]
    geoms, attrs = [], []
    for sr in r.iterShapeRecords():
        rec = dict(zip(names, sr.record))
        geoms.append(shape(sr.shape.__geo_interface__)); attrs.append(tuple(rec[k] for k in fields))
    return geoms, attrs

cg, ca = load("ne_10m_admin_0_countries.zip", ["ADMIN"])
ag, aa = load("ne_50m_admin_1_states_provinces.zip", ["admin", "name"])
ct, at = STRtree(cg), STRtree(ag)

def locate(tree, geoms, attrs, p):
    hit = [j for j in tree.query(p) if geoms[j].contains(p)]
    if hit:
        return attrs[hit[0]]
    j = tree.nearest(p)
    return attrs[j] if geoms[j].distance(p) <= 0.5 else None  # degrees

L = pts.record_id == "L"
pts["landfall_country"] = None
pts["landfall_admin1"] = None
for idx in pts.index[L]:
    p = Point(pts.at[idx, "lon"], pts.at[idx, "lat"])
    c = locate(ct, cg, ca, p)
    a = locate(at, ag, aa, p)
    pts.at[idx, "landfall_country"] = c[0] if c else None
    if a and (c is None or a[0] == c[0]):
        pts.at[idx, "landfall_admin1"] = a[1]
        if c is None:
            pts.at[idx, "landfall_country"] = a[0]
print("landfalls:", int(L.sum()), "without a country:", int(pts.loc[L, "landfall_country"].isna().sum()))
pts["landfall_country"] = pts["landfall_country"].replace({"United States of America": "United States"})

trop = pts.status.isin(["TS", "HU", "SS"])
syn = pts.observed_at.dt.strftime("%H%M").isin(["0000", "0600", "1200", "1800"])
ace_pts = pts[trop & syn & (pts.wind_kt >= 35)]
ace = (ace_pts.wind_kt.astype(float) ** 2 / 1e4).groupby(ace_pts.storm_id).sum()
g = pts.groupby("storm_id", sort=False)
tw = pts[trop].groupby("storm_id").wind_kt.max()
lf = pts[L]
st = pd.DataFrame(dict(
    storm_name=g.storm_name.first(), season=g.season.first(),
    started_at=g.observed_at.min(), ended_at=g.observed_at.max(),
    track_points=g.size(),
    peak_wind_kt=g.wind_kt.max(), min_pressure_mb=g.pressure_mb.min(),
    peak_category=g.category.max(),
    peak_tropical_wind_kt=tw,
    ace=ace, landfalls=lf.groupby("storm_id").size(),
    us_landfalls=lf[lf.landfall_country == "United States"].groupby("storm_id").size(),
    max_landfall_wind_kt=lf.groupby("storm_id").wind_kt.max(),
    first_lat=g.lat.first(), first_lon=g.lon.first(),
)).reset_index()
st["ace"] = st.ace.fillna(0).round(4)
for c in ["landfalls", "us_landfalls"]:
    st[c] = st[c].fillna(0).astype(int)
for c in ["peak_wind_kt", "min_pressure_mb", "peak_category", "peak_tropical_wind_kt", "max_landfall_wind_kt"]:
    st[c] = st[c].astype("Int64")
for c in ["wind_kt", "pressure_mb", "category"]:
    pts[c] = pts[c].astype("Int64")
pts = pts.drop(columns=["storm_name"])
pts.to_parquet(out / "track_points.parquet", index=False)
st.to_parquet(out / "storms.parquet", index=False)
print("wrote", len(pts), "points and", len(st), "storms; ace total", round(st.ace.sum(), 2))
