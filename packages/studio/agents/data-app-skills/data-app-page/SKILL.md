---
name: data-app-page
description: What a public data app built from a brief (a topic, often a story in the news, and any articles on it) should say and how it is laid out - the lead question, the views, the articles, sources and caveats, and the checks before hand-over. Use when building or reviewing a data app's page, and for the rules every data app follows. The mechanics of Publisher.query, vendoring and embedding are in malloy-html-data-apps and credible-data-apps.
---

# Data app page

**Only in a data app's own package** (a root `publisher.json` with no `agents`); anywhere else, do nothing and say so.

The brief is what you were asked to build from: a topic, often a story in the news, and any articles on it. Your
instructions say what the lead question is. A visitor arrives with that
question. In ten seconds the page should answer it with data,
then let them dig one level deeper. A visitor who wants to go further should find it natural to sign in and
ask Credible's agent.

This is the whole page at low effort. At high effort, the page below the answer is an explorer: read
`data-app-explorer`, which replaces the limits in items 3 and 4 and adds its own checks.

## The page, top to bottom

1. **Title and lead.** Above the title, the credit: "Made by" and Credible's logo, copied from the header in
   `data-app-explorer`'s `reference/app-frame.md`. A plain title naming the subject, and one sentence stating the question the brief raises. "How does this year's measles count compare with the last five years?"
2. **The answer.** Two to four numbers that answer the lead question, each with its unit, period and a
   comparison: this year against a baseline, or one place against the rest. Each number is one query result, from a
   bare view of the source that carries the question's scope (`data-app-explorer`, "The model comes first"), and
   every sentence about them is written from the rows, never typed.
3. **Three to five views.** Each answers one of the questions you wrote down while reading the brief, in
   the order a reader would ask them. A view's title says what it shows, plainly: "Cases per month, 2019 to
   2026". A title may state a finding only when the number in it comes from the query. Before writing the page,
   query the model for what stands out and choose the views by what the rows show, as `data-app-explorer`'s "Plan
   the app" says; drop a view whose finding is weak, and name it in the hand-over.
4. **One or two filters**, at most: usually place and period. Every view on the page responds to them, or
   the page says which ones do not.
5. **In the news**, when the brief is a story. The example articles: headline, outlet and date, each linked. No quoted text beyond the
   headline.
6. **Sources and caveats.** Each dataset with its publisher, license, link and fetch date, the attribution
   wording `dataset-scout` requires, and a note that the data was reshaped. Then a line or two on what the
   data cannot tell you: reporting lags, changes in how it was counted, places with no data. When a number
   on the page differs from one the articles quote, say why in one line: a different source, survey day or
   benchmark.
7. **As of.** The latest date in the data, read from a query, not typed in.

## Rules

- **Every number comes from a Malloy view or measure** in the package's model. Never compute a total, rate or
  change in JavaScript; add a measure.
- **Few queries at load.** One query per view, run in parallel. Prefer one view that returns the answer
  numbers together over several single-number queries.
- **Charts:** drawn with the d3 chart module, vendored and copied as the `data-app-explorer` skill's
  `reference/charts.md` says. Choose each chart for its finding, as `data-app-explorer`'s "Plan the app" says: a line
  for change over time, bars for comparing places or categories, sorted. A map only when the pattern in space is the
  finding and the boundaries ship with the package. No pie charts with more than three
  slices. Label units on axes. The module reads its colours and type from the `:root` tokens in that skill's
  `reference/design.md`, so start `styles.css` from that block, choose its colours as its "Colour" says and run its
  `reference/palette-check.md`, and write `fonts.css` as its `reference/fonts.md` says, linked before `styles.css`.
- **Every state has an address.** Keep the page's state (a toggle, a tab, a filter) in the URL hash, for example
  `#fuel=diesel&area=states`, and read it on load. A visitor can share a view, and you can screenshot it.
- **Phone first.** One column under 640 px wide, with charts at full width and readable at 390 px. No `100vh`;
  Credible sizes the frame to the content.
- **Accessible.** Text contrast of at least 4.5:1, chart colors that differ in lightness as well as hue, and
  every chart's finding also stated in text.
- **Neutral voice.** State what the data shows. No adjectives the data does not support, and no advice.

## Hand-off to the agent

When the app runs inside Credible, add an "Ask about this" action under the lead and on each view. It sends a
specific question to Credible's agent with the `credible:chat-message` event described in
`credible-data-apps`, such as "Which states had the largest rise in measles cases this year?". This is how a
visitor goes from reading the app to using Credible.

## Before hand-over

The page is served in the box at
`http://127.0.0.1:4000/environments/box/packages/<package>/index.html`, and `box-shot` takes the same path
after `packages/`. Never look for the address in the box's configuration files.

1. Load the page in the box's Publisher and confirm every view shows data and the browser console has no
   errors.
2. List the page's states first: the page as it loads, plus each value of every toggle, tab or filter. Then
   screenshot every state at desktop and phone width (`box-shot '<package>/index.html#fuel=diesel' …`). Every
   state at both widths, with no exceptions: a shot takes seconds. If the turn runs short, finish the shots in the
   next turn; never hand over with a state unshot.
   `box-shot <package>/index.html --viewport 1280x800 --full --wait <selector>` and
   `box-shot <package>/index.html --viewport 390x844 --full --wait <selector>`, where the selector is an
   element the page adds only once its data has drawn. Charts paint before their data arrives, so a shot
   without `--wait` can show an empty page that is not broken.
   The tool prints where each shot is saved, under `.credible/shots/` in the checkout. Open both and look at
   them: empty charts, overflowing labels, text that wraps badly, a lead that falls below the fold on a phone.
   Every image you open must be a JPEG under 600 KB, one per Read: a larger one, or several in one message, passes
   the box's 1 MiB message limit and ends the session. Check the size with `ls -l` first. To look closer at a tall
   shot, cut it into JPEG sections with the script below and open them one at a time; never crop to PNG.

   ```js
   // /tmp/scripts/cut.mjs: node /tmp/scripts/cut.mjs <shot.jpg> <section height px>
   // Writes <shot>-part-<n>.jpg beside it, each a JPEG at quality 70.
   import { createRequire } from 'node:module'
   import { readFileSync } from 'node:fs'
   const { chromium } = createRequire(import.meta.url)('/opt/box-tools/node_modules/playwright-core')
   const [file, step = '1600'] = process.argv.slice(2)
   if (!/\.jpe?g$/i.test(file)) throw new Error('a JPEG shot, please')
   const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--disable-gpu'] })
   const p = await b.newPage()
   await p.setContent(`<style>body{margin:0}</style><img id="i" style="display:block" src="data:image/jpeg;base64,${readFileSync(file).toString('base64')}">`)
   const { w, h } = await p.$eval('#i', (i) => ({ w: i.naturalWidth, h: i.naturalHeight }))
   await p.setViewportSize({ width: w, height: Math.min(h, Number(step)) })
   for (let y = 0, n = 0; y < h; y += Number(step), n++) {
     const out = file.replace(/\.jpe?g$/i, `-part-${n}.jpg`)
     await p.screenshot({ path: out, type: 'jpeg', quality: 70, fullPage: true, clip: { x: 0, y, width: w, height: Math.min(Number(step), h - y) } })
     console.log(out)
   }
   await b.close()
   ```
3. Fix and shoot again until every shot is right. Then copy each final shot to
   `.credible/shots/final-<state>-<desktop|phone>.jpg` (`<state>` is `default` for the page as it loads) and name
   them in your hand-over. Only the `final-` shots are kept.
