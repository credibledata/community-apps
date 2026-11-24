import json
import re
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from community_card import accent_of, theme_accent, add_entry, card_problems, clean_art, entry, listed, main, takes_drawn_cards  # noqa: E402

APPS_TS = """import type { ComponentType } from 'react'

export type CommunityApp = {
  slug: string
  Thumb?: ComponentType
  accent?: string
}

const credible = (pkg: string) =>
  `https://community.app.credibledata.com/community-apps/${pkg}`

export const apps: CommunityApp[] = [
  {
    slug: 'atlas',
    name: 'Atlas',
    blurb:
      'Browse a catalogue.',
    href: '/atlas',
    tag: 'Explore',
    Thumb: AtlasThumb,
  },
]
"""
ART = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet">'
       '<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4520"/></linearGradient>'
       '</defs><rect width="320" height="200" fill="#f4f1ec"/><path d="M 10 190 L 80 120 L 160 140 L 310 30" '
       'stroke="url(#g1)" stroke-width="4" fill="none" transform="translate(0, -2)"/></svg>')
CARD = {"name": "The price of coffee", "blurb": "A pound of coffee's price, since 1980.", "tag": "Explore"}


class CardTest(unittest.TestCase):
    def test_a_card_within_its_limits_has_no_problems(self):
        self.assertEqual(card_problems(CARD), [])
        self.assertEqual(card_problems({**CARD, "tag": "Simulate", "accent": "#7A4520"}), [])

    def test_a_card_out_of_its_limits_is_refused(self):
        self.assertEqual(len(card_problems({"name": "x" * 41, "blurb": "word " * 61, "tag": "News"})), 3)
        self.assertEqual(card_problems([]), ["the card is not a JSON object"])
        for bad in ({**CARD, "name": "  "}, {**CARD, "name": 7}, {**CARD, "blurb": " "}, {**CARD, "accent": "red"},
                    {**CARD, "Thumb": "x"}):
            with self.subTest(card=bad):
                self.assertEqual(len(card_problems(bad)), 1)

    def test_the_accent_is_read_only_as_a_hex_colour(self):
        self.assertEqual(accent_of(":root {\n  --accent: #7A4520;\n  --accent-soft: #f3e8dd;\n}"), "#7a4520")
        self.assertIsNone(accent_of(":root { --accent: var(--c1); }"))
        self.assertEqual(accent_of(":root { --accent: #2f6b9a; }\n/* --accent: #000000; */\n:root { --accent: #7a4520; }"), "#7a4520")

    def test_a_themed_app_takes_its_themes_light_accent(self):
        css = (Path(__file__).resolve().parents[1] / "packages/studio/templates/data-app/themes.css").read_text()
        light = re.search(r'^:root\[data-theme="harbor"\] \{\n(.*?)^\}', css, re.S | re.M).group(1)
        want = re.search(r"--accent:\s*(#[0-9a-fA-F]{6});", light).group(1).lower()
        self.assertEqual(theme_accent('<html lang="en" data-theme="harbor">', css), want)
        self.assertIsNone(theme_accent('<!-- <html data-theme="harbor"> --><html lang="en">', css))
        self.assertIsNone(theme_accent('<html data-theme="nosuch">', css))

    def test_the_entry_goes_last_links_with_credible_and_escapes_quotes(self):
        card = {**CARD, "name": "Coffee's\nprice"}
        out = add_entry(APPS_TS, entry("coffee-prices-2026", card, "#7A4520"))
        self.assertTrue(out.startswith(APPS_TS.rsplit("]\n", 1)[0]))
        self.assertTrue(out.endswith("    accent: '#7a4520',\n  },\n]\n"))
        self.assertIn("    name: 'Coffee\\'s price',\n", out)
        self.assertIn("    href: credible('coffee-prices-2026'),\n", out)
        self.assertNotIn("Thumb", out.split("coffee-prices-2026")[1])

    def test_a_backslash_cannot_end_the_literal(self):
        self.assertIn("name: 'C:\\\\data\\'s',", entry("x", {**CARD, "name": "C:\\data's"}, None))

    def test_only_a_site_that_draws_cards_takes_an_entry(self):
        self.assertTrue(takes_drawn_cards(APPS_TS))
        self.assertFalse(takes_drawn_cards(APPS_TS.replace("Thumb?:", "Thumb:")))
        self.assertFalse(takes_drawn_cards(APPS_TS.replace("  accent?: string\n", "")))

    def test_a_listed_slug_is_found(self):
        self.assertTrue(listed(APPS_TS, "atlas"))
        self.assertFalse(listed(APPS_TS, "atla"))


