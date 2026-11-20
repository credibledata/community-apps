"""List an app from packages/ on community.credibledata.com: turn its `community-card.json` into the file
`src/content/listed/<name>.json` on the community site and open a pull request there. Each app is a file of its own,
so two listing pull requests never conflict.

The community-card workflow runs this for each card a push to main adds or changes. Locally:

    python3 scripts/community_card.py packages/<name> --site <checkout of credibledata/community> [--pr]

Without --pr it only writes the file into the checkout, so the site can be built and looked at first.

The card, written by whoever builds the app:

    {"name": "at most 40 characters", "blurb": "at most 60 words", "tag": "Explore", "accent": "#7a4520"}

`tag` is one of TAGS. `accent` is optional; without it the app's `--accent` in public/styles.css is used, and
without that the site draws the card in grey.

Card art, also optional, is the package's `card.svg`: a 320 x 200 drawing the builder makes of the app. The site never
gets the file as written. It is parsed, and only drawing elements and attributes with plain values are written into a
fresh SVG at public/thumbnails/<name>.svg on the site; anything else, and the card is drawn from its name, tag and
accent instead. The site serves the file from its own domain, where a script in it would run.
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages" / "studio" / "scripts"))
from card_art import ART, clean_art  # noqa: E402  (one copy of the rules: the builder runs it too)

APPS_TS = "src/content/apps.ts"
LISTED = "src/content/listed"
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


def listing(slug: str, card: dict, accent: str | None, art: bool, listed_at: str) -> str:
    """The app's listing file, as the site reads it: the card's text on one line each, the accent lowercase, the art
    always the package's own path, and when it was listed, which orders the site's cards."""
    data = {"name": " ".join(card["name"].split()), "blurb": " ".join(card["blurb"].split()), "tag": card["tag"]}
    if accent:
        data["accent"] = accent.lower()
    if art:
        data["art"] = f"/thumbnails/{slug}.svg"
    data["listedAt"] = listed_at
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def listed(site: Path, slug: str) -> bool:
    """The app is on the site already: as a listing file, or written by hand in apps.ts."""
    if (site / LISTED / f"{slug}.json").exists():
        return True
    apps_ts = site / APPS_TS
    return apps_ts.is_file() and bool(re.search(rf"^\s*slug: '{re.escape(slug)}',$", apps_ts.read_text(), re.M))


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
    styles = package / "public" / "styles.css"
    accent = card.get("accent") or (accent_of(styles.read_text()) if styles.is_file() else None)
    return slug, card, accent


def git(site: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=site, check=True, capture_output=True, text=True).stdout.strip()


def open_pr(site: Path, slug: str, card: dict, source: str, art: bool = False, art_note: str = "") -> str:
    """Commit the listing file (and its art) on community-apps/<slug>, push it and open (or reuse) a pull request; returns its
    link."""
    branch = f"community-apps/{slug}"
    git(site, "checkout", "-B", branch)
    git(site, "add", f"{LISTED}/{slug}.json", *([f"public/thumbnails/{slug}.svg"] if art else []))
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
    folder = args.site / LISTED
    if not folder.is_dir():
        raise SystemExit(f"Not listed: the site has no {LISTED}/, so it cannot read a listing file")
    if listed(args.site, slug):
        print(f"Already listed: {slug} is on the site; change it there by hand")
        return 0
    art, art_note = False, ""
    source_art = args.package / ART
    if source_art.is_file():
        clean, problems = clean_art(source_art.read_text(errors="replace"))
        if clean is None:
            art_note = "; ".join(problems[:5])
            print(f"Card art not used, so the card is drawn instead: {art_note}")
        else:
            (args.site / "public" / "thumbnails").mkdir(parents=True, exist_ok=True)
            (args.site / "public" / "thumbnails" / f"{slug}.svg").write_text(clean, encoding="utf-8")
            art = True
    listed_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    (folder / f"{slug}.json").write_text(listing(slug, card, accent, art, listed_at), encoding="utf-8")
    if not args.pr:
        print(f"Wrote {folder / f'{slug}.json'}" + (" and its art" if art else ""))
        return 0
    print(f"Listed: {open_pr(args.site, slug, card, args.source, art, art_note)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
