---
name: dataset-scout
description: Find the public datasets that answer the brief's questions (a topic, often a story in the news), a core dataset and supplemental ones that join it, and check each one's license before it is used. Use at the start of a data app, after writing its questions. Shortlists up to six openly licensed datasets, each tied to a question, or stops with the reasons nothing qualified.
---

# Dataset scout

**Only in a data app's own package** (a root `publisher.json` with no `agents`); anywhere else, do nothing and say so.

## What you are looking for

The data an analyst would gather to understand the subject: a core dataset a reader could use to check what the
brief claims and explore past it, and supplemental datasets that answer the questions the core cannot. Start from
the questions under "The questions" in the README, not from the topic's name, and search for each in turn. A good
core dataset:

- **Answers a question the brief raises.** "Are measles cases rising?" needs case counts over time, not
  vaccination policy text.
- **Goes deep.** One row per record, such as each complaint, case or inspection, with fields to filter and
  group by: place, type, date, outcome. Prefer it to a summary table of the same thing, even when the brief only
  quotes a total. When the publisher offers both, take the records.
- **Has the right grain.** Time and place at least as fine as the brief talks about: monthly by state, not
  yearly by country, when the brief is about one state this spring.
- **Is current.** It covers the period the brief covers. Note the last date it holds.
- **Comes from the body that collects it.** A statistics office, a regulator, a research group publishing its
  own measurements. Prefer it to a re-publisher, and record the original.
- **Has a license you can read.** See below.

## How to search

Search the portals in `reference/portals.md` with the place, the measure and the time span, not the
headline. Read each candidate's own page: its description, its fields, its last update, and its license
statement. A search result's summary is not evidence of any of these.

When an article cites a source ("according to CDC data"), look for that source first.

## Supplemental data

Most questions a reader brings need data beyond the core. Look for, in this order of how often they matter:

- **The denominator.** Population, households, beds, vehicles, acres: whatever turns a count into a rate, for the
  same places and years.
- **A fair baseline.** The years before the core begins, or a longer series of the same measure from another
  body, when the core's own years are unusual (a pandemic, a change in what had to be reported).
- **Who and where.** A breakdown the core lacks: age, income, land cover, industry.
- **Why.** A cause or condition beside the outcome: weather beside fires, prices beside sales, vaccination beside
  cases, strains beside admissions.
- **What comes next.** An earlier signal of the same thing: outpatient visits before admissions, permits before
  construction, wastewater before cases.

A supplemental dataset must join the core by place or time at a grain both have (state and week, county and year).
Read its place codes and period boundaries on its own page before keeping it: a week ending Saturday against one
ending Sunday, or county names against FIPS codes, is a join `data-fetch` has to fix and say it fixed.

## The license gate

Read `reference/licenses.md`. A dataset passes only when its own page, or the publisher's terms that the
page links to, states a license on the accepted list. Record the exact wording or the license's name, and
the URL where you read it.

Stop on a dataset when:

- no license is stated, or it is stated only for the website and not the data,
- the license is on the refused list,
- getting the data needs a login or clicking through terms,
- getting it needs an API key the environment does not hold (your briefing lists the ones it does, each as an
  environment variable with the hosts it may be sent to): keep it as a source for later, with the key's name, its
  host and where to get a free one, and carry on without it,
- its key goes in the address (`?api_key=…`) rather than a header: Credible adds a key to a request's
  `Authorization` header or the header the key names, never to the address, so such a source cannot be used,
- the data is about identifiable people.

## What to hand to the next step

For each dataset you keep, at most six, the core first:

| Field | Example |
|---|---|
| Name and publisher | "Measles cases by state", US CDC |
| Dataset page | the URL you read |
| Download URL | the file or API call you will fetch |
| License | "Public domain (US federal government work)", with the URL where it is stated |
| Grain and span | weekly by state, 2019-01 to 2026-10 |
| Fields you will use | `week`, `state`, `cases` |
| Role | core, or the supplemental kind above |
| The question it answers | from "The questions" |
| Joins on | the place code and period it shares with the core, such as state FIPS and the week ending Saturday |
| Key | the environment variable it reads and the host it goes to, or none |

If no core dataset passes, stop the build. Report each candidate you rejected and the reason, and suggest what
kind of source would answer the brief's questions. A question with no supplemental dataset that passes stays open:
name it, and what kind of source would answer it.
