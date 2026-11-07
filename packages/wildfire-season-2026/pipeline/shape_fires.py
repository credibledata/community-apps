"""Shape NIFC WFIGS wildfire incident records into data/fires_*.csv and lookups.

Reads  <raw>/wfigs/page_*.json (from pipeline/fetch.sh).
Writes <data>/fires_<year>[_h1|_h2].csv, lookup_*.csv.

Every wildfire discovered 2015-01-01 or later (WFIGS starts mid-2014, so 2014 is
a partial year; six stray older records are dropped too).
Fires of at least THRESHOLD acres are kept one row per incident. Smaller fires
are summed per discovery date, state and cause into rows whose n_fires counts
them, so fire counts and acres stay exact at that grain.

Run from the package root:
  python3 -I pipeline/shape_fires.py /tmp/raw data
"""
import csv, glob, json, os, sys, datetime, collections

RAW, OUT = sys.argv[1], sys.argv[2]
THRESHOLD = 1.0
FIRST_YEAR = 2015

CAUSE = {'Human': 'H', 'Natural': 'N', 'Undetermined': 'U', 'Unknown': 'U'}
CAUSE_NAMES = [('H', 'Human'), ('N', 'Natural'), ('U', 'Undetermined')]
DETAIL = {
  'Lightning': 'Lightning', 'Natural': 'Other natural', 'Other Natural Cause': 'Other natural', 'Coal Seam': 'Other natural',
  'Debris and open burning': 'Debris and open burning', 'Debris/Open Burning': 'Debris and open burning', 'Debris Burning (Fire Use)': 'Debris and open burning',
  'Equipment': 'Equipment and vehicles', 'Equipment and vehicle use': 'Equipment and vehicles',
  'Incendiary': 'Arson', 'Arson': 'Arson',
  'Power generation/transmission/distribution': 'Power lines and utilities', 'Utilities': 'Power lines and utilities',
  'Railroad operations and maintenance': 'Railroads', 'Railroad': 'Railroads',
  'Camping': 'Campfires and recreation', 'Recreation and ceremony': 'Campfires and recreation',
  'Smoking': 'Smoking',
  'Firearms/Weapons': 'Fireworks and firearms', 'Fireworks': 'Fireworks and firearms', 'Firearms and explosives use': 'Fireworks and firearms',
  'Misuse of fire by a minor': 'Children playing with fire',
  'Other Human Cause': 'Other human', 'Other causes': 'Other human', 'Misc/Other': 'Other human',
  'Undetermined (remarks required)': 'Undetermined', 'Undetermined': 'Undetermined',
  'Cause and Origin Not Identified': 'Undetermined', 'Investigated but Undetermined': 'Undetermined',
}
OWNER = {'OthLoca': 'OthLoc', 'ANC': 'ANCSA', '#': None}
OWNER_NAMES = {'Private': 'Private', 'USFS': 'US Forest Service', 'BIA': 'Bureau of Indian Affairs', 'BLM': 'Bureau of Land Management',
  'State': 'State', 'NPS': 'National Park Service', 'Tribal': 'Tribal', 'USFWS': 'US Fish and Wildlife Service', 'DOD': 'Department of Defense',
  'City': 'City', 'County': 'County', 'ANCSA': 'Alaska Native corporation', 'BOR': 'Bureau of Reclamation', 'OthLoc': 'Other local',
  'DOE': 'Department of Energy', 'OthFed': 'Other federal'}
GACC_NAMES = {'OSCC': 'Southern California', 'ONCC': 'Northern California', 'SACC': 'Southern Area', 'NWCC': 'Northwest',
  'NRCC': 'Northern Rockies', 'SWCC': 'Southwest', 'EACC': 'Eastern Area', 'RMCC': 'Rocky Mountain', 'GBCC': 'Great Basin',
  'AICC': 'Alaska', 'AKCC': 'Alaska', 'EBCC': 'Great Basin', 'WBCC': 'Great Basin', 'Eastern': 'Eastern Area'}
