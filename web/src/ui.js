import { prettyDistance, walkMinutes } from "./shared.ts";
/**
 * Small rendering helpers shared by every screen.
 *
 * Screens here build HTML strings rather than using a framework: the app's
 * drawing components already return SVG strings (see shim/react), the
 * screens are mostly lists, and adding a runtime would mean shipping one to
 * every visitor for no gain. `h` is the escaping boundary — anything that
 * came from the price feed goes through it.
 */

/** Escape for HTML text and quoted attribute values. */
export function h(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrap a Hebrew name before it lands in a sentence of Latin text.
 *
 * Same reason as the app's `isolate` (mobile/src/data/stores.ts): without
 * the Unicode isolate characters the bidi algorithm reorders the whole
 * line around the first strong RTL character, and "Dizengoff 50 · 3 min
 * walk" comes out as "min walk · 50 3".
 */
export const isolate = (s) => `⁨${s}⁩`;

/** Build one element without a template string, for cases that need a node. */
export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

/**
 * "until 15 Sep". Short and locale-free, matching PromoList in the app —
 * this is a secondary detail on a deal card, not something worth full i18n.
 */
export function untilLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `until ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/**
 * One deal card. Shared by the store screen (deals at that branch) and the
 * flavour screen (the same deal rolled up across branches, with a count),
 * exactly as PromoList does on the phone.
 */
export function promoCard(promo, storeCount) {
  const bits = [
    promo.minQuantity ? `Buy ${promo.minQuantity}+` : null,
    promo.clubOnly ? "Loyalty club" : null,
    untilLabel(promo.endsAt),
    storeCount ? `at ${storeCount} ${storeCount === 1 ? "branch" : "branches"}` : null,
  ].filter(Boolean);

  return `
    <div class="promo">
      <div class="promo-head">
        <div class="promo-desc">${h(promo.description || "Promotion")}</div>
        ${typeof promo.discountRate === "number" ? `<div class="promo-rate">${h(promo.discountRate)}% off</div>` : ""}
      </div>
      <div class="promo-sub">${h(bits.join(" · ") || "Terms vary by store")}</div>
      ${promo.terms ? `<div class="promo-terms">${h(promo.terms)}</div>` : ""}
    </div>`;
}

/**
 * Deals on one flavour, deduped across stores with a branch count.
 *
 * promotions.json is storeId -> variantId -> [promo], store-specific by
 * design. Rolling it up is only honest on a flavour screen, where the
 * question really is "who is running a deal on this can" — and it says how
 * many branches rather than implying the deal is everywhere. A store screen
 * must never use this; that is what invented the phantom Modi'in deals the
 * data shape was changed to stop.
 */
export function promosForVariant(promotions, variantId) {
  const byDeal = new Map();
  for (const byVariant of Object.values(promotions)) {
    for (const promo of byVariant?.[variantId] ?? []) {
      const key = `${promo.description}|${promo.endsAt}`;
      const seen = byDeal.get(key);
      if (seen) seen.storeCount += 1;
      else byDeal.set(key, { promo, storeCount: 1 });
    }
  }
  return [...byDeal.values()].sort((a, b) => b.storeCount - a.storeCount);
}

/** Deals this exact branch runs, flattened with the flavour named. */
export function promosAtStore(promotions, store, getVariant) {
  const byVariant = promotions[store.id] ?? {};
  const out = [];
  for (const [variantId, list] of Object.entries(byVariant)) {
    const name = getVariant(variantId).name;
    for (const promo of list ?? []) {
      out.push({ ...promo, description: `${name} — ${promo.description || "Promotion"}` });
    }
  }
  return out;
}

export const storeHasPromo = (promotions, storeId) =>
  Object.keys(promotions[storeId] ?? {}).length > 0;

/**
 * A town name short enough to sit under a chart bar — the app's shortCity.
 * Official names carry qualifiers a reader does not need here, and cutting
 * them to a fixed width lands mid-word.
 */
export const shortCity = (city) => (city?.split("-")[0] ?? "").trim().slice(0, 8);


/**
 * How far away a shop is — or an honest refusal to say.
 *
 * A store flagged `approximate` is pinned at its town's centre, because the
 * chain filed it as "צומת אשקלון" or "קיבוץ עינת" and there is no street
 * address to place. The distance to that pin is the distance to the middle
 * of the town, which is not the distance to the shop, and a forecourt on a
 * motorway is not a three-minute walk from anywhere. Printing "240 m · 3
 * min walk" for one of those is exactly the small dishonesty that makes a
 * walking app untrustworthy, so these say where the shop is instead of how
 * far, and never offer a walking time.
 */
export function distanceLabel(store, metres) {
  if (store?.approximate) {
    const town = shortCityFull(store.city);
    return town ? `somewhere in ${town}` : "location approximate";
  }
  return prettyDistance(metres);
}

/** As above, for the places that also print a walking time. */
export function walkLabel(store, metres) {
  return store?.approximate
    ? distanceLabel(store, metres)
    : `${prettyDistance(metres)} away · ${walkMinutes(metres)} min walk`;
}

/** The town's full name — shortCity() truncates for chart axes. */
const shortCityFull = (city) => (city || "").trim();

/** Open directions in whatever maps app the visitor has. */
export function openDirections(store) {
  const url = `https://www.openstreetmap.org/?mlat=${store.lat}&mlon=${store.lng}#map=18/${store.lat}/${store.lng}`;
  window.open(url, "_blank", "noopener");
}
