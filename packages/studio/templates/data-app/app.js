// A worked example, not a template to fill in: the gasoline prices app, built on the kit. Read it once for the shape
// (the config, then a function per page), then write this app's own: its theme, metrics, filters, entities, sources,
// glossary and pages, all from its own model and brief.
//
// Gasoline prices: what Americans pay at the pump, week by week since 1990, and where it costs most.
// Brief: for anyone filling up before Thanksgiving, and for reporters checking claims of "record" prices. The
// subject is the US regular price; the record claims need it in today's dollars too, so that figure sits beside it.
// Pages: Overview (the US price and where it is highest), Areas (every state and city), an area's page, About.
import { dashboard, subject, rank, trend, heat, table, entityHead, pageHead, aboutPage, blocks, S } from './kit/kit.js'

const PRICES = ['avg_price', 'avg_real_price', 'max_price', 'min_price']
// The twelve years up to the latest in the data, read when a page draws (the data's span is known by then).
const firstYear = () => Number(S.known.span.last.slice(0, 4)) - 11

dashboard({
  title: 'Gasoline prices', sub: 'What a gallon costs, week by week', theme: 'transit',
  model: 'index.malloy', source: 'gas', credit: true, search: 'area',
  date: { field: 'survey_week', label: 'Survey week' },
  recordNoun: 'weekly prices',
  metrics: {
    avg_price: { label: 'Price per gallon', format: 'usd', good: 'down' },
    avg_real_price: { label: 'In today’s dollars', format: 'usd', good: 'down' },
    max_price: { label: 'Highest week', format: 'usd', good: 'down' },
    min_price: { label: 'Lowest week', format: 'usd', good: 'down' },
  },
  filters: [
    { key: 'grade', field: 'grade', label: 'Grade', plural: 'grades' },
    { key: 'formulation', field: 'formulation', label: 'Formulation', plural: 'formulations' },
    { key: 'level', field: 'area_type', label: 'Kind of place', plural: 'kinds of place' },
  ],
  entities: { area: { field: 'area', label: 'Area', plural: 'areas' } },
  defaults: { period: 'last_364', compare: 'year', filters: { grade: ['Regular'], formulation: ['All'], area: ['U.S.'] } },
  sources: {
    eia: { name: 'Weekly Retail Gasoline and Diesel Prices', by: 'US Energy Information Administration', what: 'EIA surveys stations every Monday and publishes the average price for the country, its regions, nine states and ten cities.', license: 'Public domain', url: 'https://www.eia.gov/petroleum/gasdiesel/' },
    bls: { name: 'Consumer Price Index (CPI-U)', by: 'US Bureau of Labor Statistics', what: 'How much prices in general have risen, used to restate old prices in today’s dollars.', license: 'Public domain', url: 'https://www.bls.gov/cpi/' },
  },
  glossary: [
    { term: 'In today’s dollars', match: ['today’s dollars', 'real'], plain: 'A past price restated in today’s money, so a gallon in 2008 can be compared fairly with a gallon now.' },
    { term: 'PADD', match: ['padd', 'region'], plain: 'One of five regions of the US that EIA reports fuel by, first drawn in the Second World War: East Coast, Midwest, Gulf Coast, Rocky Mountain, West Coast.' },
    { term: 'Grade', match: ['grade', 'regular', 'premium', 'midgrade'], plain: 'Regular is the cheapest and most common gasoline; premium has the highest octane and costs most. Diesel is listed with them.' },
  ],
  articles: [],   // the brief's articles, when it is a story: { title, outlet, date: 'YYYY-MM-DD', url }
  pages: [
    { id: 'overview', title: 'Overview', render: overview },
    { id: 'areas', title: 'Areas', lists: 'area', render: areas },
    { id: 'about', title: 'About the data', period: false, filters: false, render: about },
    { id: 'area', title: 'Area', entity: 'area', render: area },
  ],
  footer: 'An independent app, not produced by EIA or BLS.',
})

function overview() {
  return blocks(
    subject({ metrics: PRICES }),
    rank({ entity: 'area', metric: 'avg_price', top: 9, where: "area_type = 'State'", kicker: 'Price per gallon by state', what: 'The nine states EIA reports, by their average price in the period, with the same weeks a year earlier as the pale bar.' }),
    rank({ entity: 'area', metric: 'avg_price', top: 10, where: "area_type = 'City'", kicker: 'Price per gallon by city', what: 'The ten cities EIA reports, by their average price in the period.' }),
    trend({ metric: 'avg_price', by: 'grade', top: 5, kicker: 'Price per gallon by grade', what: 'Each grade’s average price over the period, one line each; diesel is listed with them.' }),
    heat({ rows: { expr: 'survey_year', label: 'Year', count: 12 }, cols: { expr: 'week_of_year', label: 'Week of the year', name: (w) => `week ${w}` }, metric: 'avg_price', period: false, where: `survey_year >= ${firstYear()}`, kicker: 'Every week of the last twelve years · darker is dearer', what: 'The average price in each week of each year, so a summer peak or an autumn fall shows as a band across the years.' }),
  )
}

function areas() {
  return [
    pageHead('Areas', 'The country, its five regions, nine states and ten cities, each on the same measures.'),
    blocks(
      rank({ entity: 'area', metric: 'avg_price', top: 30, extra: ['max_price'], span: 12, kicker: 'Every area by price per gallon' }),
      table({ kicker: 'Every area', open: { entity: 'area', key: 'area' }, sort: { key: 'avg_price', desc: true },
        query: (s) => S.run('{ group_by: area, kind is area_type; aggregate: avg_price, avg_real_price, max_price, min_price; order_by: avg_price desc; limit: 100 }', s, { ignore: ['area'] }),
        columns: [{ key: 'area', label: 'Area' }, { key: 'kind', label: 'Kind of place' }, { key: 'avg_price', metric: 'avg_price', bar: true }, { key: 'avg_real_price', metric: 'avg_real_price' }, { key: 'max_price', metric: 'max_price' }, { key: 'min_price', metric: 'min_price' }] }),
    ),
  ]
}

function area() {
  return [
    entityHead({ metric: 'avg_price' }),
    blocks(
      subject({ metrics: PRICES }),
      trend({ metric: 'avg_price', by: 'grade', top: 5, kicker: 'Its price per gallon by grade' }),
    ),
  ]
}

function about() {
  return aboutPage({
    lede: 'Where every number on these pages comes from, and what was done to it.',
    notes: [
      { title: 'What was reshaped', text: 'EIA publishes one column per price series; the app stores one row per series and week. Old prices are restated in today’s dollars with the BLS index for their month.' },
      { title: 'What is left out', text: 'Weeks a series did not report are absent rather than zero. October 2025 has no inflation index, so its weeks have no price in today’s dollars.' },
    ],
  })
}
