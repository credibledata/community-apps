#!/usr/bin/env bash
# Download the NOAA Storm Prediction Center tornado database (one row per tornado, 1950 onward).
# Usage: pipeline/fetch.sh [raw_dir]   (default /tmp/raw). Never writes into the package.
set -euo pipefail
RAW="${1:-/tmp/raw}"
mkdir -p "$RAW"
curl -sSL --fail --max-time 300 -o "$RAW/tornadoes.csv" \
  https://www.spc.noaa.gov/wcm/data/1950-2025_actual_tornadoes.csv
curl -sSL --fail --max-time 120 -o "$RAW/SPC_severe_database_description.pdf" \
  https://www.spc.noaa.gov/wcm/data/SPC_severe_database_description.pdf
echo "fetched into $RAW"
