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

Then the chart module and d3 as `reference/charts.md` says, and `fonts.css` as `reference/fonts.md` says.

## What `app.js` holds

Read it once. Everything above `// ---- Views` is the frame; keep it as it is:

- **Queries**: one request per distinct text, at most four in flight, kept for the session.
- **The address**: `go()`, `setScope()`, `toggleScope()`; every view and filter can be shared.
- **`tile()`**: a card that loads as it nears the screen, with loading, empty and error states, a finding, a method
  note and its working (each query, what it counts, its rows and a CSV of them). When the scope changes on the same
  view, every card is drawn again in place: its chart stays, dimmed, until the rows arrive, then marks move and
  numbers count.
- **`chartBox()`**, the scope bar, search.
- **`paint()` and `keepInView()`**: a new scope never takes a card out of the page, and the card the reader clicked
  keeps its place on screen; another view fades in.
- **`selfCheck()`**: open the app at `?check=1#/` and the page says whether every number in its answer and headline
  card is a value bare views of the model return.

Below it, `boot()` (its lists and the "Data through" line are marked ADAPT) and the views, a sketch to replace with
this app's.

## Before you build on it

- Load the app in the box at `#/`, `#/explore`, an entity's address and `#/about`; each shows data, and the console
  has no errors.
- Click a nav link from low on a long view and see the new view open at its top.
- Change a filter on Explore, open an entity, go back: the filter is still set, and the address says so.
