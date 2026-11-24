---
name: data-app-page
description: What a public data app built from a brief (a topic, often a story in the news, and any articles on it) should say and how it is laid out - the lead question, the Overview and About pages on the studio's dashboard kit, the articles, sources and caveats, and the checks before hand-over. Use when building or reviewing a data app, and for the rules every data app follows. The kit is in data-app-explorer's reference/app-frame.md; it replaces the frame malloy-html-data-apps describes, and credible-data-apps covers running inside Credible.
---

# Data app page

**Only in a data app's own package** (a root `publisher.json` with no `agents`); anywhere else, do nothing and say so.

The brief is what you were asked to build from: a topic, often a story in the news, and any articles on it. Your
instructions say what the lead question is. A visitor arrives with that
question. In ten seconds the page should answer it with data,
then let them dig one level deeper. A visitor who wants to go further should find it natural to sign in and
ask Credible's agent.

This is the whole app at low effort: an Overview and About the data, built on the studio's dashboard kit
(`data-app-explorer`'s `reference/app-frame.md` for the kit, `reference/dashboard-design.md` for the design). At
high effort it grows into pages a reader moves between: read `data-app-explorer`, which replaces the limits in items
3 and 4 and adds its own checks.

## The page, top to bottom

1. **The masthead.** A plain title naming the subject, a few words under it, and the credit, "Made by" and
   Credible's logo (`credit: true`). The page's lede is the question the brief raises: "How does this year's
   measles count compare with the last five years?"
2. **The answer.** The kit's `subject`: two to four numbers that answer the lead question, each with its unit, its
   period and its comparison, from measures on the app's source. Its sentence is written from the rows.
3. **Three to five sections.** Each answers one of the questions you wrote down while reading the brief, in the order
   a reader would ask them, with a headline written from its rows. Before writing the page, query the model for what
   stands out and choose the sections by what the rows show, as `data-app-explorer`'s "Plan the app" says; drop a
   section whose finding is weak, and name it in the hand-over.
4. **One or two filters**, at most: usually place and the period. Every section responds to them, or its `ignore`
   says which it leaves out and its info mark says so.
5. **In the news**, when the brief is a story: the articles in the config's `articles` and `news()` at the end of the
   page. Headline, outlet and date, each linked; no quoted text beyond the headline.
6. **About the data**, a page of its own (`aboutPage`, `period: false, filters: false`): each dataset in the
   config's `sources` with its publisher, licence and link, the attribution wording `dataset-scout` requires, and
   notes on what was reshaped and what the data cannot tell you: reporting lags, changes in how it was counted,
   places with no data. When a number on the page differs from one the articles quote, say why in one line.
7. **As of.** The kit shows the latest date in the data in the masthead, read from a query.

## Rules

- **Every number comes from a Malloy measure** in the package's model. Never compute a total, rate or change in
  JavaScript; add a measure.
- **The kit draws it.** Its blocks and chart module, never another chart library; its theme, chosen from the
  subject (`reference/dashboard-design.md`), never colours of your own except for a meaning the theme lacks.
- **Every state has an address.** The kit keeps the period, the filters and the page in the address; a visitor can
  share a view, and you can screenshot it.
- **Phone first.** Check every page at 390 px. No `100vh`; Credible sizes the frame to the content.
- **Accessible.** Every chart's finding is also a sentence: the section's headline.
- **Neutral voice.** State what the data shows. No adjectives the data does not support, and no advice.

## Hand-off to the agent

Inside Credible, every section's info mark offers "Ask Credible about this", which opens Credible's chat with a
question about that section and its queries attached (`credible-data-apps` describes the events). A specific
question of your own, under the answer, goes through the kit's `askCredible(prompt, context)`.

## Before hand-over

The page is served in the box at
`http://127.0.0.1:4000/environments/box/packages/<package>/index.html`, and `box-shot` takes the same path
after `packages/`. Never look for the address in the box's configuration files.

1. Load the page in the box's Publisher and confirm every view shows data and the browser console has no
   errors.
2. List the page's states first: each page as it loads, plus the Overview with each filter set and with another period. Then
   screenshot every state at desktop and phone width (`box-shot '<package>/index.html#/?grade=Diesel' …`). Every
   state at both widths, with no exceptions: a shot takes seconds. If the turn runs short, finish the shots in the
   next turn; never hand over with a state unshot.
   `box-shot <package>/index.html --viewport 1280x6000 --full --wait 'body[data-ready="true"]'` and
   `box-shot <package>/index.html --viewport 390x12000 --full --wait 'body[data-ready="true"]'`. The kit sets
   `data-ready` once every section has drawn; a shot without `--wait` can show an empty page that is not broken.
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
