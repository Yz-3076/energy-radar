import { hoursSince, type ShelfRow } from "./stores";

export type StockStatus = "in_stock" | "fading" | "unconfirmed";

export const STOCK_LABEL: Record<StockStatus, string> = {
  in_stock: "In stock",
  fading: "Might be out",
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
export function stockStatus(row: ShelfRow, now: Date = new Date()): StockStatus {
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
