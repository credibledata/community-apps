# Fonts

Type does most of the work of making an app look designed: a light, large sans for titles and numbers, and a serif
for everything the reader reads as prose. Font files are binary and the box refuses binary files, so the fonts ship
inside a stylesheet, `public/fonts.css`, as base64 text. Every face here is under the SIL Open Font License, which
lets them ship in a package as long as the license travels with them.

| Face | Role | Size in fonts.css |
|---|---|---|
| Figtree | Titles, numbers, labels, controls: everything that is not prose | about 27 KB |
| Source Serif 4, upright and italic | Ledes, card descriptions, findings, method notes, About | about 137 KB |
| Inter | Instead of Figtree, for a plainer, denser sans: tables and figures read side by side (Ledger) | about 65 KB |
| Fraunces | Titles, when a serif look (`data-face="serif"`) wants a display face with more character | about 49 KB |

Never ship any other font, and never a data publisher's or an organization's own: their fonts are licensed to them.

## Write fonts.css

Run the templates' script (`reference/app-frame.md`) with the faces you need. It fetches each pinned file, checks
its sum, and writes `public/fonts.css` and the licenses to `public/vendor/fonts/`:

```sh
T=$(ls -d /workspace/siblings/*/templates/data-app | head -1)
python3 -I "$T"/fonts.py public figtree source-serif-4
```

Run it again with a third face, such as `fraunces`, when the look uses one; each run writes the whole file again.
Then point the stylesheet's `:root` at it: `--font-ui: "Inter Variable", …` for Inter, or
`--font-display: "Fraunces Variable", …` for Fraunces, keeping the rest of each stack. A face nothing names is
65 or 49 KB the app never uses.

Load it first, before `styles.css`: `<link rel="stylesheet" href="./fonts.css">`. The stacks in
`reference/design.md` name these families first and fall back to system faces, so a page still reads if the file
is missing. If the host does not answer, say so in the hand-over and ship without `fonts.css`; never keep a file
whose sum differs.

Add a line per face to `public/vendor/README.md`: the family, "SIL Open Font License 1.1, from Fontsource
(`@fontsource-variable/<name>@<version>`), license in vendor/fonts/".
