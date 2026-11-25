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

5. **Does every chart act when a reader uses it?** An app a reader explores, not a report they read: on Explore
   every chart filters the other cards when a mark is clicked (or a span dragged), says what each mark is on hover,
   and clears when clicked again; every scope control redraws the cards; a name opens its page. Check it the way a
   reader would, with the template's interaction check, which clicks, drags and hovers on every view:

   ```sh
   node /workspace/siblings/studio/templates/data-app/check_interactions.mjs <package>/index.html
   ```

   It takes three or four minutes; `--views explore` checks one view. Each `FIND` line is a chart with nothing to
   click, a click that redraws no other card, a filter that does not clear, a tooltip missing, or a control that
   changes nothing. Fix each (pass `onPick` and `selected`, or `onBrush`, as `data-app-explorer` says), or name it
   under "The editor's read" with its reason, such as a card that is meant to ignore a filter and says so in its
   method note. Run it again after the fixes.
6. **What would a reader ask next** that the app cannot answer? When a dataset already in the package answers it,
   add the card. When it needs a new source, name the source under "What is next" in the hand-over.
7. **Does every view earn its place?** Each view answers a question. Records or Compare that answer none come out,
   as `data-app-explorer` says.
8. **Is every sentence from the rows?** No verdict, superlative or count typed by hand, and no claim a card's rows
   do not show.

Then read it as a stranger who opens it from a post, knowing nothing but the post:

9. **Is the headline the best true finding?** Read every card's finding.
   When a card holds a sharper finding than the headline (a record, a bigger gap, a claim it breaks, a place far
   from the rest), that finding becomes the headline and its chart the lead chart. The headline names its number
   and what it is compared with, and says nothing more than its rows do: "highest since" needs the years, "most"
   needs the whole ranking.
10. **Does the first screen stand on its own?** Shoot it with `--viewport 390x844` and `--viewport 1280x800`,
    without `--full` (at high effort the Overview at `?check=1#/`, and the check passes), and look at both. Someone who has never heard of
    the subject knows from that screen alone what the number means, why it matters this week, and what to do next,
    without opening an info mark.
11. **Would they repost it?** Write the post: what a person posts on LinkedIn or X to share the app, two or three
    sentences in plain words, with the headline finding and its number, why it matters this week, and what a
    reader can look up in the app, then `<link to the app>` for the person to fill in, and the shot to attach
    (`final-first-phone.jpg` or `final-first-desktop.jpg`). Every number in it is one the first screen shows. No
    hashtags, no emoji. It goes in the hand-over and the pull request's description. When you cannot write two
    sentences a stranger would repost, from findings the app shows, the app has no headline worth sharing: say so
    first in the hand-over, as your instructions say, put that reason where the post would go, and leave the
    decision to the reviewer rather than polishing the rest.

## Fix, then hand over

Fix what you found in the model and the app: a missing answer, an unfair baseline, a supplemental source left
unused, a view that answers nothing, a headline a card beats, a first screen that does not fit. Query every view you changed and shoot every view again. Update "The
questions" in the README so each answer matches the page.

Then hand over as your instructions' "Handing over" says. Its part **The editor's read** is what you found under
each heading above and what you changed, in a few lines.
