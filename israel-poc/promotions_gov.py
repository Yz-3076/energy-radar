"""
Real promotions, parsed directly from the same government PromoFull feeds
pipeline.py already scrapes for prices — no third-party API, no token, no
dependency on anyone else's auth working (see promotions.py's own
docstring for the auth-hang bug on openisraelisupermarkets.co.il that
motivated building this).

The raw feed is noisy: most "promotions" that technically list a Monster
barcode are blanket meal-voucher-card acceptance entries (Cibus, Sodexo,
Ten Bis) covering the store's entire catalog — confirmed 2026-09-10 by
inspecting a real store's promo file directly (one such entry covered
8,327 items, essentially the whole store). Two filters separate real,
targeted discounts from that noise:
  1. Item count — a real per-product deal applies to a small, specific
     list of items, never thousands. Anything over MAX_PROMO_ITEMS is
     assumed to be a blanket acceptance scheme, not a discount.
  2. Known voucher-provider names in the description — a direct
     confirmation on top of (1), for the specific brands actually seen.

Real promos are naturally store-specific (each PromoFull file belongs to
one branch) — genuinely more precise than the third-party API's
nationwide-per-barcode shape ever was. Output here still matches that same
variant_id -> [promo, ...] shape (data/promotions.json) rather than
plumbing store attribution through the whole app, though: every other
place this project reads promotions from already expects that shape, and
changing it is a bigger refactor than this pass needs. Worth revisiting if
per-store precision ever earns its cost.
"""

import xml.etree.ElementTree as ET
from pathlib import Path

from il_supermarket_scarper.scrappers_factory import ScraperFactory
from il_supermarket_scarper.utils.file_output import DiskFileOutput

DUMPS_DIR = Path(__file__).resolve().parent / "dumps"

MAX_PROMO_ITEMS = 60  # a real per-product deal is never this broad
VOUCHER_PROVIDERS = ("סיבוס", "סודקסו", "תן ביס", "תן-ביס", "10ביס")


async def fetch_store_promos(chain_name: str, store_id: str) -> Path:
    """Fetch one store's PromoFull file. Same fail-soft style as
    pipeline.py's fetch_files — a chain with no promo feed, or a momentary
    failure, must never take the run down."""
    out_dir = DUMPS_DIR / chain_name / "promos" / store_id
    scraper_cls = ScraperFactory.get(chain_name)
    if scraper_cls is None:
        return out_dir
    scraper = scraper_cls(file_output=DiskFileOutput(storage_path=str(out_dir)))
    try:
        async for _ in scraper.scrape(limit=1, files_types=["PROMO_FULL_FILE"], store_id=int(store_id)):
            pass
    except Exception as e:  # noqa: BLE001 — one store's promo fetch failing must never crash the run
        print(f"  promo fetch failed for {chain_name} store {store_id}: {type(e).__name__}: {e}")
    return out_dir


def _is_real_discount(promo_el) -> bool:
    desc = promo_el.findtext("PromotionDescription") or ""
    if any(v in desc for v in VOUCHER_PROVIDERS):
        return False
    item_count = sum(1 for _ in promo_el.iter("PromotionItem"))
    return 0 < item_count <= MAX_PROMO_ITEMS


def _to_int(s):
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _shape(promo_el, item_el) -> dict:
    """Shape one promo for one matched item. minQuantity/maxQuantity/
    discountRate come from the PromotionItem, not the Promotion — confirmed
    2026-09-10 against a real "2-for-16 NIS" deal where the Promotion-level
    MinNoOfItemOffered (10, a bundle-group total unrelated to this item) did
    not match the item's own MinQty (2, the actual "buy 2" threshold the
    description refers to)."""
    club_id = (promo_el.findtext("ClubID") or "0").strip()
    return {
        "description": (promo_el.findtext("PromotionDescription") or "").strip() or "Promotion",
        "discountRate": _to_float(item_el.findtext("DiscountRate")),
        "minQuantity": _to_int(item_el.findtext("MinQty")),
        "maxQuantity": _to_int(item_el.findtext("MaxQty")),
        "startsAt": promo_el.findtext("PromotionStartDateTime"),
        "endsAt": promo_el.findtext("PromotionEndDateTime"),
        "terms": (promo_el.findtext("AdditionalRestrictions") or "").strip() or None,
        "clubOnly": not club_id.startswith("0"),
    }


def _to_float(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def parse_store_promos(promo_dir: Path, barcode_to_variant: dict[str, str]) -> dict[str, list[dict]]:
    """One store's PromoFull file -> variant_id -> [promo, ...], real
    discounts only (see module docstring for why most of the raw feed gets
    filtered out)."""
    out: dict[str, list[dict]] = {}
    for path in promo_dir.glob("*.xml"):
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError:
            continue
        for promo_el in root.iter("Promotion"):
            if not _is_real_discount(promo_el):
                continue
            # map each matched variant to its own PromotionItem, since
            # different flavours in the same promo can carry different
            # quantities/prices (e.g. a mixed-case deal)
            variant_items: dict[str, object] = {}
            for item_el in promo_el.iter("PromotionItem"):
                code = item_el.findtext("ItemCode")
                variant_id = barcode_to_variant.get(code)
                if variant_id is not None:
                    variant_items.setdefault(variant_id, item_el)
            for variant_id, item_el in variant_items.items():
                out.setdefault(variant_id, []).append(_shape(promo_el, item_el))
    return out


def merge_promo_maps(*maps: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """Union several variant_id -> [promo, ...] maps, deduping identical
    promos (same variant + description + end date) so a chain-wide deal
    doesn't show up once per branch that happens to carry it."""
    merged: dict[str, list[dict]] = {}
    seen: set[tuple] = set()
    for m in maps:
        for variant_id, promos in m.items():
            for p in promos:
                key = (variant_id, p.get("description"), p.get("endsAt"))
                if key in seen:
                    continue
                seen.add(key)
                merged.setdefault(variant_id, []).append(p)
    return merged
