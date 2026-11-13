# Where to look

Starting points that serve data without a key. Each one's license still has to be read per dataset, as in
`licenses.md`. A URL here is a starting point, not a promise that it still answers.

## General catalogs

| Portal | Search | Notes |
|---|---|---|
| data.gov (US) | `https://catalog.data.gov/search?q=<terms>` | A web page, not an API: the old CKAN API under `/api/3/` answers 404. Read each dataset's page for its license and download links. Federal works are public domain; state and city datasets listed here carry their own licenses. |
| data.europa.eu (EU) | `https://data.europa.eu/api/hub/search/search?q=<terms>&filter=dataset&limit=20` | Each dataset names its license. |
| data.gov.uk | `https://data.gov.uk/api/action/package_search?q=<terms>` | CKAN. Most are OGL v3. |

## Statistics offices and international bodies

| Source | Good for | Access |
|---|---|---|
| World Bank Indicators | country-level economics, health, population, by year | `https://api.worldbank.org/v2/country/<iso3 or all>/indicator/<code>?format=json&per_page=20000`; search indicators at `https://api.worldbank.org/v2/indicator?format=json&per_page=100&source=2` |
| Eurostat | EU countries and regions, often monthly | `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?format=JSON` |
| US Census Bureau | US population, business and housing by geography | `https://api.census.gov/data/...`; small requests need no key. It can be slow or unreachable; give it one try with a timeout and move on. |
| US Bureau of Labor Statistics | US prices, jobs and wages | public API v1, no key, limited requests per day |
| US Energy Information Administration | energy prices and production | needs a key: skip |
| OECD | country comparisons | `https://sdmx.oecd.org/public/rest/data/...`; check the dataset's terms |

## Topic sources

| Source | Good for | Notes |
|---|---|---|
| USGS earthquake feeds | earthquakes worldwide, last hour to last 30 days | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php`; public domain |
| NOAA NCEI | climate and weather records | Several APIs need a token; the bulk CSV files do not. Public domain. |
| CDC data portal | US public health | `https://data.cdc.gov`, a Socrata portal; read each dataset's license |
| City portals (NYC, Chicago, San Francisco, and others) | local services, safety, transport | Socrata: `https://<portal>/resource/<id>.csv?$limit=50000`; license per dataset |
| Our World in Data | long-run global series | `https://ourworldindata.org/grapher/<chart>.csv`; their own work is CC BY 4.0, but check each series' original source |

## Not usable

Kaggle (needs a login), anything behind a key or a sign-up form, paywalled reports, scraped tables from
news sites, and Wikipedia (share-alike, see `licenses.md`).
