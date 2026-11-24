# The app frame

The shell every high-effort app is built in: a header with the app's name, its views and a search box; a scope bar;
one view at a time, each at its own address; a footer. Copy the page and the module below to `public/index.html`
and `public/app.js`, keep the frame, and write the views for this app. It uses `scope.js`
(`reference/scope-module.md`), `charts.js` and `charts.css` (the d3 chart module, `reference/charts.md`),
`styles.css` (`reference/design.md`) and `fonts.css` (`reference/fonts.md`); an app that draws a map adds the
boundary files from `reference/maps.md`.

The views are the ones `SKILL.md` lists, and it says why the app is views, not one long page.

## Copy it

The agent's own package is mounted read-only beside the app at `/workspace/siblings/<package>`; the briefing names it.
Its `templates/data-app/` holds the page, the frame and the files every app shares. Copy the page, the frame, the
scope module and the stylesheet once, when you start the app; a file already in `public/` is the app's own and stays:

```sh
T=$(ls -d /workspace/siblings/*/templates/data-app | head -1)
test -d "$T" || { echo "No templates under /workspace/siblings: stop, and say so in the hand-over."; exit 1; }
mkdir -p public && for f in index.html app.js scope.js styles.css; do [ -e public/$f ] || cp "$T/$f" public/; done
chmod -R u+w public
```

Then the chart module, `themes.css` and d3 as `reference/charts.md` says, and `fonts.css` as `reference/fonts.md`
says. Those are shared, not the app's own: copy them again whenever the templates change, as a revisit does.

## What `app.js` holds

Read it once. Everything above `// ---- Views` is the frame; keep it as it is:

- **Queries**: one request per distinct text, at most four in flight, kept for the session.
- **The address**: `go()`, `setScope()`, `toggleScope()`; every view and filter can be shared.
- **Compare**: `picked`, `inCompare()`, `toggleCompare()`, `goCompare()`. The header's Compare link carries the
  picks and counts them, "Compare · 2", so the + on a ranked list shows where it went.
- **`tile()`**: a card that loads as it nears the screen, with loading, empty and error states, a finding, a method
  note and an info mark (ⓘ) in its corner that turns it over to how it is made: what it shows, what it covers, what it leaves out, each query with what it counts (`explain`), its rows and a CSV of them, and, inside Credible, "Ask Credible about this". When the scope changes on the same
  view, every card is drawn again in place: its chart stays, dimmed, until the rows arrive, then marks move and
  numbers count.
- **`chartBox()`**, the scope bar, search.
- **`paint()` and `keepInView()`**: a new scope never takes a card out of the page, and the card the reader clicked
  keeps its place on screen; another view fades in. A part of a view that is not a card but follows the address,
  such as Compare's picks, is marked `data-redraw="<name>"` and swapped in place.
- **`selfCheck()`**: open the app at `?check=1#/` and the page says whether every number in its answer and headline
  card is a value bare views of the model return.

Below it, `boot()` (its lists and the "Data through" line are marked ADAPT) and the views, a sketch to replace with
this app's.

## Make it fast: store the source, roll up what it adds

An app over a managed table is materialized: Credible stores the app's main source as a table and keeps rollups of
the figures it adds up, and each card's info mark says which one answered and how it was built ("a summary
Credible keeps of the data: one row for each state, cause and day, with acres burned and fires already added up,
last built 24 November"). A small file in `data/` needs neither.

```malloy
#(doc) One row per fire, with the fields the app filters by stored beside each one.
#(materialize)
source: fires is community.table('wildfires__fires') extend {
  dimension:
    discovery_date is discovered_at.day            // a day, so a rollup can filter a period on it
  measure:
    #(rollup) grain=["discovery_date", "state", "cause", "size_class"]
    fire_count is count()
    #(rollup) grain=["discovery_date", "state", "cause", "size_class"]
    acres_burned is acres.sum()
    #(rollup) grain=["discovery_date", "state", "cause", "size_class"]
    acres_per_fire is acres_burned / nullif(fire_count, 0)   // a ratio of rolled-up sums rolls up when it says so too
}
```

- **`#(materialize)` on the source** the scope module names (`SOURCE` in `scope.js`).
- **`#(rollup) grain=[…]` on every measure that sums or counts, and on ratios of them.** The grain is the date and
  the scope's fields, the four to seven a reader filters by; leave out one with thousands of values (a ZIP code),
  which makes the rollup nearly as big as the source.
- **No rollup on a distinct count or on a measure that reads a joined column**: Publisher refuses it, and the
  measure is answered from the stored source, which is still fast.
- **A view answers from a rollup when it groups by grain fields and aggregates rolled-up measures**, with the scope
  as a plain `where`. A measure filtered inside the view (`count() { where: … }`) is answered from the stored
  source instead; put the filter in the view's `where`, or give the filtered measure its own `#(rollup)` in the
  model. For anything else, the card's info mark says which table answered.
- **Check it** once published: a card's info mark says "Read from a summary Credible keeps…". Where Credible's
  materialization is not switched on, the annotations are ignored and every card says "Worked out from the raw data
  just now."

## Before you build on it

- Load the app in the box at `#/`, `#/explore`, an entity's address and `#/about`; each shows data, and the console
  has no errors.
- Click a nav link from low on a long view and see the new view open at its top.
- Press the + on a ranked list: the header's Compare link counts it, and opens Compare with it.
- Change a filter on Explore, open an entity, go back: the filter is still set, and the address says so.
