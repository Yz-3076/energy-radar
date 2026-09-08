import { RARITY_ORDER, VARIANTS } from "./catalog";

/**
 * Where a row came from. Kept on every listing because the three sources have
 * genuinely different confidence, and docs/us-data-sources.md asks for them to
 * stay separable rather than blended into one anonymous "price".
 */
export type Source = "official_feed" | "hunter" | "featured";

export type ShelfRow = {
  variantId: string;
  /** Shelf price in ILS. */
  price: number;
  /** Cans seen on the shelf. Only hunters count cans — the price feed has no
   *  stock field at all, so feed rows carry null and the UI says so. */
  qty: number | null;
  /** ISO timestamp. For feed rows this is LastSaleDateTime: the strongest
   *  "actively moving" signal the feed exposes. For hunter rows it is when the
   *  sighting was logged. */
  seenAt: string;
  source: Source;
  /** Handle of the hunter who logged it, when it was a hunter. */
  by?: string;
};

export type Store = {
  id: string;
  chain: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  shelf: ShelfRow[];
  /** Local closing time. Chain-level opening hours, not per-branch truth. */
  closesAt?: string;
  featured?: boolean;
};

type Town = {
  chain: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  real?: boolean;
};

const TOWNS: Town[] = [
  // The first two are the real result of the 2026-09-05 Shufersal scrape:
  // real branch, real address, real barcodes, real prices, real last-sale times.
  {
    chain: "Shufersal Sheli",
    name: "שלי ת״א — בן יהודה",
    address: "בן יהודה 79",
    city: "תל אביב",
    lat: 32.0798,
    lng: 34.7695,
    real: true,
  },
  {
    chain: "Shufersal Sheli",
    name: "שלי ירושלים — אגרון",
    address: "אגרון 1",
    city: "ירושלים",
    lat: 31.7784,
    lng: 35.2177,
    real: true,
  },
  { chain: "Shufersal Deal", name: "דיל דיזנגוף סנטר", address: "דיזנגוף 50", city: "תל אביב", lat: 32.0742, lng: 34.7745 },
  { chain: "Rami Levy", name: "רמי לוי רוטשילד", address: "שדרות רוטשילד 12", city: "תל אביב", lat: 32.0656, lng: 34.7735 },
  { chain: "Victory", name: "ויקטורי פלורנטין", address: "פלורנטין 45", city: "תל אביב", lat: 32.0553, lng: 34.7688 },
  { chain: "AM:PM", name: "AM:PM נמל תל אביב", address: "התחנה 4", city: "תל אביב", lat: 32.0973, lng: 34.7736 },
  { chain: "Osher Ad", name: "אושר עד רמת אביב", address: "איינשטיין 2", city: "תל אביב", lat: 32.1122, lng: 34.8021 },
  { chain: "Yellow", name: "ילו הרצליה פיתוח", address: "סוקולוב 88", city: "הרצליה", lat: 32.1656, lng: 34.8437 },
  { chain: "Shufersal Sheli", name: "שלי רעננה", address: "אחוזה 100", city: "רעננה", lat: 32.1848, lng: 34.8713 },
  { chain: "Rami Levy", name: "רמי לוי פתח תקווה", address: "כביש 4812", city: "פתח תקווה", lat: 32.0917, lng: 34.8767 },
  { chain: "Victory", name: "ויקטורי חולון", address: "סוקולוב 60", city: "חולון", lat: 32.0117, lng: 34.7719 },
  { chain: "Dor Alon", name: "AM:PM בת ים", address: "רוטשילד 30", city: "בת ים", lat: 32.0171, lng: 34.7513 },
  { chain: "Osher Ad", name: "אושר עד נתניה", address: "בן גוריון 20", city: "נתניה", lat: 32.3215, lng: 34.8532 },
  { chain: "Shufersal Deal", name: "דיל חיפה הדר", address: "הרצל 45", city: "חיפה", lat: 32.8058, lng: 34.9896 },
  { chain: "Rami Levy", name: "רמי לוי מודיעין", address: "עמק דותן 5", city: "מודיעין", lat: 31.8969, lng: 35.0095 },
  { chain: "Yellow", name: "ילו אשדוד", address: "רוגוזין 12", city: "אשדוד", lat: 31.794, lng: 34.6446 },
  { chain: "Tiv Taam", name: "טיב טעם אלנבי", address: "אלנבי 79", city: "תל אביב", lat: 32.0669, lng: 34.7719 },
  { chain: "Yellow", name: "ילו איילון דרום", address: "כביש 20", city: "רמת גן", lat: 32.0684, lng: 34.8248 },
  { chain: "Shufersal Express", name: "אקספרס בזל", address: "בזל 22", city: "תל אביב", lat: 32.0902, lng: 34.7808 },
  { chain: "AM:PM", name: "AM:PM דיזנגוף", address: "דיזנגוף 190", city: "תל אביב", lat: 32.0846, lng: 34.7742 },
];

const HUNTERS = ["@aisleghost", "@nightshelf", "@kelso", "@vee", "@dmk", "@coolerdoor"];

/**
 * Synthetic rows are aged off the moment the app starts, not off a fixed
 * date: a hard-coded epoch puts every seeded sighting in the future on a
 * device whose clock is behind it, and the whole map then reads "1 min ago".
 * The seeded PRNG still fixes the *relative* ages, so the dataset is stable
 * within a run; the two real feed rows keep their real absolute timestamps.
 */
