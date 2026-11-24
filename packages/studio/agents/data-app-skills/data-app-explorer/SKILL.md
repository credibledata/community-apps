---
name: data-app-explorer
description: The high-effort data app, built on the studio's dashboard kit - pages a reader moves between (an Overview that answers the brief, a page per area, a page per entity, About the data), every chart clickable and every section explaining itself, in a theme chosen from the subject, over a model deep enough to carry it and stored by Credible so it opens fast. Use when the task asks for effort high. Sources, caveats, the hand-off to Credible's agent and the screenshot rules come from data-app-page.
---

# Data app explorer

**Only in a data app's own package** (a root `publisher.json` with no `agents`); anywhere else, do nothing and say so.

At high effort the brief is the way in, and the app is the product. A visitor lands on the answer to the brief's
question, then uses the app: changes the period, filters to a place, clicks a bar to open that entity's page,
searches for one by name, turns a section over to see how it is made, reads the rows behind a number. It should feel
like a product someone designed, not like an article with charts. The kit (`reference/app-frame.md`) draws all of
that to one design (`reference/dashboard-design.md`); the app is the config, the pages and the findings.
Everything `data-app-page` says about sources, caveats, the hand-off to Credible's agent and
screenshots still holds; its limit of one page and one or two filters does not.

## The model comes first

An app is only as deep as its model. Before writing the app:

- **Record grain.** The main source is one row per record, as `data-fetch` stores it, with a `primary_key` when
  the data has one. Lookup files are joined and decoded into readable dimensions.
- **Every field documented.** A `#(doc)` on each dimension and measure: what it means, its unit, and where it
  comes from. `#(index)` on the dimensions a reader would search by name.
- **Quirks become fields.** Sentinels become null. "Unknown" and "Unspecified" stay as their own value, and
  rates leave them out of the denominator. A domain's own calendar, size classes or codes become dimensions.
  Each quirk's doc says what was done and why.
- **Correct denominators.** Every rate is a measure whose doc names its numerator and denominator. Subsets are
  filtered measures (`count() { where: ... }`), never arithmetic in JavaScript. When the publisher defines a
  headline measure, define it the same way and say so in its doc.
- **The app's source is one source at record grain**, with the dimensions the app filters, ranks and splits by as
  its own fields and a day dimension for its date (`reference/app-frame.md`, "The model the kit needs"), exported
  from `index.malloy`. When the brief's question has a scope of its own (passenger cars, one state), say so in its
  doc and start the app filtered to it with `defaults.filters`, so a reader can widen it.
- **A date in one place.** Periods count back from the data's latest date; a date the story turns on (a policy's
  end) is written once, in the dimension that splits the periods, and every measure filters on it.
- **A story around a date is compared like for like.** A `vs_year_before` view puts each month beside the same month
  a year earlier (`calculate: x is lag(m, 12)`, months in order), and `like_for_like` sums the matched months in a
  second stage and subtracts in a third. A pull-forward window is a documented dimension, left out of the clean
  comparison. The headline shows the like-for-like change beside the plain one.
- **Thresholds carry their evidence.** A minimum count for a change between groups, a window, a cutoff: each is a
  measure or dimension whose doc gives the evidence and says it is this model's choice. A caveat about what a code
  covers (fuel, class, status) is read from the source's own data dictionary first.
- **A measure for every number on a page**, named for what it counts, so the kit can filter it to any period and
  place; a `kpis` view with the measures the subject shows, so the Credible agent and an analyst get the same
  numbers; views for what a block of your own needs.

Query every measure by each dimension the app splits it by, and look at the rows before you build on them.

## Plan the app

The brief gives the questions; the data decides what is worth showing. Before writing a page, look for what stands
out, with queries on the model: the biggest movers and the biggest fallers, a break in a trend, a share that
flipped, an entity far from its peers, a group moving against the rest, a season that ran early or late. Check each
against its denominator and its threshold: a fall from five to two is not a finding.

Then write the plan into that turn's `**Progress:**` note, so the person sees it before the build:

- **The lead finding** the Overview opens on: one sentence, its number, the view it comes from.
- **The pages and the paths**: each page, what leads it, its sections in order, and which page a click on each list
  opens (`reference/dashboard-design.md`, "Pages, and the paths between them"). The theme, from the subject.
- **Each section**: the question, the finding the rows show in one line with its number, two or three forms that
  could show it, the one you pick (a kit block, or a chart of your own) and why it beats the others.
- **The native form** and why the field draws it that way.
- **Left out**: what you looked at and dropped, and why (too few rows, the same as another card, no change).

Build from the plan. A section whose finding turns out weak, or repeats another, is cut, not padded with a weaker
chart. A finding worth a section that the brief did not ask about goes in, under the question it answers.

