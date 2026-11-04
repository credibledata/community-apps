# Data: a dated snapshot of public sources

Every Parquet file here is built by `scripts/build-data.mjs` from public sources, as of the date
in `build-info.json` (currently **2026-11-02**, the day before the election). Nothing after that
date is included, so the forecast is the forecast as of the snapshot, not a live feed.
`scripts/validate-data.mjs` gates every build (schema, joins, the 2026 map's counts, ranges, no
rows after the snapshot, and certified 2020/2024 results) and runs in `pnpm test`.

Margins everywhere are Democratic minus Republican, in points. "D" and "R" are the two sides of a
race: where a party has no nominee, the leading independent stands in for that side
(`races.matchup_note` says so; Dan Osborn in Nebraska is the D side).

| File | Rows | One row is | Source |
| --- | --- | --- | --- |
| `geographies.parquet` | 485 | A state or a 2026 House district | Census ACS 2024 1-year; presidential margins as in `historical_results` |
| `historical_results.parquet` | 850 | A result: year × office × geography (`geo_id = 'US'` is the nation) | MIT Election Lab (nation and states), The Downballot (districts) |
| `races.parquet` | 506 | A 2026 race: Senate, House or governor | Wikipedia; Sabato's Crystal Ball ratings via Wikipedia; FEC |
| `chambers.parquet` | 3 | Seat arithmetic for a chamber | `unitedstates/congress-legislators`; Wikipedia (governors) |
| `pollsters.parquet` | 188 | A pollster: grade and house effect | FiveThirtyEight ratings; house effects derived |
| `polls.parquet` | 1,177 | A poll: generic ballot (`US-GENERIC`) or a nominee head-to-head | VoteHub |
| `kalshi_prices.parquet` | ~35k | A market-day price for "Yes, the D side wins" | Kalshi public API |
| `approval.parquet` | 362 | A day of the presidential approval average | Derived from VoteHub approval polls |
| `special_elections.parquet` | 110 | A special election since 2025 | The Downballot |

Election night adds five tables, built by `scripts/results.mjs` (`pnpm results`) rather than
`build-data.mjs`, so refreshing the count never touches the forecast's inputs:

| File | Rows | One row is | Source |
| --- | --- | --- | --- |
| `results.parquet` | 507 per snapshot | A race's count at one snapshot (`race_id = 'US-HOUSE-VOTE'` is the national House vote); `is_latest` marks the newest | AP via the New York Times' results feeds |
| `forecasts.parquet` | 3,036 | A scenario preset's frozen forecast for one race: P(D), mean margin, 10th/50th/90th percentiles | This model, run before polls closed |
| `forecast_chambers.parquet` | 18 | A scenario's forecast for one chamber | This model |
| `forecast_seats.parquet` | 878 | A scenario × chamber × Democratic seat count, with its share of simulations | This model |
| `house_popular_vote.parquet` | 6 | A past House election's national popular vote (2006–2024) and the prior presidential margin | Wikipedia; MIT Election Lab |

## Sources

