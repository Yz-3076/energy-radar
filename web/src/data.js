/**
 * Loading the same data the app loads, from the same place.
 *
 * GitHub Pages serves docs/ as the site root, and data/ lives outside it at
 * the repo root — so there is no relative path from this page to the data.
 * These are fetched over the network from the repo instead, exactly as the
 * phone app does (mobile/src/data/api.ts) and as the existing dashboard at
 * docs/index.html already does. The alternative, copying 3 MB of JSON into
 * docs/ on every pipeline run, would double the repo's growth for nothing.
 */
const PUBLISHED = "https://raw.githubusercontent.com/Yz-3076/energy-radar/main/data";

/**
 * Served locally, read the working tree instead — `npx serve` from the repo
 * root puts this page at /docs/app/ and the data at /data/. Without this,
 * developing against a pipeline change would mean pushing first to see it.
 */
const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const DATA = LOCAL ? "../../data" : PUBLISHED;

const LATEST = `${DATA}/latest.json`;
const PROMOS = `${DATA}/promotions.json`;
const STATS = `${DATA}/stats.json`;

async function getJSON(url, { optional = false } = {}) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (!optional) console.warn(`Energy Radar: could not load ${url}`, err);
    return null;
  }
}

/**
 * Stores, deals and the aggregate stats.
 *
 * Fetched together because the map needs the first two before it can draw
 * anything, and waiting on them sequentially shows an empty map for no
 * reason. A failure of any one is not fatal: the caller renders whatever
 * arrived and says so, which is the same stance the app takes.
 */
export async function loadAll() {
  const [stores, promotions, stats] = await Promise.all([
    getJSON(LATEST),
    getJSON(PROMOS),
    getJSON(STATS),
  ]);
  return {
    stores: Array.isArray(stores) ? stores : [],
    promotions: promotions && typeof promotions === "object" ? promotions : {},
    stats: stats && typeof stats === "object" ? stats : null,
  };
}

/*
 * Note on history: data/history/*.ndjson holds every observation ever
 * recorded — 353,000 lines and 55 MB as of writing, growing every run. The
 * Stats screen never touches it. The pipeline folds it down to one row per
 * day and ships that as `stats.timeline`, which is what the trend chart
 * draws. Downloading 55 MB to plot sixteen points would be by far the
 * heaviest thing on the site, and the aggregate is the same picture.
 */

/**
 * Where the visitor is, if they allow it.
 *
 * Unlike the phone app there is no onboarding screen asking first — the
 * browser shows its own prompt, and asking twice is worse than asking
 * once. The map works without a fix: it opens on the country instead of
 * on you, and everything except walking distances behaves the same.
 */
export function locate(onFix) {
  if (!("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => {},
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
  );
}
