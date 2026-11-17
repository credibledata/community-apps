---
name: dataset-scout
description: Find public datasets that speak to the brief (a topic, often a story in the news), and check each one's license before it is used. Use at the start of a data app, after reading the brief. Shortlists at most three openly licensed datasets, or stops with the reasons nothing qualified.
---

# Dataset scout

**Only in a data app's own package** (a root `publisher.json` with no `agents`); anywhere else, do nothing and say so.

## What you are looking for

The richest data on the brief's subject that a reader could use to check what the brief claims and then
explore past it. Start from the questions you wrote down while reading the brief, not from the topic's name. A
good dataset for a data app:

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

## The license gate

Read `reference/licenses.md`. A dataset passes only when its own page, or the publisher's terms that the
page links to, states a license on the accepted list. Record the exact wording or the license's name, and
the URL where you read it.

Stop on a dataset when:

- no license is stated, or it is stated only for the website and not the data,
- the license is on the refused list,
- getting the data needs an API key, a login, or clicking through terms,
- the data is about identifiable people.

## What to hand to the next step

For each dataset you keep, at most three:

| Field | Example |
|---|---|
| Name and publisher | "Measles cases by state", US CDC |
| Dataset page | the URL you read |
| Download URL | the file or API call you will fetch |
| License | "Public domain (US federal government work)", with the URL where it is stated |
| Grain and span | weekly by state, 2019-01 to 2026-10 |
| Fields you will use | `week`, `state`, `cases` |
| The question it answers | from your list |

If nothing passes, stop the build. Report each candidate you rejected and the reason, and suggest what kind
of source would answer the brief's questions.
