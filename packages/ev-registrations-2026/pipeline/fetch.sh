#!/usr/bin/env bash
# Download every source into a raw directory (default /tmp/raw). Never writes into the package.
# Source: NY DMV "Registration Transactions: Two Year Window", https://data.ny.gov/d/s2dd-yksa
# The dataset is a rolling two-year window refreshed weekly, so a later fetch holds a later window.
set -euo pipefail
RAW="${1:-/tmp/raw}"
mkdir -p "$RAW"
BASE="https://data.ny.gov/resource/s2dd-yksa.csv"

# 1. Every electric-vehicle ORIGINAL registration (a vehicle newly registered in New York), one row each.
#    VIN, registrant city, ZIP code and coordinates are not requested.
curl -sSL --fail --max-time 300 -G "$BASE" \
  --data-urlencode "\$select=effective_date,registration_class,model_year,make_code,body_type,registrant,residence_county,state,use" \
  --data-urlencode "\$where=fuel='ELECTRIC' AND transaction='ORIGINAL'" \
  --data-urlencode "\$order=effective_date,make_code,residence_county" \
  --data-urlencode "\$limit=1000000" \
  -o "$RAW/ny_ev_original.csv"

# 2. ORIGINAL registrations of every fuel, counted by month, county, fuel and class: the denominator for EV share.
curl -sSL --fail --max-time 600 -G "$BASE" \
  --data-urlencode "\$select=date_trunc_ym(effective_date) as month,residence_county,fuel,registration_class,count(*) as n" \
  --data-urlencode "\$where=transaction='ORIGINAL'" \
  --data-urlencode "\$group=month,residence_county,fuel,registration_class" \
  --data-urlencode "\$order=month,residence_county,fuel,registration_class" \
  --data-urlencode "\$limit=1000000" \
  -o "$RAW/ny_original_by_month.csv"

# 3. The export date range of the window, recorded for the README.
curl -sSL --fail --max-time 120 -G "$BASE" \
  --data-urlencode "\$select=min(exported) as first_export,max(exported) as last_export,count(*) as rows" \
  -o "$RAW/ny_window.csv"

# 4. County boundaries for the map: us-atlas 3.0.1 (US Census Bureau cartographic boundaries, ISC), checked by sha256.
curl -sSL --fail --max-time 60 -o "$RAW/counties-albers-10m.json" https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-albers-10m.json
echo "a674dfa31b625e92635f32684a61ae135b05a91507f17f2d5164833237fecf46  $RAW/counties-albers-10m.json" | sha256sum -c -
