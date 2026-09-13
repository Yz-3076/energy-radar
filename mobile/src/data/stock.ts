import { hoursSince, type ShelfRow } from "./stores";

export type StockStatus = "in_stock" | "fading" | "likely_out" | "unconfirmed";

export const STOCK_LABEL: Record<StockStatus, string> = {
  in_stock: "In stock",
  fading: "Might be out",
  likely_out: "Likely sold out",
  unconfirmed: "Unconfirmed",
};

/**
 * A confidence read on whether a flavour is still actually sitting on a
 * shelf — without asking a person to go check. This replaces hunter-reported
 * "still there?" updates (cut — see the Me screen changes), so it has to
 * stand on its own using only what a row already carries: where the price
 * came from, and how long ago.
 *
 * This is a plain, explainable heuristic, not a trained model — there is no
 * labelled "was it actually still there" dataset to train one on, and a
 * rule anyone can read and argue with beats a black box for something this
 * consequential to what the app tells people. Official-feed rows get a
 * longer benefit of the doubt than a one-off hunter photo: a chain's own
 * price file still listing the SKU implies it's an active line at that
 * store, even if the specific can on the shelf that day is long gone.
 */
/** How much to trust the row on age alone — "how stale is our copy of this
 *  price", which is a different question from whether the can is there. */
function freshness(row: ShelfRow, now: Date): StockStatus {
  const hours = hoursSince(row.seenAt, now);

  if (row.source === "featured") return "in_stock"; // the store itself keeps this listing current
  if (row.source === "official_feed") {
    if (hours <= 24) return "in_stock";
    if (hours <= 96) return "fading";
    return "unconfirmed";
  }
  // hunter: a single snapshot, trusted for a shorter window than a feed row
  if (hours <= 12) return "in_stock";
  if (hours <= 48) return "fading";
  return "unconfirmed";
}

export function stockStatus(row: ShelfRow, now: Date = new Date()): StockStatus {
  const fresh = freshness(row, now);

  // Where we have it, sales activity outranks freshness, because it is
  // evidence about the shelf rather than about when we last looked. The
  // pipeline has computed this on every row for a while (depletion.py);
  // it simply was not being read here, so the app was showing how recent
  // the price was and calling it stock.
  switch (row.depletion) {
    case "likely_out":
      // Sold regularly for days, then went completely silent. For a
      // grab-and-go product that is usually an empty shelf rather than a
      // collapse in demand — worth saying even if the price is fresh.
      return "likely_out";
    case "healthy":
      // Rang up in the last ~12h, so the line is live at this branch even
      // if our copy of the price has aged past the 24h mark.
      return fresh === "unconfirmed" ? "fading" : "in_stock";
    case "slowing":
      return fresh === "in_stock" ? "fading" : fresh;
    default:
      // insufficient_data, or a hunter row that has none — age is all we have.
      return fresh;
  }
}