| Source | Used for | Terms |
| --- | --- | --- |
| [Wikipedia](https://en.wikipedia.org/wiki/2026_United_States_elections): the 2026 Senate, House, gubernatorial and House-ratings articles, and the list of current governors | Race map, nominees, incumbents and their status, Sabato ratings, governors' parties | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/): attribute, share alike |
| [VoteHub polls API](https://votehub.com/) | Polls and approval polls | Public API; confirm redistribution terms before a commercial release |
| [FiveThirtyEight pollster ratings](https://github.com/fivethirtyeight/data/tree/master/pollster-ratings) | Pollster grades | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [The Downballot](https://www.the-downballot.com/) presidential-results-by-district sheets (2024 and 2026 lines) and special-elections tracker | District presidential margins; special elections | Public Google Sheets; credit The Downballot |
| [MIT Election Data and Science Lab](https://electionlab.mit.edu/data), U.S. President 1976–2024 | State and national presidential results | Harvard Dataverse, CC0 |
| [U.S. Census Bureau](https://www.census.gov/programs-surveys/acs), ACS 2024 1-year summary files (tables B01003, B03002, B15003, B01002, B19013) | Demographics | Public domain |
| [FEC bulk data](https://www.fec.gov/data/browse-data/?tab=bulk-data), `weball26` | Candidate total receipts | Public domain |
| [Kalshi trade API](https://kalshi.com/) | Market prices | Public market data; confirm display terms before a commercial release |
| [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators) | Current Senate and House membership | CC0 |
| [The New York Times' election results](https://www.nytimes.com/spotlight/elections) (Associated Press data), the JSON feeds behind its 2026 results pages | Election-night counts and race calls | Unofficial, undocumented feed; credit AP and the Times, and confirm terms (or license AP directly) before a commercial release |

The forecast is independent and not affiliated with or endorsed by any source, rater or market.

## What is derived here, and how

- **Race map.** Parsed from the Wikipedia articles into `scripts/data/curated/races.csv`
  (committed, with a source URL per row). `locked_party` marks races where both finalists are
  from one party (California's top-two, unopposed seats); polls of those races are dropped.
- **Ratings.** Sabato's Crystal Ball column only, so every rating has one citable source. Races
  Sabato does not rate have a null rating, and the model gives the expert term no weight there.
- **Fundraising.** FEC total receipts (2025–26 cycle) for the two nominees, matched by state,
  office and name. Null for governors (they file with states) and wherever either side is
  missing, so the model never compares a filer against nobody.
- **Polls.** VoteHub polls ending 2026-01-01 through the snapshot, keeping the generic ballot
  and head-to-heads between the actual nominees (primary-season hypotheticals are dropped). A
  missing sample size takes the median.
- **Pollster grades.** FiveThirtyEight's numeric rating mapped to letters (2.8+ A+, 2.5 A, 2.2
  A-, 1.9 B+, 1.6 B, 1.3 B-, 1.0 C+, else C). Pollsters 538 never rated get C. `rating_538`
  names the 538 entry matched.
- **House effects.** For each poll, its margin minus the average of other pollsters' polls of
  the same race within 21 days (at least two of them), averaged per pollster and shrunk toward
  zero (`n / (n + 5)`).
- **Approval.** A daily average of approval polls: weight √n × 0.5^(age / 14 days) over 60 days,
  divided by √(that pollster's poll count) so daily trackers do not dominate.
- **District results.** 2024 and 2020 presidential margins on the 2026 lines. Districts whose
  lines changed for 2026 (`redrawn_for_2026`, 179 of them) have no census tabulation yet, so
  their demographics are null and the model reads them as national averages.
- **Kalshi.** Daily candles: the day's last trade, or the bid/ask midpoint on days without a
  trade. `is_latest` marks each market's last day. Volume is contracts × price.
- **Specials.** Contests with a Democrat and a Republican taking 90%+ of the vote between them.
  The tracker publishes margins, not vote totals, so `total_votes` is null and the "weighted"
  swing is the plain average.
- **Election-night counts.** Each feed race is matched to ours by state, office and seat, and
  each candidate to a side by name against the curated nominees, so independents standing in
  for a side count for it; anyone else is "other". The run fails if a race doesn't match or
  the feed's 2024 presidential margin differs from ours by more than 2.5 points (the
  Downballot sheet is rounded to whole points). Margins are D minus R as a share of all votes
  counted. Calls are AP's; a call can't be withdrawn between snapshots without failing
  validation.
- **Frozen forecast.** Every scenario preset run once with 10,000 simulations (seed 538)
  against this snapshot, before polls closed, and committed as CSV in
  `scripts/data/results/`. Validation pins the default topline to the published one.
- **Past House popular vote.** The infobox of each election's Wikipedia article; 2010 and 2018
  are checked against the Clerk of the House's certified totals.

## Rebuilding

```sh
pnpm data:real    # fetch every source into data-raw/ (gitignored), re-curate, fetch Kalshi, build, validate
pnpm data         # rebuild the Parquet from the cached downloads and curated CSVs only
pnpm test         # includes the validation gate
pnpm results      # election night: fetch the latest count, add a snapshot, rebuild the results tables
pnpm results --offline   # rebuild the results tables from committed snapshots only
```

The build is deterministic given `data-raw/`. Two optional MIT files (House and Senate results)
sit behind a Dataverse guestbook; download them by hand to `data-raw/mit-house.tab` and
`data-raw/mit-senate.tab` to add those offices to `historical_results`.
