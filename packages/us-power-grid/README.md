# US power grid

How US electricity generation has changed since 2001, by state, type of producer and energy source, from the US
Energy Information Administration's monthly net generation data. The app opens on one question: when did wind and
solar overtake coal, across the US and in Texas?

- **Overview**: the year wind and solar first made more electricity than coal, nationally and in Texas; coal, gas,
  and wind and solar each complete year; how many states had wind and solar ahead of coal each year; and each
  state's wind and solar share in the latest complete year.
- **Explore**: the whole fuel mix over time, monthly coal against wind and solar, states ranked, producers and
  energy sources, and the season. Every chart filters the others; years, a state and a producer type set the scope,
  and the address keeps it.
- **State pages**: each state against the US, its annual crossover, a year-by-month heatmap of its wind and solar
  share, and its latest records.
- **Records**: the rows in scope, newest first, 50 at a time.
- **Compare**: up to four states side by side.
- **About the data**: source, license, reshaping and caveats.

Open the app at `?check=1#/` to see whether the headline numbers match bare views of the model.

## Sources

| Dataset | Publisher | License | Source | Fetched | Rows kept | Shaping |
|---|---|---|---|---|---|---|
| Net generation by state by type of producer by energy source (EIA-923, EIA-906/920) | US Energy Information Administration | Public domain (US federal government work; EIA asks to be credited) | [EIA state electricity data](https://www.eia.gov/electricity/data/state/), file [generation_monthly.xlsx](https://www.eia.gov/electricity/data/state/generation_monthly.xlsx) | 2026-11-19 | 353,580 of 605,426, January 2001 to August 2026 | Every monthly sheet stacked into one table: `month`, `year`, `state`, `producer` (code), `source` (code), `mwh`, `final`. Dropped the rows that are sums of others: state `US-TOTAL`, producer `Total Electric Power Industry`, energy source `Total`. The script checks the kept rows add up to EIA's US totals. Rows from preliminary sheets are marked `final = false`. |

The model groups energy sources into six fuel groups for charts. "Wind and solar" is wind plus utility-scale solar.
That grouping is this app's choice, not EIA's.

Caveats: these are utility-scale plants only (1 MW and more), so rooftop solar is not counted. Generation is counted
in the state where the plant is. Recent months are preliminary and EIA revises them. Pumped storage has negative net
generation. Annual comparisons use complete calendar years only.

## Rebuild

The app reads one managed table, `community.us_power_grid__generation`, in the community-apps environment. It is not
in this package. To rebuild it from the source:

```sh
pipeline/fetch.sh /tmp/raw
uv run --with pandas --with openpyxl --with pyarrow python -I pipeline/shape_generation.py /tmp/raw /tmp/shaped
```

That writes `/tmp/shaped/generation.parquet`, which is loaded as the managed table. A clean rerun on 2026-11-19
reproduced it: 605,426 rows in, 353,580 kept, 105,057.5 TWh in total, and every month within 0.00001% of EIA's US
total. Check: the table has 353,580
rows, and `run: generation -> { aggregate: row_count }` on the model returns the same number.

## Files

- `us-power-grid.malloy`: the sources, measures and views, each with a `#(doc)`.
- `index.malloy`: the root model, exporting the sources the app reads.
- `public/`: the data app.
- `pipeline/`: the fetch and shaping scripts.
- `community-card.json`, `card.svg`: the catalogue card and its art.
