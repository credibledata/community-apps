#!/usr/bin/env bash
# Download every source into a raw directory (default /tmp/raw). Never writes into the package.
set -euo pipefail
RAW="${1:-/tmp/raw}"
mkdir -p "$RAW"
# CDC NHSN Weekly Hospital Respiratory Data (HRD) Metrics by Jurisdiction, public domain (US government).
curl -sSL --fail --max-time 600 -o "$RAW/hrd.csv" \
  "https://data.cdc.gov/api/views/ua7e-t2fy/rows.csv?accessType=DOWNLOAD"
curl -sSL --fail --max-time 60 -o "$RAW/hrd_meta.json" "https://data.cdc.gov/api/views/ua7e-t2fy.json"
# Census Bureau Vintage 2025 state population estimates, public domain (US government).
curl -sSL --fail --max-time 60 -o "$RAW/pop.csv" \
  "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv"
echo "fetched into $RAW"
