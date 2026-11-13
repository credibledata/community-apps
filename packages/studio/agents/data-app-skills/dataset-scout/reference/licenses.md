# Licenses

The published app is public, and its package may be copied by anyone who can read it. Only data whose
license allows republishing with attribution, and nothing more, is used.

## Accepted

| License | Attribution you write on the page and in the README |
|---|---|
| Public domain, including US federal government works | "Source: <publisher>". Credit the publisher even though it is not required. |
| Figures a US federal agency compiles from state and local government reports, such as CDC's case counts, even when the dataset's license field is unspecified | "Source: <agency>, from reports by <the state and local agencies>" |
| CC0 1.0, Public Domain Dedication and License (PDDL) | "Source: <publisher>, CC0" |
| CC BY 4.0, CC BY 3.0 | "Source: <publisher>, <dataset name>, CC BY 4.0", with a link to the dataset and the license, and a note that the data was reshaped |
| Open Data Commons Attribution (ODC-By) | as CC BY |
| Open Government Licence (UK) v3 | "Contains public sector information licensed under the Open Government Licence v3.0." |
| Licence Ouverte / Open Licence (France) 2.0 | "Source: <publisher>, Licence Ouverte 2.0" |
| Eurostat and the European Commission's reuse policy (Decision 2011/833/EU) | "Source: Eurostat", with the dataset code |
| World Bank datasets marked CC BY 4.0 | as CC BY |
| A government publisher's own written statement that use of its open data is unrestricted, such as NYC Open Data's FAQ: "There are no restrictions on the use of Open Data." | The statement quoted word for word, with a link to where the publisher says it, beside "Source: <publisher>" |

## Refused

- **Share-alike** licenses: CC BY-SA and the Open Database License (ODbL). They are open, but they would require
  the shaped data republished in `data/` to carry the same license, which this repository does not take on. This rules out
  Wikipedia tables and OpenStreetMap extracts.
- **NonCommercial or NoDerivatives** terms of any kind (CC BY-NC, CC BY-ND and their mixes).
- "Free for personal use", "for research only", or any terms that limit who may use or redistribute it.
- No stated license. A portal being public is not a license, and neither is a website's footer: the statement of
  unrestricted use above must come from the publisher, about its data. A federal agency's compilation of state and
  local reports is the one dataset accepted without one.

## Traps

- **A re-publisher's license is not the original's.** An aggregator page can say CC BY while the data
  inside comes from a source with its own terms. Our World in Data, FRED and many GitHub repositories pass
  through other publishers' data; check the original's license for each series.
- **A publisher's own license does not cover what it redistributes.** A government agency can republish a
  commercial series under its own name. EIA's WTI and Brent spot prices "are from Refinitiv, an LSEG company,
  via EIA", which EIA states in its Short-Term Energy Outlook notes, not on the series page. Read the notes
  and documentation that come with the data as well as the series page; a third-party credit anywhere means
  that series is not covered by the agency's public-domain terms, unless the third party is a state or local
  government reporting to the agency (accepted above).
- **A data file can name its own sources.** The World Bank's commodity prices (the "Pink Sheet", catalogued as
  CC BY 4.0) credit series by series in the workbook's `Description` sheet: cocoa to the International Cocoa
  Organization and Bloomberg Finance, world sugar to Bloomberg, the International Sugar Organization and Thomson
  Reuters Datastream. Those series are not covered by the World Bank's license. Before using any series from a
  compilation, open the file's own description, notes or sources sheet and check that series' line.
- **City and state portals license dataset by dataset.** A Socrata or CKAN portal's site terms are not the
  dataset's license. Read the dataset's own license field: when it names a license or an owner, that decides. A
  publisher's own statement that its open data is unrestricted, like NYC's above, covers a dataset only when the
  dataset's field is empty or agrees.
- **Website terms are not data terms.** A site's copyright footer covers its pages. Look for the data
  license, often in a "terms of use", "data policy" or "reuse" page.
