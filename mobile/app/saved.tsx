import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BackButton, Screen, Tap, styles as ui } from "@/components/ui";
import { distanceM, ils, originalRow, prettyDistance, relativeTime } from "@/data/stores";
import { useApp } from "@/state/AppState";
import { color, muted, space, textAlpha } from "@/theme";

export default function SavedScreen() {
  const router = useRouter();
  const { stores, coord, saved } = useApp();
  const now = useMemo(() => new Date(), []);

  const savedStores = stores.filter((s) => saved.has(s.id));

  return (
    <Screen>
      <BackButton onPress={() => router.back()} />
      <Text style={styles.title}>Saved</Text>
      <Text style={styles.sub}>Shelves you bookmarked — {savedStores.length} saved.</Text>

      <View style={styles.cards}>
        {savedStores.map((s) => {
          const row = originalRow(s);
          return (
            <Tap
              key={s.id}
              style={[ui.card, styles.card]}
              onPress={() => router.push({ pathname: "/store/[id]", params: { id: s.id } })}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.rowSub}>
                  {prettyDistance(distanceM(coord, s))} · {s.shelf.length} variants ·{" "}
                  {relativeTime(row.seenAt, now)}
                </Text>
              </View>
              <Text style={styles.price}>{ils(row.price)}</Text>
            </Tap>
          );
        })}
        {savedStores.length === 0 ? (
          <View style={[ui.card, styles.empty]}>
            <Text style={styles.emptyText}>
              No saved shelves yet. Open a store and tap the bookmark to keep it here.
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.8,
    textTransform: "uppercase",
    color: color.text,
    marginTop: space[4],
  },
  sub: { fontSize: 11.5, color: textAlpha(45), marginTop: space[3], marginBottom: space[6] },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 12.5, fontWeight: "600", color: color.text },
  rowSub: { fontSize: 10, color: muted, marginTop: 3 },
  cards: { gap: space[3] },
  card: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  price: { fontSize: 13.5, fontWeight: "700", color: color.accent },
  empty: { padding: space[6] },
  emptyText: { fontSize: 11.5, lineHeight: 17, color: textAlpha(45) },
});
