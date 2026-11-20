"""Shape Reclamation's daily reservoir series into readings.csv, reservoirs.csv and thresholds.csv for managed tables.

Reads:  <raw>/usbr/<site>/<type>.csv as written by pipeline/fetch.sh (columns datetime,<value>).
Writes: <out>/readings.csv with columns
          date, site_id, elevation_ft, storage_af, inflow_cfs, release_cfs, evaporation_af
        one row per reservoir per day on which any series has a value; blanks where a series has none.
        <out>/reservoirs.csv, one row per reservoir; <out>/thresholds.csv, cited operating thresholds.
Values: elevation rounded to 0.01 ft; storage, inflow, release and evaporation to whole units.
        Readings dated after the fetch date are dropped (Reclamation sometimes posts a scheduled release for today).
Run:    python3 -I pipeline/shape_readings.py /tmp/raw /tmp/shaped   (standard library only)
Load:   each file into the environment's `community` database as colorado_river_reservoirs__<file name>.
"""
import csv, os, sys, glob
from collections import defaultdict

RESERVOIRS = [
    # site_id, name, short, basin, river, dam, state, lat, lon
    (916, "Fontenelle Reservoir", "Fontenelle", "Upper", "Green River", "Fontenelle Dam", "WY", 42.026, -110.068),
    (917, "Flaming Gorge Reservoir", "Flaming Gorge", "Upper", "Green River", "Flaming Gorge Dam", "UT", 40.915, -109.422),
    (912, "Taylor Park Reservoir", "Taylor Park", "Upper", "Taylor River", "Taylor Park Dam", "CO", 38.818, -106.606),
    (913, "Blue Mesa Reservoir", "Blue Mesa", "Upper", "Gunnison River", "Blue Mesa Dam", "CO", 38.453, -107.337),
    (914, "Morrow Point Reservoir", "Morrow Point", "Upper", "Gunnison River", "Morrow Point Dam", "CO", 38.452, -107.538),
    (915, "Crystal Reservoir", "Crystal", "Upper", "Gunnison River", "Crystal Dam", "CO", 38.510, -107.624),
    (920, "Navajo Reservoir", "Navajo", "Upper", "San Juan River", "Navajo Dam", "NM", 36.801, -107.612),
    (919, "Lake Powell", "Powell", "Upper", "Colorado River", "Glen Canyon Dam", "AZ-UT", 36.936, -111.484),
    (921, "Lake Mead", "Mead", "Lower", "Colorado River", "Hoover Dam", "AZ-NV", 36.016, -114.737),
    (922, "Lake Mohave", "Mohave", "Lower", "Colorado River", "Davis Dam", "AZ-NV", 35.198, -114.569),
    (923, "Lake Havasu", "Havasu", "Lower", "Colorado River", "Parker Dam", "AZ-CA", 34.296, -114.138),
]
TYPES = {49: ("elevation_ft", 2), 17: ("storage_af", 0), 29: ("inflow_cfs", 0), 42: ("release_cfs", 0), 25: ("evaporation_af", 0)}
# Operating thresholds from the 2007 Interim Guidelines Record of Decision (Reclamation, Dec 2007),
# https://www.usbr.gov/lc/region/programs/strategies/RecordofDecision.pdf
# Lake Mead: Section 2.D.1 (shortage apportionments by Jan 1 elevation). Lake Powell: the Section 6 tier table.
THRESHOLDS = [
    # site_id, elevation_ft, label, meaning, rod_section
    (921, 1075, "Shortage tier 1", "At or below 1,075 ft on Jan 1, Lower Basin apportionment cut to 7.167 maf", "ROD Sec. 2.D.1.a"),
    (921, 1050, "Shortage tier 2", "Below 1,050 ft on Jan 1, apportionment cut to 7.083 maf", "ROD Sec. 2.D.1.b"),
    (921, 1025, "Shortage tier 3", "Below 1,025 ft on Jan 1, apportionment cut to 7.0 maf and consultation begins", "ROD Sec. 2.D.1.c"),
    (919, 3700, "Equalization tier", "Above about 3,636-3,666 ft by year (3,700 ft shown), Powell equalizes with Mead", "ROD Sec. 6 table"),
    (919, 3575, "Mid-Elevation Release tier", "Below 3,575 ft, Powell releases 7.48 maf (8.23 if Mead below 1,025 ft)", "ROD Sec. 6.C"),
    (919, 3525, "Lower Elevation Balancing tier", "Below 3,525 ft, releases balance Powell and Mead, 7.0 to 9.5 maf", "ROD Sec. 6.D"),
    (919, 3370, "Zero active storage", "3,370 ft, where the ROD's tier table puts Powell's active storage at zero", "ROD Sec. 6 table"),
]
COLS = ["date", "site_id", "elevation_ft", "storage_af", "inflow_cfs", "release_cfs", "evaporation_af"]
LAST_DATE = os.environ.get("LAST_DATE", "2026-11-16")


def fmt(v, nd):
    if v in ("", "nan", "NaN", None):
        return ""
    x = round(float(v), nd)
    return f"{x:.{nd}f}" if nd else str(int(x))


def main(raw, out):
    os.makedirs(out, exist_ok=True)
    total_in = total_out = 0
    with open(os.path.join(out, "readings.csv"), "w", newline="") as rf:
        w = csv.writer(rf, lineterminator="\n")
        w.writerow(COLS)
        for r in RESERVOIRS:
            sid = r[0]
            rows = defaultdict(dict)
            for t, (col, nd) in TYPES.items():
                p = os.path.join(raw, "usbr", str(sid), f"{t}.csv")
                if not os.path.exists(p):
                    continue
                with open(p, newline="") as fh:
                    rd = csv.reader(fh)
                    next(rd)
                    for d, v in rd:
                        total_in += 1
                        if d > LAST_DATE:
                            continue
                        s = fmt(v, nd)
                        if s != "":
                            rows[d][col] = s
            for d in sorted(rows):
                w.writerow([d, str(sid)] + [rows[d].get(c, "") for c in COLS[2:]])
                total_out += 1
    with open(os.path.join(out, "reservoirs.csv"), "w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["site_id", "name", "short_name", "basin", "river", "dam", "state", "lat", "lon"])
        w.writerows(RESERVOIRS)
    with open(os.path.join(out, "thresholds.csv"), "w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["site_id", "elevation_ft", "label", "meaning", "rod_section"])
        w.writerows(THRESHOLDS)
    print(f"values read {total_in}, reservoir-days written {total_out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/raw", sys.argv[2] if len(sys.argv) > 2 else "/tmp/shaped")
