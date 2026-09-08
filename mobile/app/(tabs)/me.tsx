import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { Can } from "@/components/Can";
import { BellRinging, Flame, Info, MagnifyingGlass, Plus, Storefront, X } from "@/components/icons";
import { Chip, Kicker, Screen, Tap, rowDivider, styles as ui } from "@/components/ui";
import { matchingStores, storeAlertStatus } from "@/data/alerts";
import { getVariant, VARIANTS } from "@/data/catalog";
import { notifyAlert } from "@/data/notify";
import { currentStreak, favouriteVariantId, longestStreak } from "@/data/streak";
import { distanceM, ils, isolate, lastSeen, prettyDistance, relativeTime, type Store } from "@/data/stores";
import { useApp } from "@/state/AppState";
import { color, radius, space, textAlpha } from "@/theme";

/** A small breathing dot for a currently-matching alert — the only piece of
 *  motion on this screen, so it earns the attention it draws. */
function PulseDot() {
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.55, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[styles.pulseDot, { opacity: v }]} />;
}

type SearchHit = { key: string; tag: string; term: string; meta: string; onPick: () => void };

/** Either alert type, resolved against live data — one shape the Me list can
 *  render without re-narrowing `alert.type` at every use site. `nav` is
 *  already the exact route params this row's own detail page needs. */
type AlertRow = {
  id: string;
  on: boolean;
  /** Small uppercase kicker: RESTOCK / PRICE DROP / NEARBY STORE. */
  badge: string;
  title: string;
  sub: string;
  /** The real can for a flavour alert; null for a store alert (shows a
   *  storefront icon instead). */
  can: ReturnType<typeof getVariant> | null;
  nav: { pathname: "/variant/[id]" | "/store/[id]"; params: { id: string } };
  remove: () => void;
};

