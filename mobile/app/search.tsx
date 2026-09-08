import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Can } from "@/components/Can";
import { MagnifyingGlass, Storefront } from "@/components/icons";
import { Chip, Kicker, Tap, rowDivider, styles as ui } from "@/components/ui";
import { VARIANTS, getVariant } from "@/data/catalog";
import { FILTERS, matchesFilter, type FilterId } from "@/data/filters";
import {
  distanceM,
  ils,
  isolate,
  prettyDistance,
  relativeTime,
  type Store,
} from "@/data/stores";
import { useApp } from "@/state/AppState";
import { color, muted, radius, space, textAlpha } from "@/theme";

type VariantHit = { variantId: string; store: Store; price: number; seenAt: string; metres: number };

export default function SearchScreen() {
  const router = useRouter();
  const { q: initialQuery } = useLocalSearchParams<{ q?: string }>();
  const insets = useSafeAreaInsets();
  const { stores, coord, addRecentSearch } = useApp();
  const now = useMemo(() => new Date(), []);

  const [query, setQuery] = useState(initialQuery ?? "");
  const [filter, setFilter] = useState<FilterId>("all");

  const pool = useMemo(() => stores.filter((s) => matchesFilter(s, filter, now)), [stores, filter, now]);
  const q = query.trim().toLowerCase();

  /** Cheapest live listing per matching variant. */
  const variantHits = useMemo<VariantHit[]>(() => {
    const best = new Map<string, VariantHit>();
    for (const store of pool) {
      const metres = distanceM(coord, store);
      for (const row of store.shelf) {
        const v = getVariant(row.variantId);
        const hay = `${v.name} ${v.fullName} ${v.rarity} ${v.barcode ?? ""}`.toLowerCase();
        if (q && !hay.includes(q)) continue;
        const prev = best.get(v.id);
        if (!prev || row.price < prev.price) {
          best.set(v.id, { variantId: v.id, store, price: row.price, seenAt: row.seenAt, metres });
        }
      }
    }
    return [...best.values()].sort((a, b) => a.price - b.price);
  }, [pool, q, coord]);

  const storeHits = useMemo(() => {
    if (!q) return [];
    return pool
      .filter((s) => `${s.name} ${s.chain} ${s.address}`.toLowerCase().includes(q))
      .map((s) => ({ store: s, metres: distanceM(coord, s) }))
      .sort((a, b) => a.metres - b.metres)
      .slice(0, 6);
  }, [pool, q, coord]);

  /** Variants nobody nearby is carrying — an honest "nothing found" answer. */
  const missing = useMemo(() => {
    if (!q) return [];
    const found = new Set(variantHits.map((h) => h.variantId));
    return VARIANTS.filter(
      (v) => !found.has(v.id) && `${v.name} ${v.fullName}`.toLowerCase().includes(q),
    );
  }, [q, variantHits]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <View style={styles.searchRow}>
        <View style={styles.field}>
          <MagnifyingGlass size={15} color={color.accent} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Flavour, store, barcode…"
            placeholderTextColor={textAlpha(38)}
            style={styles.input}
            returnKeyType="search"
            selectionColor={color.accent}
            onSubmitEditing={() => addRecentSearch(query)}
          />
        </View>
        <Tap haptic="none" onPress={() => router.back()} style={styles.cancel}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Tap>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <Chip key={f.id} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
          ))}
        </View>

        <Kicker style={styles.kicker}>
          {q ? "Flavour matches" : "Cheapest right now"}
        </Kicker>
        <View style={ui.group}>
          {variantHits.slice(0, q ? 12 : 6).map((hit, i, arr) => {
            const v = getVariant(hit.variantId);
            return (
              <Tap
                key={hit.variantId}
                style={[ui.row, i < arr.length - 1 && rowDivider]}
                onPress={() => router.push({ pathname: "/variant/[id]", params: { id: v.id } })}
              >
                <Can variant={v} size={45} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{v.fullName}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {isolate(hit.store.name)} · {prettyDistance(hit.metres)} ·{" "}
                    {relativeTime(hit.seenAt, now)}
                  </Text>
                </View>
                <Text style={styles.price}>{ils(hit.price)}</Text>
              </Tap>
            );
          })}
          {variantHits.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No shelf in range lists that.</Text>
            </View>
          ) : null}
        </View>

        {missing.length > 0 ? (
          <>
            <Kicker style={styles.kicker}>Known, but not nearby</Kicker>
            <View style={ui.group}>
              {missing.map((v, i) => (
                <Tap
                  key={v.id}
                  style={[ui.row, i < missing.length - 1 && rowDivider]}
                  onPress={() => router.push({ pathname: "/variant/[id]", params: { id: v.id } })}
                >
                  <Can variant={v} size={45} dim />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, { color: textAlpha(65) }]}>{v.fullName}</Text>
                    <Text style={styles.rowSub}>Not on any shelf Energy Radar can see right now</Text>
                  </View>
                  <Text style={styles.dash}>—</Text>
                </Tap>
              ))}
            </View>
          </>
        ) : null}

        {storeHits.length > 0 ? (
          <>
            <Kicker style={styles.kicker}>Stores</Kicker>
            <View style={ui.group}>
              {storeHits.map(({ store, metres }, i) => (
                <Tap
                  key={store.id}
                  style={[ui.row, i < storeHits.length - 1 && rowDivider]}
                  onPress={() => router.push({ pathname: "/store/[id]", params: { id: store.id } })}
                >
                  <Storefront size={18} color={textAlpha(50)} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{store.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {isolate(store.chain)} · {prettyDistance(metres)} · {store.shelf.length} variants
                    </Text>
                  </View>
                </Tap>
              ))}
            </View>
          </>
        ) : null}

        {!q ? (
          <>
            <Kicker style={styles.kicker}>Try</Kicker>
            <View style={styles.suggestions}>
              {["ultra", "zero sugar", "mango", "rare", "5060639128051"].map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={false}
                  onPress={() => {
                    setQuery(s);
                    addRecentSearch(s);
                  }}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  searchRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: 16 },
  field: {
    flex: 1,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.accent,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
  },
  input: { flex: 1, fontSize: 13, color: color.text, padding: 0 },
  cancel: { paddingVertical: 8 },
  cancelLabel: { fontSize: 12.5, fontWeight: "500", color: color.accent },
  body: { paddingHorizontal: 16, paddingTop: space[4] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  kicker: { marginTop: space[8], marginBottom: space[4] },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, fontWeight: "600", color: color.text },
  rowSub: { fontSize: 10.5, color: muted, marginTop: 3, writingDirection: "ltr" },
  price: { fontSize: 13, fontWeight: "700", color: color.accent },
  dash: { fontSize: 13, color: textAlpha(30) },
  emptyRow: { padding: space[6], alignItems: "center" },
  emptyText: { fontSize: 12, color: muted },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
