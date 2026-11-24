---
name: card-art
description: Draw a community app's card art, card.svg - a 320 x 200 SVG miniature of the app's lead view in its own palette, drawn with plain shapes only - and check it with the studio's card_art.py before hand-over. Use when an app is done and its community-card.json is written.
---

# Drawing the card art

The community site shows each app as a card, and the card's top is a small picture of the app. Draw it as
`card.svg` in the package root. When the app is listed, the workflow checks it and copies a rebuilt drawing to the
site; if it fails the check, the card is drawn from the app's name and colour instead, which is plainer.

## What to draw

The card should look like the app a visitor is about to open, at a glance and at half size on a phone.

- **The app's lead view, in miniature.** The chart a visitor sees first, and the one nothing else in the catalogue
  looks like: a hex map of where the fires started, a county map shaded by share, an aspect rose, a chamber's odds
  as dots. When the app is about a thing more than a chart (a bird at a feeder), draw the thing. When the page
  opens with numbers rather than a chart, draw the chart that carries the app's story, the one its lead question
  is answered by; and pick one view, since two side by side are both too small on a phone.
- **The real shape, simplified.** Take the shape from the app's own data: which bars are long, where the map is dark,
  how the line moves. Round it and drop detail. Computing a measure from the data files the way the model does (a
  share, a rate) is expected; check it against a number the app shows. It is a picture of the app, not a chart of
  live data, so it never needs updating.
- **The app's palette, nothing else.** Use its theme's light colours, the `:root[data-theme="<theme>"]` block in
  `public/kit/themes.css` for the theme the app's config names (`paper`, the default, is the plain `:root` block): its `--paper`, its `--ink`, its `--accent`, its
  chart colours. Echo its masthead: when the theme sets a `--mast-bg` other than `transparent`, draw a band of that
  colour across the top (about 34 units); when it sets a `--mast-top`, a thin strip of it.
- **Fill the frame.** A background `rect` of 320 x 200 first. Keep the drawing about 16 units in from the edges. No
  border: the card has its own.
- **Bold enough to read at 160 x 100.** In the 320 x 200 units you draw in, no line under 1.5 and no shape under 4. Fewer, larger marks beat many
  small ones.
- **No words or numbers.** Fonts do not load inside an image, so text renders in a fallback face. The card's name
  and blurb sit right under the picture.

## What the file may hold

Only drawing: `svg`, `g`, `defs`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`,
`linearGradient`, `radialGradient`, `stop` and `clipPath`, with their geometry, `fill`, `stroke`, opacity,
`transform`, `id` and `clip-path` attributes. Colours as `#rrggbb` (or `none`), with any transparency in
`fill-opacity`, `stroke-opacity` or `opacity` rather than in the colour; a gradient or clip referred to as
`url(#its-id)`. The root is `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">`.

Anything else makes the whole file unusable, so the card is drawn without it: no `text`, `image`, `use`, `a`, `style`, `script` or `foreignObject`; no `style` or `class`
attribute; no link or URL to anything outside the file; no DOCTYPE. Under 64 KB and 4,000 elements; most cards are under
20 KB (merge shapes of one colour into one `path`).

Draw it by writing the SVG by hand, or with a short script that reads the app's data and writes coordinates: either
way, the numbers come from the app.

## Check it, then look at it

1. From the package folder, `python3 /workspace/siblings/studio/scripts/card_art.py card.svg` prints `OK` or each reason the card would be
   drawn without it. Fix every reason; the workflow runs the same check.
2. Open `card.svg` in the browser at 320 x 200 and at 160 x 100, screenshot both with the agent computer's
   screenshot tool, as for the app, and look. Ask: would someone who
   has seen the app recognise it from this? Is anything too thin, too small or too busy at the small size? Fix and
   look again.
