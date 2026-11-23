# US gasoline prices

Every weekly US retail gasoline and diesel price the US Energy Information Administration (EIA) has published since
1990, by grade and for the US, its regions, nine states and ten cities. Each price is shown as paid and in today's
dollars, adjusted with the BLS consumer price index.

The app opens on one question: **are Thanksgiving gas prices near a record?** It compares the survey week before
Thanksgiving with the same week in every year since 1990, before and after inflation. From there a reader can:

- **Explore** prices by area, grade and period: the trend, the premium and diesel gaps, and the seasonal pattern.
- Open any **area's page** for its own record and calendar.
- **Compare** up to four areas.
- Search and download every weekly reading under **Records**.

## Responding to

- [Thanksgiving gas prices](https://news.google.com/rss/articles/CBMikAFBVV95cUxPWnNrNmcyaXlfWVlTM29KQnZKWUdIZVVvSnREWDhHcm9wZWtDVTVWMXlDV0I4dHFGQlJZYVFFbHI3N1VqdWZjOTlBY2xNT2tEYTBhYlJXX0xkaGpVVU94bnlJcjhXRUl2b3V3b254QmhkR2RPUWZPWjQ0aU9LOGFDdzVHbVFMcXJsWXI5M2FZUVg?oc=5) (Vermont Business Magazine, November 2026)

## Sources

| Dataset | Publisher | License | Fetched | Table |
|---|---|---|---|---|
| [Weekly Retail Gasoline and Diesel Prices](https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_nus_w.htm) (US by grade and formulation; regions, states and cities by grade) | US Energy Information Administration | Public domain (US federal government work; [EIA copyright and reuse](https://www.eia.gov/about/copyrights_reuse.php)) | 2026-11-23 | `community.us_gasoline_prices__prices`, 199,906 rows: one per EIA series and survey week |
| [CPI-U, all items, US city average, not seasonally adjusted](https://download.bls.gov/pub/time.series/cu/) (series CUUR0000SA0) | US Bureau of Labor Statistics | Public domain (US federal government work; [BLS linking and copyright](https://www.bls.gov/bls/linksite.htm)) | 2026-11-23 | `community.us_gasoline_prices__cpi`, 1,365 rows: one per month, 1913 to October 2026 |

BLS did not publish CPI-U for October 2025, during the federal shutdown. Weeks in that month have a nominal price but no
price in today's dollars.

## The files

- `pipeline/fetch.sh`: downloads every source into a raw directory.
- `pipeline/shape_prices.py`, `pipeline/shape_cpi.py`: reshape the raw files into one parquet file per table.
- `us_gasoline_prices.malloy`: the model, with sources, dimensions, measures and views, each documented.
- `index.malloy`: the root model, exporting `us_regular`, `fuel_prices` and `prices`.
- `public/`: the data app.

## Rebuild the tables

```sh
pipeline/fetch.sh /tmp/raw
uv run --with pandas --with pyarrow --with xlrd python -I pipeline/shape_prices.py /tmp/raw /tmp/shaped
uv run --with pandas --with pyarrow python -I pipeline/shape_cpi.py /tmp/raw /tmp/shaped
```

Then load `/tmp/shaped/prices.parquet` and `/tmp/shaped/cpi.parquet` into the environment's `community` database as
new managed tables, and point the two `community.table(...)` sources at the top of `us_gasoline_prices.malloy` at
them. Rerunning the scripts on 2026-11-23's downloads reproduces both tables exactly.

## License

The app's code and model are published with the Credible community apps. The data is the public-domain work of EIA
and BLS. This is an independent app, not produced or endorsed by either agency.
