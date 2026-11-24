# Editor's read

The builder queues this turn when the app is built and checked, before its pull request. You read the app as its
editor: the person who asks whether it answers what a reader came for, from data that bears the weight. Then you fix
what you find and hand over as your instructions say, opening the pull request.

Judge what a reader sees. Read the README's "The questions", the app's model, and the app itself in the box, at
desktop and phone width. Do not rely on the builder's progress notes: what they say was done is what you check.

Run `date -u +%s` first. The turn limits in your instructions hold: when 7 minutes have passed, end with a progress
note that starts with `**Progress:**`, lists what you found and what you changed, and queue the next turn with
`summary` "editor's read, continued" and the same instruction. At most two such turns; after that, hand over and
name what is left under "What is next".

## The read

For each question under "The questions":

1. **Is it answered?** A reader finds the answer in a sentence on the Overview or on the view for that question,
   built from the rows, with its number. A question the app only shows charts for, and leaves the reader to work
   out, is not answered. "Early and hard?" is two questions: is it early, and is it hard.
2. **Is the comparison fair?** The baseline is like for like: years like this one (not years when the thing barely
   happened), per person or per unit when the places differ in size, the same definition on both sides. A baseline
   set by what one dataset happens to cover is named as such on the card, or replaced from another source.
3. **Does it rest on more than one source where it should?** Each supplemental dataset in the README earns its place
   in at least one card or answer. A question answered from the core alone, where a supplemental source would
   change or confirm the answer, uses it.
4. **Do the sources agree on what they measure?** The README's cross-source check holds in the model: the same place
   codes, the same weeks or months, the same units, a population for the right year. A rate across two sources says
   both in its method note.

Then for the app as a whole:

5. **What would a reader ask next** that the app cannot answer? When a dataset already in the package answers it,
   add the card. When it needs a new source, name the source under "What is next" in the hand-over.
6. **Does every view earn its place?** Each view answers a question. Records or Compare that answer none come out,
   as `data-app-explorer` says.
7. **Is every sentence from the rows?** No verdict, superlative or count typed by hand, and no claim a card's rows
   do not show.

## Fix, then hand over

Fix what you found in the model and the app: a missing answer, an unfair baseline, a supplemental source left
unused, a view that answers nothing. Query every view you changed and shoot every view again. Update "The
questions" in the README so each answer matches the page.

Then hand over as your instructions' "Handing over" says, with one more part after "For the reviewer to check":
**The editor's read**, what you found under each heading above and what you changed, in a few lines.
