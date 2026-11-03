// Curate the 2026 map from the cached sources into scripts/data/curated/*.csv (committed, so
// a reviewer can read every race, nominee and rating the forecast uses and where it came from).
//
//   races.csv       one row per 2026 race: incumbency, open seat, Sabato rating, matchup
//   candidates.csv  general-election nominees, with the side (D or R) each stands in for
//   chambers.csv    seat arithmetic going in
//
// Sources: the Wikipedia 2026 Senate, gubernatorial and House articles and the House ratings
// article (CC BY-SA 4.0), whose rating columns cite Sabato's Crystal Ball; current members of
// Congress from unitedstates/congress-legislators; current governors from Wikipedia.
//
//   node scripts/data/curate.mjs

import { partyCode, plain, ratingLabel, readJson, STATES, ABBR, wikiCandidates, writeCurated } from './lib.mjs'
import { cellValue, sectionAt, tableRows, wikitext } from './wiki.mjs'

// The Vice President breaks Senate ties. JD Vance (R), per the Senate article's account of the
// Ohio special election.
const VICE_PRESIDENT_PARTY = 'R'

const stateOf = (header) => {
  const name = plain(header)
    .replace(/\(.*?\)/g, '')
    .replace(/Class \d/, '')
    .trim()
    .toLowerCase()
  return ABBR[name] || null
}

/** Running for this seat again (renominated, advanced, appointee nominated); not retiring or beaten. */
const isRunning = (status) =>
  // "Re-elected" is an incumbent already returned unopposed (Florida prints no such race).
  /nominated|advanced|running for re-?election|seeking re-?election|re-?elected/i.test(status) &&
  !/retir|lost|ineligible|defeated|term-limited|not seeking|withdr/i.test(status)

const partyOf = (cell) => partyCode(plain(cellValue(cell)) || cell)

/**
 * Which nominee stands in for each side. With no nominee from one major party, independents
 * stand in for that side (Nebraska's Senate race, or CA-06 where the incumbent is an
 * independent and no Republican advanced). A race with nominees from one party only is
 * decided before Election Day.
 */
function matchup(candidates) {
  const D = candidates.filter((c) => c.party === 'D')
  const R = candidates.filter((c) => c.party === 'R')
  const I = candidates.filter((c) => c.party === 'I')
  let dSide = D
  let rSide = R
  let note = ''
  let independentAs = null
  const names = I.map((c) => c.name).join(', ')
  if (!D.length && I.length && R.length) {
    dSide = I
    independentAs = 'D'
    note = `No Democratic nominee; independent ${names} counted on the D side`
  } else if (!R.length && I.length && D.length) {
    rSide = I
    independentAs = 'R'
    note = `No Republican nominee; independent ${names} counted on the R side`
  }
  const sides = candidates.map((c) => ({
    ...c,
    side: dSide.includes(c) ? 'D' : rSide.includes(c) ? 'R' : '',
  }))
  let locked = ''
  if (!dSide.length && rSide.length) {
    locked = 'R'
    note = 'Republican-only general election'
  } else if (dSide.length && !rSide.length) {
    locked = 'D'
    note = 'Democratic-only general election'
  }
  return { sides, locked, note, independentAs }
}

