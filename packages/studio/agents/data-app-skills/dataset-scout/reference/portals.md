# Where to look

Starting points. Most serve data without a key; a source that needs one is usable only when the environment holds
that key (`SKILL.md`). Each one's license still has to be read per dataset, as in
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
| US Energy Information Administration | energy prices and production | The API takes its key in the address, which Credible cannot add: use the spreadsheet on each series' page, which needs none. Public domain. |
| OECD | country comparisons | `https://sdmx.oecd.org/public/rest/data/...`; check the dataset's terms |

## Topic sources

| Source | Good for | Notes |
|---|---|---|
| USGS earthquake feeds | earthquakes worldwide, last hour to last 30 days | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php`; public domain |
| NOAA NCEI | climate and weather records | Several APIs need a token; the bulk CSV files do not. Public domain. |
| CDC data portal | US public health | `https://data.cdc.gov`, a Socrata portal; read each dataset's license |
| City portals (NYC, Chicago, San Francisco, and others) | local services, safety, transport | Socrata: `https://<portal>/resource/<id>.csv?$limit=50000`; license per dataset |
| Our World in Data | long-run global series | `https://ourworldindata.org/grapher/<chart>.csv`; their own work is CC BY 4.0, but check each series' original source |

## Money, work and companies

Public records that agencies publish carry subjects people argue about: pay, prices, companies, complaints. Several
name people (donors, filers' contacts): keep companies, places and amounts, never a person's name, as `SKILL.md`'s
license gate says.

| Source | Good for | Notes |
|---|---|---|
| SEC EDGAR | company filings and financial statements | `https://data.sec.gov/api/xbrl/frames/...` and `https://www.sec.gov/cgi-bin/browse-edgar`; public domain. SEC refuses a request whose `User-Agent` gives no contact email, so it is usable only when the environment holds a key for `www.sec.gov` and `data.sec.gov` sent as the `User-Agent` header, added like any key; never write an address into a script. At most 10 requests a second. |
| US Department of Labor, foreign labor certification (H-1B and other visa filings) | wages employers file by job, employer and city | `https://www.dol.gov/agencies/eta/foreign-labor/performance`, yearly and quarterly spreadsheets; public domain |
| CFPB Consumer Complaint Database | complaints about banks, lenders and card issuers, by company and product, updated daily | `https://www.consumerfinance.gov/data-research/consumer-complaints/`; public domain |
| FEC | campaign money by candidate, committee and donor's employer | `https://www.fec.gov/data/browse-data/` bulk files; public domain |
| FDIC BankFind | every US bank's deposits, branches and failures | `https://banks.data.fdic.gov/api/institutions?limit=10`; public domain |

## Wikimedia

| Source | Good for | Notes |
|---|---|---|
| Wikipedia tables | lists and results the field keeps there (elections, sports, launches) | Text and tables are CC BY-SA 4.0: share-alike, see `licenses.md`. Read each table's own citations: the original source may carry other terms. |
| Wikidata | facts about companies, places and works | `https://query.wikidata.org/sparql`; CC0 |
| Wikipedia page views | how much people read about a subject, by day | `https://wikimedia.org/api/rest_v1/metrics/pageviews/...`; CC0 |

## Not usable

Kaggle (needs a login), anything behind a sign-up form or terms to accept, a key the environment does not hold,
paywalled reports, and scraped tables from news sites.
