# The palette check

The colours are yours to choose (`reference/design.md`, "Colour"); this check says whether they work. Run the
templates' script (`reference/app-frame.md`) after every change to the tokens and before you hand over:

```sh
T=$(ls -d /workspace/siblings/*/templates/data-app | head -1)
python3 -I "$T"/palette.py public/styles.css
```

It prints each failure and exits 1; fix the tokens and run it
again until it prints `palette ok`. Standard library only.

