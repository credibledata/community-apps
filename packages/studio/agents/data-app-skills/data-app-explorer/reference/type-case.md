# The case

An app type, chosen when the brief's `Type` is `case`. Read it before planning the app: where it differs from
`SKILL.md`, `data-app-page`, the editor's read or a revisit on the app's shape, it wins: the headline is the change
as a question, and the post asks it rather than giving a verdict. Every other rule holds: every number from a Malloy
view, open licenses, the headline check, the editor's read, and the page reading as plain sentences.

**The promise to the reader:** "Something changed. Here are the explanations people give. See how each one holds up
against the data, then test your own." The reader does not get a verdict; they get the suspects, a fair test for
each, and an open row for theirs, which is a question to Credible's agent.

## When a topic is a case

A change people argue about the cause of, with rival explanations in the news, and data at a place grain (states,
counties, countries; at least 30 places) for the change and for each explanation. A topic with fewer than three
suspects testable by place is not a case; a board holds three to six.

## The board

Build it on the frame in `reference/app-frame.md`, with the board as the Overview view. Its first screen:

1. **The headline**: the change, with its number, as a question. "Home power prices are up **39%** since 2019. Why?"
2. **One line** on what the number is: "The average US home price per kWh, **13.0¢** in 2019 and **18.1¢** in the
   12 months to September 2026, before inflation."
3. **A small chart** of the change.
4. **How to read the board**, in two sentences, before the suspects: "Below are the reasons people give. For each, we
   compared the states where it should matter most with the rest: if it drove the rise, those states should have
   risen more."
5. **The suspects**, three to six chips, "Tap the one you believe". Each takes its stamp once opened.
6. **Your suspect**: an open row that sends the reader's own explanation to Credible's agent, and three ready
   questions for suspects not tested.
7. **Find your state**: the header's search, opening the state's page, which shows its change and where it falls on
   every test. The board has no find box of its own, so its first screen is items 1 to 4.

## A test card

Tapping a suspect opens its card in place. Top to bottom:

1. **What would be true if it were the cause**, in one sentence: "If data centers drove the rise, prices should have
   risen more in the states where business power use grew most."
2. **What the data shows**, in one or two sentences from the rows, naming the groups: "In the 10 states where it grew
   most (Virginia, Texas, Arizona, …) home prices rose **31.5%**; in the other 41, **33.9%**. They rose a little
   less, not more." List the group's states, or the first five and "5 more" that opens the rest.
3. **One chart** of the two groups, bars labelled with the groups' names and their numbers. Mark the reader's state
   when the address carries one.
4. **The stamp**, with what it means in words beside it: **fits** ("these states rose more, as this explanation
   predicts"), **does not fit** ("they did not rise more"), **cannot tell** ("the data cannot test it", and why).
5. **What this cannot show**, one plain line: "A state average hides what happened inside one utility's area."
6. **Who says it**, linked to where the claim is made.
7. **How we tested**, folded: the rule for choosing the states, the measure, the smallest gap that counts, the
   smallest group, the second split and how it came out, and the query. Words such as median, points, threshold,
   proxy, baseline and split belong here, never above the fold.

## Rules for the tests

- **Write the tests before running them.** In one turn, write "The tests" into the README: for each suspect, the
  prediction, the exposure measure, how places are split, and the two thresholds. Query no test view in that turn.
  A later turn may not change a rule without saying so on the card.
- **Suspects come from the world.** Each links to someone making the claim; the most popular one is on the list; none
  is dropped because of how its test came out. State each the way its believers do; when the data can only test a
  weaker version (a proxy, build-out in place of a mandate), the card's first sentence says so.
- **Three stamps, fixed words.** The verdict is a field of the model, never decided in the page. The page never says
  caused, because of, due to, drove (outside the "if it drove" prediction) or explains.
- **"Cannot tell" is a result**, shown like the others, with what data would test it.
- **Each verdict survives one other fair split** (top quarter in place of top ten, or a start a year earlier); when
  it flips, the stamp is "cannot tell".

## The model

- `outcome`: the change, national and by place. One source per suspect's exposure, keyed on the same places.
- One view per suspect, `test_<name>`: the split by the documented rule, each group's change, size and members, the
  gap, and `verdict` as a `pick` on the two documented thresholds. `board`: one row per suspect with its verdict, and
  the counts for the summary sentence.

## Checks before hand-over

On top of `SKILL.md`'s:

- Open every card at phone width and read its first two sentences aloud to someone who has not seen the app: do
  they know what was compared and what came out, without the folded method?
- Could each test have come out the other way? A test that would stamp "fits" for any data is not a test.
- Each stamp's text equals its `verdict`, and the board's counts equal `board`; the group lists equal the view's
  members.
- None of the banned cause words is in the page text.
- Send one "your suspect" question through, when the app runs inside Credible, and read the answer.
- Shoot the board, every card open, and one state's page, at both widths and in dark mode.
