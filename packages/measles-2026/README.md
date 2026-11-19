# Measles comes back

An explorer of the 2026 US measles outbreak. In November 2026 the United States lost the measles elimination status
it had held since 2000. The app leads with how 2026 compares with every year since elimination, then shows where
kindergarten MMR vaccination has slipped since before the pandemic, state by state.

- **Overview:** cases in 2026 against every year since 2000, cumulative cases week by week, the epidemic curve,
  the states whose coverage fell furthest, national coverage and exemptions, and cases by state.
- **Explore:** national coverage, exemptions and coverage bands by school year, a ranked table of states, and each
  state's change since 2019-20. Filter by school year and coverage band.
- **A page per state:** coverage against the nation, exemptions, and 2024–26 cases.
- **Compare** up to four states, **Records** for every row, and **About the data**.

## Sources

| Dataset | Publisher | License | Fetched | Table |
|---|---|---|---|---|
| Measles cases by year, 1985 to now | CDC, Measles Cases and Outbreaks (chart data) | US federal government work, public domain | 2026-11-13 | `community.measles_2026__yearly_cases` |
| Measles cases by week of rash onset | CDC, as above | US federal government work, public domain | 2026-11-14 | `community.measles_2026__weekly_cases` |
| Measles cases by state, 2024 to now | CDC, as above | US federal government work, public domain | 2026-11-13 | `community.measles_2026__state_cases` |
| Kindergarten MMR coverage and exemptions, by state and school year | CDC SchoolVaxView, data.cdc.gov `ijqb-a7ye` | US federal government work, public domain | 2026-11 | `community.measles_2026__kindergarten` |

Source: CDC, from reports by state and local health departments (cases) and state immunization programs
(kindergarten coverage). This is an independent app, not produced by CDC. www.cdc.gov refuses some automated
downloads, so `pipeline/fetch.sh` falls back to the Internet Archive's copy of each chart file, pinned by
timestamp.

## Rebuild

```sh
bash pipeline/fetch.sh /tmp/raw
python3 -I pipeline/shape_measles.py /tmp/raw /tmp/shaped
```

The shaped files should have 42 (yearly), 254 (weekly), 156 (state) and 907 (kindergarten) rows. Load each one
into the managed table named above.

## Notes

- 2026 is a partial year, counted by the year and week of rash onset.
- "Slipped" means coverage fell by 1 point or more between 2019-20 and 2025-26. That threshold is this app's
  choice.
- States count kindergartners differently (census, sample or voluntary response).
