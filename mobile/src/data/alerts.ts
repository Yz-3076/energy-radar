import { distanceM, type Store } from "./stores";

export type FlavourAlertKind = "restock" | "price_drop";

/**
 * Two different things worth being told about, kept as one list because
 * they show up together on Me: "this flavour is back" and "I'm near a shelf
 * I saved" are both just — the radar found something. Discriminated on
 * `type` rather than splitting into two lists, so the Me screen can render
 * one feed instead of two.
 */
export type Alert =
  | {
      id: string;
      type: "flavour";
      variantId: string;
      kind: FlavourAlertKind;
      /** Only meaningful for "price_drop" — notify once a shelf lists it under this. */
      maxPrice: number | null;
      createdAt: string;
    }
  | {
      id: string;
      type: "store";
      storeId: string;
      createdAt: string;
    };

/** How close counts as "you're basically there" for a store alert. Checked
 *  live against wherever you are right now when you open Me — there's no
 *  background geofence or push notification service (see
 *  docs/staying-current.md), so this is "the app can tell you when you look,"
 *  not "your phone buzzes when you arrive." */
export const NEARBY_METRES = 350;

/**
 * Stores currently satisfying one flavour alert, cheapest first — see the
 * module doc above for why this is a plain check against loaded data, not a
 * live push.
 */
export function matchingStores(
  alert: Extract<Alert, { type: "flavour" }>,
  stores: Store[],
): { store: Store; price: number }[] {
  const hits: { store: Store; price: number }[] = [];
  for (const store of stores) {
    const row = store.shelf.find((r) => r.variantId === alert.variantId);
    if (!row) continue;
    if (alert.kind === "restock") hits.push({ store, price: row.price });
    else if (alert.maxPrice != null && row.price < alert.maxPrice) {
      hits.push({ store, price: row.price });
    }
  }
  return hits.sort((a, b) => a.price - b.price);
}

/** How far a store alert's target is right now, and whether that counts as
 *  "arrived". Null if the store isn't in the currently-loaded dataset. */
export function storeAlertStatus(
  alert: Extract<Alert, { type: "store" }>,
  stores: Store[],
  coord: { lat: number; lng: number },
): { store: Store; metres: number; near: boolean } | null {
  const store = stores.find((s) => s.id === alert.storeId);
  if (!store) return null;
  const metres = distanceM(coord, store);
  return { store, metres, near: metres <= NEARBY_METRES };
}
