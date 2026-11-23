# Topics for the next community apps

Updated 2026-11-23. Run `build-next-topic` with a topic's package name as the note to build it. Reorder, edit, or
add a topic with `Added by:` your name.

## 1. Gasoline prices going into Thanksgiving

- Package: `us-gasoline-prices`
- Why now: Reports call Thanksgiving gas prices near an all-time high, while EIA's weekly survey has the US average regular price falling from $4.331 a gallon on October 12 to $3.805 on November 16, https://news.google.com/rss/articles/CBMikAFBVV95cUxPWnNrNmcyaXlfWVlTM29KQnZKWUdIZVVvSnREWDhHcm9wZWtDVTVWMXlDV0I4dHFGQlJZYVFFbHI3N1VqdWZjOTlBY2xNT2tEYTBhYlJXX0xkaGpVVU94bnlJcjhXRUl2b3V3b254QmhkR2RPUWZPWjQ0aU9LOGFDdzVHbVFMcXJsWXI5M2FZUVg?oc=5 (Vermont Business Magazine)
- Data: Weekly Retail Gasoline and Diesel Prices from the US Energy Information Administration, https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_nus_w.htm, public domain as US government publications (https://www.eia.gov/about/copyrights_reuse.php); one spreadsheet (about 500 KB) of weekly prices since 1990 to 1994 by grade, formulation and region (US, PADDs, some states and cities)
- Lead view: weekly US regular gasoline price since 1990, with each year's Thanksgiving week marked
- Risk: prices are nominal, so comparing with past peaks needs an inflation index (BLS CPI, also public domain) as a second dataset; regions are PADDs and a few states and cities, not every state
- Added by: app-builder, 2026-11-23

## 2. Carbon dioxide in the air after COP31 failed

- Package: `co2-keeling-curve`
- Why now: The COP31 climate talks in Antalya ended on November 22 without a deal, https://news.google.com/rss/articles/CBMiW0FVX3lxTE4zazlrTTNEV2tGd0RQYWNBcEdIendZVHNySG96NDVwUXA5aWQwLWw2NlFsN3RPUjhfRDQ4ZDNsQ1hjR0lvZ2V2ZENMSlIxbXdocWxKam9fTkNpak0?oc=5 (BBC)
- Data: Mauna Loa CO2 monthly means from NOAA Global Monitoring Laboratory, https://gml.noaa.gov/ccgg/trends/data.html, measured by a US federal agency and stated in the file as "made freely available to the public"; about 820 monthly rows since March 1958 (latest month October 2026, 426.69 ppm), well under 1 MiB, with daily, weekly and global-mean files alongside
- Lead view: the monthly Keeling curve since 1958, with the annual growth rate per year beneath it
- Risk: NOAA's file asks users to cite it rather than naming a license; national emissions to set beside it would need a second dataset (such as the Global Carbon Budget, CC BY 4.0) whose license must be checked on its own page
- Added by: app-builder, 2026-11-23

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