# EBCC/WBCC are the Eastern and Western Great Basin centres, AKCC the older Alaska code.
GACC_MERGE = {'AKCC': 'AICC', 'EBCC': 'GBCC', 'WBCC': 'GBCC', 'Eastern': 'EACC'}
COMPLEXITY = {'Type 1 Incident': 1, 'Type 2 Incident': 2, 'Type 3 Incident': 3, 'Type 4 Incident': 4, 'Type 5 Incident': 5, 'Complex Incident': 0}
BEHAVIOR = {'Minimal': 1, 'Moderate': 2, 'Active': 3, 'Extreme': 4}
FUEL = {'Grass': 1, 'Grass-Shrub': 2, 'Brush': 3, 'Timber': 4, 'Slash': 5}

STATE_NAMES = dict(x.split(':') for x in (
  'AL:Alabama,AK:Alaska,AZ:Arizona,AR:Arkansas,CA:California,CO:Colorado,CT:Connecticut,DE:Delaware,DC:District of Columbia,'
  'FL:Florida,GA:Georgia,HI:Hawaii,ID:Idaho,IL:Illinois,IN:Indiana,IA:Iowa,KS:Kansas,KY:Kentucky,LA:Louisiana,ME:Maine,'
  'MD:Maryland,MA:Massachusetts,MI:Michigan,MN:Minnesota,MS:Mississippi,MO:Missouri,MT:Montana,NE:Nebraska,NV:Nevada,'
  'NH:New Hampshire,NJ:New Jersey,NM:New Mexico,NY:New York,NC:North Carolina,ND:North Dakota,OH:Ohio,OK:Oklahoma,OR:Oregon,'
  'PA:Pennsylvania,RI:Rhode Island,SC:South Carolina,SD:South Dakota,TN:Tennessee,TX:Texas,UT:Utah,VT:Vermont,VA:Virginia,'
  'WA:Washington,WV:West Virginia,WI:Wisconsin,WY:Wyoming,PR:Puerto Rico,GU:Guam,VI:US Virgin Islands,AS:American Samoa,'
  'MP:Northern Mariana Islands,FM:Micronesia,MH:Marshall Islands,PW:Palau').split(','))

def acres(a):
    for k in ('FinalAcres', 'IncidentSize', 'DiscoveryAcres'):
        if a.get(k) is not None:
            return max(float(a[k]), 0.0)
    return 0.0

def day(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc)

def num(v, nd):
    s = f'{v:.{nd}f}'
    return s.rstrip('0').rstrip('.') if '.' in s else s

rows_in = 0
records = collections.defaultdict(list)
small = collections.defaultdict(lambda: [0, 0.0])
counties = {}
detail_ids = {n: i + 1 for i, n in enumerate(sorted(set(DETAIL.values())))}
owner_ids = {c: i + 1 for i, c in enumerate(OWNER_NAMES)}
for path in sorted(glob.glob(os.path.join(RAW, 'wfigs', 'page_*.json'))):
    for ft in json.load(open(path, encoding='utf-8'))['features']:
        rows_in += 1
        a, g = ft['attributes'], ft.get('geometry') or {}
        if not a['FireDiscoveryDateTime']:
            continue
        d = day(a['FireDiscoveryDateTime'])
        if d.year < FIRST_YEAR:
            continue
        st = (a['POOState'] or '').replace('US-', '')
        cause = CAUSE.get(a['FireCause'], '')
        ac = acres(a)
        if ac < THRESHOLD:
            k = (d.strftime('%Y-%m-%d'), st, cause)
            small[k][0] += 1
            small[k][1] += ac
            continue
        fips = (a['POOFips'] or '').strip()
        if fips and a['POOCounty']:
            counties.setdefault(fips, (a['POOCounty'].strip(), st))
        contain = ''
        if a['ContainmentDateTime'] and a['ContainmentDateTime'] >= a['FireDiscoveryDateTime']:
            contain = str(round((a['ContainmentDateTime'] - a['FireDiscoveryDateTime']) / 86400000))
        owner = OWNER.get(a['POOLandownerCategory'], a['POOLandownerCategory'])
        gacc = GACC_MERGE.get(a['GACC'], a['GACC']) or ''
        name = ' '.join((a['IncidentName'] or '').replace('"', "'").split()).title()
        records[d.year].append([
            a['OBJECTID'], name, d.strftime('%Y-%m-%d'), 1, num(ac, 1), cause,
            detail_ids.get(DETAIL.get(a['FireCauseGeneral']), ''), st, fips, gacc, owner_ids.get(owner, ''),
            num(g['y'], 4) if g.get('y') is not None else '', num(g['x'], 4) if g.get('x') is not None else '',
            contain, COMPLEXITY.get(a['IncidentComplexityLevel'], ''), BEHAVIOR.get(a['FireBehaviorGeneral'], ''),
            FUEL.get(a['PredominantFuelGroup'], ''), 1 if a['IsCpxChild'] else 0,
        ])
