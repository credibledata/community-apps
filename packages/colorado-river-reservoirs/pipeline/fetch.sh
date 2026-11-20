#!/usr/bin/env bash
# Download the Bureau of Reclamation daily reservoir series used by this app.
# Usage: pipeline/fetch.sh [raw_dir]   (default /tmp/raw). Never writes into the package.
set -euo pipefail
RAW="${1:-/tmp/raw}"
BASE="https://www.usbr.gov/uc/water/hydrodata/reservoir_data"
# site id -> Reclamation HydroData site (see pipeline/shape_readings.py for names)
SITES="912 913 914 915 916 917 919 920 921 922 923"
# datatype ids: 49 pool elevation (ft), 17 storage (af), 29 inflow (cfs), 42 total release (cfs), 25 evaporation (af)
TYPES="49 17 29 42 25"
for s in $SITES; do
  mkdir -p "$RAW/usbr/$s"
  for t in $TYPES; do
    if curl -sSL --fail --max-time 120 -o "$RAW/usbr/$s/$t.csv" "$BASE/$s/csv/$t.csv"; then
      echo "ok $s/$t $(wc -l < "$RAW/usbr/$s/$t.csv") lines"
    else
      rm -f "$RAW/usbr/$s/$t.csv"; echo "absent $s/$t"
    fi
  done
done
