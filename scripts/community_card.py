"""List an app from packages/ on community.credibledata.com: turn its `community-card.json` into an entry in the
community site's `src/content/apps.ts` and open a pull request there.

The community-card workflow runs this for each card a push to main adds or changes. Locally:

    python3 scripts/community_card.py packages/<name> --site <checkout of credibledata/community> [--pr]

Without --pr it only writes the entry into the checkout, so the site can be built and looked at first.

The card, written by whoever builds the app:

    {"name": "at most 40 characters", "blurb": "at most 60 words", "tag": "Explore", "accent": "#7a4520"}

`tag` is one of TAGS. `accent` is optional; without it the card takes the app's own colour: the light `--accent` of
the theme its public/index.html names (`<html data-theme="…">`), from public/themes.css, or for an app without a
theme the `--accent` in public/styles.css. Without either, the site draws the card in grey.

Card art, also optional, is the package's `card.svg`: a 320 x 200 drawing the builder makes of the app. The site never
gets the file as written. It is parsed, and only drawing elements and attributes with plain values are written into a
fresh SVG at public/thumbnails/<name>.svg on the site; anything else, and the card is drawn from its name, tag and
accent instead. The site serves the file from its own domain, where a script in it would run.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages" / "studio" / "scripts"))
from card_art import ART, clean_art  # noqa: E402  (one copy of the rules: the builder runs it too)

APPS_TS = "src/content/apps.ts"
TAGS = ("Explore", "Analyse", "Simulate")
HEX = re.compile(r"#[0-9a-fA-F]{6}")
SLUG = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
APP_URL = "https://community.app.credibledata.com/community-apps/{package}/latest/data-apps/index.html"


def card_problems(card: object) -> list[str]:
    """What keeps a card from becoming an entry."""
    if not isinstance(card, dict):
        return ["the card is not a JSON object"]
    problems = []
    name, blurb, tag, accent = card.get("name"), card.get("blurb"), card.get("tag"), card.get("accent")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 40:
        problems.append("name must be text of at most 40 characters")
    if not isinstance(blurb, str) or not blurb.strip() or len(blurb.split()) > 60:
        problems.append("blurb must be text of at most 60 words")
    if tag not in TAGS:
        problems.append(f"tag must be one of {', '.join(TAGS)}")
    if accent is not None and not (isinstance(accent, str) and HEX.fullmatch(accent)):
        problems.append("accent, when given, must be a colour such as #7a4520")
    unknown = sorted(set(card) - {"name", "blurb", "tag", "accent"})
    if unknown:
        problems.append(f"unknown keys: {', '.join(unknown)}")
    return problems


def accent_of(styles_css: str) -> str | None:
    """The app's `--accent` colour from its stylesheet; None if it is not a hex colour. The last one wins, as in a
    browser."""
    found = re.findall(r"--accent:\s*([^;]+);", re.sub(r"/\*.*?\*/", "", styles_css, flags=re.S))
    value = found[-1].strip() if found else ""
    return value.lower() if HEX.fullmatch(value) else None


def theme_accent(index_html: str, themes_css: str) -> str | None:
    """A themed app's colour: the light `--accent` of the theme `<html data-theme="…">` names. None when the page
    names no theme, or the stylesheet has no light block for it."""
    named = re.search(r"<html\b[^>]*\bdata-theme=[\"']([a-z]+)[\"']", re.sub(r"<!--.*?-->", "", index_html, flags=re.S))
    if not named:
        return None
    css = re.sub(r"/\*.*?\*/", "", themes_css.replace("\r\n", "\n"), flags=re.S)
    head = re.escape(':root[data-theme="' + named.group(1) + '"]')
    # Every block for the theme, in file order, as one: the last --accent wins, as in the browser.
    blocks = [m.group(1) for m in re.finditer(head + r"\s*\{([^}]*)\}", css)]
    return accent_of("\n".join(blocks)) if blocks else None


def takes_drawn_cards(apps_ts: str) -> bool:
    """The site's entry type has an optional `Thumb` and an `accent`, so an entry with no artwork builds."""
    return bool(re.search(r"^\s*Thumb\?:", apps_ts, re.M) and re.search(r"^\s*accent\?:", apps_ts, re.M))


def _quoted(text: str) -> str:
    # One line, single quotes: a line break would end the literal and break the site's build.
    return "'" + " ".join(text.split()).replace("\\", "\\\\").replace("'", "\\'") + "'"


def entry(slug: str, card: dict, accent: str | None, art: bool = False) -> str:
    """The entry as apps.ts writes them: two-space indent, single quotes, no semicolons, linked with `credible()`."""
    blurb = f"    blurb: {_quoted(card['blurb'])},"
    lines = [
        "  {",
        f"    slug: {_quoted(slug)},",
        f"    name: {_quoted(card['name'])},",
        # The site's formatter keeps a blurb on the key's line when it fits in 80 columns, and breaks it otherwise.
        *([blurb] if len(blurb) <= 80 else ["    blurb:", f"      {_quoted(card['blurb'])},"]),
        f"    href: credible({_quoted(slug)}),",
        f"    tag: {_quoted(card['tag'])},",
    ]
    if accent:
        lines.append(f"    accent: {_quoted(accent.lower())},")
    if art:
        lines.append(f"    art: {_quoted(f'/thumbnails/{slug}.svg')},")
    lines.append("  },")
    return "\n".join(lines) + "\n"


def listed(apps_ts: str, slug: str) -> bool:
    return bool(re.search(rf"^\s*slug: '{re.escape(slug)}',$", apps_ts, re.M))


