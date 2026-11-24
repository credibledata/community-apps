# Topics for the next community apps

Updated 2026-11-24. Run `build-next-topic` with a topic's package name as the note to build it. Reorder, edit, or
add a topic with `Added by:` your name.

## 1. An early flu season, in hospital beds

- Package: `flu-hospital-admissions`
- Why now: Flu activity has started weeks earlier than usual and is still climbing ahead of Thanksgiving, while CDC has said little about it, https://news.google.com/rss/articles/CBMibkFVX3lxTFBaSDVQX2tUa2Z5ZHcwRV8ycmZ1dWMxSWoyZ19fbW9iVnNPNG1XWTdqS0Z4OVZ3Mm9VS01yTW9uZTJMb2h4blBUbGl5aFg0eG9WalV2bGQ5cWNyMGw2UUhpWW4tcFZXRkxaVWRsQUJ3?oc=5 (CNN)
- Data: Weekly Hospital Respiratory Data (HRD) Metrics by Jurisdiction from CDC's National Healthcare Safety Network, https://data.cdc.gov/Public-Health-Surveillance/Weekly-Hospital-Respiratory-Data-HRD-Metrics-by-Ju/ua7e-t2fy, "Public Domain U.S. Government" on its data.cdc.gov page; 21,976 rows (one per state or territory per week, August 2020 to the week ending November 14, 2026) with 217 columns of flu, COVID and RSV admissions and bed use
- More data: Census Bureau state population estimates (public domain, US government), joined by state, so admissions read per 100,000 people
- Needs a key: none
- Lead view: weekly new flu hospital admissions in the US by season, with this season's line over the last five seasons at the same week
- Pages: a state, with its flu, COVID and RSV admissions and beds occupied; Compare states; About the data
- Risk: hospital reporting was voluntary from May to October 2024, so that stretch has gaps; the data is by week and state, not by hospital
- Added by: app-builder, 2026-11-24

## 2. King tides and high-tide flooding on US coasts

- Package: `high-tide-flooding`
- Why now: Potentially record-breaking king tides are flooding the California coast this Thanksgiving week, https://news.google.com/rss/articles/CBMimAFBVV95cUxQa2JrSlRQeWVrZVVLcVhSUncxVFFnU2xuMkJ4OS0wRTZtNXZ6aHpWWERwTkNhZ0d3dEJ2MXVmM2t1eldYS3RJRDQ3NUh0dk10YWtpblJldzl0QlZIeXF4c2VNT1lnTGZoZ21KMVRHT0ZIYWNBckJhcTFQQmlVRXkzbkN4Vko2UHhKblVuajUyS01Mb1BWV1F3bQ?oc=5 (The Guardian)
- Data: High-tide flooding annual counts and verified high and low water levels from NOAA CO-OPS, served by its open APIs at https://api.tidesandcurrents.noaa.gov (no key), public domain per https://tidesandcurrents.noaa.gov/disclaimers.html ("in the public domain ... may be used freely by the public"); 303 water-level stations, flood-day counts per station per year (San Francisco back to 1920), and roughly 1,400 high and low tides per station per year
- More data: NOAA's sea level trends per station, from the same service, to set long-run sea level rise beside the count of flood days
- Needs a key: none
- Lead view: days of high-tide flooding per year across US coastal stations, with 2026 marked
- Pages: a station, with its flood days by year and its highest tides; Compare stations; About the data
- Risk: fetching high and low tides for every station is one API request per station per month, so the full history runs as a job; flood thresholds are NOAA's own derived values per station
- Added by: app-builder, 2026-11-24

## 3. Carbon dioxide in the air after COP31 failed

