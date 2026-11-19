#!/usr/bin/env bash
# Download the raw sources into $1 (default /tmp/raw). Never writes into the package.
#  - USGS ComCat events, M2.5+, 2000-01-01 to today, in a box around the contiguous US, one CSV per year
#    (the FDSN service returns at most 20,000 events per request).
#  - US Census Bureau cartographic boundary files of states and counties (1:500,000), to place each event in a state.
set -euo pipefail
OUT="${1:-/tmp/raw}"
mkdir -p "$OUT/comcat"
END=$(date -u +%Y-%m-%d)
BOX="minlatitude=24&maxlatitude=50&minlongitude=-125.5&maxlongitude=-66&minmagnitude=2.5"
for y in $(seq 2000 "$(date -u +%Y)"); do
  e="$((y+1))-01-01"; [[ "$e" > "$END" ]] && e="$END"
  curl -sSL --fail --max-time 120 -o "$OUT/comcat/$y.csv" \
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&orderby=time-asc&starttime=$y-01-01&endtime=$e&$BOX"
  echo "$y $(($(wc -l < "$OUT/comcat/$y.csv")-1))"
done
for g in state county; do
  curl -sSL --fail --max-time 120 -o "$OUT/cb_2023_us_${g}_500k.zip" \
    "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_${g}_500k.zip"
done
