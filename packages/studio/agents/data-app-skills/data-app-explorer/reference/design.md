# Design

A small design system for the app: tokens, then the pieces the frame in `reference/app-frame.md` uses. The
stylesheet is `templates/data-app/styles.css`, copied with the frame; make it the app's own: choose its theme as "Colour" below says, and keep
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
- **Colour comes from a theme, chosen for the subject.** Ten themes, each with a light and a dark mode, carry the
  page tone, the accent, the categories and the ramp, every one checked; the app chooses one, as "Colour" below says,
  and gives each colour its meaning.
- **A change is coloured by what it means to the reader, not by its direction.** A falling price is good news for
  a buyer and bad for a seller; `.delta--up` and `.delta--down` name the colour, and you choose which applies. When
  the meaning is not clear, keep the change neutral.
- **The app is not the publisher.** Never use a data publisher's logo, name as a brand, or palette; the app credits
  them as a source.
- **Every card** has a title (uppercase, or a headline in some looks), a description saying how to read it and what clicking does, the chart, a
  sentence stating its finding, a method note, and a footer that shows the working: what each query counts, the
  query, and the rows it returned.

The stylesheet's parts, in order: the tokens on `:root`, the page and its type, the header and scope bar, cards and
headline numbers, the ranked table and the working, states, motion, the phone layout, then the Looks. Choose the
theme as "Colour" says and the Looks' attributes on `<body>`; keep the rest.

## Colour

Colour comes from a theme in `themes.css`, copied whole with the chart module (`reference/charts.md`). Each of the
ten is a complete palette for a light page and a dark one: page tone, accent, six categories, ramp, good and bad
news. Set the app's on `<html>` in `index.html`: `<html lang="en" data-theme="lagoon">`.

| Theme | Page | Accent | Suits |
|---|---|---|---|
| `ember` | warm paper | rust | heat, fire, energy, prices, the cost of living |
| `harbor` | cool grey | navy | water, shipping, weather, cities, transport |
| `meadow` | warm paper | forest green | nature, farming, food, birds, land, health |
| `dusk` | cool grey | indigo | space, night, sleep, technology, science, culture |
| `coral` | white | coral, with teal | oceans, beaches, tourism, people and places |
| `ink` | white | newspaper red | politics, elections, courts, news, history |
| `desert` | sand | gold | drought, mining, the West, dry land |
| `orchard` | warm paper | plum | wine, fruit, fashion, the arts, retail |
| `lagoon` | cool grey | teal | climate, coasts, public health, ecology |
| `graphite` | cool grey | electric blue | technology, finance, markets, infrastructure |

- **Choose from the subject, then make the gallery varied.** Of the themes that suit the subject, prefer one no other
  community app uses; list theirs first:

  ```sh
  for p in $(curl -s https://api.github.com/repos/credibledata/community-apps/contents/packages | python3 -I -c "import json,sys; print(' '.join(x['name'] for x in json.load(sys.stdin) if x['type'] == 'dir' and x['name'] != 'studio'))"); do printf '%s ' "$p"; curl -s "https://raw.githubusercontent.com/credibledata/community-apps/main/packages/$p/public/index.html" | grep -o 'data-theme="[a-z]*"' | head -1; echo; done
  ```

  An app with no `data-theme` predates the themes. Say in the hand-over which theme you chose and why.
- **Light and dark.** With no `data-mode` the reader's system setting decides; `?mode=dark` in the address shows the
  dark page, and `?theme=` another theme. The frame draws every chart again when either changes. Shoot both modes.
- **Meanings are the app's; colours are the theme's.** Write what each category means in a comment at the top of
  `styles.css` (`/* --c1 as paid, --c2 in today's dollars, --c6 a year ago */`) and keep it the same on every chart,
  label and chip. Only `--c1` may be the accent; fewer categories are better. `--c-bar` is the neutral for a count
  with no category, the ramp `--seq-0` to `--seq-5` is for maps and heatmaps, and `--up` and `--down` are bad news and
  good news, not up and down.
- **Don't hand-pick colours.** Override a token only for a subject with its own colour (a party): on
  `:root[data-theme="<theme>"]` and on `:root[data-theme="<theme>"][data-mode="dark"]` in `styles.css`, never in
  `themes.css`, then run `reference/palette-check.md` for both modes. The tokens on `:root` in `styles.css` are only a
  fallback for a page with no theme.

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
