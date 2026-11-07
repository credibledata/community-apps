// Download every public source the package is built from into data-raw/ (gitignored).
// Cached: a rerun touches the network only for files that are missing, or for all of them
// with --refresh. Kalshi markets are fetched separately (fetch-kalshi.mjs) because which
// markets to ask for depends on the curated race list.
//
//   node packages/midterms2026/pipeline/data/fetch.mjs [--refresh]

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cached, RAW } from './lib.mjs'

const wiki = (page) =>
  `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`
const sheet = (id, gid) =>
  `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`
const dataverse = (id, original = false) =>
  `https://dataverse.harvard.edu/api/access/datafile/${id}${original ? '?format=original' : ''}`

// ACS 2024 1-year table-based summary files: keyless bulk downloads, every geography per table.
// B01003 population, B03002 race and Hispanic origin, B15003 education (25+), B01002 median
// age, B19013 median household income.
const acs = (table) =>
  `https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/1YRData/acsdt1y2024-${table}.dat`
export const ACS_TABLES = ['b01003', 'b03002', 'b15003', 'b01002', 'b19013']

export const SOURCES = [
  // Polls: generic ballot, races, approval (VoteHub public API).
  ['votehub-polls.json', 'https://api.votehub.com/polls'],
  // The 2026 map, nominees, incumbents and ratings (Wikipedia, CC BY-SA 4.0).
  ['wiki-senate.json', wiki('2026 United States Senate elections')],
  ['wiki-governor.json', wiki('2026 United States gubernatorial elections')],
  ['wiki-house.json', wiki('2026 United States House of Representatives elections')],
  ['wiki-house-ratings.json', wiki('2026 United States House of Representatives election ratings')],
  ['wiki-current-governors.json', wiki('List of current United States governors')],
  // Current members of Congress (unitedstates/congress-legislators, public domain).
  ['legislators-current.json', 'https://unitedstates.github.io/congress-legislators/legislators-current.json'],
  // Presidential results by congressional district (The Downballot).
  ['downballot-pres-2026-lines.csv', sheet('1eZfaFI-c-PFOoKx1-zZA2MP0_dxRq_LVK0re3BOQqy0')],
  ['downballot-pres-2024-lines.csv', sheet('1ng1i_Dm_RMDnEvauH44pgE6JCUsapcuu8F2pCfeLWFo')],
  // Special elections since 2025 (The Downballot's tracker, 2026 cycle).
  ['downballot-specials-2026.csv', sheet('1JGk1r1VXnxBrAIVHz1C5HTB5jxCO6Zw4QNPivdhyWHw', '1173601967')],
  ['downballot-specials-2025.csv', sheet('1JGk1r1VXnxBrAIVHz1C5HTB5jxCO6Zw4QNPivdhyWHw', '415249345')],
  // Pollster ratings (538, CC BY 4.0; archived).
  ['538-pollster-ratings.csv', 'https://raw.githubusercontent.com/fivethirtyeight/data/master/pollster-ratings/pollster-ratings-combined.csv'],
  // Historical results (MIT Election Data and Science Lab, Harvard Dataverse, CC0).
  // The House and Senate files sit behind a Dataverse guestbook form, so they are not fetched
  // here; download 1976-2024-house.tab / 1976-2024-senate-state.tab by hand into data-raw/ as
  // mit-house.tab / mit-senate.tab and the build will include them.
  ['mit-president.csv', dataverse(13887042, true)],
  // Demographics (Census ACS 2024 1-year; districts are the 119th Congress lines).
  ...ACS_TABLES.map((t) => [`acs-${t}.dat`, acs(t)]),
]

export async function fetchAll() {
  for (const [name, url] of SOURCES) {
    const text = await cached(name, url)
    console.log(`data-raw/${name.padEnd(32)} ${String(text.length).padStart(10)} bytes`)
  }
  // Campaign finance: the FEC's all-candidates summary for the 2026 cycle (bulk file, no key).
  const zip = new URL('weball26.zip', RAW)
  await cached('weball26.zip', 'https://www.fec.gov/files/bulk-downloads/2026/weball26.zip', { binary: true })
  if (!existsSync(new URL('weball26.txt', RAW))) {
    execFileSync('unzip', ['-o', '-q', zip.pathname, '-d', RAW.pathname])
  }
  console.log('data-raw/weball26.txt')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchAll()
}
