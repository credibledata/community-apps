"""The studio's agents stay inside the caps Publisher serves an agent under.

Publisher drops an agent from its package, with only a package warning, when its instructions or any task file
is over 16 KiB or its skill files total over 256 KiB (PACKAGE_AGENT_TEXT_MAX_BYTES and
PACKAGE_AGENT_SKILLS_MAX_BYTES in @malloy-publisher/server). A dropped agent cannot run, so an edit that crosses a
cap breaks every build, proposal and revisit at once.
"""
import json
import unittest
from pathlib import Path

STUDIO = Path(__file__).resolve().parent.parent / "packages" / "studio"
TEXT_MAX = 16 * 1024
SKILLS_MAX = 256 * 1024


class StudioAgentSize(unittest.TestCase):
    def test_every_agent_fits_publisher_caps(self):
        agents = json.loads((STUDIO / "publisher.json").read_text())["agents"]
        self.assertTrue(agents)
        for name, agent in agents.items():
            texts = [agent["instructions"], *(s["task"] for s in agent.get("schedules", []))]
            for rel in texts:
                size = (STUDIO / rel).stat().st_size
                self.assertLessEqual(size, TEXT_MAX, f"{name}: {rel} is {size} bytes, over Publisher's {TEXT_MAX}")
            skills = sum(f.stat().st_size for d in agent.get("skills", []) for f in (STUDIO / d).rglob("*") if f.is_file())
            self.assertLessEqual(skills, SKILLS_MAX, f"{name}: skill files total {skills} bytes, over {SKILLS_MAX}")


if __name__ == "__main__":
    unittest.main()
