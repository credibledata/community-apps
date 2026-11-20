import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from community_card import accent_of, card_problems, clean_art, listed, listing, main  # noqa: E402

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

    def test_the_listing_is_one_line_per_field_with_a_lowercase_accent(self):
        out = json.loads(listing("coffee-prices-2026", {**CARD, "name": "Coffee's\nprice"}, "#7A4520", True,
                                 "2026-11-20T18:04:00Z"))
        self.assertEqual(out, {"name": "Coffee's price", "blurb": CARD["blurb"], "tag": "Explore", "accent": "#7a4520",
                               "art": "/thumbnails/coffee-prices-2026.svg", "listedAt": "2026-11-20T18:04:00Z"})
        self.assertNotIn("accent", json.loads(listing("x", CARD, None, False, "2026-11-20T18:04:00Z")))
        self.assertNotIn("art", json.loads(listing("x", CARD, None, False, "2026-11-20T18:04:00Z")))


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
        (self.site / "src/content/listed").mkdir(parents=True)
        (self.site / "src/content/apps.ts").write_text(APPS_TS)
        self.listed = self.site / "src/content/listed/coffee-prices-2026.json"
        self.pkg = self.tmp / "packages" / "coffee-prices-2026"
        (self.pkg / "public").mkdir(parents=True)
        (self.pkg / "publisher.json").write_text(json.dumps({"name": "coffee-prices-2026", "version": "0.1.0"}))
        (self.pkg / "community-card.json").write_text(json.dumps(CARD))
        (self.pkg / "public/styles.css").write_text(":root { --accent: #7a4520; }")

    def run_main(self):
        return main([str(self.pkg), "--site", str(self.site)])

    def test_a_card_becomes_a_listing_file_with_the_stylesheet_accent(self):
        self.assertEqual(self.run_main(), 0)
        out = json.loads(self.listed.read_text())
        self.assertEqual(out["accent"], "#7a4520")
        self.assertRegex(out["listedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertEqual((self.site / "src/content/apps.ts").read_text(), APPS_TS)

    def test_an_app_already_on_the_site_is_left_alone(self):
        self.run_main()
        first = self.listed.read_text()
        self.run_main()
        self.assertEqual(self.listed.read_text(), first)
        self.assertTrue(listed(self.site, "atlas"))  # written by hand in apps.ts
        self.assertFalse(listed(self.site, "atla"))

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
                self.assertFalse(self.listed.exists())

    def test_valid_art_goes_to_the_site_and_the_listing(self):
        (self.pkg / "card.svg").write_text(ART)
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(json.loads(self.listed.read_text())["art"], "/thumbnails/coffee-prices-2026.svg")
        self.assertEqual((self.site / "public/thumbnails/coffee-prices-2026.svg").read_text(), clean_art(ART)[0])

    def test_bad_art_falls_back_to_the_drawn_card(self):
        (self.pkg / "card.svg").write_text(ART.replace("</svg>", "<script/></svg>"))
        self.assertEqual(self.run_main(), 0)
        self.assertNotIn("art", json.loads(self.listed.read_text()))
        self.assertFalse((self.site / "public/thumbnails").exists())

    def test_the_pull_request_commits_the_art_and_says_why_art_was_dropped(self):
        import subprocess as sp
        remote = self.tmp / "remote.git"
        sp.run(["git", "init", "-q", "--bare", str(remote)], check=True)
        sp.run(["git", "init", "-q", "-b", "main", str(self.site)], check=True)
        (self.site / "src/content/listed/README.md").write_text("listed apps\n")
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
        self.assertEqual(sorted(files), ["public/thumbnails/coffee-prices-2026.svg", "src/content/listed/coffee-prices-2026.json"])
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

        # Both were opened from the same main, as the workflow opens them. Merged one after the other, neither conflicts.
        sp.run(["git", "checkout", "-q", "main"], cwd=self.site, check=True)
        for branch in ("community-apps/coffee-prices-2026", "community-apps/tea-prices"):
            merged = sp.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "merge", "-q", "--no-edit", branch],
                            cwd=self.site, capture_output=True, text=True)
            self.assertEqual(merged.returncode, 0, merged.stdout + merged.stderr)
        self.assertEqual(sorted(p.name for p in (self.site / "src/content/listed").glob("*.json")),
                         ["coffee-prices-2026.json", "tea-prices.json"])

    def test_a_site_without_listing_files_is_left_alone(self):
        (self.site / "src/content/listed").rmdir()
        with self.assertRaises(SystemExit) as e:
            self.run_main()
        self.assertIn("has no src/content/listed/", str(e.exception))
        self.assertEqual((self.site / "src/content/apps.ts").read_text(), APPS_TS)


if __name__ == "__main__":
    unittest.main()
