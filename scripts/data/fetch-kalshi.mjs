// Kalshi prediction markets: find the "Democrat wins" market for chamber control and for each
// race in curated/races.csv, write the mapping to curated/kalshi_tickers.csv, and cache each
// market's daily candlesticks in data-raw/kalshi/. Public market-data endpoints; no key.
//
//   node scripts/data/fetch-kalshi.mjs [--refresh]

import { mkdirSync } from 'node:fs'
import { cached, RAW, readCurated, STATES, writeCurated } from './lib.mjs'

const API = 'https://api.elections.kalshi.com/trade-api/v2'
const START = Date.UTC(2026, 0, 1) / 1000
const END = Math.floor(Date.now() / 1000)
mkdirSync(new URL('kalshi/', RAW), { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(name, path) {
  await sleep(120)
  return JSON.parse(await cached(`kalshi/${name}`, `${API}${path}`))
}

const series = new Set(
  (await api('series-elections.json', '/series?category=Elections')).series.map((s) => s.ticker)
)

/** Series tickers Kalshi has used for a race, most specific first. */
function seriesFor(r) {
  if (r.office === 'Senate') {
    const st = `${r.state}${r.is_special === 'true' ? 'S' : ''}`
    return [`SENATE${st}`, `KXSENATE${st}`, `SENATEPARTY${st}`, `SENATEPARTY-${st}`]
  }
  if (r.office === 'Governor') {
    return [`GOVPARTY${r.state}`, `KXGOVPARTY${r.state}`]
  }
  const n = Number(r.district_number)
  const ids = [`${r.state}${n}`]
  if (n === 1) {
    ids.push(`${r.state}AL`)
  }
  return ids.flatMap((id) => [`HOUSE${id}`, `KXHOUSE${id}`])
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '')
function demMarket(markets, r) {
  const names = (r?.dem_candidate || '').split('; ').filter(Boolean).map(norm)
  const lastNames = names.map((n) => n.slice(-6))
  return (
    markets.find((m) => names.length && names.some((n) => norm(m.yes_sub_title) === n)) ||
    markets.find((m) => /-D$/.test(m.ticker) && r?.locked_party !== 'R') ||
    markets.find((m) => /democrat/i.test(`${m.yes_sub_title} ${m.subtitle}`)) ||
    markets.find((m) => lastNames.length && lastNames.some((n) => norm(m.yes_sub_title).endsWith(n))) ||
    null
  )
}

/** Does the event's title name this race? Kalshi occasionally files a race under another state's series. */
function namesRace(title, r) {
  if (!r) {
    return true
  }
  if (r.office === 'House') {
    const n = Number(r.district_number)
    return new RegExp(`\\b${r.state}-(${n}|0${n}${n === 1 ? '|AL' : ''})\\b`).test(title)
  }
  return title.toLowerCase().includes(STATES[r.state].toLowerCase())
}

const tickers = []
const misfiled = []
async function addEvent(raceId, seriesTicker, eventTicker, race) {
  const ev = await api(`event-${eventTicker}.json`, `/events/${eventTicker}?with_nested_markets=true`).catch(() => null)
  const markets = ev?.event?.markets || ev?.markets || []
  if (ev?.event && !namesRace(`${ev.event.title} ${markets.map((m) => m.title).join(' ')}`, race)) {
    misfiled.push({ seriesTicker, event: ev.event, markets })
    return false
  }
  const m = demMarket(markets, race)
  if (!m) {
    return false
  }
  tickers.push({
    race_id: raceId,
    series_ticker: seriesTicker,
    market_ticker: m.ticker,
    market_title: m.title,
    yes_side: m.yes_sub_title,
  })
  return true
}

await addEvent('US-SENATE', 'CONTROLS', 'CONTROLS-2026', null)
await addEvent('US-HOUSE', 'CONTROLH', 'CONTROLH-2026', null)
const races = readCurated('races.csv')
for (const r of races) {
  if (r.locked_party) {
    continue
  }
  for (const s of seriesFor(r)) {
    if (series.has(s) && (await addEvent(r.race_id, s, `${s}-26`, r))) {
      break
    }
  }
}
// A misfiled event belongs to the race its title names, if that race has no market yet and
// the market's YES side is that race's D-side nominee.
for (const { seriesTicker, event, markets } of misfiled) {
  const r = races.find(
    (x) => !x.locked_party && namesRace(event.title, x) && x.office !== 'House' === !/House/.test(event.title) &&
      !tickers.some((t) => t.race_id === x.race_id) && /Senate/.test(event.title) === (x.office === 'Senate')
  )
  const m = r && demMarket(markets, r)
  if (m && (r.dem_candidate || '').split('; ').some((n) => norm(n) === norm(m.yes_sub_title))) {
    console.log(`misfiled: ${event.event_ticker} ("${event.title}") -> ${r.race_id}`)
    tickers.push({ race_id: r.race_id, series_ticker: seriesTicker, market_ticker: m.ticker, market_title: m.title, yes_side: m.yes_sub_title })
  } else {
    console.log(`skipped: ${event.event_ticker} ("${event.title}") names no unmatched race`)
  }
}
writeCurated('kalshi_tickers.csv', tickers)

for (const t of tickers) {
  await api(
    `candles-${t.market_ticker}.json`,
    `/series/${t.series_ticker}/markets/${t.market_ticker}/candlesticks?start_ts=${START}&end_ts=${END}&period_interval=1440`
  )
}
console.log(`data-raw/kalshi/: candlesticks for ${tickers.length} markets`)
