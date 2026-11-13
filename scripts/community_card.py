"""List an app from packages/ on community.credibledata.com: turn its `community-card.json` into an entry in the
community site's `src/content/apps.ts` and open a pull request there.

The community-card workflow runs this for each card a push to main adds or changes. Locally:

    python3 scripts/community_card.py packages/<name> --site <checkout of credibledata/community> [--pr]

Without --pr it only writes the entry into the checkout, so the site can be built and looked at first.

The card, written by whoever builds the app:

    {"name": "at most 40 characters", "blurb": "at most 60 words", "tag": "Explore", "accent": "#7a4520"}

`tag` is one of TAGS. `accent` is optional; without it the app's `--accent` in public/styles.css is used, and
without that the site draws the card in grey.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

APPS_TS = "src/content/apps.ts"
TAGS = ("Explore", "Analyse", "Simulate")
HEX = re.compile(r"#[0-9a-fA-F]{6}")
SLUG = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
PACKAGE_URL = "https://community.app.credibledata.com/community-apps/{package}"


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


def takes_drawn_cards(apps_ts: str) -> bool:
    """The site's entry type has an optional `Thumb` and an `accent`, so an entry with no artwork builds."""
    return bool(re.search(r"^\s*Thumb\?:", apps_ts, re.M) and re.search(r"^\s*accent\?:", apps_ts, re.M))


def _quoted(text: str) -> str:
    # One line, single quotes: a line break would end the literal and break the site's build.
    return "'" + " ".join(text.split()).replace("\\", "\\\\").replace("'", "\\'") + "'"


def entry(slug: str, card: dict, accent: str | None) -> str:
    """The entry as apps.ts writes them: two-space indent, single quotes, no semicolons, linked with `credible()`."""
    lines = [
        "  {",
        f"    slug: {_quoted(slug)},",
        f"    name: {_quoted(card['name'])},",
        "    blurb:",
        f"      {_quoted(card['blurb'])},",
        f"    href: credible({_quoted(slug)}),",
        f"    tag: {_quoted(card['tag'])},",
    ]
    if accent:
        lines.append(f"    accent: {_quoted(accent.lower())},")
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
    styles = package / "public" / "styles.css"
    accent = card.get("accent") or (accent_of(styles.read_text()) if styles.is_file() else None)
    return slug, card, accent


def git(site: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=site, check=True, capture_output=True, text=True).stdout.strip()


def open_pr(site: Path, slug: str, card: dict, source: str) -> str:
    """Commit the entry on community-apps/<slug>, push it and open (or reuse) a pull request; returns its link."""
    branch = f"community-apps/{slug}"
    git(site, "checkout", "-B", branch)
    git(site, "add", APPS_TS)
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
        f"The card links to {PACKAGE_URL.format(package=slug)} and is drawn from its name, tag and accent. "
        "Merging deploys the site: merge once that page opens the published app."
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
    apps.write_text(add_entry(text, entry(slug, card, accent)))
    if not args.pr:
        print(f"Wrote {slug}'s entry into {apps}")
        return 0
    print(f"Listed: {open_pr(args.site, slug, card, args.source)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
