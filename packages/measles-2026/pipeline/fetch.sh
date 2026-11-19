#!/usr/bin/env bash
# Download every source of measles-2026 into a raw directory (default /tmp/raw). Never writes into the package.
# CDC's measles page (https://www.cdc.gov/measles/data-research/index.html) draws its charts from JSON files under
# /wcms/vizdata/measles/. www.cdc.gov refuses some automated clients, so each file falls back to the Internet
# Archive's copy of the same URL (the snapshot used for the published tables is pinned below).
set -euo pipefail
RAW="${1:-/tmp/raw}"
mkdir -p "$RAW"
UA="Mozilla/5.0 (X11; Linux x86_64) measles-2026 data app rebuild"

viz() { # $1 file name, $2 pinned Wayback timestamp
  local url="https://www.cdc.gov/wcms/vizdata/measles/$1"
  if ! curl -sSL --fail --max-time 120 -A "$UA" -o "$RAW/$1" "$url"; then
    echo "www.cdc.gov refused $1; using Wayback snapshot $2" >&2
    curl -sSL --fail --max-time 120 --compressed -o "$RAW/$1" "https://web.archive.org/web/${2}id_/$url"
  fi
}
viz MeaslesCasesYear.json   20261113210451
viz MeaslesCasesWeekly.json 20261114205324
viz MeaslesCasesMap.json    20261113210450

# SchoolVaxView: Vaccination Coverage and Exemptions among Kindergartners (data.cdc.gov ijqb-a7ye)
curl -sSL --fail --max-time 120 -A "$UA" -o "$RAW/kindergarten.json" \
  'https://data.cdc.gov/resource/ijqb-a7ye.json?$limit=50000&$where=vaccine%20in(%27MMR%27,%27Exemption%27)'
ls -l "$RAW"
