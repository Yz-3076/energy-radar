import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Can } from "./Can";
import { PulseRing } from "./ui";
import { getVariant } from "@/data/catalog";
import { ils, originalRow, storeIsFresh, type Store } from "@/data/stores";
import { accentAlpha, color, radius } from "@/theme";

/**
 * A store pin. The can shown is always Original (see `originalRow`) so every
 * pin reads the same at a glance; a pulsing ring means the shelf moved in the
 * last 36 h, and a gold outline marks a paid featured listing.
 */
function StorePinBase({
  store,
  focused,
  dimmed,
  showPrice,
  now,
}: {
  store: Store;
  focused: boolean;
  dimmed: boolean;
  showPrice: boolean;
  now: Date;
}) {
  const row = originalRow(store);
  const variant = getVariant(row.variantId);
  const fresh = storeIsFresh(store, now);
  const ring = store.featured ? "#f0b429" : focused ? color.accent : accentAlpha(30);

  return (
    <View style={[styles.pin, dimmed && styles.dim]}>
      {showPrice ? (
        <View style={[styles.priceTag, { borderColor: ring }]}>
          <Text style={styles.priceText}>{ils(row.price)}</Text>
        </View>
      ) : null}

      <View style={styles.canWrap}>
        {fresh ? <PulseRing size={48} color={ring} /> : null}
        <Can variant={variant} size={focused ? 62 : 52} dim={!fresh} />
      </View>
      <View style={styles.shadow} />
    </View>
  );
}

export const StorePin = memo(StorePinBase);

/** Where the user is standing: the canvas's glowing green dot, with the same
 *  live pulse the fresh pins use. */
export function UserPuck() {
  return (
    <View style={styles.puck}>
      <PulseRing size={64} color={accentAlpha(55)} />
      <View style={styles.puckHalo} />
      <View style={styles.puckDot} />
    </View>
  );
}

/** Cluster badge — dark disc, glowing ring, count in the middle. */
function ClusterBadgeBase({ count, fresh }: { count: number; fresh: boolean }) {
  const size = count < 10 ? 40 : count < 50 ? 48 : 56;
  return (
    <View
      style={[
        styles.cluster,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: fresh ? color.accent : accentAlpha(35),
        },
      ]}
    >
      <Text style={styles.clusterCount}>{count}</Text>
    </View>
  );
}

export const ClusterBadge = memo(ClusterBadgeBase);

const styles = StyleSheet.create({
  pin: { alignItems: "center", justifyContent: "flex-end" },
  dim: { opacity: 0.32 },
  canWrap: { alignItems: "center", justifyContent: "center" },
  shadow: {
    width: 26,
    height: 8,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.6)",
    marginTop: -3,
    transform: [{ scaleX: 1.2 }],
  },
  priceTag: {
    minWidth: 54,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    backgroundColor: "rgba(10,11,10,0.85)",
    alignItems: "center",
  },
  priceText: { fontSize: 9, fontWeight: "600", color: color.accent },
  puck: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  puckHalo: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: accentAlpha(12),
  },
  puckDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: color.accent,
    borderWidth: 3,
    borderColor: "#04140a",
    shadowColor: color.accent,
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  cluster: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    backgroundColor: "rgba(10,13,10,0.88)",
    shadowColor: color.accent,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  clusterCount: { fontSize: 14, fontWeight: "700", color: color.accent },
});
