import { distanceM, type Store } from "./stores";

/**
 * Two different things worth being told about, kept as one list because
 * they show up together on Me: "this flavour is on a shelf near me" and
 * "I'm near a shelf I saved" are both just — the radar found something.
 * Discriminated on `type` rather than splitting into two lists, so the Me
 * screen can render one feed instead of two.
 *
 * A flavour alert is about *proximity*, not price. It used to watch for a
 * restock or a price drop, which quietly made it a different product: a
 * shelf listing Ultra 90km away satisfied it, so the answer was never
 * something you could act on. The whole app is "what can I actually walk
 * to", and this is that question asked about one can.
 */
export type Alert =
  | {
      id: string;
      type: "flavour";
      variantId: string;
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

/** A flavour alert answers "is this can somewhere I could reasonably go
 *  right now", which is a looser question than a store alert's "have I
 *  arrived" — so it uses a walk-to radius rather than NEARBY_METRES. */
export const FLAVOUR_NEARBY_METRES = 1500;

/**
 * Shelves near you carrying the flavour, closest first — see the module doc
 * above for why this is a plain check against loaded data, not a live push,
 * and why it is filtered by distance rather than by price.
 */
export function matchingStores(
  alert: Extract<Alert, { type: "flavour" }>,
  stores: Store[],
  coord: { lat: number; lng: number },
): { store: Store; price: number; metres: number }[] {
  const hits: { store: Store; price: number; metres: number }[] = [];
  for (const store of stores) {
    const row = store.shelf.find((r) => r.variantId === alert.variantId);
    if (!row) continue;
    const metres = distanceM(coord, store);
    if (metres <= FLAVOUR_NEARBY_METRES) hits.push({ store, price: row.price, metres });
  }
  return hits.sort((a, b) => a.metres - b.metres);
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
