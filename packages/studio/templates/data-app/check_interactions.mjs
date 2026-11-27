#!/usr/bin/env node
// Check that a data app's charts act when a reader uses them, the way a reader would: on every view in the app's
// nav, every chart has something to click and a tooltip on hover; clicking a mark changes the address and redraws
// the other cards (or opens a page), and clicking it again clears it; every scope control redraws cards; a link to an
// entity opens its page; and the page follows the reader's light or dark mode. Works on apps built from the community
// template and from Publisher's data app kit.
//
//   node check_interactions.mjs <package>/<path under public/ | http(s)://...> [--viewport 1280x900] [--views a,b]
//
// In the agent's box it finds the Publisher and the browser as box-shot does. Elsewhere, point PLAYWRIGHT_CORE at a
// playwright-core install and CHROMIUM at a Chromium. Prints each finding and exits 1 when there are any: fix each,
// or name it in the hand-over with its reason (a card that is meant to ignore a filter says so in its method note).
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || '/opt/box-tools/node_modules/playwright-core')
const usage = () => {
  console.error('usage: check_interactions.mjs <package/path | http(s)://...> [--viewport 1280x900] [--views explore,overview]')
  process.exit(2)
}
const [target, ...rest] = process.argv.slice(2)
if (!target) usage()
let viewport = '1280x900'
let only = null
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--viewport' && rest[i + 1]) viewport = rest[++i]
  else if (rest[i] === '--views' && rest[i + 1]) only = rest[++i].split(',')
  else usage()
}
const host = process.env.PUBLISHER_HOST || '127.0.0.1'
const port = process.env.PUBLISHER_PORT || '4000'
// A value inside a quoted attribute selector: backslashes first, then quotes.
const attr = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const base = (/^https?:\/\//.test(target) ? target : `http://${host}:${port}/environments/box/packages/${target.replace(/^\//, '')}`).split('#')[0]
const [width, height] = viewport.split('x').map(Number)

const CARDS = 'article.card, article.block'
const MARKS = 'svg [role="button"]'
const TIP = '[role="status"].tip, .fx-tip'
const findings = []
const notes = []
const errors = []
const find = (view, card, what) => findings.push(`${view} | ${card} | ${what}`)

// Every card's own view of itself: what it shows and how its marks stand, so a redraw is seen.
const signatures = (page) =>
  page.evaluate((sel) => [...document.querySelectorAll(sel)].map((c) => {
    const pressed = [...c.querySelectorAll('[aria-pressed="true"]')].map((n) => n.getAttribute('aria-label')).join('|')
    const marks = [...c.querySelectorAll('svg *')].length
    return (c.innerText || '').slice(0, 4000) + `#${marks}#${pressed}`
  }), CARDS)
const names = (page) =>
  page.evaluate((sel) => [...document.querySelectorAll(sel)].map((c, i) =>
    ([...c.querySelectorAll('.card__title, .kicker, h2, h3')].map((e) => e.textContent.trim()).find(Boolean) || c.dataset.key || `card ${i + 1}`).slice(0, 70)), CARDS)
const route = (page) => page.evaluate(() => location.hash)

// A point on a mark a reader would aim at: on a path, a point on its stroke (the middle of a curve's box is often
// empty); otherwise the centre of the shape. The mark is scrolled to the middle of the screen first.
function pointOn(el) {
  const shape = el.tagName.toLowerCase() === 'g' ? el.querySelector('circle, rect, path') || el : el
  shape.scrollIntoView({ block: 'center' })
  if (shape.tagName.toLowerCase() === 'path' && shape.getTotalLength && shape.getScreenCTM()) {
    const len = shape.getTotalLength()
    const pt = shape.getPointAtLength(len / 2).matrixTransform(shape.getScreenCTM())
    return { x: pt.x, y: pt.y }
  }
  const r = shape.getBoundingClientRect()
  return r.width + r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
}

// Wait until every card has drawn: scroll through so lazy cards load, then wait for the redraws to stop.
async function settle(page, { scroll = false } = {}) {
  if (scroll) {
    const h = await page.evaluate(() => document.body.scrollHeight)
    for (let y = 0; y < h; y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y)
      await page.waitForTimeout(120)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
  }
  const deadline = Date.now() + 20000
  let last = ''
  while (Date.now() < deadline) {
    await page.waitForTimeout(400)
    const state = await page.evaluate((sel) => {
      const cards = [...document.querySelectorAll(sel)]
      const busy = cards.filter((c) => c.classList.contains('is-updating') || c.querySelector('.state--loading, [data-pending]')).length
      return `${cards.length}:${busy}:${document.body.innerText.length}`
    }, CARDS)
    if (state === last && state.split(':')[1] === '0') return
    last = state
  }
}

const views = async (page) =>
  page.evaluate(() => [...new Set([...document.querySelectorAll('nav a[href^="#"], header a[href^="#"]')]
    .map((a) => a.getAttribute('href').replace(/^#\/?/, '').split('?')[0])
    .filter((v) => !/^about/.test(v)))])

async function open(page, view) {
  await page.goto(`${base}#/${view}`, { waitUntil: 'load' })
  await page.waitForSelector(CARDS, { timeout: 30000 }).catch(() => {})
  await settle(page, { scroll: true })
}

async function checkView(page, view) {
  await open(page, view)
  const label = view || 'overview'
  const cardNames = await names(page)
  if (!cardNames.length) return only ? find(label, 'view', 'no cards after 30 s') : notes.push(`${label}: no cards`)
  // A view with scope controls is one a reader filters: there, a chart that takes no click or drag is a finding.
  const filterable = (await page.locator('select:visible').count()) > 0
  let clickable = 0
  for (let i = 0; i < cardNames.length; i++) {
    const card = () => page.locator(CARDS).nth(i)
    // A chart, not a sparkline or an icon: an svg drawing more than a handful of shapes.
    const charted = await card().evaluate((c) => [...c.querySelectorAll('svg')].some((s) => s.querySelectorAll('rect, circle, path, line').length > 8 && s.getBoundingClientRect().height > 80))
    if (!charted) continue
    await card().scrollIntoViewIfNeeded()
    const n = await card().locator(MARKS).count()
    const brush = card().locator('svg .overlay').first()
    const hasBrush = (await brush.count()) > 0
    const rows = await card().locator('a[href^="#/"], tr[data-id], [data-link]').count()
    if (!n && !hasBrush) {
      if (rows) notes.push(`${label} | ${cardNames[i]} | rows open pages`)
      else if (filterable) find(label, cardNames[i], 'a chart with nothing to click or drag')
      else notes.push(`${label} | ${cardNames[i]} | a chart with nothing to click or drag (no scope bar on this view)`)
      continue
    }
    clickable++
    // The tooltip: hover a drawn shape of the first mark, or the middle of a brushable chart.
    // The tooltip: hover a drawn shape of the first mark, or the middle of a brushable chart. The page can still shift
    // as cards above settle, so each try finds the shape again and checks the pointer is over this card.
    const locate = () => card().evaluate((c, [sel, fn]) => {
      const mark = c.querySelector(sel) || c.querySelector('svg .overlay')
      return mark ? new Function(`return (${fn})`)()(mark) : null
    }, [MARKS, pointOn.toString()])
    const tipShown = () => page.locator(TIP).filter({ hasText: /\S/ }).first().isVisible().catch(() => false)
    let tip = false
    let spot = null
    for (let k = 0; !tip && k < 4; k++) {
      spot = await locate()
      if (!spot) break
      await page.waitForTimeout(150)
      const over = await card().evaluate((c, at) => c.contains(document.elementFromPoint(at.x, at.y)), spot)
      if (!over) continue
      await page.mouse.move(spot.x + 2 * k, spot.y + k, { steps: 3 })
      await page.waitForTimeout(350)
      tip = await tipShown()
    }
    if (!tip) find(label, cardNames[i], 'no tooltip on hover')
    await page.mouse.move(0, 0)

    const before = await signatures(page)
    const hash = await route(page)
    let what
    let pickLabel = null
    let toggles = true
    if (n) {
      // The click: a mark not already chosen.
      const pick = card().locator(`${MARKS}:not([aria-pressed="true"])`).first()
      pickLabel = await pick.getAttribute('aria-label')
      const at = await pick.evaluate((el, fn) => new Function(`return (${fn})`)()(el), pointOn.toString())
      // Only a mark that is on or off (aria-pressed) is expected to clear on a second click; a click that zooms to a
      // period is undone from the period control instead.
      toggles = (await pick.getAttribute('aria-pressed')) !== null
      what = `clicking ${pickLabel || 'a mark'}`
      if (at) await page.mouse.click(at.x, at.y)
      else await pick.click({ force: true })
    } else {
      // The drag: across the middle third of the chart.
      const box = await brush.boundingBox()
      what = 'dragging across the chart'
      await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + (2 * box.width) / 3, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
    }
    await page.waitForTimeout(300)
    await settle(page)
    const after = await route(page)
    const nowView = after.replace(/^#\/?/, '').split('?')[0]
    if (nowView !== view && after !== hash) {
      notes.push(`${label} | ${cardNames[i]} | ${what} opens ${nowView || 'the overview'}`)
      await open(page, view)
      continue
    }
    const sigs = await signatures(page)
    const others = before.filter((s, k) => k !== i && sigs[k] !== undefined && sigs[k] !== s).length
    if (after === hash && others === 0) {
      find(label, cardNames[i], `${what} did nothing`)
      continue
    }
    if (others === 0) find(label, cardNames[i], `${what} changed the address but redrew no other card`)
    else notes.push(`${label} | ${cardNames[i]} | ${what} redrew ${others} of ${before.length - 1} other cards`)
    // Doing it again clears it: the same mark clicked again, or a click on the chart outside the dragged span.
    if (!toggles) {
      await open(page, view)
      continue
    }
    if (pickLabel) {
      const again = card().locator(`[role="button"][aria-label="${attr(pickLabel)}"]`).first()
      if (await again.count()) {
        const at2 = await again.evaluate((el, fn) => new Function(`return (${fn})`)()(el), pointOn.toString())
        if (at2) await page.mouse.click(at2.x, at2.y)
        else await again.click({ force: true })
      }
    } else if (!n) {
      const box = await card().locator('svg .overlay').first().boundingBox()
      if (box) await page.mouse.click(box.x + box.width * 0.95, box.y + box.height / 2)
    }
    await page.waitForTimeout(300)
    await settle(page)
    if ((await route(page)) !== hash) {
      find(label, cardNames[i], `${n ? `clicking ${pickLabel || 'the mark'}` : 'clicking outside the dragged span'} again does not clear it`)
      await open(page, view)
    }
  }
  if (!clickable) notes.push(`${label}: no chart takes a click or a drag`)

  // Every scope control outside the cards redraws some card.
  const controls = await page.locator('select:visible').evaluateAll((els, sel) => els.map((e, k) => (e.closest(sel) ? -1 : k)).filter((k) => k >= 0), CARDS)
  for (const k of controls) {
    const sel = page.locator('select:visible').nth(k)
    const options = await sel.locator('option').count()
    if (options < 2) continue
    const nameOf = (await sel.getAttribute('aria-label')) || (await sel.evaluate((e) => e.labels?.[0]?.textContent || e.name || 'a control'))
    const before = await signatures(page)
    await sel.selectOption({ index: 1 })
    await page.waitForTimeout(300)
    await settle(page)
    const changed = (await signatures(page)).filter((s, j) => before[j] !== undefined && before[j] !== s).length
    if (!changed) find(label, `control "${nameOf.trim()}"`, 'choosing a value redrew no card')
    else notes.push(`${label} | control "${nameOf.trim()}" | redrew ${changed} of ${before.length} cards`)
    await open(page, view)
  }

  // A link to an entity opens its page, with cards that load.
  const href = await page.evaluate((sel) => document.querySelector(`${sel.split(', ').map((s) => `${s} a[href^="#/"]`).join(', ')}`)?.getAttribute('href') || null, CARDS)
  if (href) {
    await page.locator(`a[href="${attr(href)}"]`).first().click()
    await page.waitForTimeout(300)
    await settle(page, { scroll: true })
    const cards = await page.locator(CARDS).count()
    if (!(await route(page)).startsWith(href.split('?')[0]) || !cards) find(label, `link ${href}`, 'did not open a page with cards')
    else notes.push(`${label} | link ${href} | opened, ${cards} cards`)
  }
}

// The page follows the reader's light or dark mode: opened in a light system and in a dark one, its colour differs.
async function checkMode() {
  const colour = async (scheme) => {
    const p = await browser.newPage({ viewport: { width, height }, colorScheme: scheme })
    try {
      await p.goto(base, { waitUntil: 'load' })
      await p.waitForTimeout(1500)
      return await p.evaluate(() => {
        const bg = (el) => getComputedStyle(el).backgroundColor
        return bg(document.body) === 'rgba(0, 0, 0, 0)' ? bg(document.documentElement) : bg(document.body)
      })
    } finally {
      await p.close()
    }
  }
  const light = await colour('light')
  const dark = await colour('dark')
  if (light === dark) find('page', 'light and dark', `the page is ${light} in both a light and a dark system: it does not follow the reader's mode`)
  else notes.push(`page | light and dark | follows the reader's mode (${light}, ${dark})`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--disable-gpu'] })
try {
  await checkMode()
  const page = await browser.newPage({ viewport: { width, height } })
  page.setDefaultTimeout(15000)
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 200)))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`.slice(0, 200)))
  await page.goto(base, { waitUntil: 'load' })
  // A first view with no cards is a broken app, unless --views names the views to check (a guess's deck has none);
  // then an error while the first view loads is the finding.
  if (!only) await page.waitForSelector(CARDS, { timeout: 30000 }).catch(() => find('page', 'first view', 'no cards after 30 s: the app drew nothing (a first view with no cards, such as a guess\'s deck, is checked with --views and the views that have cards)'))
  else {
    await page.waitForTimeout(3000)
    if (errors.length) find('page', 'first view', `an error while it loads: ${errors[0]}`)
  }
  const list = only || (await views(page))
  for (const view of list.length ? list : ['']) await checkView(page, view)
} finally {
  await browser.close()
}

for (const n of notes) console.log(`ok   ${n}`)
for (const e of [...new Set(errors)].slice(0, 10)) console.log(`err  ${e}`)
for (const f of findings) console.log(`FIND ${f}`)
console.log(findings.length ? `\n${findings.length} finding(s): fix each, or name it in the hand-over with its reason.` : '\nNo findings.')
process.exit(findings.length ? 1 : 0)
