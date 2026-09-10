"""Render every can to a single HTML sheet, for looking at them together.

The cans are React Native SVG, so the only way to see them normally is on
a device — which means one flavour at a time, and not at all when no
phone is plugged in. The point of the artwork is that flavours are
*distinguishable from each other*, and that is a judgement you can only
make with all of them side by side.

Reads the real path data out of Can.tsx and the real colours out of
catalog.ts rather than duplicating either, so the sheet cannot quietly
drift from what the app draws.

Usage:  py preview_cans.py   ->  writes cans-preview.html next to itself
"""

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
CAN_TSX = HERE / ".." / "src" / "components" / "Can.tsx"
CATALOG = HERE / ".." / "src" / "data" / "catalog.ts"
OUT = HERE / "cans-preview.html"

BODY_PATH = (
    "M17,9 C13,11 8,15 8,21 L8,85 C8,90 11,93 27,93 "
    "C43,93 46,90 46,85 L46,21 C46,15 41,11 37,9 Z"
)


def artwork_marks(src: str) -> dict[str, list[tuple[str, float, bool]]]:
    """kind -> [(d, opacity, is_secondary)], parsed out of artworkPaths()."""
    body = src[src.index("function artworkPaths") : src.index("\ntype Props")]
    marks: dict[str, list[tuple[str, float, bool]]] = {}
    # each `case "x":` (or `default:`) runs until the next one
    chunks = re.split(r'\n    (?:case "([a-z]+)":|(default):)', body)
    for i in range(1, len(chunks), 3):
        kind = chunks[i] or "bolt"  # `default:` is the bolt
        for d, rest in re.findall(r'\{ d: "([^"]+)", (.*?)\}', chunks[i + 2], re.S):
            op = float(re.search(r"opacity: ([\d.]+)", rest).group(1))
            marks.setdefault(kind, []).append((d, op, "secondary: true" in rest))
    return marks


def variants(src: str) -> list[dict]:
    out = []
    for blk in re.findall(r"\{\s*id: \"[^\"]+\",.*?blurb:", src, re.S):
        def g(k, default=""):
            m = re.search(k + r': "([^"]*)"', blk)
            return m.group(1) if m else default
        out.append(
            {
                "id": g("id"),
                "name": g("name"),
                "accent": g("accent"),
                "secondary": g("secondary"),
                "body": g("body"),
                "artwork": g("artwork"),
            }
        )
    return out


def can_svg(v: dict, marks: dict, size: int = 190) -> str:
    white = v["body"] == "white"
    shell = "#e8ece8" if white else "#0a0d0a"
    uid = v["id"]
    paths = "".join(
        f'<path d="{d}" fill="{v["secondary"] if sec else v["accent"]}" opacity="{op}"/>'
        for d, op, sec in marks.get(v["artwork"], [])
    )
    return f"""
<figure>
  <svg width="{size * 54 // 100}" height="{size}" viewBox="0 0 54 100">
    <defs>
      <clipPath id="c{uid}"><path d="{BODY_PATH}"/></clipPath>
      <linearGradient id="cyl{uid}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity="{0.3 if white else 0.55}"/>
        <stop offset="0.17" stop-color="#fff" stop-opacity="{0.55 if white else 0.2}"/>
        <stop offset="0.42" stop-color="#fff" stop-opacity="0.03"/>
        <stop offset="0.78" stop-color="#000" stop-opacity="{0.22 if white else 0.42}"/>
        <stop offset="1" stop-color="#000" stop-opacity="{0.42 if white else 0.68}"/>
      </linearGradient>
      <linearGradient id="band{uid}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="{v['accent']}" stop-opacity="0.7"/>
        <stop offset="0.28" stop-color="{v['accent']}"/>
        <stop offset="1" stop-color="{v['secondary']}" stop-opacity="0.8"/>
      </linearGradient>
    </defs>
    <ellipse cx="27" cy="8.6" rx="10.4" ry="2.9" fill="#9aa39a"/>
    <path d="{BODY_PATH}" fill="{shell}"/>
    <g clip-path="url(#c{uid})">
      {paths}
      <rect x="0" y="52" width="54" height="13" fill="url(#band{uid})"/>
      <rect x="0" y="67" width="54" height="2.6" fill="{v['secondary']}" opacity="0.75"/>
      <rect x="0" y="85" width="54" height="8" fill="#828a82" opacity="0.9"/>
      <rect x="0" y="0" width="54" height="100" fill="url(#cyl{uid})"/>
      <rect x="11.5" y="10" width="2.2" height="80" rx="1.1" fill="#fff"
            opacity="{0.5 if white else 0.22}"/>
    </g>
    <path d="{BODY_PATH}" fill="none" stroke="#000"
          stroke-opacity="{0.35 if white else 0.6}" stroke-width="0.8"/>
  </svg>
  <figcaption>{v['name']}<span>{v['artwork']}</span></figcaption>
</figure>"""


def main() -> None:
    marks = artwork_marks(CAN_TSX.read_text(encoding="utf-8"))
    vs = variants(CATALOG.read_text(encoding="utf-8"))
    cans = "".join(can_svg(v, marks) for v in vs)
    OUT.write_text(
        f"""<!doctype html><meta charset="utf-8"><title>Energy Radar cans</title>
<style>
 body{{margin:0;padding:32px;background:#0a0b0a;color:#eaf2ec;
   font:14px/1.4 system-ui,sans-serif}}
 h1{{font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#39ff6a;
   margin:0 0 24px}}
 .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));
   gap:26px}}
 figure{{margin:0;text-align:center}}
 figcaption{{margin-top:10px;font-size:12px;font-weight:600}}
 figcaption span{{display:block;font-weight:400;font-size:10px;letter-spacing:.1em;
   text-transform:uppercase;color:#7e8c82;margin-top:3px}}
</style>
<h1>{len(vs)} cans &middot; {len(marks)} marks</h1>
<div class="grid">{cans}</div>
""",
        encoding="utf-8",
    )
    print(f"{len(vs)} cans, {len(marks)} marks -> {OUT}")


if __name__ == "__main__":
    main()
