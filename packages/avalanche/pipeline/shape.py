"""Shape the raw downloads from pipeline/fetch.sh into the package's extra tables.

Reads  <raw>/caic/accident_reports_*.json, incident_reports_*.json
       <raw>/snotel/stations.json, <raw>/snotel/*_CO_SNTL.json
       public/zones.geojson (CAIC forecast-zone boundaries, already in the package)
Writes <data>/accidents.parquet            one row per Colorado accident or incident report
       <data>/accident_observations.parquet  which avalanche observations each report covers
       <data>/snotel_stations.parquet      Colorado SNOTEL stations and the CAIC zone each sits in
       <data>/snotel_zone_daily.parquet    station readings averaged per zone and day, Oct 2010 on
Parquet, not CSV: DuckDB re-parses a CSV on every query, which made the snowpack queries ~5x slower.

Accidents: CAIC keeps investigated accidents (accident_reports) and lighter-weight incident records
(incident_reports); a report can appear in both under the same report_id, and the accident version is
kept. Only counts, dates, places, activity and the forecast danger rating are kept: no names, and no
narrative text (the CAIC report the row links to has it).

SNOTEL: a zone's daily value is the mean over its stations reporting that day. New SWE is the day's
positive change in snow water equivalent at a station, averaged over the zone's stations.

Run from the package root (DuckDB writes the Parquet files):
  uv run --with duckdb==1.1.3 python -I pipeline/shape.py <raw> data
"""
import collections, csv, datetime, glob, json, os, sys, tempfile

import duckdb

RAW, OUT = sys.argv[1], sys.argv[2]
FIRST_DAY = '2010-10-01'


def load_pages(kind):
  rows = []
  for f in sorted(glob.glob(os.path.join(RAW, 'caic', f'{kind}_*.json'))):
    rows.extend(json.load(open(f)))
  return rows


def denver_date(iso):
  # observed_at is UTC; CAIC's day is Mountain time. DST is ignored: a 6-7 h shift only moves reports
  # timed between 17:00 and 18:00 local, and CAIC enters most accident times as 19:00 UTC (noon).
  t = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))
  return (t - datetime.timedelta(hours=7)).date()


def water_year(d):
  return d.year + 1 if d.month >= 10 else d.year


DANGER = {'Low': 'Low', 'Moderate': 'Moderate', 'Considerable': 'Considerable', 'High': 'High',
          'Extreme': 'Extreme', 'No Rating': 'No rating'}


def shape_accidents():
  reports = {}
  for kind in ('incident_reports', 'accident_reports'):  # accident version overwrites the incident one
    for r in load_pages(kind):
      if r.get('state') != 'CO' or not r.get('observed_at'):
        continue
      reports[r.get('report_id') or r['id']] = (kind, r)

  acc, links = [], []
  for rid, (kind, r) in reports.items():
    d = denver_date(r['observed_at'])
    groups = r.get('affected_groups') or []
    caught = sum(g.get('normalized_degree_caught') in ('caught', 'buried') for g in groups)
    buried = sum(g.get('normalized_degree_caught') == 'buried' for g in groups)
    injured = sum(g.get('normalized_degree_hurt') == 'injured' for g in groups)
    killed = sum(g.get('normalized_degree_hurt') == 'killed' for g in groups)
    s = r.get('involvement_summary') or {}
    # Groups are missing on some older records; fall back to the summary counts there.
    if not groups:
      buried, killed, injured = s.get('buried', 0), s.get('killed', 0), s.get('injured', 0)
      caught = s.get('caught', 0) + buried
    caught = max(caught, buried, killed, injured)  # a person killed or buried was caught, even if unrecorded
    acts = collections.Counter(g.get('normalized_travel_activity') for g in groups if g.get('normalized_travel_activity'))
    acts.update({} if acts else (s.get('normalized_travel_activity') or {}))
    detail = r.get('public_report_detail') or {}
    zone = (r.get('backcountry_zone') or {}).get('title')
    lat, lon = r.get('latitude'), r.get('longitude')
    acc.append({
      'report_id': rid,
      'record_type': 'Accident' if kind == 'accident_reports' else 'Incident',
      'observed_date': d.isoformat(),
      'water_year': water_year(d),
      'zone': zone or '',
      'setting': {'bc': 'Backcountry', 'op': 'Operational', 'hw': 'Highway'}.get(r.get('hw_op_bc'), ''),
      'location': (detail.get('location') or r.get('landmark') or r.get('area') or '').strip(),
      'activity': acts.most_common(1)[0][0] if acts else '',
      'involved': s.get('involved', len(groups)),
      'caught': caught,
      'buried': buried,
      'injured': injured,
      'killed': killed,
      'danger_rating': DANGER.get(detail.get('danger_rating') or '', ''),
      'latitude': lat if lat is not None else '',
      'longitude': lon if lon is not None else '',
      'report_url': f'https://avalanche.state.co.us/report/{rid}',
    })
    for o in r.get('avalanche_observations') or []:
      links.append({'report_id': rid, 'observation_id': o['id']})

  acc.sort(key=lambda a: (a['observed_date'], a['report_id']))
  write(os.path.join(OUT, 'accidents.parquet'), acc)
  write(os.path.join(OUT, 'accident_observations.parquet'), sorted(links, key=lambda l: (l['report_id'], l['observation_id'])))
  return len(acc)


