import { getVariant } from "./catalog";
import { cheapest, storeIsFresh, type Store } from "./stores";

/** The chip row on the map and the filter row in search share these. */
export type FilterId = "all" | "fresh" | "cheap" | "zero";

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All shelves" },
  { id: "fresh", label: "Sold in 36 h" },
  { id: "cheap", label: "Under ₪10" },
  { id: "zero", label: "Zero sugar" },
];

export function matchesFilter(store: Store, id: FilterId, now: Date): boolean {
  switch (id) {
    case "fresh":
      return storeIsFresh(store, now);
    case "cheap":
      return cheapest(store).price < 10;
    case "zero":
      return store.shelf.some((r) => getVariant(r.variantId).zeroSugar);
    default:
      return true;
  }
}
