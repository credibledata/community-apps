# Credible community apps

Data apps built with Malloy and Credible from public data. Each one is a Malloy semantic model, the data it
reads, and an HTML app in the package's `public/` directory, served by Publisher.

| App | What it answers | Where |
|---|---|---|
| 2026 Midterms Simulation Explorer | A Monte Carlo simulation of the 2026 Senate, House and governor races with adjustable assumptions, and an election-night page comparing the count with the forecast | [`packages/midterms2026`](packages/midterms2026) |
| The 2026 Wildfire Season | How 2026's US fire season compared with every season since 2015, and where, when and why the fires burned | [`packages/wildfire-season-2026`](packages/wildfire-season-2026) |
| New York EV registrations | Whether New York's new EV registrations fell after the federal clean vehicle tax credit ended on 30 September 2025 | [`packages/ev-registrations-2026`](packages/ev-registrations-2026) |
| Project FeederWatch explorer | How winter feeder birds across North America changed from 1988-89 to 2023-24, by species, region and yard | [`packages/feederwatch`](packages/feederwatch) |
| Colorado Avalanche Explorer | Where, when and how Colorado's avalanches run, how storms and warm-ups drive them, and who gets caught, from CAIC reports and SNOTEL | [`packages/avalanche`](packages/avalanche) |

## Layout

Each app is a folder under `packages/`, and everything in it publishes: `publisher.json`, the model, `data/`,
`public/` (the app), `pipeline/` (the scripts that fetch and shape the data, where the app has them) and a
README crediting its data sources.
`packages/publisher.config.json` names them for a local Publisher. The midterms app also keeps its own tooling
in its folder: `pnpm` scripts and the container image it is deployed as. Its `.credignore` keeps that tooling
out of the published package, and [its README](packages/midterms2026/README.md) describes it.

## Run the apps in `packages/`

```bash
npx @malloy-publisher/server@0.11.2 --server_root packages --port 4100 --mcp_port 4140
```

- Wildfire: http://localhost:4100/environments/community-apps/packages/wildfire-season-2026/index.html
- EV registrations: http://localhost:4100/environments/community-apps/packages/ev-registrations-2026/index.html
- Midterms: http://localhost:4100/environments/community-apps/packages/midterms2026/index.html
- FeederWatch: http://localhost:4100/environments/community-apps/packages/feederwatch/index.html
- Avalanche: http://localhost:4100/environments/community-apps/packages/avalanche/index.html

The ports differ from the midterms app's `pnpm dev`, so both can run at once. Add `?check=1` to the wildfire or EV app's URL and it
checks that the numbers it leads with are the ones the model returns, and says so at the top of the page.

## Adding an app

Add a folder under `packages/` with a `publisher.json` whose `name` is the folder's name, add it to
`packages/publisher.config.json`, and list it in the table above. Data files ship in the package, so its
README has to credit each source.

## License

The code is [MIT](LICENSE). The data keeps its sources' licences:

- Midterms: the data in `packages/midterms2026/data/` and `packages/midterms2026/pipeline/data/curated/`
  is derived from third-party sources (Wikipedia-derived tables are CC BY-SA 4.0, FiveThirtyEight pollster
  ratings are CC BY 4.0); see [`packages/midterms2026/README.md`](packages/midterms2026/README.md).
- Each app under `packages/`: the Sources section of its README. The libraries and fonts an app ships in
  `public/` keep theirs (d3 and topojson-client are ISC, Chart.js is MIT, the fonts SIL OFL 1.1), listed in
  its `public/vendor/README.md` or in the licence files beside them.
