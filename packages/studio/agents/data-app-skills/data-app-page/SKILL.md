---
name: data-app-page
description: What a public data app built from a brief (a topic, often a story in the news, and any articles on it) should say and how it is laid out - the first screen and its headline, the views, the articles, sources and caveats, and the checks before hand-over. Use when building or reviewing a data app's page, and for the rules every data app follows. The mechanics of Publisher.query, vendoring and embedding are in malloy-html-data-apps and credible-data-apps.
---

# Data app page

**Only in a data app's own package** (a root `publisher.json` with no `agents`); anywhere else, do nothing and say so.

The brief is what you were asked to build from: a topic, often a story in the news, and any articles on it. Your
instructions say what the lead question is. Most visitors arrive from a post on LinkedIn or X, knowing nothing but
the post. In five seconds, without scrolling, the page should give them its strongest finding with data, then let
them find their own place in it and dig one level deeper. A visitor who wants to go further should find it natural to sign in and
ask Credible's agent.

Every app is an explorer below its first screen: `data-app-explorer` sets its views, filters and checks. This
skill holds what the page says and the rules every app follows.

## The page, top to bottom

1. **The first screen.** What a visitor sees before scrolling, on a phone (390 x 844) as on a desktop (1280 x 800):
   - The credit, "Made by" and Credible's logo, and the app's plain name, in the header copied from
     `data-app-explorer`'s `reference/app-frame.md`.
   - **The headline**: the strongest true finding in the data, one sentence with its number and what it is compared
     with. "Thanksgiving gas ranks 11th of the last 37 years, in today's dollars", not "Gas prices at Thanksgiving".
     When the brief names a claim in circulation, the headline says whether the data bears it out. It is written
     from the rows of a view, like every sentence, with each number in bold, and chosen as `data-app-explorer`'s
     "Plan the app" says.
   - **One line under it**: what the data is and how recent, in plain words, then what changed in its latest period
     against the one before ("Week ending Nov 22: 412 more admissions than the week before"), from a view.
   - **The lead chart**: one chart that shows the headline, short enough that all of this fits.
   - **The find box**, labelled the way a reader names their own place or thing ("Find your state", "Find your
     employer"), that opens its page. Every app with an entity has one;
     when the brief names a lookup, it is the entity.

   The template's `overview()` lays this out, and its headline check measures it.
2. **The answer.** Below the first screen, two to four numbers that answer the lead question, each with its unit, period and a
   comparison: this year against a baseline, or one place against the rest. Each number is one query result, from a
   bare view of the source that carries the question's scope (`data-app-explorer`, "The model comes first"), and
   every sentence about them is written from the rows, never typed.
3. **The views**, as `data-app-explorer` lays them out. A view's title says what it shows, plainly: "Cases per
   month, 2019 to 2026". A title may state a finding only when the number in it comes from the query.
4. **In the news**, when the brief is a story. The example articles: headline, outlet and date, each linked. No quoted text beyond the
   headline.
5. **Sources and caveats.** Each dataset with its publisher, license, link and fetch date, the attribution
   wording `dataset-scout` requires, and a note that the data was reshaped. Then a line or two on what the
   data cannot tell you: reporting lags, changes in how it was counted, places with no data. When a number
   on the page differs from one the articles quote, say why in one line: a different source, survey day or
   benchmark.
6. **As of.** The latest date in the data, read from a query, not typed in.

## Rules

- **Every number comes from a Malloy view or measure** in the package's model. Never compute a total, rate or
  change in JavaScript; add a measure.
- **Few queries at load.** One query per view, run in parallel. Prefer one view that returns the answer
  numbers together over several single-number queries.
- **Charts:** drawn with the d3 chart module, vendored and copied as the `data-app-explorer` skill's
  `reference/charts.md` says. Choose each chart for its finding, as `data-app-explorer`'s "Plan the app" says: a line
  for change over time, bars for comparing places or categories, sorted. A map only when the pattern in space is the
  finding and the boundaries ship with the package. No pie charts with more than three
  slices. Label units on axes. The module reads its colours and type from the page's tokens, so copy `styles.css` and `themes.css` from
  the templates as that skill's `reference/app-frame.md` says, link `themes.css` before `styles.css`, choose a theme on
  `<html>` as its `reference/design.md` "Colour" says, and pin it light with `data-mode="light"` unless the page
  carries the frame's theme and mode block, which redraws its charts when the mode changes, and write `fonts.css` as its `reference/fonts.md` says, linked before `styles.css`.
- **Every state has an address.** Keep the page's state (a toggle, a tab, a filter) in the URL hash, for example
  `#fuel=diesel&area=states`, and read it on load. A visitor can share a view, and you can screenshot it.
- **Phone first.** One column under 640 px wide, with charts at full width and readable at 390 px. No `100vh`;
  Credible sizes the frame to the content.
- **Accessible.** Text contrast of at least 4.5:1, chart colors that differ in lightness as well as hue, and
  every chart's finding also stated in text.
- **Plain, sharp voice.** Lead with the most striking thing the data shows, in the fewest words. No adjective the
  data does not support, and no advice. A claim from the brief or its articles is attributed ("Reports said gas was
  near a record"), never stated as the app's own.

## Hand-off to the agent

When the app runs inside Credible, add an "Ask about this" action under the headline and on each view. An app built on
the frame's cards (`data-app-explorer`) also has "Ask Credible about this" on every card's info mark. It sends a
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
   them: empty charts, overflowing labels, text that wraps badly, a first screen that does not fit on a phone.
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
3. Shoot the first screen too, without `--full` and without `?check=1`, with `--wait`: `--viewport 390x844` and
   `--viewport 1280x800`, kept as `final-first-phone.jpg` and `final-first-desktop.jpg`, the shot a post attaches.
4. Fix and shoot again until every shot is right. Then copy each final shot to
   `.credible/shots/final-<state>-<desktop|phone>.jpg` (`<state>` is `default` for the page as it loads) and name
   them in your hand-over. Only the `final-` shots are kept.