- Package: `co2-keeling-curve`
- Why now: The COP31 climate talks in Antalya ended on November 22 without a deal, https://news.google.com/rss/articles/CBMiW0FVX3lxTE4zazlrTTNEV2tGd0RQYWNBcEdIendZVHNySG96NDVwUXA5aWQwLWw2NlFsN3RPUjhfRDQ4ZDNsQ1hjR0lvZ2V2ZENMSlIxbXdocWxKam9fTkNpak0?oc=5 (BBC)
- Data: Mauna Loa CO2 monthly means from NOAA Global Monitoring Laboratory, https://gml.noaa.gov/ccgg/trends/data.html, measured by a US federal agency and stated in the file as "made freely available to the public"; about 820 monthly rows since March 1958 (latest month October 2026, 426.69 ppm), well under 1 MiB, with daily, weekly and global-mean files alongside
- More data: national emissions from the Global Carbon Budget (CC BY 4.0, license to check on its own page), to set countries' emissions beside the curve
- Needs a key: none
- Lead view: the monthly Keeling curve since 1958, with the annual growth rate per year beneath it
- Pages: a year, with its monthly readings and growth; a country, if emissions are added; About the data
- Risk: NOAA's file asks users to cite it rather than naming a license; without a second dataset the record is small, closer to a chart than an app
- Added by: app-builder, 2026-11-23

## 4. Thanksgiving flight delays

- Package: `us-flight-delays`
- Why now: Storms on both coasts and airline system glitches threaten the busiest travel week of the year, https://news.google.com/rss/articles/CBMiogFBVV95cUxNRXpwaW1RekJITW11bzNyd19hUzZ0MGF1RG5PY196VmNZOXBSZEcxeUdYazJYRV9zNFFqTHBxdXMyeXNIa242aFlzcHRWbnY1bzhLYlpTUjdrM1BtZUxNczBEaV9BT0ZKUVNieFN3UlNOcWFLbUdFWEZhUW52MTk1LUM3NS1oUXY5V1o2bWpodXYxRUk4Z05TalpNblo3YlVUX1E?oc=5 (PBS)
- Data: Reporting Carrier On-Time Performance from the Bureau of Transportation Statistics, https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ, a US federal government work; one row per domestic flight by the large carriers since 1987, about 600,000 rows a month, as monthly zip files (about 32 MB for August 2026)
- More data: NOAA hourly weather observations at the same airports (public domain), to tell weather delays from carrier delays
- Needs a key: none
- Lead view: share of flights delayed or cancelled each day of Thanksgiving week, this year beside the last ten years
- Pages: an airport, an airline, a route; Compare airports; About the data
- Risk: bts.gov refused this agent computer, so BTS's own reuse statement was not read; the data runs about two months behind, so this Thanksgiving's flights will not be in it until late January; the full history is too large to load whole and must be trimmed to Thanksgiving weeks or recent years
- Added by: app-builder, 2026-11-24

## 5. Bird flu in US dairy herds

- Package: `bird-flu-dairy-herds`
- Why now: Oregon confirmed its first H5N1 case in dairy cattle on November 12, the 22nd state to do so, as Washington's infected herds climb into the dozens, https://news.google.com/rss/articles/CBMihgFBVV95cUxOZlAyelU4R3VPT1Y3MlQtTWY0SDJoMTJTWlBlOGgwRHhrQnhzZ0JYc3p4WHZMdUprMGdESDRqRXVJampCX0phaWpDSU96WWhJb2t0dHhkWGlRUW9wQk9ZQmlZSzczbDlFd2hWR0JiVVRRNGlleVJ5Qnk2T3l5LTN1cUJKXzc0dw?oc=5 (OPB)
- Data: HPAI confirmed detections in livestock and in commercial and backyard flocks from USDA APHIS, https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/livestock, US federal government work (public domain); one row per confirmed herd or flock since 2022, small
- More data: none
- Needs a key: none
- Lead view: confirmed dairy herds by month and state since March 2024
- Pages: a state, with its herds and flocks by month; About the data
- Risk: the data is served only through APHIS's Tableau dashboards; the default flock sheet exports as a monthly CSV, and a record-level export for herds is not yet confirmed
- Added by: app-builder, 2026-11-17
