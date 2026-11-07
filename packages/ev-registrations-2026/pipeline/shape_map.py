"""Cut New York's counties out of us-atlas and scale them to fill the chart module's 975 x 610 map box.

Reads  <raw>/counties-albers-10m.json (us-atlas@3.0.1, sha256 a674dfa3..., fetched by pipeline/fetch.sh)
Writes <out>/ny-counties.json: TopoJSON with one object, `counties`, 62 New York counties (FIPS 36xxx), each
       keeping its `id` (5-digit FIPS) and `properties.name`. Coordinates are already Albers-projected; they are
       decoded, scaled and centred to fill the box, rounded to 0.1 px, and written without shared arcs.
Run from the package root:
  python3 -I pipeline/shape_map.py /tmp/raw public/vendor/maps
"""
import json
import sys

raw, out = sys.argv[1], sys.argv[2]
topo = json.load(open(f"{raw}/counties-albers-10m.json"))
sx, sy = topo["transform"]["scale"]
tx, ty = topo["transform"]["translate"]


def arc(i):
    a = topo["arcs"][i if i >= 0 else ~i]
    pts, x, y = [], 0, 0
    for dx, dy in a:
        x += dx
        y += dy
        pts.append([x * sx + tx, y * sy + ty])
    return pts if i >= 0 else pts[::-1]


def ring(idx):
    pts = []
    for i in idx:
        p = arc(i)
        pts.extend(p if not pts else p[1:])
    return pts


geoms = [g for g in topo["objects"]["counties"]["geometries"] if str(g["id"]).startswith("36")]
shapes = []
for g in geoms:
    polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
    shapes.append((g, [[ring(r) for r in poly] for poly in polys]))

xs = [p[0] for _, ps in shapes for poly in ps for r in poly for p in r]
ys = [p[1] for _, ps in shapes for poly in ps for r in poly for p in r]
W, H, PAD = 975, 610, 12
k = min((W - 2 * PAD) / (max(xs) - min(xs)), (H - 2 * PAD) / (max(ys) - min(ys)))
ox = (W - k * (max(xs) - min(xs))) / 2 - k * min(xs)
oy = (H - k * (max(ys) - min(ys))) / 2 - k * min(ys)

arcs, out_geoms = [], []
for g, polys in shapes:
    arc_polys = []
    for poly in polys:
        rings = []
        for r in poly:
            arcs.append([[round(p[0] * k + ox, 1), round(p[1] * k + oy, 1)] for p in r])
            rings.append([len(arcs) - 1])
        arc_polys.append(rings)
    out_geoms.append({"type": "MultiPolygon", "id": g["id"], "properties": g.get("properties", {}), "arcs": arc_polys})

result = {"type": "Topology", "bbox": [0, 0, W, H], "objects": {"counties": {"type": "GeometryCollection", "geometries": out_geoms}}, "arcs": arcs}
with open(f"{out}/ny-counties.json", "w") as f:
    json.dump(result, f, separators=(",", ":"))
print(len(out_geoms), "counties;", sorted(g["properties"].get("name") for g in out_geoms))
