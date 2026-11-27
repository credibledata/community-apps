# The guess

An app type, chosen when the brief's `Type` is `guess`. Read it before planning the app: where it differs from your
instructions, a task or another skill on the app's shape, it wins. A guess has no headline: its headline line in the
hand-over, and its post, ask the first round's question and link the deck. Nothing it ships shows the months it
hides: not the post, `card.svg`, the card's blurb in `community-card.json`, the description in `publisher.json`, the
README (its "The questions" says what each round asks, never the answer) or About. The README's first line under its
title is `Type: guess`, which a revisit reads. When the data cannot fill five rounds by the rules below, build an
explorer and say why in the hand-over. Every other rule holds: every number from a Malloy view, open licenses, the
editor's read, and the page reading as plain sentences.

**The promise to the reader:** "Mark where you think the number is. Then see where it really is, and how far off you
were." The reader commits a belief before the app shows the answer. In every other type the page speaks first.

## When a topic is a guess

A number people talk about and misjudge, with a long monthly or yearly history: prices, shares, counts. The brief's
claim is usually about where that number is now ("gas plunged", "eggs are still expensive").

## The deck

Build it on the frame in `reference/app-frame.md`, with the deck as the Overview view: the theme, the reader's light
or dark mode, the header, search and About come with the frame. Five rounds, each a different series from the same model, then a score card, with the explorer behind "See all
the data". A round:

1. **The question**, as a reader would ask it: "What does a dozen eggs cost now?"
2. **The chart** of the series up to the cut date, the months after it hidden behind a band marked "hidden", and a
   dot the reader drags (or moves with the arrow keys) to their guess. The guess's value shows as they move.
   "Lock it in" is disabled until the dot moves.
3. **On lock-in**, one Malloy view runs with the guess as a given. The hidden line draws in, in the series' own
   colour at full weight, with its highest and lowest points in the hidden span labelled.
4. **The grade**, in sentences a stranger reads without the chart:
   - What happened while it was hidden, from the rows: "Eggs peaked at **$6.23** in March 2025, then fell to
     **$2.32** by October 2026."
   - The reader against it: "You said **$4.35**: **$2.03** too high." Then the band word, **close** (within 10%),
     **near** (within 25%) or **far**, from two documented constants in the model.
   - When it applies: "**$4.35** was the price as recently as **May 2025**." Where the data has places, and only
     when one is within the near band of the guess: "In October 2026 the **West** was nearest, at **$4.20**." When none
     is, say nothing about places.
5. **Next**, to the following round.

The last round may be **a call**: the reader guesses next release's value, graded when it is out. The guess travels
in the link the reader copies, never to a server.

**The score card:** the five bands as squares, "2 of 5 close", the widest miss in a sentence, then three exits, in
this order: **Ask why** on the widest miss (a ready question to Credible's agent with that round's queries as
context), **Next deck** (another community app), and **Copy my score** (a link that carries the bands and no
values, so it spoils nothing).

## Rules for the rounds

- **Pick rounds a reasonable guess gets wrong** by more than the near band, from the rows, never by what would make
  a reader feel foolish. A round most people would get right comes out. At most one round where the answer is "it
  barely moved".
- **The window shows enough history to guess from, and leaves enough hidden to see.** Start the chart so the hidden
  span is at least a quarter of its width: with a year hidden, show three or four years; with two, six to eight.
- **The scale is fixed before the answer is looked at, and fits the history.** From zero to the larger of 1.5 times
  the highest visible value and the visible value rounded up to a clean step; for a share, 0 to 100. Never centred
  on the hidden answer, and never so tall that the visible line sits in the bottom third. When a hidden value would
  sit above the top, raise the top to the next clean step above it: a dot that cannot reach the answer is worse than
  a tall scale.
- **One cut date for every round in a deck.** Move it a year each way while planning: when that changes a round's
  story, say so on About.
- **No answer before lock-in:** not in the title, the question, the post, the card art, the share image or any query
  the page runs. Before lock-in the page runs only `round_info` and `round_visible`, never `grade` and never a frame
  query that reaches past the cut date. The frame's nav, search and entity pages show the hidden months, so the deck
  hides them and links the explorer only from the score card. Their addresses still open, for a shared link and the
  interaction check, under a line that says they show the deck's answers.

## The model

- A series source at entity by period grain, with a dimension for places or items where the measure exists for many.
- `round_info` (the question, unit, cut date and scale per round), `round_visible`, and `grade` with the given
  `guess`: the hidden points, the peak and trough in the hidden span and their months, the latest value, the gap,
  the band, the last period at or above the guess, and the nearest place with its distance. `scorecard` with five
  givens.

## How it reads

Every grade and score line is a full sentence a stranger understands without the chart, with each number in bold.
The chart's caption says what the line is ("Average price paid in US cities, dollars per dozen"). No "band", "given",
"cut date" or "series" on the page; say "hidden", "your guess", "shown through December 2024".

## Checks before hand-over

On top of `SKILL.md`'s:

- Play the deck yourself at phone width, locking in a guess well above and well below each answer, and read each
  grade aloud: does it say what happened while hidden, and is every sentence true for that guess?
- A scripted play-through shows only `round_info` and `round_visible` run before lock-in, in every round.
- The interaction check runs with `--views` set to the explorer's views: the deck has no cards. Its light and dark
  test applies to the deck.
- The first screen at 390 x 844 holds the question, the whole chart with its hidden band, the guess value and the
  button.
- The frame's headline check is built for a headline, which this type's first screen has none of; in its place,
  the play-through checks each grade and score line's bold numbers against the `grade` and `scorecard` rows.
- Shoot each round after lock-in and the score card, at both widths and in dark mode.
