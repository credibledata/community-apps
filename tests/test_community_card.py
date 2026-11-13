import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from community_card import accent_of, add_entry, card_problems, entry, listed, main, takes_drawn_cards  # noqa: E402

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

    def test_a_site_without_drawn_cards_is_left_alone(self):
        (self.site / "src/content/apps.ts").write_text(APPS_TS.replace("Thumb?:", "Thumb:"))
        with self.assertRaises(SystemExit) as e:
            self.run_main()
        self.assertIn("no optional Thumb", str(e.exception))


if __name__ == "__main__":
    unittest.main()
