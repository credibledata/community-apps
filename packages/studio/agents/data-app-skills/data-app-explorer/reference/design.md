# Design

A small design system for the app: tokens, then the pieces the frame in `reference/app-frame.md` uses. The
stylesheet is `templates/data-app/styles.css`, copied with the frame; make it the app's own: choose its colours as "Colour" below says, and keep
the rest.

Every app has the same frame: a header with the app's name, its views and a search; a scope bar; one view at a time,
each a title, a lede and sections of cards; a footer with the sources. Type and white space carry the structure, not
boxes. What varies from app to app is the look, chosen as the section "Looks" below says, so that no two apps come
out the same.

- **Two typefaces, two jobs.** A sans (Figtree) for titles, numbers, labels and controls; a serif (Source Serif 4)
  for everything read as prose: the lede, each card's description and finding, method notes, About. View titles
  are large and light. Labels are small uppercase sans. `reference/fonts.md` ships both as text.
- **Rules and white space, not boxes.** A card is a column under a thin dark rule, with no border, background or
  shadow. Sections are separated by space and a heading. Only the headline numbers sit on a tinted panel.
- **Colour has meaning, and the app chooses it.** The page is light and its neutrals are fixed; the accent, the
  categories and the ramp are chosen for this app's subject, as "Colour" below says, and checked.
- **A change is coloured by what it means to the reader, not by its direction.** A falling price is good news for
  a buyer and bad for a seller; `.delta--up` and `.delta--down` name the colour, and you choose which applies. When
  the meaning is not clear, keep the change neutral.
- **The app is not the publisher.** Never use a data publisher's logo, name as a brand, or palette; the app credits
  them as a source.
- **Every card** has a title (uppercase, or a headline in some looks), a description saying how to read it and what clicking does, the chart, a
  sentence stating its finding, a method note, and a footer that shows the working: what each query counts, the
  query, and the rows it returned.

The stylesheet's parts, in order: the tokens on `:root`, the page and its type, the header and scope bar, cards and
headline numbers, the ranked table and the working, states, motion, the phone layout, then the Looks. Change the
tokens as "Colour" says and the Looks' attributes on `<body>`; keep the rest.

## Colour

The page is light, and its neutrals are fixed: `--bg` (the accent may tint it), the surfaces, the text greys, the rules
and the grid. What carries meaning is chosen for this app, from its subject (a coffee app's roast brown, a wildfire
app's ember red):

- **The accent**, one colour for the lead number, links and the selection; as text it needs 4.5:1 on `--bg`.
- **Up to six categories**, `--c1` to `--c6`, each standing for one thing in the domain on every chart, label and
  chip. The lead category may be the accent itself (`--c1`); no other may. Fewer is better.
- **`--c-bar`**, the neutral for a count with no category: a dark grey, or a muted shade of the accent.
- **The ramp**, `--seq-0` to `--seq-5`, light to dark in one hue family, for maps and heatmaps.
- **`--up` and `--down`**, bad news and good news, different in lightness as well as hue, and 4.5:1 on `--bg`, since
  they colour the deltas' text.

Pick the accent first, then categories of similar weight spread around the colour wheel, darker than they look in a
swatch, since marks are small. Keep every token six-digit hex. Then copy and run `reference/palette-check.md`: fix
everything it prints as a problem before you hand over; a note means label those two categories directly wherever
both appear. Say in the hand-over which accent and categories you chose, and why.

## Looks

The frame is fixed; its look is chosen per app, so no two apps come out the same. A look is nine choices, each an
attribute on `<body>`, styled at the end of the stylesheet above. With no attribute, a choice takes its first option.

| Attribute | Options | What changes |
|---|---|---|
| `data-masthead` | `band`, `light`, `bar` | The header: a dark band; a light masthead with the name large over the views between rules; one slim light row. The light ones put a kicker naming the view above its title |
| `data-face` | `sans`, `serif` | The face of the titles, the section heads and the headline numbers |
| `data-filters` | `selects`, `sentence` | The scope bar: labelled selects, or a sentence ("Showing … in …") from each scope entry's `word` |
| `data-numbers` | `panel`, `rules` | The headline numbers: on the tinted panel, or between rules |
| `data-sections` | `plain`, `numbered` | Section heads: plain, or numbered under a heavy rule |
| `data-cards` | `caps`, `headline` | Card titles: small capitals, or a headline in the display face |
| `data-buttons` | `pills`, `links`, `square` | Buttons and selects: pills, links in the accent, or square corners |
| `data-footer` | `panel`, `colophon` | The footer: on the panel, or a colophon under a double rule |
| `data-lede` | `plain`, `dropcap` | The lede: plain, or larger with a drop cap |

Three starting looks:

- **Band**: no attributes. A dark band over a quiet page.
- **Masthead**: `data-masthead="light" data-face="serif" data-filters="sentence" data-numbers="rules"
  data-sections="numbered" data-cards="headline" data-buttons="links" data-footer="colophon" data-lede="dropcap"`.
- **Ledger**: `data-masthead="bar" data-numbers="rules" data-sections="numbered" data-buttons="square"`. Compact,
  for numbers read side by side.

Choose from the data and its reader, never from how the brief arrived: a story in the news is only how the subject
was found, and the app is about the data. Start from the look whose character fits the subject:
numbers a reader scans and compares (prices, output, jobs, counts) suit Ledger or Band; a subject read slowly, with
many caveats or a long history, suits Masthead. Then change one or two choices so the app is its own, and say in the hand-over which look you started from and what you changed. Whatever the
look, check the header and the scope bar at 390 px and the focus ring on each.
