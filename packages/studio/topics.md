# Topics for the next community apps

Updated 2026-11-17. Run `build-next-topic` with a topic's package name as the note to build it. Reorder, edit, or
add a topic with `Added by:` your name.

## 1. US measles after losing elimination status

- Package: `measles-2026`
- Why now: The US lost its measles elimination status in November 2026, with CDC counting 5,412 confirmed cases in 2026 as of November 12, the worst outbreak since 1991, https://news.google.com/rss/articles/CBMixAFBVV95cUxPRTN3WGpYREtMZGcxLXV6UVNVWlFRSmFXaGVCRTR3WTdZUGMyczlVdm5KSmIwd2NvZVZuOVdfQkNRTDhackVHbzBGWVRPUk81VTRDUVh3MkI5Y1o2WnJiN2ZaMklXUDVfUUM4X21FZUZuRXN5UHFkV19fYnBXVGNVVFR6M0VxSzczS1FsMlZfRUp5SVNXclNhZGRZQVdzeVlhSmlObE1Ic3U5OE1FTG5NS3dXaF8wSUFTbG9KdWhwRlNGSVN6?oc=5 (KFF)
- Data: Measles Cases and Outbreaks from CDC, https://www.cdc.gov/measles/data-research/index.html, figures a federal agency compiles from state and local reports (accepted without a license field); yearly US cases since 1985, weekly cases since 2022, and kindergarten MMR coverage and exemptions by state and school year (901 rows, 2009-10 to 2025-26); all well under 1 MiB
- Lead view: weekly confirmed cases since 2022, with 2026 against every earlier year
- Risk: cases are national by week, not by state or county; state detail is only in the kindergarten coverage table and the current year's list of reporting jurisdictions
- Added by: app-builder, 2026-11-17

## 2. Lake Mead and Lake Powell under Colorado River cuts

- Package: `colorado-river-reservoirs`
- Why now: As the Colorado River shrinks under deep cuts, calls to drain Lake Powell grow, even after floods raised it 20 feet, https://grist.org/drought/as-the-colorado-river-shrinks-calls-to-drain-lake-powell-grow/
- Data: Reservoir data (daily pool elevation and storage) from the US Bureau of Reclamation, https://www.usbr.gov/uc/water/hydrodata/reservoir_data/site_map.html, US federal government work (public domain); Lake Mead daily since 1935 and Lake Powell since 1963, about 23,000 to 33,000 rows per series, a few MiB in total
- Lead view: daily elevation of both lakes since they filled, with the 2026 level marked against the shortage thresholds
- Risk: the shortage-tier elevations come from Reclamation's operating guidelines, not the data files, and must be cited from that document
- Added by: app-builder, 2026-11-17

## 3. Bird flu in US dairy herds

- Package: `bird-flu-dairy-herds`
- Why now: Oregon confirmed its first H5N1 case in dairy cattle on November 12, the 22nd state to do so, as Washington's infected herds climb into the dozens, https://news.google.com/rss/articles/CBMihgFBVV95cUxOZlAyelU4R3VPT1Y3MlQtTWY0SDJoMTJTWlBlOGgwRHhrQnhzZ0JYc3p4WHZMdUprMGdESDRqRXVJampCX0phaWpDSU96WWhJb2t0dHhkWGlRUW9wQk9ZQmlZSzczbDlFd2hWR0JiVVRRNGlleVJ5Qnk2T3l5LTN1cUJKXzc0dw?oc=5 (OPB)
- Data: HPAI confirmed detections in livestock and in commercial and backyard flocks from USDA APHIS, https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/livestock, US federal government work (public domain); one row per confirmed herd or flock since 2022, small
- Lead view: confirmed dairy herds by month and state since March 2024
- Risk: the data is served only through APHIS's Tableau dashboards; the default flock sheet exports as a monthly CSV, and a record-level export for herds is not yet confirmed
- Added by: app-builder, 2026-11-17

## 4. Fireballs over Earth during the Leonids

- Package: `fireballs`
- Why now: The Leonid meteor shower peaked on November 16-17, https://www.scientificamerican.com/article/look-up-the-leonids-meteor-shower-peaks-tonight/
- Data: Fireball and bolide reports from NASA JPL's Center for Near Earth Object Studies, https://cneos.jpl.nasa.gov/fireballs/, served by the open Fireball Data API (no key); 1,074 events since 1988 with date, location, altitude, velocity and energy, well under 1 MiB
- Lead view: a world map of every fireball sized by impact energy, with a count by year
- Risk: CNEOS's page states no data license, and JPL is operated by Caltech, so NASA's public-domain status must be confirmed before building; the events are bright bolides seen by US government sensors, not shower meteors, so the app cannot count the Leonids themselves
- Added by: app-builder, 2026-11-17
