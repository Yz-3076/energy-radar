"""Reconcile this run's data/ with whatever landed on main while it ran.

    py merge_data.py <dir-holding-this-run's-data>

Called by the workflow when a push is rejected. The working tree has already
been reset to origin/main, so this merges OUR output back over THEIRS with
rules that suit each file, then the caller commits and pushes again.

Why not `git rebase`: these files are machine-generated, and a textual
three-way merge of pretty-printed JSON produces conflict markers — which is
exactly what happened on 2026-09-14, when a hand commit touching
town-coords.json collided with a running scrape. The retry loop rebased,
conflicted, and every later attempt failed against a rebase that was still
in progress, so a 50-minute nationwide scrape was thrown away over a cache
file where both sides were trivially reconcilable.

Merge rules, by what the file actually is:

  latest.json, stats.json   OURS wins wholesale. They are a complete
                            snapshot regenerated every run, so the newer
                            one is simply correct and merging them is
                            meaningless.
  history/*.ndjson          UNION of lines, order preserved. Append-only
                            observations; losing either side loses history.
  *-cache.json,             UNION of keys. An address or town resolves to
  town-coords.json          the same coordinate whoever asked, so a
                            collision is not a disagreement. Ours wins on
                            the few keys that differ, since ours is newer.
  anything else             left as it came from origin/main — reference
                            data like city-codes.json is edited by hand,
                            never by a run.
"""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

SNAPSHOTS = ("latest.json", "stats.json", "promotions.json")
UNION_CACHES = ("geocode-cache.json", "town-coords.json", "promo-cache.json")


def merge_union(ours: Path, theirs: Path) -> int:
    """theirs <- theirs | ours, ours winning on overlap. Returns key count."""
    a = json.loads(theirs.read_text(encoding="utf-8")) if theirs.exists() else {}
    b = json.loads(ours.read_text(encoding="utf-8")) if ours.exists() else {}
    if not isinstance(a, dict) or not isinstance(b, dict):
        # Not a keyed cache after all — don't invent a merge, take ours.
        shutil.copy2(ours, theirs)
        return 0
    a.update(b)
    theirs.write_text(
        json.dumps(a, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    return len(a)


def merge_history(ours_dir: Path, theirs_dir: Path) -> int:
    """Union of observation lines per month file, first-seen order kept."""
    added = 0
    theirs_dir.mkdir(parents=True, exist_ok=True)
    for ours in sorted(ours_dir.glob("*.ndjson")):
        theirs = theirs_dir / ours.name
        seen, out = set(), []
        for src in (theirs, ours):
            if not src.exists():
                continue
            for line in src.read_text(encoding="utf-8").splitlines():
                if line and line not in seen:
                    seen.add(line)
                    out.append(line)
        before = len(theirs.read_text(encoding="utf-8").splitlines()) if theirs.exists() else 0
        theirs.write_text("\n".join(out) + "\n", encoding="utf-8")
        added += len(out) - before
    return added


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    ours_root = Path(sys.argv[1])
    if not ours_root.is_dir():
        sys.exit(f"{ours_root} is not a directory")

    for name in SNAPSHOTS:
        src = ours_root / name
        if src.exists():
            shutil.copy2(src, DATA / name)
            print(f"  {name}: took ours (complete snapshot)")

    for name in UNION_CACHES:
        src = ours_root / name
        if src.exists():
            n = merge_union(src, DATA / name)
            print(f"  {name}: unioned -> {n} keys")

    if (ours_root / "history").is_dir():
        n = merge_history(ours_root / "history", DATA / "history")
        print(f"  history/: {n} new observation line(s)")


if __name__ == "__main__":
    main()
