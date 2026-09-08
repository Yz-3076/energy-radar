import Constants from "expo-constants";

import type { ShelfRow, Store } from "./stores";

/**
 * Backend client for the owner/featured-listing service in `../server`.
 *
 * The app is fully usable with the backend down — everything the map needs
 * ships in the bundle. The backend only *adds* paid featured pins, so every
 * call here fails soft and returns nothing rather than blocking a screen.
 */

/** Host the Metro bundler is served from — the dev machine, on device too. */
function devHost(): string | null {
  const uri =
    // expo-constants exposes the packager host on both SDK shapes
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | null)?.debuggerHost ??
    null;
  if (!uri) return null;
  return uri.split(":")[0] ?? null;
}

const OWNER_PORT = 8790;

export const apiBase = (): string | null => {
  const explicit = process.env.EXPO_PUBLIC_ENERGY_RADAR_API;
  if (explicit) return explicit.replace(/\/$/, "");
  const host = devHost();
  return host ? `http://${host}:${OWNER_PORT}` : null;
};

/**
 * The real price feed — a JSON file, not a server. A GitHub Actions job
 * (.github/workflows/fetch-prices.yml) fetches Israel's published price
 * files, filters for Monster, geocodes each store once, and commits the
 * result here every few hours. Reading it straight off GitHub's CDN needs no
 * backend at all: no server to run, no server to go down.
 *
 * Currently Shufersal only (see israel-poc/pipeline.py for why Rami Levy is
 * temporarily out) — real coverage, growing chain by chain, rather than the
 * curated multi-chain spread the bundled seed data shows. See
 * docs/staying-current.md for the honest state of this at any given time.
 */
const LIVE_DATA_URL = "https://raw.githubusercontent.com/Yz-3076/energy-radar/main/data/latest.json";

/**
 * variantId -> current promotions. Same "just a JSON file on GitHub" shape
 * as LIVE_DATA_URL, written by israel-poc/pipeline.py from the free Open
 * Israeli Supermarkets API (see israel-poc/promotions.py) — nationwide per
 * flavour, not per-store, and the file itself is `{}` whenever no API token
 * is configured, so an empty result here means "no live promos right now",
 * not "broken".
 */
const PROMOTIONS_URL = "https://raw.githubusercontent.com/Yz-3076/energy-radar/main/data/promotions.json";

async function getAbsoluteJSON<T>(url: string, timeoutMs = 6000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" as RequestCache });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The real, live dataset — or null if it hasn't loaded (offline, first ever
 * fetch not run yet, URL not configured). Callers should fall back to the
 * bundled seed data rather than show nothing.
 */
export async function fetchLiveStores(): Promise<Store[] | null> {
  const stores = await getAbsoluteJSON<Store[]>(LIVE_DATA_URL);
  return stores && stores.length > 0 ? stores : null;
}

/** One current deal on a flavour — see israel-poc/promotions.py for where
 *  these fields come from. `discountRate`/quantities/dates are whatever the
 *  source published; not every promo sets all of them. */
export type Promo = {
  description: string;
  discountRate: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  startsAt: string | null;
  endsAt: string | null;
  terms: string | null;
  clubOnly: boolean;
};

/** variantId -> its current promotions, or {} if the file hasn't loaded or
 *  no promo data is configured. Never null — callers can treat a missing
 *  key as "no live promo on this flavour" with no special-casing. */
export async function fetchPromotions(): Promise<Record<string, Promo[]>> {
  const promos = await getAbsoluteJSON<Record<string, Promo[]>>(PROMOTIONS_URL);
  return promos ?? {};
}

type Listing = {
  id: string;
  storeName: string;
  address: string;
  status: string;
  featured?: boolean;
  lat?: number;
  lng?: number;
  flavors?: { name: string; price: number | string }[];
};

async function getJSON<T>(path: string, timeoutMs = 3500): Promise<T | null> {
  const base = apiBase();
  if (!base) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Paid, verified store listings, mapped onto the same Store shape the map
 * already renders. Owner submissions have no geocoding yet (see
 * docs/owner-monetization.md), so a listing without coordinates is dropped
 * rather than dropped at a fake point on the map.
 */
export async function fetchFeaturedStores(): Promise<Store[]> {
  const listings = await getJSON<Listing[]>("/api/listings");
  if (!listings) return [];

  return listings
    .filter((l) => l.featured && l.status !== "rejected")
    .filter((l) => typeof l.lat === "number" && typeof l.lng === "number")
    .map((l): Store => {
      const shelf: ShelfRow[] = (l.flavors ?? []).map((f) => ({
        variantId: matchVariant(f.name),
        price: typeof f.price === "string" ? parseFloat(f.price) || 0 : f.price,
        qty: null,
        seenAt: new Date().toISOString(),
        source: "featured",
      }));
      return {
        id: `featured-${l.id}`,
        chain: "Featured listing",
        name: l.storeName,
        address: l.address,
        city: "",
        lat: l.lat as number,
        lng: l.lng as number,
        shelf,
        featured: true,
      };
    })
    .filter((s) => s.shelf.length > 0);
}

/** Loose name → catalogue id match for owner-typed flavour names. */
function matchVariant(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("paradise")) return "ultra-paradise";
  if (n.includes("fiesta")) return "ultra-fiesta";
  if (n.includes("violet")) return "ultra-violet";
  if (n.includes("gold")) return "ultra-gold";
  if (n.includes("khaotic")) return "juice-khaotic";
  if (n.includes("mango")) return "mango-loco";
  if (n.includes("pipeline")) return "pipeline-punch";
  if (n.includes("nitro")) return "nitro-super-dry";
  if (n.includes("rehab")) return "rehab-lemonade";
  if (n.includes("zero")) return "full-zero";
  if (n.includes("ultra")) return "ultra";
  return "original";
}