# ---- SNOTEL ---------------------------------------------------------------------------------------
def point_in_ring(x, y, ring):
  inside = False
  for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
    if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
      inside = not inside
  return inside


def zone_of(lon, lat, zones):
  for name, polys in zones:
    for poly in polys:
      if point_in_ring(lon, lat, poly[0]) and not any(point_in_ring(lon, lat, h) for h in poly[1:]):
        return name
  return ''


def shape_snotel():
  g = json.load(open('public/zones.geojson'))
  zones = [(f['properties']['zone'], f['geometry']['coordinates']) for f in g['features']]
  stations = []
  for s in json.load(open(os.path.join(RAW, 'snotel', 'stations.json'))):
    stations.append({
      'station': s['stationTriplet'], 'name': s['name'], 'elevation_ft': round(s['elevation']),
      'latitude': s['latitude'], 'longitude': s['longitude'],
      'zone': zone_of(s['longitude'], s['latitude'], zones),
      'first_date': s['beginDate'][:10], 'last_date': s['endDate'][:10],
    })
  by_zone = collections.defaultdict(lambda: collections.defaultdict(list))  # (zone, date) -> element -> values
  have = set()
  for st in stations:
    f = os.path.join(RAW, 'snotel', st['station'].replace(':', '_') + '.json')
    if not st['zone'] or not os.path.exists(f):
      continue
    series = {}
    for block in json.load(open(f)):
      for el in block.get('data', []):
        series[el['stationElement']['elementCode']] = {v['date']: v['value'] for v in el.get('values', []) if v.get('value') is not None}
    if not series:
      continue
    have.add(st['station'])
    swe = series.get('WTEQ', {})
    for day in sorted(set().union(*[set(v) for v in series.values()])):
      if day < FIRST_DAY:
        continue
      cell = by_zone[(st['zone'], day)]
      for code, key in (('WTEQ', 'swe'), ('SNWD', 'depth'), ('TMAX', 'tmax'), ('TMIN', 'tmin')):
        v = series.get(code, {}).get(day)
        if v is not None:
          cell[key].append(v)
      prev = (datetime.date.fromisoformat(day) - datetime.timedelta(days=1)).isoformat()
      if day in swe and prev in swe:
        cell['new_swe'].append(max(0.0, swe[day] - swe[prev]))
      if day in swe:
        cell['n'].append(1)
  for st in stations:
    st['has_data'] = st['station'] in have
  write(os.path.join(OUT, 'snotel_stations.parquet'), sorted(stations, key=lambda s: (s['zone'], s['name'])))

  mean = lambda xs: round(sum(xs) / len(xs), 2) if xs else ''
  rows = []
  for (zone, day), cell in sorted(by_zone.items()):
    if not cell.get('n'):
      continue
    rows.append({'zone': zone, 'date': day, 'stations': len(cell['n']), 'swe_in': mean(cell['swe']),
                 'depth_in': mean(cell['depth']), 'new_swe_in': mean(cell['new_swe']),
                 'tmax_f': mean(cell['tmax']), 'tmin_f': mean(cell['tmin'])})
  # Storm loading: new SWE over the day and the two before it, and the day's warming against the
  # previous day's high. Gaps (a day with no zone reading) leave the window blank rather than short.
  by_key = {(r['zone'], r['date']): r for r in rows}
  for r in rows:
    d = datetime.date.fromisoformat(r['date'])
    window = [by_key.get((r['zone'], (d - datetime.timedelta(days=i)).isoformat())) for i in range(3)]
    vals = [w['new_swe_in'] for w in window if w and w['new_swe_in'] != '']
    r['new_swe_3d_in'] = round(sum(vals), 2) if len(vals) == 3 else ''
    prev = window[1]
    r['tmax_change_f'] = round(r['tmax_f'] - prev['tmax_f'], 2) if prev and r['tmax_f'] != '' and prev['tmax_f'] != '' else ''
  write(os.path.join(OUT, 'snotel_zone_daily.parquet'), rows)
  return len(stations), len(have), len(rows)


# Id columns stay text: DuckDB would otherwise sniff them as UUID, a type Malloy cannot compare.
TEXT = {'report_id', 'observation_id', 'station', 'report_url'}


def write(path, rows):
  """Rows -> Parquet, through a CSV that DuckDB types (dates, numbers) as it reads."""
  with tempfile.NamedTemporaryFile('w', suffix='.csv', newline='', delete=False) as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
  types = {c: 'VARCHAR' for c in rows[0] if c in TEXT}
  rel = duckdb.read_csv(fh.name, header=True, dtype=types or None)
  rel.write_parquet(path, compression='zstd')
  os.unlink(fh.name)


if __name__ == '__main__':
  print('accidents', shape_accidents())
  print('snotel stations, with data, zone-days', shape_snotel())
