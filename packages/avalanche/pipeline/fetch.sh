#!/usr/bin/env bash
# Download the raw inputs the avalanche app's extra tables are built from, into <raw-dir>.
# Writes nothing into the package; pipeline/shape.py turns <raw-dir> into data/.
#   <raw-dir>/caic/accident_reports_N.json, incident_reports_N.json  CAIC accident and incident reports
#   <raw-dir>/snotel/stations.json, <triplet>.json                   NRCS SNOTEL stations and daily data
# CAIC's terms of use (avalanche.state.co.us/terms-use) prohibit automated collection without its
# permission: run the CAIC part (--caic) only with that permission in hand.
# Usage: pipeline/fetch.sh <raw-dir> [--caic]
set -euo pipefail
RAW="$1"; CAIC="${2:-}"
mkdir -p "$RAW/caic" "$RAW/snotel"

if [ "$CAIC" = "--caic" ]; then
  for kind in accident_reports incident_reports; do
    page=1
    while :; do
      f="$RAW/caic/${kind}_$page.json"
      [ -s "$f" ] || { curl -sS --fail --max-time 120 "https://api.avalanche.state.co.us/api/v2/$kind?page=$page&per=100" -o "$f"; sleep 2; }
      [ "$(python3 -I -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "$f")" -lt 100 ] && break
      page=$((page+1))
    done
  done
fi

AWDB="https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1"
[ -s "$RAW/snotel/stations.json" ] || curl -sS --fail --max-time 120 \
  "$AWDB/stations?stationTriplets=*:CO:SNTL&activeOnly=false" -o "$RAW/snotel/stations.json"
fetch_station() {
  f="$RAW/snotel/$(echo "$1" | tr : _).json"
  [ -s "$f" ] && return 0
  for try in 1 2 3; do
    curl -sS --fail --max-time 300 -o "$f.tmp" "$AWDB/data?stationTriplets=$1&elements=WTEQ,SNWD,PREC,TOBS,TMAX,TMIN&duration=DAILY&beginDate=2010-10-01&endDate=2026-09-30" \
      && mv "$f.tmp" "$f" && return 0
    sleep $((try*5))
  done
  echo "failed $1" >&2; return 1
}
n=0
for t in $(python3 -I -c 'import json,sys;[print(s["stationTriplet"]) for s in json.load(open(sys.argv[1]))]' "$RAW/snotel/stations.json"); do
  fetch_station "$t" &
  n=$((n+1)); [ $((n % 4)) -eq 0 ] && wait
done
wait
date -u +%F > "$RAW/fetched.txt"