const memberName = (cell) =>
  plain(cellValue(cell).replace(/(<br\s*\/?>)?\s*\{\{small\|Redistricted[\s\S]*$/i, ''))

const races = []
const candidates = []

function addRace(r, cands) {
  const m = matchup(cands)
  races.push({
    ...r,
    expert_rating: r.rating_cell ? ratingLabel(r.rating_cell, { independentAs: m.independentAs }) : '',
    locked_party: m.locked,
    matchup_note: m.note,
    dem_candidate: m.sides.filter((c) => c.side === 'D').map((c) => c.name).join('; '),
    rep_candidate: m.sides.filter((c) => c.side === 'R').map((c) => c.name).join('; '),
  })
  for (const c of m.sides) {
    candidates.push({ race_id: r.race_id, name: c.name, party: c.party, side: c.side })
  }
}

// ---- Ratings: Sabato's column in each article's ratings table --------------------------------
function statewideRatings(text) {
  const out = {}
  const rows = tableRows(text, text.indexOf('<!--Sabato'))
  for (const r of tableRows(text, text.lastIndexOf('{|', text.indexOf('<!--Sabato')))) {
    const st = r.header && stateOf(r.header)
    const m = r.raw.match(/<!--\s*Sabato\s*-->\s*\|\s*([^\n]*)/)
    if (st && m) {
      const special = /special/i.test(r.header)
      out[`${st}${special ? '-S' : ''}`] = m[1]
    }
  }
  return rows.length ? out : out
}

// ---- Senate -------------------------------------------------------------------------------
const sen = wikitext('wiki-senate.json')
const senRatings = statewideRatings(sen)
for (const [section, special] of [
  ['Special elections during the preceding Congress', true],
  ['Elections leading to the next Congress', false],
]) {
  for (const r of tableRows(sen, sectionAt(sen, section))) {
    if (!r.header || !/election in|special election/i.test(r.header)) {
      continue
    }
    const state = stateOf(r.header)
    // Regular: PVI, senator, party, history, last result, status, candidates. Special: no last result.
    const [, , party, , ...rest] = r.cells
    const status = plain(cellValue(rest.at(-2)))
    const running = isRunning(status)
    addRace(
      {
        race_id: `SEN-${state}${special ? '-S' : ''}`,
        office: 'Senate',
        state,
        district_number: '',
        race_name: `${STATES[state]} Senate${special ? ' (special)' : ''}`,
        is_special: special,
        incumbent_party: partyOf(party),
        is_open_seat: !running,
        incumbent_status: status,
        rating_cell: senRatings[`${state}${special ? '-S' : ''}`] || '',
        source: 'https://en.wikipedia.org/wiki/2026_United_States_Senate_elections',
      },
      wikiCandidates(r.cells.at(-1))
    )
  }
}

// ---- Governors ----------------------------------------------------------------------------
const gov = wikitext('wiki-governor.json')
const govRatings = statewideRatings(gov)
for (const r of tableRows(gov, sectionAt(gov, 'States'))) {
  const state = r.header && stateOf(r.header)
  if (!state) {
    continue
  }
  // Governor, party, first elected, last race, status, candidates.
  const [, party, , , status] = r.cells
  const st = plain(cellValue(status))
  addRace(
    {
      race_id: `GOV-${state}`,
      office: 'Governor',
      state,
      district_number: '',
      race_name: `${STATES[state]} Governor`,
      is_special: false,
      incumbent_party: partyCode(party),
      is_open_seat: !isRunning(st),
      incumbent_status: st,
      rating_cell: govRatings[state] || '',
      source: 'https://en.wikipedia.org/wiki/2026_United_States_gubernatorial_elections',
    },
    wikiCandidates(r.cells.at(-1))
  )
}

// ---- House --------------------------------------------------------------------------------
const hr = wikitext('wiki-house-ratings.json')
const houseRatings = {}
{
  const rows = tableRows(hr, hr.lastIndexOf('{|', hr.indexOf("Sabato's Crystal Ball|Sabato")))
  const head = rows.find((r) => r.cells.some((c) => /Sabato/.test(c)))
  const col = head.cells.findIndex((c) => /Sabato/.test(c))
  for (const r of rows) {
    const m = r.header && r.header.match(/ushr\|([A-Z]{2})\|(\w+)/)
    if (m && r.cells[col]) {
      const n = m[2] === 'AL' ? 1 : Number(m[2])
      houseRatings[`${m[1]}-${String(n).padStart(2, '0')}`] = r.cells[col]
    }
  }
}

const house = wikitext('wiki-house.json')
for (const [abbr, name] of Object.entries(STATES)) {
  const at = sectionAt(house, name)
  if (at < 0) {
    throw new Error(`No House section for ${name}`)
  }
  let cur = null
  const flush = () => {
    if (!cur) {
      return
    }
    const running = cur.incumbents.find((i) => i.running)
    const held = running || cur.incumbents[0]
    addRace(
      {
        race_id: `HOU-${cur.geo}`,
        office: 'House',
        state: abbr,
        district_number: cur.n,
        race_name: cur.n === 1 && cur.atLarge ? `${name} at-large` : `${name} ${ordinal(cur.n)}`,
        is_special: false,
        incumbent_party: held ? held.party : '',
        is_open_seat: !running,
        incumbent_status: cur.incumbents.map((i) => `${i.name}: ${i.status}`).join(' / ') || cur.note,
        rating_cell: houseRatings[cur.geo] || '',
        source: `https://en.wikipedia.org/wiki/2026_United_States_House_of_Representatives_elections#${name.replace(/ /g, '_')}`,
      },
      cur.cands
    )
    cur = null
  }
  for (const r of tableRows(house, at)) {
    const m = r.header && r.header.match(/ushr\|([A-Z]{2})\|(\w+)/)
    if (m) {
      flush()
      const atLarge = m[2] === 'AL'
      const n = atLarge ? 1 : Number(m[2])
      cur = { n, atLarge, geo: `${abbr}-${String(n).padStart(2, '0')}`, incumbents: [], cands: wikiCandidates(r.cells.at(-1)), note: '' }
      const member = memberName(r.cells[1])
      if (/^None/.test(member)) {
        cur.note = 'New seat'
      } else if (/^Vacant/.test(member)) {
        const note = plain(cellValue(r.cells[2]))
        const p = (note.match(/\(([DR])\)/) || [])[1] || ''
        cur.note = `Vacant: ${note}`
        cur.incumbents.push({ name: 'Vacant', party: p, status: note, running: false })
      } else {
        const status = plain(cellValue(r.cells[4]))
        cur.incumbents.push({ name: member, party: partyOf(r.cells[2]), status, running: isRunning(status) })
      }
    } else if (cur && r.cells.length >= 4 && !r.header) {
      // A second incumbent drawn into the same district (rowspan continuation).
      const status = plain(cellValue(r.cells[3]))
      cur.incumbents.push({
        name: memberName(r.cells[0]),
        party: partyOf(r.cells[1]),
        status,
        running: isRunning(status),
      })
    }
  }
  flush()
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// ---- Chambers -----------------------------------------------------------------------------
const TERRITORIES = new Set(['DC', 'PR', 'GU', 'VI', 'AS', 'MP'])
const members = readJson('legislators-current.json').map((l) => {
  const t = l.terms.at(-1)
  const p = partyCode(t.caucus || t.party)
  return { type: t.type, state: t.state, party: p }
})
const count = (type, party) =>
  members.filter((m) => m.type === type && m.party === party && !TERRITORIES.has(m.state)).length

const governors = {}
{
  const text = wikitext('wiki-current-governors.json')
  for (const m of text.matchAll(/\n\|\[\[Governor of ([^|\]]+)\|[^\]]*\]\][^\n]*\n[\s\S]*?party color\|([^}]+)\}\}/g)) {
    const st = ABBR[m[1].toLowerCase()]
    if (st && !(st in governors)) {
      governors[st] = partyCode(m[2])
    }
  }
}
if (Object.keys(governors).length !== 50) {
  throw new Error(`Expected 50 governors, parsed ${Object.keys(governors).length}`)
}

