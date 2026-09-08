import React from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";

import { Can } from "./Can";
import { CheckCircle, NavigationArrow, X } from "./icons";
import { Tap } from "./ui";
import { getVariant } from "@/data/catalog";
import {
  distanceM,
  ils,
  isFresh,
  originalRow,
  prettyDistance,
  relativeTime,
  walkMinutes,
  type ShelfRow,
  type Store,
} from "@/data/stores";
import { color, radius, space } from "@/theme";

/**
 * The one white surface in the app — the focused-store card that slides in
 * beside the hero can, exactly as the canvas frames it.
 */

export function openDirections(store: Store) {
  const label = encodeURIComponent(store.name);
  const url = Platform.select({
    ios: `maps://?daddr=${store.lat},${store.lng}&q=${label}`,
    android: `geo:${store.lat},${store.lng}?q=${store.lat},${store.lng}(${label})`,
    default: `https://www.openstreetmap.org/?mlat=${store.lat}&mlon=${store.lng}`,
  });
  Linking.openURL(url).catch(() => {
    Linking.openURL(`https://www.openstreetmap.org/?mlat=${store.lat}&mlon=${store.lng}`).catch(() => {});
  });
}

function priceVerdict(row: ShelfRow, all: Store[]): string {
  const sameVariant = all.flatMap((s) => s.shelf.filter((r) => r.variantId === row.variantId));
  if (sameVariant.length < 2) return "Only sighting";
  const sorted = sameVariant.map((r) => r.price).sort((a, b) => a - b);
  if (row.price <= sorted[0]) return "Cheapest nearby";
  const median = sorted[Math.floor(sorted.length / 2)];
  if (row.price <= median) return "Fair price";
  return "Above average";
}

export function StoreBubble({
  store,
  stores,
  coord,
  now,
  onClose,
  onDetails,
}: {
  store: Store;
  stores: Store[];
  coord: { lat: number; lng: number };
  now: Date;
  onClose: () => void;
  onDetails: () => void;
}) {
  const row = originalRow(store);
  const variant = getVariant(row.variantId);
  const metres = distanceM(coord, store);
  const fresh = isFresh(row.seenAt, now);

  return (
    <View style={styles.card}>
      <View style={styles.tail} />

      <Tap style={styles.close} onPress={onClose} hitSlop={10} accessibilityLabel="Close">
        <X size={12} color="#474d47" weight="fill" />
      </Tap>

      <View style={styles.statusRow}>
        <CheckCircle size={13} color={fresh ? "#009a28" : "#767c76"} weight="fill" />
        <Text style={[styles.status, { color: fresh ? "#009a28" : "#767c76" }]}>
          {fresh ? "Sold here today" : `Last sold ${relativeTime(row.seenAt, now)}`}
        </Text>
      </View>

      <Text style={styles.name} numberOfLines={2}>
        {store.name}
      </Text>
      <Text style={styles.address} numberOfLines={2}>
        {store.address}
      </Text>

      <View style={styles.divider} />

      <View style={styles.priceRow}>
        <View>
          <Text style={styles.priceLabel}>Shelf price</Text>
          <Text style={styles.price}>{ils(row.price)}</Text>
        </View>
        <View style={styles.verdict}>
          <Text style={styles.verdictText}>{priceVerdict(row, stores)}</Text>
        </View>
      </View>

      <View style={styles.variantRow}>
        <Can variant={variant} size={41} />
        <View style={styles.variantText}>
          <Text style={styles.variantName} numberOfLines={1}>
            {variant.fullName}
          </Text>
          <Text style={styles.variantMeta}>
            {variant.sizeMl} ml · {walkMinutes(metres)} min walk
          </Text>
        </View>
      </View>

      <Text style={styles.provenance}>
        {row.source === "official_feed"
          ? `Official price feed · last sold ${relativeTime(row.seenAt, now)}`
          : row.source === "featured"
            ? "Featured listing · submitted by the store"
            : `${row.qty ?? "?"} on shelf · logged ${relativeTime(row.seenAt, now)} by ${row.by ?? "a hunter"}`}
      </Text>

      <View style={styles.actions}>
        <Tap haptic="medium" style={styles.primary} onPress={() => openDirections(store)}>
          <NavigationArrow size={13} color="#f2f5f2" weight="fill" />
          <Text style={styles.primaryLabel}>Directions</Text>
        </Tap>
        <Tap style={styles.secondary} onPress={onDetails}>
          <Text style={styles.secondaryLabel}>Details</Text>
        </Tap>
      </View>

      <Text style={styles.footnote}>
        {prettyDistance(metres)} away
        {store.shelf.length > 1
          ? ` · ${store.shelf.length - 1} more flavour${store.shelf.length > 2 ? "s" : ""} on Details`
          : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.neutral100,
    borderRadius: radius.lg,
    paddingHorizontal: space[6],
    paddingTop: space[6],
    paddingBottom: space[4],
    shadowColor: "#000",
    shadowOpacity: 0.65,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 22 },
    elevation: 20,
  },
  tail: {
    position: "absolute",
    left: -8,
    top: 64,
    width: 18,
    height: 18,
    backgroundColor: color.neutral100,
    transform: [{ rotate: "45deg" }],
    borderRadius: 3,
  },
  close: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: color.neutral200,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  status: {
    fontSize: 9.5,
    fontWeight: "600",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  name: {
    fontSize: 16.5,
    lineHeight: 19,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: "#111411",
    marginTop: space[3],
    paddingRight: 22,
  },
  address: { fontSize: 11, lineHeight: 16, color: "#5a615a", marginTop: 4 },
  divider: { height: 1, backgroundColor: "#d8ddd8", marginVertical: space[4] },
  priceRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  priceLabel: {
    fontSize: 9,
    fontWeight: "500",
    letterSpacing: 1.3,
    color: "#767c76",
    textTransform: "uppercase",
  },
  price: { fontSize: 29, fontWeight: "800", letterSpacing: -1, color: "#111411", marginTop: 5 },
  verdict: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#009a28",
  },
  verdictText: {
    fontSize: 9.5,
    fontWeight: "600",
    color: "#00691b",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    marginTop: space[4],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: "#e8ece8",
  },
  variantText: { flex: 1, minWidth: 0 },
  variantName: { fontSize: 12, fontWeight: "700", color: "#111411" },
  variantMeta: { fontSize: 10, color: "#5a615a", marginTop: 2 },
  provenance: { fontSize: 10.5, lineHeight: 15, color: "#767c76", marginTop: space[3] },
  actions: { flexDirection: "row", gap: space[2], marginTop: space[4] },
  primary: {
    flex: 1,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: "#111411",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryLabel: { fontSize: 11.5, fontWeight: "700", color: "#f2f5f2" },
  secondary: {
    paddingHorizontal: space[4],
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#b6bdb6",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: { fontSize: 11.5, fontWeight: "700", color: "#111411" },
  footnote: { fontSize: 9.5, color: "#8b938b", marginTop: space[3], textAlign: "center" },
});
