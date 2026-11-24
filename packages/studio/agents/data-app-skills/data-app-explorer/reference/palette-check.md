# The palette check

Every theme in `themes.css` already passes it in both modes. Run it when the app overrides a colour
(`reference/design.md`, "Colour"), once per mode, naming the app's theme:

```sh
T=$(ls -d /workspace/siblings/*/templates/data-app | head -1)
TH=$(grep -o 'data-theme="[a-z]*"' public/index.html | head -1 | cut -d'"' -f2)
python3 -I "$T"/palette.py public/themes.css public/styles.css --theme "$TH" --mode light
python3 -I "$T"/palette.py public/themes.css public/styles.css --theme "$TH" --mode dark
```

It prints each failure and exits 1; fix the override and run it again until both print `palette ok`. A note names two
categories to label directly wherever both appear. Standard library only.
