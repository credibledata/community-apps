---
name: data-app-explorer
description: The high-effort data app - an app with views at their own addresses (an overview that answers the brief, an explorer whose cards filter each other, a page per entity, records, compare, about the data), a header with search, labelled d3 charts chosen for what the data shows and that filter on click, in an editorial design with real type, over a model deep enough to carry it. Use when the task asks for effort high. Sources, caveats, the hand-off to Credible's agent and the screenshot rules come from data-app-page.
---

# Data app explorer

**Only in a data app's own package** (a root `publisher.json` with no `agents`); anywhere else, do nothing and say so.

At high effort the brief is the way in, and the app is the product. A visitor lands on the answer to the brief's
question, then uses the app: narrows to a place or a period, clicks a bar to filter everything else, searches for
an entity and opens its page, compares two, reads the rows behind a number. It should feel like a product someone
designed, like the avalanche explorer in this repository (`packages/avalanche`) or the FeederWatch explorer (`packages/feederwatch`), not like an article
with charts. Everything `data-app-page` says about sources, caveats, the hand-off to Credible's agent and
screenshots still holds; its limits of three to five views and one or two filters do not.

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
- **The headline question is a source.** When the question has a scope of its own (passenger cars, one state), it
  is a source that extends the main one with that `where:`, documented as the question's and exported first in
  `index.malloy`. Its `kpis` view is the app's headline, so the Credible agent and an analyst get the same numbers.
- **A date in one place.** Periods come from the scope or the data's latest date; a date the story turns on (a
  policy's end) is written once, in the dimension that splits the periods, and every measure filters on it.
- **A story around a date is compared like for like.** A `vs_year_before` view puts each month beside the same month
  a year earlier (`calculate: x is lag(m, 12)`, months in order), and `like_for_like` sums the matched months in a
  second stage and subtracts in a third. A pull-forward window is a documented dimension, left out of the clean
  comparison. The headline shows the like-for-like change beside the plain one.
- **Thresholds carry their evidence.** A minimum count for a change between groups, a window, a cutoff: each is a
  measure or dimension whose doc gives the evidence and says it is this model's choice. A caveat about what a code
  covers (fuel, class, status) is read from the source's own data dictionary first.
- **One view per card**, grouped by the card's axis and named for what it shows; a `kpis` view with every
  measure the headline numbers show; a `records` view listing the fields a reader would check, newest first.

Query every view and look at the rows before you build on them.

## Plan the app

The brief gives the questions; the data decides what is worth showing. Before writing a page, look for what stands
out, with queries on the model: the biggest movers and the biggest fallers, a break in a trend, a share that
flipped, an entity far from its peers, a group moving against the rest, a season that ran early or late. Check each
against its denominator and its threshold: a fall from five to two is not a finding.

Then write the plan into that turn's `**Progress:**` note, so the person sees it before the build:

- **The lead finding** the Overview opens on: one sentence, its number, the view it comes from.
- **Each Explore card**: the question, the finding the rows show in one line with its number, two or three forms
  that could show it, the one you pick and why it beats the others, and the view that feeds it.
- **The native chart** and why the field draws it that way.
- **Left out**: what you looked at and dropped, and why (too few rows, the same as another card, no change).

Build from the plan. A card whose finding turns out weak, or repeats another, is cut, not padded with a weaker
chart. A finding worth a card that the brief did not ask about goes in, under the question it answers.

**Charts are chosen, not slotted.** Ask what this data could show that is worth seeing, and which chart shows it
plainest; never where a chart goes in the layout. A change across many entities is a slope or a dumbbell, a ranking
with a gap is sorted bars or dots, a share that flipped is shares over time, a break is a line with before and after
marked, a total moved by its parts is a waterfall. The templates and the chart module are where you start, not the
whole choice: when a finding deserves a form they lack, draw it (Mechanics, below).

**A map earns its place.** Being about places is not a reason for a map. Draw one only when the pattern in space is
the finding: neighbours that move together, a gradient across a region, a cluster along a border or a coast. The
plan says what the map shows that a sorted chart of the same places cannot. One map in the app unless the geography
is the story, and never a map beside a ranked table of the same measure.

## The app

Build it in the frame in `reference/app-frame.md`: a header with the app's name, nav and a search box for the
entity; a scope bar; one view at a time at its own address; a footer. Its views:

- **Overview** (`#/`): the brief's question, the answer in a sentence or two, then the lede; headline numbers with
  sparklines from bare views of the headline source, no filter added in the app; the chart the plan chose to show
  the lead finding; the ranked table of the entity when a ranking is part of the answer; two or three cards that
  lead into the app ("Biggest falls: ZIP 10035 →"), and, when the brief has articles, the articles. No scope bar: it shows the brief's own
  comparison.
- **Explore** (`#/explore`): the scope bar, then sections named for what the plan found ("Texas pulls ahead",
  "Clubs take share"), each a grid of cards. Every card with a category or time axis filters the app when clicked,
  and a second click clears it; a card ignores its own key, so it highlights the selection. A click filters in place
  and never opens a page: a page opens from a name drawn as a link. Six to ten cards.
- **An entity's page** (`#/<entity>/<id>`): the entity the domain is about, a zone, a species, a ZIP code or a
  state. Its numbers against the whole, its trend, its chart native to the field, its latest records, "Add to
  compare". Reached from search, every ranked list, the records and the overview.
