"""
"Is this shelf about to run out?" — from sales history, not a stock field.

The price files never expose a stock count. What they do expose is
`LastSaleDateTime`, updated by the register the moment a can of THAT
barcode actually sells at THAT store. That is a genuine, if indirect,
supply signal: a store that has been ringing up a flavour every few hours
for days and then suddenly stops isn't "unpopular now" — for a habitual,
grab-and-go product like this, it almost always means the shelf is empty
and the register has nothing left to log a sale of.

This module turns a history of fetches for one (store, variant) pair into
one of four honest, explainable states — a plain rule over real data, not a
trained model (there's no "was it actually restocked" label to train one
on):

  insufficient_data — not enough history yet to say anything
  healthy           — still selling recently
  slowing           — used to sell, activity has dropped off some
  likely_out        — was selling regularly, has gone completely quiet

Fed by pipeline.py, which appends one observation per run to
data/history/YYYY-MM.ndjson: {store_id, variant_id, last_sale, fetched_at}.
"""

from datetime import datetime, timezone

MIN_OBSERVATIONS = 6  # ~18h of history at a 3-hour fetch cadence
RECENT_WINDOW = 4  # ~12h — "has it sold since roughly this morning"
QUIET_MEANS_OUT_THRESHOLD = 0.25  # >=25% of older windows active is "used to sell regularly"


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def _sold_between(prev_last_sale: str | None, cur_last_sale: str | None) -> bool:
    """True if the register logged a new sale strictly between two fetches."""
    cur = _parse(cur_last_sale)
    if cur is None:
        return False
    prev = _parse(prev_last_sale)
    if prev is None:
        return True  # first time we've ever seen a sale timestamp at all
    return cur > prev


def assess(observations: list[dict]) -> str:
    """`observations`: chronological (oldest first) list of
    {"last_sale": iso_str | None}, all for the same (store, variant).
    Returns one of insufficient_data / healthy / slowing / likely_out.
    """
    if len(observations) < MIN_OBSERVATIONS:
        return "insufficient_data"

    activity = [
        _sold_between(observations[i - 1].get("last_sale"), observations[i].get("last_sale"))
        for i in range(1, len(observations))
    ]

    recent = activity[-RECENT_WINDOW:]
    older = activity[: -RECENT_WINDOW] if len(activity) > RECENT_WINDOW else []

    if any(recent):
        return "healthy"

    older_rate = (sum(older) / len(older)) if older else 0.0
    if older_rate >= QUIET_MEANS_OUT_THRESHOLD:
        return "likely_out"
    if older_rate > 0:
        return "slowing"
    return "insufficient_data"  # never seen it move at all — not enough signal either way


DEPLETION_LABEL = {
    "insufficient_data": "Not enough history yet",
    "healthy": "Selling normally",
    "slowing": "Sales slowing down",
    "likely_out": "Likely out of stock",
}
