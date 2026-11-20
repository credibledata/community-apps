#!/usr/bin/env bash
# Download every source this app uses into a raw directory (default /tmp/raw).
# Never writes into the package.
set -euo pipefail
RAW="${1:-/tmp/raw}"
mkdir -p "$RAW/ne"
# NOAA NHC Atlantic HURDAT2 best track, 1851-2025 (revision of 2026-09-23). Public domain.
curl -sSL --fail --max-time 120 -o "$RAW/hurdat2.txt" \
  https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt
# Natural Earth 1:10m countries and 1:50m states/provinces. Public domain.
curl -sSL --fail --max-time 120 -o "$RAW/ne/ne_10m_admin_0_countries.zip" https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip
for f in ne_50m_admin_1_states_provinces; do
  curl -sSL --fail --max-time 120 -o "$RAW/ne/$f.zip" \
    "https://naciscdn.org/naturalearth/50m/cultural/$f.zip"
done
echo "fetched into $RAW"