for (dt, st, cause), (n, ac) in small.items():
    records[int(dt[:4])].append(['', '', dt, n, num(ac, 2), cause, '', st, '', '', '', '', '', '', '', '', '', 0])

HEADER = ['id', 'name', 'discovered', 'n_fires', 'acres', 'cause', 'cause_detail_id', 'state', 'fips', 'gacc', 'owner_id',
          'lat', 'lon', 'days_to_contain', 'complexity', 'behavior', 'fuel_id', 'complex_child']
os.makedirs(OUT, exist_ok=True)
for f in glob.glob(os.path.join(OUT, 'fires_*.csv')):
    os.remove(f)
rows_out = 0
for y, rs in sorted(records.items()):
    rs.sort(key=lambda r: (r[2], r[7], r[5], str(r[0])))
    halves = [('', rs)]
    if len(rs) > 9000:
        halves = [('_h1', [r for r in rs if r[2][5:7] <= '06']), ('_h2', [r for r in rs if r[2][5:7] > '06'])]
    for suffix, part in halves:
        with open(os.path.join(OUT, f'fires_{y}{suffix}.csv'), 'w', newline='', encoding='utf-8') as fh:
            w = csv.writer(fh, lineterminator='\n')
            w.writerow(HEADER)
            w.writerows(part)
        rows_out += len(part)

def lookup(name, header, rows):
    with open(os.path.join(OUT, f'lookup_{name}.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh, lineterminator='\n')
        w.writerow(header)
        w.writerows(rows)

lookup('cause', ['cause', 'cause_name'], CAUSE_NAMES)
lookup('cause_detail', ['cause_detail_id', 'cause_detail'], [(i, n) for n, i in detail_ids.items()])
lookup('owner', ['owner_id', 'owner_code', 'owner_name'], [(i, c, OWNER_NAMES[c]) for c, i in owner_ids.items()])
lookup('gacc', ['gacc', 'gacc_name'], sorted((c, n) for c, n in GACC_NAMES.items() if c not in GACC_MERGE))
lookup('complexity', ['complexity', 'complexity_name'], sorted((v, k.replace(' Incident', ' incident')) for k, v in COMPLEXITY.items()))
lookup('behavior', ['behavior', 'behavior_name'], sorted((v, k) for k, v in BEHAVIOR.items()))
lookup('fuel', ['fuel_id', 'fuel'], sorted((v, k) for k, v in FUEL.items()))
lookup('state', ['state', 'state_name'], sorted((c, STATE_NAMES.get(c, c)) for c in {r[7] for rs in records.values() for r in rs}))
lookup('county', ['fips', 'county', 'county_state'], sorted((f, c, s) for f, (c, s) in counties.items()))
print(f'records read {rows_in}; rows written {rows_out}; incident rows {sum(1 for rs in records.values() for r in rs if r[0] != "")}; '
      f'small-fire rows {len(small)} covering {sum(v[0] for v in small.values())} fires')
