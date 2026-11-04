#!/usr/bin/env bash
# Download every wildfire record (IncidentTypeCategory = 'WF') from NIFC's
# WFIGS Wildland Fire Incident Locations feature service, 2,000 rows a page,
# into <raw-dir>/wfigs/page_NNNNN.json. Writes nothing into the package.
# Usage: pipeline/fetch.sh [/tmp/raw]
set -euo pipefail
RAW="${1:-/tmp/raw}"
OUT="$RAW/wfigs"
mkdir -p "$OUT"
L="https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations/FeatureServer/0/query"
WHERE="IncidentTypeCategory='WF'"
FIELDS="OBJECTID,UniqueFireIdentifier,IncidentName,IncidentTypeKind,FireDiscoveryDateTime,ContainmentDateTime,ControlDateTime,FireOutDateTime,IncidentSize,DiscoveryAcres,FinalAcres,FireCause,FireCauseGeneral,FireCauseSpecific,POOState,POOCounty,POOFips,GACC,POOLandownerCategory,POOLandownerKind,POOJurisdictionalAgency,PredominantFuelGroup,IsCpxChild,CpxName,EstimatedCostToDate,TotalIncidentPersonnel,IncidentComplexityLevel,FireBehaviorGeneral"
TOTAL=$(curl -sS --fail --max-time 60 -G "$L" --data-urlencode "where=$WHERE" -d returnCountOnly=true -d f=json | python3 -I -c "import json,sys;print(json.load(sys.stdin)['count'])")
echo "total=$TOTAL" | tee "$OUT/total.txt"
seq 0 2000 $((TOTAL-1)) | xargs -P 8 -I{} sh -c '
  f="$0/page_$(printf %07d {}).json"
  [ -s "$f" ] && exit 0
  for try in 1 2 3 4; do
    curl -sS --fail --max-time 120 -G "$1" --data-urlencode "where=$2" -d outFields="$3" \
      -d returnGeometry=true -d outSR=4326 -d orderByFields=OBJECTID -d resultOffset={} -d resultRecordCount=2000 -d f=json -o "$f.tmp" \
      && grep -q "\"features\"" "$f.tmp" && mv "$f.tmp" "$f" && exit 0
    sleep $((try*3))
  done
  echo "failed offset {}" >&2; exit 1' "$OUT" "$L" "$WHERE" "$FIELDS"
date -u +%F > "$OUT/fetched.txt"
