#!/usr/bin/env bash
# Download EIA's monthly net generation by state, producer type and energy source (EIA-923 / EIA-906/920).
# Usage: pipeline/fetch.sh [raw_dir]   (default /tmp/raw). Never writes into the package.
set -euo pipefail
RAW="${1:-/tmp/raw}"
mkdir -p "$RAW"
curl -sSL --fail --max-time 120 -o "$RAW/generation_monthly.xlsx" \
  https://www.eia.gov/electricity/data/state/generation_monthly.xlsx
echo "fetched $(date -u +%F): $RAW/generation_monthly.xlsx"