- **Compare** (`#/compare?ids=a,b`), when the domain has entities people compare: up to four side by side.
- **Records** (`#/records`): the rows in scope, 50 more at a time, each linking to its entity.
- **About the data** (`#/about`): sources and licenses with attribution, what was reshaped, caveats, how to rebuild,
  the date of the latest record.

**One chart form native to the field.** Before drawing, ask what chart the field itself uses, and draw one: a rose
of slope aspect, a calendar heatmap for seasons, an hour-by-weekday grid for calls and complaints, an epidemic
curve, a curve of days until closed. Pick from the data's shape, and say in the hand-over why this form.

**Each finding its own form**, as the plan chose it. Two cards share a form only when they show different kinds of
finding. Label marks directly rather than with legends, keeping a key only where `reference/charts.md` allows one.

**The words carry the method.** The lede of each view and each card's finding are sentences built from the data,
with the entity they name in bold ("**Idaho** grew fastest, +6.1%"). Every card has a method note saying what it
leaves out and why: a threshold, a missing period, rows without a place, "associations, not causes". A reader who
checks a number should find the rule that made it on the same card. **No sentence is typed:** a verdict ("Yes."), a
count of months, a period, a superlative ("the most of any month") comes from the rows, and a claim the rows do not
support is left out; no number goes in a static caption, sub-line or legend, where a refresh would leave it wrong. A
change between small groups shows only where the model's threshold says there is enough, and the card says how many
it left out.

**Credible's viewer shapes the frame.** The app runs in a frame as tall as its content, at most 20,000 px, and the
host page scrolls. So: no drawers, popups or `position: fixed`; nothing that only works when it sticks; each view
under about 5,000 px at desktop width, so a long Explore splits a section into its own view. The frame handles the rest: a new view scrolls the reader to its top.

## Mechanics

- **Every query and the address are built in one module**, `public/scope.js`, from `reference/scope-module.md`. A
  value from the address reaches a query only after it is checked against a list from a distinct-value query.
- **Queries** go through the frame's `query()`: one request per distinct text, at most four in flight, results kept
  for the session, so moving between views is instant the second time.
- **Cards load lazily** and drop a stale answer; each has a loading, an empty and an error state, as the frame's
  `tile()` does, and shows its working: what each query counts (`explain`), the query, its rows and a CSV of them.
  A new scope on the same view draws every card again in place: marks move, numbers count, and the card the reader
  clicked holds still. Keep the frame's `tile()`, `chartBox()` and `paint()` as they are; they do this.
- **Charts:** one d3 chart module, vendored and copied whole, never read, as `reference/charts.md` says; choose each
  chart with its table. Nearly every mark filters the page or opens a page, so pass `onPick` and `selected` to every
  chart that takes them. The ranked table is in `reference/charts.md`; maps and their pinned boundaries in `reference/maps.md`.
  When a finding deserves a form the module does not have, draw it yourself with d3 in a file of its own, to the
  module's bar: marks labelled directly, a tooltip on hover and keyboard focus, `onPick` where it filters, the
  card's working, and a check at phone width.
- **Design:** `reference/design.md`, with the fonts from `reference/fonts.md`. Choose the accent, the categories and
  the ramp from the subject as its "Colour" says, run `reference/palette-check.md` until it passes, and keep each
  colour's meaning the same on every view.

## Work in phases

Each phase is one turn, and each turn ends with a `**Progress:**` note until the last:

1. Read the brief, find, fetch and shape the data. This can take two turns.
2. Build the model as above, query every view, and plan the app (above).
3. The frame, the design, colours and fonts, d3 and the chart module (and the map files when the plan has a map),
   the Overview and Explore.
4. The entity's page, the native chart, Records, Compare if it fits, About the data.
5. Check every state and shoot it, then the README, the community card, and the hand-over.

## States to shoot

Every view: Overview, Explore, one entity's page, Records, Compare if built, About. Then Explore with each scope
control set to one value, Explore after one card is clicked, and one entity's page with a scope. Shoot each at both
widths, as `data-app-page` says, named for the view and state, such as `final-explore-borough-brooklyn-desktop.jpg`
and `final-zip-10035-phone.jpg`. Cards load as they near the screen, so shoot with a viewport taller than the
view (`--viewport 1280x6000` and `--viewport 390x12000`) and `--wait '[data-loaded]'`.

## Before hand-over

On top of the checks in `data-app-page`:

- Every view loads from its address alone, with no console errors.
- `index.html?check=1#/` shows a banner that says the headline check passed: every number the answer and the headline
  card show is a value bare views of the model return, and no placeholder is on the page. Shoot it.
- The fonts load: `[...document.fonts].some((f) => f.family === 'Source Serif 4 Variable' && f.status === 'loaded')`
  is true in the page (`document.fonts.check` is true even when the face is missing), and the shots show the serif
  in ledes and descriptions.
- No label overlaps another or runs off its chart in any shot, at either width.
- Every card has a finding and a method note, and its working opens with a definition for every query.
- `reference/palette-check.md` prints `palette ok`.
- Every scope control changes every card that should respond; a card that ignores a key says so.
- A link opened from low on a view lands at the top of the next view.
- Search finds an entity by part of its name and opens its page; Back returns to where the reader was.
- Clearing every chip returns Explore to how it loads.

Add to your hand-over: the views, the scope keys, the entity, the native chart and why, the accent and categories you
chose and why, any card that ignores a key, each chart's form and the form it beat, and how the app differs from
the plan.