**Charts are chosen, not slotted.** Ask what this data could show that is worth seeing, and which chart shows it
plainest; never where a chart goes in the layout. A change across many entities is a slope or a dumbbell, a ranking
with a gap is sorted bars or dots, a share that flipped is shares over time, a break is a line with before and after
marked, a total moved by its parts is a waterfall. The kit's blocks and its chart module are where you start, not the
whole choice: when a finding deserves a form they lack, draw it as a block of your own (`reference/app-frame.md`).

**A map earns its place.** Being about places is not a reason for a map. Draw one only when the pattern in space is
the finding: neighbours that move together, a gradient across a region, a cluster along a border or a coast. The
plan says what the map shows that a sorted chart of the same places cannot. One map in the app unless the geography
is the story, and never a map beside a ranked table of the same measure.

## The app

Build it on the kit, as `reference/app-frame.md` says, with `credit: true` (it is published by Credible), the brief's
articles in `articles`, and every dataset in `sources`. Its pages:

- **Overview** (`#/`): the brief's question as the page's lede, the subject (the numbers that answer it, from bare
  views of the question's source), then four to six sections of evidence in the order a reader asks, the native
  form among them, and `news()` at the end when the brief has articles.
- **A page per area a reader works in** (`lists: '<entity>'`): every entity of that kind ranked, the sections that
  compare them, and a `table` of the rows. Two such pages at most; most apps have one.
- **A page per entity** (`entity: '<key>'`): the zone, species, ZIP code or state the domain is about. `entityHead`,
  its subject against the whole, its own parts, its rows. Reached from every list of it and from search
  (`search: '<key>'` when a reader would look one up by name).
- **About the data** (`aboutPage`, with `period: false, filters: false`): the sources with their licences, what was
  reshaped, what is left out, caveats, how to rebuild it.

**One form native to the field**, as a block of your own: a rose of slope aspect, a calendar of seasons, an
hour-by-weekday grid for calls, an epidemic curve, a curve of days until closed. Say in the hand-over why this form.

**The words carry the method.** Each section's headline is written by code from its rows, with the entity it names
in bold; the kit writes a standard one, and you write your own where the domain says what matters ("Two zones are
past the line"). Each section's `what` says what it shows and what it leaves out: a threshold, a missing period, rows
without a place, "associations, not causes". **No sentence is typed:** a verdict, a count, a period, a superlative
comes from the rows, and a claim the rows do not support is left out; no number goes in a static caption.

**Credible's viewer shapes the frame.** The app runs in a frame as tall as its content, at most 20,000 px, and the
host page scrolls: no drawers, popups or `position: fixed`, and each page under about 5,000 px at desktop width. The
kit already follows this.

**Fast because Credible stores it.** The app's source is a managed table, so it is materialized with rollups, as
`reference/app-frame.md` "Make it fast" says, and each section's info mark then says which table answered. Persist
only a source over a managed table; a source over a file in `data/` is never materialized.

## Work in phases

Each phase is one turn, and each turn ends with a `**Progress:**` note until the last:

1. Read the brief, find, fetch and shape the data. This can take two turns.
2. Build the model as above, materialize it, query every view, and plan the app (above).
3. Copy the kit, write the config and the Overview.
4. The area and entity pages, the native form, About the data.
5. Check every page and shoot it, then the README, the community card, and the hand-over.

## States to shoot

Every page: the Overview, each area page, one entity's page, About. Then the Overview with one filter set, the
Overview with another period, and one entity's page with a filter. Shoot each at both widths, as `data-app-page`
says, named for the page and state, such as `final-areas-desktop.jpg` and `final-zone-front-range-phone.jpg`. Blocks
load as they near the screen, so shoot with a viewport taller than the page (`--viewport 1280x6000` and
`--viewport 390x12000`) and `--wait 'body[data-ready="true"]'`.

## Before hand-over

On top of the checks in `data-app-page`:

- Every page loads from its address alone, with no console errors.
- `index.html?check=1#/` shows a banner that says the check passed: no section failed and no placeholder is on the
  page. Shoot it.
- No label overlaps another or runs off its chart in any shot, at either width.
- Every section has a headline from its rows and a `what`; every metric has a `#(doc)` in the model or a `doc`.
- Every page reads well with `?mode=dark` too.
- Every list opens its entity's page, every line zooms the period, and the native form does something when clicked.
- Search finds an entity by part of its name and opens its page; Back returns to where the reader was.
- A section's info mark says where the answer came from; once the app is published, a ranked list's says a summary.

Add to your hand-over: the pages and the paths between them, the theme and why, the native form and why, each
section's form and the form it beat, and how the app differs from the plan.
