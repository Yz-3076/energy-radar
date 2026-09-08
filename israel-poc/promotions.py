"""
Optional supplement: current promotions/discounts per Monster flavour,
pulled from the free Open Israeli Supermarkets API
(https://openisraelisupermarkets.co.il) instead of scraped ourselves — they
already parse the promo feed's full discount-group logic (buy-N-for-X,
loyalty-club-only deals, AND/OR combos), which our own pipeline doesn't
attempt.

Requires a free API token: sign up at openisraelisupermarkets.co.il, grab a
token from the "API Tokens" docs page, and set it as the OPEN_IL_SUPERMARKETS_TOKEN
secret (GitHub Actions repo secret in production, plain env var locally).

Entirely optional and additive. If the token isn't set, or any call fails,
this contributes nothing and the pipeline runs exactly as it did before —
promo info is a bonus on top of the prices we already scrape ourselves,
never a dependency. See israel-poc/README.md for how this fits alongside
the direct government-feed scrape.
"""

import os

import requests

API_BASE = "https://data.openisraelisupermarkets.co.il"
TOKEN = os.environ.get("OPEN_IL_SUPERMARKETS_TOKEN")


def _get(path, params=None, timeout=10):
    if not TOKEN:
        return None
    try:
        resp = requests.get(
            f"{API_BASE}{path}",
            params=params or {},
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=timeout,
        )
        if resp.status_code != 200:
            print(f"  promotions: {path} -> HTTP {resp.status_code}")
            return None
        return resp.json()
    except requests.RequestException as exc:
        print(f"  promotions: {path} -> {type(exc).__name__}: {exc}")
        return None


def _shape(promo: dict) -> dict:
    """Their PromotionResponse -> the small shape the app actually displays."""
    return {
        "description": promo.get("promotion_description") or promo.get("additional_promo_text") or "",
        "discountRate": promo.get("discount_rate"),
        "minQuantity": promo.get("minimum_quantity_for_promo"),
        "maxQuantity": promo.get("maximum_quantity_for_promo"),
        "startsAt": promo.get("promotion_start_datetime"),
        "endsAt": promo.get("promotion_end_datetime"),
        "terms": promo.get("additional_promo_restrictions") or None,
        "clubOnly": bool(promo.get("clubs")),
    }


def promotions_for_barcode(barcode: str) -> list[dict]:
    """Current promotions for one barcode, nationwide (not store-scoped —
    their schema doesn't attribute a promo to a single store, only to
    whatever chain/store filter you query with, and querying per-store would
    be one call per store per flavour). Returns [] on any failure, missing
    token, or a barcode with no live promos — never raises."""
    data = _get(f"/analytics/promotions/product/{barcode}", params={"current_only": True})
    if not data:
        return []
    return [_shape(p) for p in data.get("promotions", [])]


def promotions_by_variant(barcode_to_variant: dict[str, str]) -> dict[str, list[dict]]:
    """barcode -> variant_id map (only the barcodes actually seen this run)
    -> variant_id -> promotions. Skips entirely, zero network calls, if no
    token is configured — matches the rest of this pipeline's fail-soft
    style (see fetch_files in pipeline.py)."""
    if not TOKEN:
        print("  promotions: OPEN_IL_SUPERMARKETS_TOKEN not set, skipping")
        return {}
    out: dict[str, list[dict]] = {}
    for barcode, variant_id in barcode_to_variant.items():
        promos = promotions_for_barcode(barcode)
        if promos:
            out[variant_id] = promos
    return out