const upBy = (office, party) => races.filter((r) => r.office === office && r.incumbent_party === party).length
const senD = count('sen', 'D')
const senR = count('sen', 'R')
const houseD = count('rep', 'D')
const houseR = count('rep', 'R')
const govD = Object.values(governors).filter((p) => p === 'D').length
const govR = Object.values(governors).filter((p) => p === 'R').length
const chambers = [
  {
    chamber: 'Senate',
    total_seats: 100,
    dem_seats_not_up: senD - upBy('Senate', 'D'),
    rep_seats_not_up: senR - upBy('Senate', 'R'),
    dem_seats_current: senD,
    rep_seats_current: senR,
    dem_needs: VICE_PRESIDENT_PARTY === 'D' ? 50 : 51,
    rep_needs: VICE_PRESIDENT_PARTY === 'R' ? 50 : 51,
  },
  {
    chamber: 'House',
    total_seats: 435,
    dem_seats_not_up: 0,
    rep_seats_not_up: 0,
    dem_seats_current: houseD,
    rep_seats_current: houseR,
    dem_needs: 218,
    rep_needs: 218,
  },
  {
    chamber: 'Governor',
    total_seats: 50,
    dem_seats_not_up: govD - upBy('Governor', 'D'),
    rep_seats_not_up: govR - upBy('Governor', 'R'),
    dem_seats_current: govD,
    rep_seats_current: govR,
    dem_needs: 26,
    rep_needs: 26,
  },
]

const counts = { Senate: 0, Governor: 0, House: 0 }
for (const r of races) {
  counts[r.office]++
}
console.log('races by office', counts)

writeCurated('races.csv', races, [
  'race_id', 'office', 'state', 'district_number', 'race_name', 'is_special', 'incumbent_party',
  'is_open_seat', 'incumbent_status', 'expert_rating', 'locked_party', 'matchup_note',
  'dem_candidate', 'rep_candidate', 'source',
])
writeCurated('candidates.csv', candidates, ['race_id', 'name', 'party', 'side'])
writeCurated('chambers.csv', chambers)
