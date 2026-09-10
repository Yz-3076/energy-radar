"""Turn raw phone screenshots into Play-Store-ready listing images.

Two things the raw captures get wrong:

1. The status bar carries the phone owner's real notification icons —
   Instagram, Discord, whatever happened to be unread. Android's demo mode
   fixes the clock and battery but did not suppress those on this device,
   and clearing someone's actual notifications to get a clean shot is not
   a reasonable thing to do to their phone. So the status bar is cropped
   off entirely, which also just looks tidier in a listing.

2. A Pixel 8 Pro screenshot is 1008x2244, an aspect ratio of 2.23:1. Play
   caps phone screenshots at 2:1, so the raw files would be rejected.

Output is letterboxed onto the app's own background colour rather than
stretched: the UI keeps its real proportions, and the padding is
invisible against the app's dark theme.

Usage:  py prepare_store_screenshots.py [--src DIR] [--out DIR]
"""

import argparse
from pathlib import Path

from PIL import Image

# Matches app.json's backgroundColor, so the padding reads as part of the
# screenshot rather than as a border around it.
BACKDROP = (10, 11, 10)

# Status bar height on this device, from the app's own WindowInsets log
# (statusBars:[0,113,0,0]).
STATUS_BAR_PX = 113

# 9:16 — comfortably inside Play's limits and the most common phone
# listing size, so the images look right next to other apps.
TARGET = (1080, 1920)


def prepare(src: Path, dst: Path) -> tuple[int, int]:
    img = Image.open(src).convert("RGB")
    img = img.crop((0, STATUS_BAR_PX, img.width, img.height))

    scale = min(TARGET[0] / img.width, TARGET[1] / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)

    canvas = Image.new("RGB", TARGET, BACKDROP)
    canvas.paste(resized, ((TARGET[0] - resized.width) // 2, (TARGET[1] - resized.height) // 2))
    canvas.save(dst, "PNG", optimize=True)
    return canvas.size


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=here / ".." / ".." / "store-assets" / "screenshots")
    ap.add_argument("--out", default=here / ".." / ".." / "store-assets" / "play-listing")
    args = ap.parse_args()

    src_dir, out_dir = Path(args.src).resolve(), Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    shots = sorted(src_dir.glob("*.png"))
    if not shots:
        raise SystemExit(f"no screenshots in {src_dir}")

    for shot in shots:
        size = prepare(shot, out_dir / shot.name)
        print(f"  {shot.name}  ->  {size[0]}x{size[1]}")
    print(f"\n{len(shots)} image(s) ready in {out_dir}")


if __name__ == "__main__":
    main()
