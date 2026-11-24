#!/usr/bin/env bash
# Download every source into a raw directory (default /tmp/raw). Never writes into the package.
set -euo pipefail
RAW="${1:-/tmp/raw}"
mkdir -p "$RAW"
EIA=https://www.eia.gov/dnav/pet/xls
# US prices by grade and formulation, and diesel
curl -sSL --fail --max-time 120 -o "$RAW/eia_gnd_weekly.xls" "$EIA/PET_PRI_GND_DCUS_NUS_W.xls"
# Prices by area (US, PADDs, states, cities), one file per grade
for g in EPM0 EPMR EPMM EPMP EPD2D; do
  curl -sSL --fail --max-time 120 -o "$RAW/eia_${g}.xls" "$EIA/PET_PRI_GND_A_${g}_PTE_DPGAL_W.xls"
done
# BLS CPI-U, all items (BLS asks for a contact in the User-Agent)
curl -sSL --fail --max-time 120 -A "credible-community-apps (community.credibledata.com)" \
  -o "$RAW/cu_allitems.txt" https://download.bls.gov/pub/time.series/cu/cu.data.1.AllItems