const DATA_EPOCH = new Date();

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** The six rows the Shufersal feed actually returned, verbatim. */
const REAL_ROWS: Record<string, ShelfRow[]> = {
  "store-1": [
    { variantId: "ultra", price: 9.9, qty: null, seenAt: "2026-09-04T15:27:04+03:00", source: "official_feed" },
    { variantId: "mango-loco", price: 9.9, qty: null, seenAt: "2026-09-04T11:37:00+03:00", source: "official_feed" },
  ],
  "store-2": [
    { variantId: "ultra", price: 9.9, qty: null, seenAt: "2026-09-01T14:32:00+03:00", source: "official_feed" },
    { variantId: "mango-loco", price: 9.9, qty: null, seenAt: "2026-08-28T13:28:00+03:00", source: "official_feed" },
    { variantId: "ultra-paradise", price: 9.9, qty: null, seenAt: "2026-09-03T20:58:00+03:00", source: "official_feed" },
    { variantId: "ultra-fiesta", price: 9.9, qty: null, seenAt: "2026-09-03T20:58:00+03:00", source: "official_feed" },
    { variantId: "original", price: 9.9, qty: null, seenAt: "2026-08-26T19:04:00+03:00", source: "official_feed" },
    { variantId: "full-zero", price: 10.9, qty: null, seenAt: "2026-09-01T20:05:00+03:00", source: "official_feed" },
  ],
};

function buildStores(): Store[] {
  const rand = seeded(42);
  const stores: Store[] = [];
  let id = 0;

  for (const town of TOWNS) {
    const branches = town.real ? 1 : 1 + Math.floor(rand() * 3);
    for (let b = 0; b < branches; b++) {
      id += 1;
      const storeId = `store-${id}`;
      const lat = town.lat + (b === 0 ? 0 : (rand() - 0.5) * 0.022);
      const lng = town.lng + (b === 0 ? 0 : (rand() - 0.5) * 0.022);

      let shelf = REAL_ROWS[storeId];
      if (!shelf) {
        const count = 2 + Math.floor(rand() * 5);
        const pool = [...VARIANTS].sort(
          (a, b2) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b2.rarity] + (rand() - 0.5) * 2.4,
        );
        shelf = pool.slice(0, count).map((v) => {
          const feed = rand() < 0.62;
          const hoursAgo = rand() < 0.45 ? rand() * 30 : 30 + rand() * 260;
          const base = 9.9 + RARITY_ORDER[v.rarity] * 0.9 + Math.round(rand() * 6) * 0.5;
          return {
            variantId: v.id,
            price: Math.round(base * 10) / 10,
            qty: feed ? null : 1 + Math.floor(rand() * 14),
            seenAt: new Date(DATA_EPOCH.getTime() - hoursAgo * 3600_000).toISOString(),
            source: feed ? ("official_feed" as const) : ("hunter" as const),
            by: feed ? undefined : HUNTERS[Math.floor(rand() * HUNTERS.length)],
          };
        });
      }

      stores.push({
        id: storeId,
        chain: town.chain,
        name: b === 0 ? town.name : `${town.name} · סניף ${b + 1}`,
        address: `${town.address}, ${town.city}`,
        city: town.city,
        lat,
        lng,
        shelf,
        closesAt: town.chain === "AM:PM" || town.chain === "Yellow" ? "24h" : b % 2 ? "22:00" : "23:00",
      });
    }
  }
  return stores;
}

export const STORES: Store[] = buildStores();

/* ── derived helpers ───────────────────────────────────────────────────── */

export const FRESH_HOURS = 36;

export const hoursSince = (iso: string, now: Date = new Date()) =>
  (now.getTime() - new Date(iso).getTime()) / 3600_000;

export const isFresh = (iso: string, now?: Date) => hoursSince(iso, now) <= FRESH_HOURS;

/** Most recent activity anywhere on this shelf. */
export const lastSeen = (s: Store) =>
  s.shelf.reduce((acc, r) => (r.seenAt > acc ? r.seenAt : acc), s.shelf[0]?.seenAt ?? "");

export const storeIsFresh = (s: Store, now?: Date) => isFresh(lastSeen(s), now);

export const cheapest = (s: Store) =>
  s.shelf.reduce((acc, r) => (r.price < acc.price ? r : acc), s.shelf[0]);

/**
 * The variant a store's pin, list row and focused hero can show by default.
 *
 * Deliberately always Original when the shelf has it, rather than "whatever's
 * rarest" — most stores carry Original, so showing it consistently means
 * every pin looks the same at a glance instead of a rotating cast of
 * flavours. Anyone who wants the actual full shelf taps through to the store
 * page, which lists every variant it really carries.
 */
export const originalRow = (s: Store) =>
  s.shelf.find((r) => r.variantId === "original") ?? cheapest(s);

export function relativeTime(iso: string, now: Date = new Date()): string {
  const h = hoursSince(iso, now);
  if (h <= 0.017) return "just now";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} d ago`;
}

/** Metres between two WGS84 points (equirectangular — fine at city scale). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = (((b.lng - a.lng) * Math.PI) / 180) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) * R;
}

export const prettyDistance = (m: number) =>
  m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

export const ils = (n: number) => `₪${n.toFixed(2)}`;

/**
 * Wrap a Hebrew store name in Unicode isolates before dropping it into a
 * sentence of Latin text. Without them the bidi algorithm reorders the whole
 * line around the first strong RTL character, and "Dizengoff 50 · 3 min walk"
 * comes out as "min walk · 50 3". Pair it with `writingDirection: "ltr"` on
 * the Text so the paragraph itself stays left-to-right.
 */
export const isolate = (s: string) => `⁨${s}⁩`;

/** Rough walking time at 80 m/min. */
export const walkMinutes = (m: number) => Math.max(1, Math.round(m / 80));