export default function MeScreen() {
  const router = useRouter();
  const {
    drinks,
    logDrink,
    saved,
    stores,
    coord,
    recentSearches,
    addRecentSearch,
    alerts,
    removeAlert,
    toggleStoreAlert,
  } = useApp();

  const [query, setQuery] = useState("");
  const [addMode, setAddMode] = useState<"closed" | "choose" | "store">("closed");

  // Real activity, not decoration: how many cans this handle actually logged
  // drinking on each of the last 14 days. A brand-new account just shows a
  // flat, honest floor rather than a fake shape.
  const activity = useMemo(() => {
    const days = 14;
    const counts = new Array(days).fill(0);
    const now = Date.now();
    for (const d of drinks) {
      const ageDays = Math.floor((now - new Date(d.at).getTime()) / 86_400_000);
      if (ageDays >= 0 && ageDays < days) counts[days - 1 - ageDays]++;
    }
    const max = Math.max(1, ...counts);
    return counts.map((c) => Math.max(3, Math.round((c / max) * 30)));
  }, [drinks]);

  const streak = useMemo(() => currentStreak(drinks), [drinks]);
  const best = useMemo(() => longestStreak(drinks), [drinks]);
  const favVariant = useMemo(() => {
    const id = favouriteVariantId(drinks);
    return id ? getVariant(id) : null;
  }, [drinks]);
  const lastVariantId = drinks[0]?.variantId ?? "original";

  const onLogCan = () => logDrink(lastVariantId);
  const onShare = () => {
    const line =
      drinks.length === 0
        ? "I'm tracking my Monster habit on Energy Radar 🥤⚡"
        : streak > 1
          ? `${drinks.length} Monster${drinks.length === 1 ? "" : "s"} logged and counting — ${streak}-day streak on Energy Radar 🥤⚡`
          : `${drinks.length} Monster${drinks.length === 1 ? "" : "s"} logged on Energy Radar 🥤⚡`;
    Share.share({ message: line }).catch(() => {});
  };

  const results = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    for (const v of VARIANTS) {
      if (hits.length >= 4) break;
      if (!`${v.name} ${v.fullName}`.toLowerCase().includes(q)) continue;
      const shelves = stores.filter((s) => s.shelf.some((r) => r.variantId === v.id)).length;
      hits.push({
        key: `v-${v.id}`,
        tag: "FLAVOUR",
        term: v.fullName,
        meta: shelves === 1 ? "1 shelf" : `${shelves} shelves`,
        onPick: () => {
          addRecentSearch(v.name);
          router.push({ pathname: "/variant/[id]", params: { id: v.id } });
        },
      });
    }
    for (const s of stores) {
      if (hits.length >= 4) break;
      if (!`${s.name} ${s.chain}`.toLowerCase().includes(q)) continue;
      hits.push({
        key: `s-${s.id}`,
        tag: "STORE",
        term: isolate(s.name),
        meta: prettyDistance(distanceM(coord, s)),
        onPick: () => {
          addRecentSearch(s.name);
          router.push({ pathname: "/store/[id]", params: { id: s.id } });
        },
      });
    }
    return hits;
  }, [query, stores, coord, addRecentSearch, router]);

  /** The pick list for "track a store": shelves you already saved come
   *  first (this is where "saved" lives now instead of its own card), then
   *  whatever's closest right now, using the same live GPS fix the map
   *  runs on. */
  const nearbyStores = useMemo(() => {
    const withDistance = stores.map((s) => ({ store: s, metres: distanceM(coord, s) }));
    const savedRows = withDistance.filter((r) => saved.has(r.store.id)).sort((a, b) => a.metres - b.metres);
    const rest = withDistance
      .filter((r) => !saved.has(r.store.id))
      .sort((a, b) => a.metres - b.metres)
      .slice(0, Math.max(0, 6 - savedRows.length));
    return [...savedRows, ...rest];
  }, [stores, coord, saved]);

  /** Each alert resolved into one shape the list below can render without
   *  a type-check per row — see the sub-lines for what "on" means per kind. */
  const alertRows = useMemo<AlertRow[]>(() => {
    return alerts.map((alert): AlertRow => {
      if (alert.type === "flavour") {
        const variant = getVariant(alert.variantId);
        const hits = matchingStores(alert, stores);
        const on = hits.length > 0;
        return {
          id: alert.id,
          on,
          badge: alert.kind === "restock" ? "RESTOCK" : "PRICE DROP",
          title: variant.name,
          sub: on
            ? alert.kind === "restock"
              ? `Back in stock at ${isolate(hits[0].store.name)}`
              : `Now ${ils(hits[0].price)} at ${isolate(hits[0].store.name)}`
            : alert.kind === "restock"
              ? "No stock nearby yet"
              : `Watching for under ${ils(alert.maxPrice ?? 0)}`,
          can: variant,
          nav: { pathname: "/variant/[id]", params: { id: alert.variantId } },
          remove: () => removeAlert(alert.id),
        };
      }
      const status = storeAlertStatus(alert, stores, coord);
      return {
        id: alert.id,
        on: status?.near ?? false,
        badge: "NEARBY STORE",
        title: status ? status.store.name : "Store no longer listed",
        sub: status ? (status.near ? "You're basically here right now" : `${prettyDistance(status.metres)} away`) : "",
        can: null,
        nav: { pathname: "/store/[id]", params: { id: alert.storeId } },
        remove: () => removeAlert(alert.id),
      };
    });
  }, [alerts, stores, coord, removeAlert]);
  const matchingCount = alertRows.filter((a) => a.on).length;

  // Fires a real system notification the moment an alert flips from waiting
  // to matching — but only while this screen is mounted and re-rendering.
  // There is no background job behind this: it's a live check against
  // whatever's loaded right now (GPS position, shelf data), not a push
  // service that can reach you with the app closed.
  const wasOn = useRef<Record<string, boolean>>({});
  useEffect(() => {
    for (const row of alertRows) {
      const before = wasOn.current[row.id] ?? false;
      if (row.on && !before) {
        notifyAlert(row.badge === "NEARBY STORE" ? "You're near a store you're tracking" : row.title, row.sub);
      }
      wasOn.current[row.id] = row.on;
    }
  }, [alertRows]);

  const freshestStore = useMemo(
    () => stores.reduce<Store | null>((acc, s) => (!acc || lastSeen(s) > lastSeen(acc) ? s : acc), null),
    [stores],
  );

  return (
    <Screen>
      <View style={styles.recentHead}>
        <Kicker>Recent</Kicker>
        <Text style={styles.recentHint}>TAP TO RE-RUN</Text>
      </View>
      {recentSearches.length > 0 ? (
        <View style={styles.chips}>
          {recentSearches.map((q) => (
            <Chip key={q} label={q} active={false} onPress={() => setQuery(q)} />
          ))}
        </View>
      ) : (
        <Text style={styles.emptyText}>Nothing searched yet.</Text>
      )}

      <View style={styles.statBlock}>
        <Text style={styles.statNumber}>{drinks.length.toLocaleString()}</Text>
        <Text style={styles.statLabel}>MONSTERS LOGGED</Text>
        <View style={styles.bars}>
          {activity.map((h, i) => (
            <View key={i} style={[styles.bar, { height: h, opacity: 0.35 + (h / 30) * 0.65 }]} />
          ))}
        </View>
      </View>

      <View style={styles.streakRow}>
        <View style={styles.streakLeft}>
          <Flame size={15} color={streak > 0 ? "#ff9d3d" : textAlpha(30)} weight={streak > 0 ? "fill" : "regular"} />
          <Text style={styles.streakText}>
            {streak > 0 ? `${streak}-day streak` : "No streak yet"}
            {best > streak ? ` · best ${best}` : ""}
          </Text>
        </View>
        <Tap haptic="none" style={styles.shareButton} onPress={onShare}>
          <Text style={styles.shareLabel}>SHARE</Text>
        </Tap>
      </View>
      {favVariant ? <Text style={styles.favText}>Most logged · {favVariant.name}</Text> : null}

      <Tap haptic="medium" style={styles.logButtonSmall} onPress={onLogCan}>
        <Text style={styles.logLabelSmall}>+ LOG A CAN</Text>
      </Tap>

      <View style={styles.searchField}>
        <View style={styles.searchDot} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => addRecentSearch(query)}
          placeholder="Flavour, store or barcode"
          placeholderTextColor={textAlpha(38)}
          style={styles.searchInput}
          returnKeyType="search"
          selectionColor={color.accent}
        />
        {query.length > 0 ? (
          <Tap haptic="none" style={styles.searchClear} onPress={() => setQuery("")}>
            <X size={13} color={textAlpha(50)} />
          </Tap>
        ) : (
          <View style={styles.searchClear}>
            <MagnifyingGlass size={15} color={textAlpha(45)} />
          </View>
        )}
      </View>

      {results.length > 0 ? (
        <View style={[ui.group, styles.results]}>
          {results.map((r, i) => (
            <Tap
              key={r.key}
              style={[ui.row, i < results.length - 1 && rowDivider]}
              onPress={() => {
                r.onPick();
                setQuery("");
              }}
            >
              <Text style={styles.resultTag}>{r.tag}</Text>
              <Text style={styles.resultTerm} numberOfLines={1}>
                {r.term}
              </Text>
              <Text style={styles.resultMeta}>{r.meta}</Text>
            </Tap>
          ))}
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Alerts</Text>
        <View style={styles.sectionRule} />
      </View>

      {alertRows.length > 0 ? (
        <View style={styles.alertList}>
          {alertRows.map((row) => (
            <Tap
              key={row.id}
              style={[styles.alertCard, row.on && styles.alertCardOn]}
              onPress={() => router.push(row.nav)}
            >
              {row.on ? <View style={styles.alertEdge} /> : null}
              {row.can ? (
                <Can variant={row.can} size={40} dim={!row.on} />
              ) : (
                <View style={[styles.storeIconWrap, row.on && styles.storeIconWrapOn]}>
                  <Storefront size={18} color={row.on ? color.accent : textAlpha(55)} weight={row.on ? "fill" : "regular"} />
                </View>
              )}
              <View style={styles.rowText}>
                <View style={styles.alertKickerRow}>
                  {row.on ? <PulseDot /> : <View style={styles.pulseDotOff} />}
                  <Text style={[styles.alertKicker, row.on && styles.alertKickerOn]}>{row.badge}</Text>
                </View>
                <Text style={[styles.alertName, row.on && styles.alertNameOn]} numberOfLines={1}>
                  {row.title}
                </Text>
                <Text style={styles.alertDetail} numberOfLines={1}>
                  {row.sub}
                </Text>
              </View>
              <Tap haptic="light" style={styles.removeAlert} onPress={row.remove}>
                <X size={13} color={textAlpha(row.on ? 55 : 35)} />
              </Tap>
            </Tap>
          ))}
        </View>
      ) : addMode === "closed" ? (
        <View style={styles.emptyAlerts}>
          <View style={styles.emptyDotRing}>
            <View style={styles.emptyDot} />
          </View>
          <Text style={styles.emptyTitle}>Radar is quiet</Text>
          <Text style={styles.emptyBody}>
            Track a flavour for a restock or price drop, or a store to know when you're near it.
          </Text>
        </View>
      ) : null}

      <Tap
        haptic="light"
        style={styles.addAlertButton}
        onPress={() => setAddMode((m) => (m === "closed" ? "choose" : "closed"))}
      >
        <Plus size={15} color={color.accent} weight="fill" />
        <Text style={styles.addAlertLabel}>{addMode === "closed" ? "ADD ALERT" : "CANCEL"}</Text>
      </Tap>

      {addMode === "choose" ? (
        <View style={styles.addPicker}>
          <Tap
            style={styles.addOption}
            onPress={() => {
              setAddMode("closed");
              router.push("/search");
            }}
          >
            <Text style={styles.addOptionTitle}>Track a flavour</Text>
            <Text style={styles.addOptionSub}>Notify on restock or a price drop</Text>
          </Tap>
          <Tap style={styles.addOption} onPress={() => setAddMode("store")}>
            <Text style={styles.addOptionTitle}>Track a store</Text>
            <Text style={styles.addOptionSub}>Notify when you're near it, using your live location</Text>
          </Tap>
        </View>
      ) : null}

      {addMode === "store" ? (
        <View style={[ui.group, styles.addPicker]}>
          {nearbyStores.map(({ store, metres }, i, arr) => (
            <Tap
              key={store.id}
              style={[ui.row, i < arr.length - 1 && rowDivider]}
              onPress={() => {
                toggleStoreAlert(store.id);
                setAddMode("closed");
              }}
            >
              <Storefront
                size={16}
                color={saved.has(store.id) ? color.accent : textAlpha(55)}
                weight={saved.has(store.id) ? "fill" : "regular"}
              />
              <View style={styles.rowText}>
                <Text style={styles.resultTerm} numberOfLines={1}>
                  {isolate(store.name)}
                  {saved.has(store.id) ? "  ·  saved" : ""}
                </Text>
              </View>
              <Text style={styles.resultMeta}>{prettyDistance(metres)}</Text>
            </Tap>
          ))}
        </View>
      ) : null}

      {alertRows.length > 0 ? (
        <Text style={styles.alertSummary}>
          {alertRows.length} tracked{matchingCount > 0 ? ` · ${matchingCount} matching now` : ""}
        </Text>
      ) : null}

      <View style={[ui.card, styles.about]}>
        <View style={styles.aboutHead}>
          <Info size={14} color={textAlpha(55)} />
          <Text style={styles.aboutTitle}>Where the prices come from</Text>
        </View>
        <Text style={styles.aboutBody}>
          Israeli chains are legally required to publish machine-readable price files several times a day.
          Energy Radar reads those, matches Monster barcodes, and resolves each store from the chain's own
          branch list. Rows tagged “official feed” came from there; the rest were logged by hunters standing
          in front of the shelf. A price file says what a register charges — it never promises the can is
          still on the shelf.
        </Text>
        {freshestStore ? (
          <Text style={styles.lastSync}>
            LAST SHELF UPDATE · {relativeTime(lastSeen(freshestStore)).toUpperCase()}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statBlock: { alignItems: "center", marginTop: space[6] },
  statNumber: {
    fontSize: 56,
    fontWeight: "800",
    lineHeight: 56,
    color: color.white,
  },
  statLabel: { fontSize: 10, fontWeight: "500", letterSpacing: 1.8, color: textAlpha(50), marginTop: space[2] },
  bars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 3, height: 32, marginTop: space[4] },
  bar: { width: 5, borderRadius: 1, backgroundColor: color.accent },

  streakRow: { flexDirection: "row", alignItems: "center", gap: space[3], marginTop: space[6] },
  streakLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[2], minWidth: 0 },
  streakText: { fontSize: 12, fontWeight: "600", color: textAlpha(70) },
  shareButton: {
    height: 34,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: textAlpha(16),
    alignItems: "center",
    justifyContent: "center",
  },
  shareLabel: { fontSize: 9.5, fontWeight: "700", letterSpacing: 1, color: textAlpha(60) },
  favText: { fontSize: 10.5, color: textAlpha(40), marginTop: space[3] },
  logButtonSmall: {
    marginTop: space[3],
    alignSelf: "flex-start",
    height: 28,
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: color.accent900,
    alignItems: "center",
    justifyContent: "center",
  },
  logLabelSmall: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8, color: color.accent },

  searchField: {
    marginTop: space[8],
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(0,255,65,0.35)",
    backgroundColor: color.accent900,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingLeft: space[4],
  },
  searchDot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: color.accent,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: "500", color: color.text, padding: 0 },
  searchClear: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  results: { marginTop: space[3] },
  resultTag: { width: 56, fontSize: 8.5, letterSpacing: 1.2, color: textAlpha(40) },
  resultTerm: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "500", color: color.text, writingDirection: "ltr" },
  resultMeta: { fontSize: 10.5, color: color.accent },

  recentHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: space[8] },
  recentHint: { fontSize: 9, letterSpacing: 1.2, color: textAlpha(28) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[3] },
  emptyText: { fontSize: 11.5, color: textAlpha(40), marginTop: space[3] },

  sectionHead: { flexDirection: "row", alignItems: "center", gap: space[3], marginTop: space[8], marginBottom: space[4] },
  sectionTitle: { fontSize: 19, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: color.text },
  sectionRule: { flex: 1, height: 1, backgroundColor: textAlpha(12) },
  addAlertButton: {
    marginTop: space[4],
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(0,255,65,0.45)",
    backgroundColor: color.accent900,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
  },
  addAlertLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: color.accent },

  addPicker: { marginTop: space[3], marginBottom: space[4] },
  addOption: {
    borderWidth: 1,
    borderColor: textAlpha(12),
    borderRadius: radius.md,
    padding: space[4],
    marginBottom: space[2],
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  addOptionTitle: { fontSize: 13, fontWeight: "700", color: color.text },
  addOptionSub: { fontSize: 10.5, color: textAlpha(45), marginTop: 2 },

  alertList: { gap: space[3] },
  alertCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: textAlpha(10),
    backgroundColor: "rgba(255,255,255,0.015)",
    overflow: "hidden",
  },
  alertCardOn: {
    borderColor: "rgba(0,255,65,0.5)",
    backgroundColor: "rgba(0,255,65,0.06)",
  },
  alertEdge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: color.accent },
  storeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: textAlpha(14),
    alignItems: "center",
    justifyContent: "center",
  },
  storeIconWrapOn: { borderColor: "rgba(0,255,65,0.5)", backgroundColor: color.accent900 },
  alertKickerRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  pulseDotOff: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: textAlpha(35) },
  alertKicker: { fontSize: 8.5, letterSpacing: 1.6, color: textAlpha(42) },
  alertKickerOn: { color: color.accent },
  alertName: {
    fontSize: 16,
    fontWeight: "700",
    textTransform: "uppercase",
    color: textAlpha(80),
    marginTop: 3,
  },
  alertNameOn: { color: color.text },
  alertDetail: { fontSize: 11.5, color: textAlpha(45), marginTop: 2 },
  removeAlert: { padding: space[2] },
  alertSummary: { fontSize: 9.5, letterSpacing: 1, color: textAlpha(35), marginTop: space[4], textAlign: "center" },

  emptyAlerts: {
    borderWidth: 1,
    borderColor: textAlpha(14),
    borderStyle: "dashed",
    borderRadius: radius.md,
    padding: space[6],
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.01)",
  },
  emptyDotRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,65,0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space[3],
  },
  emptyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(0,255,65,0.6)" },
  emptyTitle: { fontSize: 17, fontWeight: "800", textTransform: "uppercase", color: color.text },
  emptyBody: {
    fontSize: 12.5,
    lineHeight: 18,
    color: textAlpha(50),
    marginTop: space[2],
    textAlign: "center",
    maxWidth: 250,
  },

  rowText: { flex: 1, minWidth: 0 },
  about: { marginTop: space[8] },
  aboutHead: { flexDirection: "row", alignItems: "center", gap: space[2] },
  aboutTitle: { fontSize: 12.5, fontWeight: "600", color: color.text },
  aboutBody: { fontSize: 11, lineHeight: 17, color: textAlpha(50), marginTop: space[2] },
  lastSync: { fontSize: 9.5, letterSpacing: 1, color: textAlpha(30), marginTop: space[3] },
});