def add_entry(apps_ts: str, text: str) -> str:
    """apps.ts with `text` appended to the `apps` array; ValueError if the array is not where apps.ts keeps it."""
    m = re.search(r"^export const apps: CommunityApp\[\] = \[\n(.*?)^\]\n", apps_ts, re.S | re.M)
    if not m:
        raise ValueError(f"no `export const apps: CommunityApp[] = [` array closed by a lone `]` in {APPS_TS}")
    return apps_ts[: m.end(1)] + text + apps_ts[m.end(1):]


def read_card(package: Path) -> tuple[str, dict, str | None]:
    """The package's slug, card and accent; SystemExit naming the problem when it cannot be listed."""
    slug = package.resolve().name
    if not SLUG.fullmatch(slug):
        raise SystemExit(f"Not listed: {slug} is not a package name")
    try:
        manifest = json.loads((package / "publisher.json").read_text())
    except (OSError, ValueError) as e:
        raise SystemExit(f"Not listed: {package}/publisher.json cannot be read ({e})")
    if manifest.get("name") != slug:
        raise SystemExit(f"Not listed: publisher.json names {manifest.get('name')!r}, not the folder's {slug!r}")
    if manifest.get("agents"):
        raise SystemExit(f"Not listed: {slug} holds agents, not an app")
    try:
        card = json.loads((package / "community-card.json").read_text())
    except (OSError, ValueError) as e:
        raise SystemExit(f"Not listed: {package}/community-card.json cannot be read ({e})")
    problems = card_problems(card)
    if problems:
        raise SystemExit(f"Not listed: {slug}'s card: {'; '.join(problems)}")
    public = package / "public"
    accent = card.get("accent")
    if not accent and (public / "themes.css").is_file() and (public / "index.html").is_file():
        # styles.css after themes.css, as the page links them, so an app's own override of its theme's accent wins.
        styles = (public / "styles.css").read_text() if (public / "styles.css").is_file() else ""
        accent = theme_accent((public / "index.html").read_text(), (public / "themes.css").read_text() + "\n" + styles)
    if not accent and (public / "styles.css").is_file():
        accent = accent_of((public / "styles.css").read_text())
    return slug, card, accent


def takes_art(apps_ts: str) -> bool:
    """The site's entry type has an optional `art` path."""
    return bool(re.search(r"^\s*art\?:", apps_ts, re.M))


def git(site: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=site, check=True, capture_output=True, text=True).stdout.strip()


def open_pr(site: Path, slug: str, card: dict, source: str, art: bool = False, art_note: str = "") -> str:
    """Commit the entry (and its art) on community-apps/<slug>, push it and open (or reuse) a pull request; returns its
    link."""
    branch = f"community-apps/{slug}"
    git(site, "checkout", "-B", branch)
    git(site, "add", APPS_TS, *([f"public/thumbnails/{slug}.svg"] if art else []))
    git(site, "-c", "user.name=community-apps", "-c", "user.email=community-apps@users.noreply.github.com",
        "commit", "-m", f"List {card['name']} from community-apps")
    git(site, "push", "--force", "origin", branch)
    found = subprocess.run(["gh", "pr", "list", "--head", branch, "--state", "open", "--json", "url", "-q", ".[0].url"],
                           cwd=site, check=True, capture_output=True, text=True).stdout.strip()
    if found:
        return found
    body = (
        f"Lists **{card['name']}** on the Apps page, from its card in credibledata/community-apps ({source}).\n\n"
        f"> {' '.join(card['blurb'].split())}\n\n"
        f"The card opens the data app at {APP_URL.format(package=slug)}. "
        + ("Its art is the app's own card.svg, rebuilt from its drawing elements: look at it in Files changed. " if art
           else "It is drawn from the app's name, tag and accent. " + (f"(Its card.svg was not used: {art_note}.) " if art_note else ""))
        + "Merging deploys the site: merge once that page opens the published app."
    )
    return subprocess.run(["gh", "pr", "create", "--head", branch, "--title", f"List {card['name']} on the Apps page",
                           "--body", body], cwd=site, check=True, capture_output=True, text=True).stdout.strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("package", type=Path, help="the app's folder, packages/<name>")
    ap.add_argument("--site", type=Path, required=True, help="a checkout of credibledata/community on its main branch")
    ap.add_argument("--pr", action="store_true", help="commit, push and open a pull request on the site")
    ap.add_argument("--source", default="a merge to main", help="where the card came from, for the pull request")
    args = ap.parse_args(argv)

    slug, card, accent = read_card(args.package)
    apps = args.site / APPS_TS
    text = apps.read_text()
    if not takes_drawn_cards(text):
        raise SystemExit(f"Not listed: the site's {APPS_TS} has no optional Thumb and accent, so a card without artwork would not build")
    if listed(text, slug):
        print(f"Already listed: {slug} is in {APPS_TS}; change its entry on the site by hand")
        return 0
    art, art_note = False, ""
    source_art = args.package / ART
    if source_art.is_file():
        clean, problems = (None, [f"the site's {APPS_TS} has no optional art"]) if not takes_art(text) else \
            clean_art(source_art.read_text(errors="replace"))
        if clean is None:
            art_note = "; ".join(problems[:5])
            print(f"Card art not used, so the card is drawn instead: {art_note}")
        else:
            (args.site / "public" / "thumbnails").mkdir(parents=True, exist_ok=True)
            (args.site / "public" / "thumbnails" / f"{slug}.svg").write_text(clean, encoding="utf-8")
            art = True
    apps.write_text(add_entry(text, entry(slug, card, accent, art)))
    if not args.pr:
        print(f"Wrote {slug}'s entry into {apps}" + (" and its art" if art else ""))
        return 0
    print(f"Listed: {open_pr(args.site, slug, card, args.source, art, art_note)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
