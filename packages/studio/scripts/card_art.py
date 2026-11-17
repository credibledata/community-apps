"""Check a community card's art, and rebuild it from its drawing elements alone.

    python3 card_art.py <card.svg>      prints OK, or why the card would be drawn without it

The app builder runs this on the card.svg it drew; the listing workflow in credibledata/community-apps
(scripts/community_card.py) runs the same check and writes only the rebuilt drawing to the community site, which
serves it from its own domain, where a script in it would run. Standard library only.
"""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET

ART = "card.svg"
ART_MAX_BYTES = 64 * 1024
SVG_NS = "http://www.w3.org/2000/svg"
# Drawing only: no text (fonts do not load inside an image), no links, images, scripts, styles or foreign content.
SHARED = {"id", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
          "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity", "transform",
          "clip-path", "clip-rule"}
ART_ELEMENTS = {
    "svg": {"viewBox", "preserveAspectRatio", "width", "height"}, "g": set(), "defs": set(),
    "rect": {"x", "y", "width", "height", "rx", "ry"}, "circle": {"cx", "cy", "r"}, "ellipse": {"cx", "cy", "rx", "ry"},
    "line": {"x1", "y1", "x2", "y2"}, "polyline": {"points"}, "polygon": {"points"}, "path": {"d"},
    "linearGradient": {"x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform"},
    "radialGradient": {"cx", "cy", "r", "fx", "fy", "gradientUnits", "gradientTransform"},
    "stop": {"offset", "stop-color", "stop-opacity"}, "clipPath": {"clipPathUnits"},
}
PLAIN = re.compile(r"[A-Za-z0-9_#.,%+\-() \t\n\r]*")
LOCAL_URL = re.compile(r"url\(#[A-Za-z][\w-]*\)")
ART_MAX_ELEMENTS = 4000
ART_MAX_DEPTH = 32


def clean_art(text: str) -> tuple[str | None, list[str]]:
    """The card art rebuilt from its drawing elements alone, or None and why it cannot be used."""
    if len(text.encode()) > ART_MAX_BYTES:
        return None, [f"it is over {ART_MAX_BYTES // 1024} KB"]
    if re.search(r"<!(DOCTYPE|ENTITY)|<\?xml-stylesheet", text, re.I):
        return None, ["it declares a DOCTYPE, an entity or a stylesheet"]
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        return None, [f"it is not well-formed XML ({e})"]
    problems: list[str] = []
    count = 0

    def name_of(tag: str) -> str | None:
        ns, _, local = tag.rpartition("}")
        return local if ns in ("", "{" + SVG_NS) else None

    def build(src: ET.Element, depth: int = 0) -> ET.Element | None:
        nonlocal count
        if depth > ART_MAX_DEPTH:
            problems.append(f"it nests deeper than {ART_MAX_DEPTH} levels")
            return None
        name = name_of(src.tag)
        if name not in ART_ELEMENTS:
            problems.append(f"<{src.tag.rpartition('}')[2]}> is not a drawing element")
            return None
        count += 1
        out = ET.Element(f"{{{SVG_NS}}}{name}")
        for key, value in src.attrib.items():
            if key.startswith("{") or key not in ART_ELEMENTS[name] | SHARED:
                problems.append(f"{key.rpartition('}')[2]} on <{name}> is not allowed")
            elif (not PLAIN.fullmatch(LOCAL_URL.sub("", value)) or re.search("url", LOCAL_URL.sub("", value), re.I)
                  or (key == "id" and not re.fullmatch(r"[A-Za-z][\w-]*", value))):
                problems.append(f"{key}={value[:40]!r} on <{name}> is not a plain value")
            else:
                out.set(key, value)
        if (src.text or "").strip() or any((child.tail or "").strip() for child in src):
            problems.append(f"<{name}> holds text")
        for child in src:
            built = build(child, depth + 1)
            if built is not None:
                out.append(built)
        return out

    if name_of(root.tag) != "svg":
        return None, ["its root is not <svg>"]
    clean = build(root)
    if root.get("viewBox", "").split() != ["0", "0", "320", "200"]:
        problems.append("its viewBox is not 0 0 320 200")
    if count > ART_MAX_ELEMENTS:
        problems.append(f"it has over {ART_MAX_ELEMENTS} elements")
    if problems or clean is None:
        return None, problems or ["it is not an <svg>"]
    clean.attrib.pop("width", None)
    clean.attrib.pop("height", None)
    ET.register_namespace("", SVG_NS)
    return ET.tostring(clean, encoding="unicode") + "\n", []


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        raise SystemExit(__doc__)
    clean, problems = clean_art(open(argv[0], encoding="utf-8", errors="replace").read())
    if clean is None:
        print("Not usable, so the card would be drawn without it:")
        for p in problems[:20]:
            print(f"  - {p}")
        return 1
    print(f"OK: {len(clean.encode())} bytes once rebuilt")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
