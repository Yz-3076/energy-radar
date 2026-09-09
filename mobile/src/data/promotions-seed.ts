import type { Promo } from "./api";

/**
 * Fictional demo promotions — used ONLY until data/promotions.json has any
 * real content (i.e. until OPEN_IL_SUPERMARKETS_TOKEN is set and a real
 * pipeline run actually finds a live deal; see israel-poc/promotions.py).
 *
 * Checked the real government promo feed directly for Monster-specific
 * deals (2026-09-10, several real Modi'in branches) and found none — every
 * hit was a blanket employee meal-voucher (Cibus/Sodexo) acceptance entry
 * covering 8,000+ items store-wide, not a targeted discount. So this isn't
 * standing in for real data we're choosing not to show; there currently
 * isn't any to show. This exists purely so the promo UI (the fire badge,
 * the deal card, the "N deals" pill) has something to render in testing
 * rather than looking permanently inert.
 *
 * Deliberately NOT tied to a specific city or store — the data model only
 * supports promos per flavour nationwide (see PromoList's own note), and
 * inventing a fake city-specific claim here would misrepresent real
 * geography with fictional content. Swapped out automatically the moment
 * real promo data exists — see promotionsFor in AppState.tsx.
 */
export const SEED_PROMOTIONS: Record<string, Promo[]> = {
  ultra: [
    {
      description: "Buy 2, save ₪4 (demo — not real data)",
      discountRate: null,
      minQuantity: 2,
      maxQuantity: null,
      startsAt: null,
      endsAt: null,
      terms: "Placeholder promo shown until real promotion data is available.",
      clubOnly: false,
    },
  ],
};
