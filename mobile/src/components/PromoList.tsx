import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { rowDivider, styles as ui } from "./ui";
import type { Promo } from "@/data/api";
import { color, muted, space, textAlpha } from "@/theme";

/** "until Sep 15" — short and locale-free is fine here, this is a
 *  secondary detail on a promo card, not something worth full i18n. */
function untilLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `until ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/**
 * The "current deals" card list — shared by the variant screen (deals on
 * one flavour) and the store screen (deals on anything that store carries).
 * See israel-poc/promotions.py: these are nationwide per flavour, not
 * store-specific, which is why every caller's heading should say so rather
 * than imply "at this exact store."
 */
export function PromoList({ promos }: { promos: Promo[] }) {
  if (promos.length === 0) return null;
  return (
    <View style={ui.group}>
      {promos.map((p, i) => (
        <View key={i} style={[styles.promo, i < promos.length - 1 && rowDivider]}>
          <View style={styles.promoHead}>
            <Text style={styles.promoDesc} numberOfLines={2}>
              {p.description || "Promotion"}
            </Text>
            {typeof p.discountRate === "number" ? (
              <Text style={styles.promoRate}>{p.discountRate}% off</Text>
            ) : null}
          </View>
          <Text style={styles.promoSub}>
            {[p.minQuantity ? `Buy ${p.minQuantity}+` : null, p.clubOnly ? "Loyalty club" : null, untilLabel(p.endsAt)]
              .filter(Boolean)
              .join(" · ") || "Terms vary by store"}
          </Text>
          {p.terms ? (
            <Text style={styles.promoTerms} numberOfLines={2}>
              {p.terms}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  promo: { paddingVertical: space[3] },
  promoHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[3] },
  promoDesc: { flex: 1, fontSize: 12.5, fontWeight: "700", color: color.text },
  promoRate: { fontSize: 12.5, fontWeight: "800", color: color.accent },
  promoSub: { fontSize: 10, color: muted, marginTop: 3 },
  promoTerms: { fontSize: 9.5, lineHeight: 13, color: textAlpha(38), marginTop: 3 },
});