class ArtTest(unittest.TestCase):
    def test_a_drawing_is_rebuilt_and_kept(self):
        clean, problems = clean_art(ART)
        self.assertEqual(problems, [])
        self.assertIn('stroke="url(#g1)"', clean)
        self.assertTrue(clean.startswith('<svg xmlns="http://www.w3.org/2000/svg"'))

    def test_size_and_ids_are_plain(self):
        clean, problems = clean_art(ART.replace('viewBox="0 0 320 200"', 'viewBox="0 0 320 200" width="640" height="400"')
                                    .replace('id="g1"', 'id="grad_1"').replace("url(#g1)", "url(#grad_1)"))
        self.assertEqual(problems, [])
        self.assertNotIn("width=\"640\"", clean)
        self.assertIn('id="grad_1"', clean)

    def test_anything_but_drawing_is_refused(self):
        hostile = {
            "script": ART.replace("</svg>", "<script>alert(1)</script></svg>"),
            "handler": ART.replace("<rect ", '<rect onload="alert(1)" '),
            "foreign": ART.replace("</svg>", "<foreignObject><div/></foreignObject></svg>"),
            "link": ART.replace("</svg>", '<a href="https://x.test"><rect width="1" height="1"/></a></svg>'),
            "use": ART.replace("</svg>", '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#g1"/></svg>'),
            "image": ART.replace("</svg>", '<image href="data:image/png;base64,AAAA"/></svg>'),
            "style attr": ART.replace("<rect ", '<rect style="fill:red" '),
            "style element": ART.replace("</svg>", "<style>rect{fill:url(https://x.test/a)}</style></svg>"),
            "remote url": ART.replace("url(#g1)", "url(https://x.test/a#g1)"),
            "javascript": ART.replace('fill="#f4f1ec"', 'fill="javascript:alert(1)"'),
            "text": ART.replace("</svg>", '<text x="1" y="1">hi</text></svg>'),
            "stray text": ART.replace("</svg>", "hello</svg>"),
            "doctype": '<!DOCTYPE svg [<!ENTITY a "b">]>' + ART,
            "stylesheet": '<?xml-stylesheet href="https://x.test/a.css"?>' + ART,
            "other namespace": ART.replace("</svg>", '<x:rect xmlns:x="urn:x"/></svg>'),
            "viewBox": ART.replace("0 0 320 200", "0 0 100 100"),
            "not svg": "<html/>",
            "broken": ART[:-6],
            "too big": ART.replace("</svg>", "<g/>" * 20000 + "</svg>"),
            "relative url": ART.replace("url(#g1)", "url(evil.svg#g1)"),
            "upper URL": ART.replace("url(#g1)", "URL(evil.svg)"),
            "spaced url": ART.replace("url(#g1)", "url( evil )"),
            "relative clip": ART.replace("<rect ", '<rect clip-path="url(a.svg)" '),
            "root not svg": ART.replace("<svg ", "<g ").replace("</svg>", "</g>"),
            "root g with a viewBox": '<g xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200"/></g>',
            "too deep": ART.replace("</svg>", "<g>" * 1000 + "</g>" * 1000 + "</svg>"),
            "too many elements": ART.replace("</svg>", "<g/>" * 4500 + "</svg>"),
            "bad id": ART.replace("<rect ", '<rect id="1g" '),
            "too many bytes": ART.replace('d="M 10 190', 'd="M 10 190' + " L 1 1" * 12000),
        }
        for name, text in hostile.items():
            with self.subTest(name=name):
                clean, problems = clean_art(text)
                self.assertIsNone(clean)
                self.assertTrue(problems)


class MainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.site = self.tmp / "site"
        (self.site / "src/content").mkdir(parents=True)
        (self.site / "src/content/apps.ts").write_text(APPS_TS)
        self.pkg = self.tmp / "packages" / "coffee-prices-2026"
        (self.pkg / "public").mkdir(parents=True)
        (self.pkg / "publisher.json").write_text(json.dumps({"name": "coffee-prices-2026", "version": "0.1.0"}))
        (self.pkg / "community-card.json").write_text(json.dumps(CARD))
        (self.pkg / "public/styles.css").write_text(":root { --accent: #7a4520; }")

    def run_main(self):
        return main([str(self.pkg), "--site", str(self.site)])

    def test_a_card_becomes_an_entry_with_the_stylesheet_accent(self):
        self.assertEqual(self.run_main(), 0)
        out = (self.site / "src/content/apps.ts").read_text()
        self.assertIn("slug: 'coffee-prices-2026',", out)
        self.assertIn("accent: '#7a4520',", out)

    def test_a_themed_app_is_drawn_in_its_theme_over_its_stylesheet(self):
        (self.pkg / "public/themes.css").write_text(':root[data-theme="meadow"] {\n  --accent: #2f5d3a;\n}\n')
        (self.pkg / "public/index.html").write_text('<!doctype html>\n<html lang="en" data-theme="meadow">')
        self.assertEqual(self.run_main(), 0)
        self.assertIn("accent: '#2f5d3a',", (self.site / "src/content/apps.ts").read_text())

    def test_the_cards_own_accent_wins_over_the_theme(self):
        (self.pkg / "public/themes.css").write_text(':root[data-theme="meadow"] {\n  --accent: #2f5d3a;\n}\n')
        (self.pkg / "public/index.html").write_text('<html data-theme="meadow">')
        (self.pkg / "community-card.json").write_text(json.dumps({**CARD, "accent": "#123456"}))
        self.assertEqual(self.run_main(), 0)
        self.assertIn("accent: '#123456',", (self.site / "src/content/apps.ts").read_text())

    def test_listing_twice_adds_one_entry(self):
        self.run_main()
        self.run_main()
        self.assertEqual((self.site / "src/content/apps.ts").read_text().count("coffee-prices-2026"), 2)  # slug and href

    def test_refusals_name_their_reason(self):
        cases = [
            ("publisher.json", json.dumps({"name": "other"}), "not the folder's"),
            ("publisher.json", json.dumps({"name": "coffee-prices-2026", "agents": {"a": {}}}), "holds agents"),
            ("community-card.json", "{", "cannot be read"),
            ("community-card.json", json.dumps({**CARD, "tag": "News"}), "tag must be one of"),
        ]
        for name, text, reason in cases:
            with self.subTest(reason=reason):
                self.setUp()
                (self.pkg / name).write_text(text)
                with self.assertRaises(SystemExit) as e:
                    self.run_main()
                self.assertIn(reason, str(e.exception))
                self.assertEqual((self.site / "src/content/apps.ts").read_text(), APPS_TS)

    def test_valid_art_goes_to_the_site_and_the_entry(self):
        (self.site / "src/content/apps.ts").write_text(APPS_TS.replace("  accent?: string\n", "  accent?: string\n  art?: string\n"))
        (self.pkg / "card.svg").write_text(ART)
        self.assertEqual(self.run_main(), 0)
        self.assertIn("    art: '/thumbnails/coffee-prices-2026.svg',\n", (self.site / "src/content/apps.ts").read_text())
        self.assertEqual((self.site / "public/thumbnails/coffee-prices-2026.svg").read_text(), clean_art(ART)[0])

    def test_bad_art_or_a_site_without_art_falls_back_to_the_drawn_card(self):
        for site_has_art, art in ((True, ART.replace("</svg>", "<script/></svg>")), (False, ART)):
            with self.subTest(site_has_art=site_has_art):
                self.setUp()
                apps = APPS_TS.replace("  accent?: string\n", "  accent?: string\n  art?: string\n") if site_has_art else APPS_TS
                (self.site / "src/content/apps.ts").write_text(apps)
                (self.pkg / "card.svg").write_text(art)
                self.assertEqual(self.run_main(), 0)
                out = (self.site / "src/content/apps.ts").read_text()
                self.assertIn("slug: 'coffee-prices-2026',", out)
                self.assertNotIn("art:", out)
                self.assertFalse((self.site / "public/thumbnails").exists())

    def test_a_short_blurb_stays_on_the_key_line(self):
        self.assertIn("    blurb: 'Short.',\n", entry("x", {**CARD, "blurb": "Short."}, None))
        long = "word " * 20
        self.assertIn("    blurb:\n      'word", entry("x", {**CARD, "blurb": long}, None))

    def test_the_pull_request_commits_the_art_and_says_why_art_was_dropped(self):
        import subprocess as sp
        remote = self.tmp / "remote.git"
        sp.run(["git", "init", "-q", "--bare", str(remote)], check=True)
        sp.run(["git", "init", "-q", "-b", "main", str(self.site)], check=True)
        apps = APPS_TS.replace("  accent?: string\n", "  accent?: string\n  art?: string\n")
        (self.site / "src/content/apps.ts").write_text(apps)
        for args in (["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"],
                     ["remote", "add", "origin", str(remote)], ["push", "-q", "origin", "main"]):
            sp.run(["git", *args], cwd=self.site, check=True)
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        log = self.tmp / "gh.log"
        (bin_dir / "gh").write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> {log}\n[ "$2" = create ] && echo https://example.test/pr/1\nexit 0\n')
        (bin_dir / "gh").chmod(0o755)
        from unittest import mock
        patch = mock.patch.dict(os.environ, {"PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"})
        patch.start()
        self.addCleanup(patch.stop)
        (self.pkg / "card.svg").write_text(ART)
        self.assertEqual(main([str(self.pkg), "--site", str(self.site), "--pr"]), 0)
        files = sp.run(["git", "show", "--name-only", "--format=", "community-apps/coffee-prices-2026"], cwd=self.site,
                       capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(sorted(files), ["public/thumbnails/coffee-prices-2026.svg", "src/content/apps.ts"])
        self.assertIn("Its art is the app's own card.svg", log.read_text())

        log.write_text("")
        self.pkg = self.tmp / "packages" / "tea-prices"
        (self.pkg / "public").mkdir(parents=True)
        (self.pkg / "publisher.json").write_text(json.dumps({"name": "tea-prices", "version": "0.1.0"}))
        (self.pkg / "community-card.json").write_text(json.dumps({**CARD, "name": "Tea"}))
        (self.pkg / "card.svg").write_text(ART.replace("</svg>", "<script/></svg>"))
        sp.run(["git", "checkout", "-q", "main"], cwd=self.site, check=True)
        self.assertEqual(main([str(self.pkg), "--site", str(self.site), "--pr"]), 0)
        self.assertIn("Its card.svg was not used: <script> is not a drawing element", log.read_text())

    def test_a_site_without_drawn_cards_is_left_alone(self):
        (self.site / "src/content/apps.ts").write_text(APPS_TS.replace("Thumb?:", "Thumb:"))
        with self.assertRaises(SystemExit) as e:
            self.run_main()
        self.assertIn("no optional Thumb", str(e.exception))


if __name__ == "__main__":
    unittest.main()
