import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Linking, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Can } from "@/components/Can";
import { openDirections } from "@/components/StoreBubble";
import {
  Bell,
  BellRinging,
  BookmarkSimple,
  CaretLeft,
  Clock,
  Flame,
  Info,
  NavigationArrow,
  X,
} from "@/components/icons";
import { PromoList } from "@/components/PromoList";
import { Kicker, Tap, rowDivider, styles as ui } from "@/components/ui";
import { NEARBY_METRES } from "@/data/alerts";
import { getVariant } from "@/data/catalog";
import { STOCK_LABEL, stockStatus } from "@/data/stock";
import {
  cheapest,
  distanceM,
  ils,
  isolate,
  prettyDistance,
  relativeTime,
  walkMinutes,
  type ShelfRow,
  type Store,
} from "@/data/stores";
import { useApp } from "@/state/AppState";
import { color, muted, radius, space, textAlpha } from "@/theme";

const REPORT_REPO = "Yz-3076/energy-radar";

function openReportIssue(storeId: string, storeName: string, address: string, message: string) {
  const title = `Store report: ${storeName}`;
  const body = [
    message.trim() || "(no details given)",
    "",
    "---",
    `Store: ${storeName}`,
    `Address: ${address}`,
    `ID: ${storeId}`,
  ].join("\n");
  const url =
    `https://github.com/${REPORT_REPO}/issues/new?` +
    `title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=user-report`;
  Linking.openURL(url).catch(() => {});
}

export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { storeById, stores, coord, saved, toggleSaved, storeAlertFor, toggleStoreAlert, promosAtStore } = useApp();
  const now = useMemo(() => new Date(), []);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");

  /**
   * Undefined whenever the id isn't in the dataset *yet* — most often on a
   * cold open straight to this screen (deep link, notification), where the
   * live store list hasn't finished fetching and only the seeded set is
   * loaded. It resolves to a real store a moment later, so every hook below
   * has to run in both states: the early return for the missing case sits
   * after all of them, because returning before a hook changed the hook
   * count between those two renders and crashed the screen outright
   * ("Rendered more hooks than during the previous render").
   */
  const store = storeById(String(id));

  const shelf = store ? [...store.shelf].sort((a, b) => a.price - b.price) : [];
  const best = store ? cheapest(store) : null;

  /** Same variant, every other shelf in the dataset — a real price comparison
   *  in place of a price history nobody is recording yet. */
  const spread = useMemo(() => {
    if (!best) return { rows: [] as { s: Store; r: ShelfRow }[], max: 0, min: 0 };
    const rows = stores
      .flatMap((s) => s.shelf.filter((r) => r.variantId === best.variantId).map((r) => ({ s, r })))
      .sort((a, b) => a.r.price - b.r.price)
      .slice(0, 10);
    const max = Math.max(...rows.map((x) => x.r.price), best.price);
    const min = Math.min(...rows.map((x) => x.r.price), best.price);
    return { rows, max, min };
  }, [stores, best]);

  /** Deals this exact branch is running, labelled with the flavour since a
   *  store can carry several. Branch-scoped: anything this store isn't
   *  actually running simply doesn't appear, so the section is empty far
   *  more often than not — which is the honest answer. */
  const shelfPromos = useMemo(
    () =>
      shelf.flatMap((r) => {
        const promos = store ? promosAtStore(store.id, r.variantId) : [];
        if (promos.length === 0) return [];
        const name = getVariant(r.variantId).name;
        return promos.map((p) => ({ ...p, description: `${name} — ${p.description || "Promotion"}` }));
      }),
    [shelf, store, promosAtStore],
  );

  // Every hook has now run, so it is safe to bail out — see the note on
  // `store` above for why this can't move back up.
  if (!store || !best) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>That shelf is no longer in the dataset.</Text>
        <Tap style={ui.ghostButton} onPress={() => router.back()}>
          <Text style={ui.ghostLabel}>Go back</Text>
        </Tap>
      </View>
    );
  }

  const metres = distanceM(coord, store);
  const isSaved = saved.has(store.id);
  const bestVariant = getVariant(best.variantId);
  const storeAlert = storeAlertFor(store.id);
  const isNear = metres <= NEARBY_METRES;
  const cheaperCount = spread.rows.filter((x) => x.r.price < best.price).length;

  const submitReport = () => {
    openReportIssue(store.id, store.name, store.address, reportText);
    setReportOpen(false);
    setReportText("");
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <View style={styles.heroGlow} />
        <View style={styles.heroCans}>
          {shelf.slice(0, 3).map((r, i) => (
            <Can key={r.variantId} variant={getVariant(r.variantId)} size={i === 1 ? 92 : 74} />
          ))}
        </View>

        <Tap style={[styles.heroButton, { top: insets.top + 6, left: 14 }]} onPress={() => router.back()}>
          <CaretLeft size={15} color={color.text} />
        </Tap>
        <Tap
          style={[styles.heroButton, { top: insets.top + 6, right: 14 }]}
          onPress={() => toggleSaved(store.id)}
          accessibilityLabel={isSaved ? "Remove from saved" : "Save shelf"}
        >
          <BookmarkSimple
            size={15}
            color={isSaved ? color.accent : color.text}
            weight={isSaved ? "fill" : "regular"}
          />
        </Tap>
      </View>

      <View style={styles.body}>
        <View style={styles.openRow}>
          {store.closesAt ? (
            <>
              <Clock size={12} color={color.accent} weight="fill" />
              <Text style={styles.open}>
                {store.closesAt === "24h" ? "Open 24 hours" : `Open until ${store.closesAt}`}
              </Text>
            </>
          ) : null}
          {shelfPromos.length > 0 ? (
            <View style={styles.dealPill}>
              <Flame size={10} color="#ff5a2e" weight="fill" />
              <Text style={styles.dealPillText}>
                {shelfPromos.length} {shelfPromos.length === 1 ? "deal" : "deals"}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.name}>{store.name}</Text>
        <Text style={styles.address}>
          {isolate(store.address)} · {walkMinutes(metres)} min walk · {prettyDistance(metres)}
        </Text>

        <Tap haptic="medium" style={[ui.ghostButton, styles.action]} onPress={() => openDirections(store)}>
          <NavigationArrow size={14} color={color.accent} weight="fill" />
          <Text style={ui.ghostLabel}>Directions</Text>
        </Tap>

        <Tap
          haptic="medium"
          style={[styles.nearCard, storeAlert && styles.nearCardOn]}
          onPress={() => toggleStoreAlert(store.id)}
        >
          {storeAlert ? (
            <BellRinging size={16} color={color.accent} weight="fill" />
          ) : (
            <Bell size={16} color={textAlpha(60)} />
          )}
          <View style={styles.nearText}>
            <Text style={[styles.nearTitle, storeAlert && { color: color.accent }]}>
              {storeAlert ? "Alert on" : "Notify me when I'm near"}
            </Text>
            <Text style={styles.nearSub}>
              {isNear ? "You're basically here right now" : `Checked in-app · ${prettyDistance(metres)} away`}
            </Text>
          </View>
        </Tap>

        <Kicker style={styles.kicker}>On the shelf · {shelf.length}</Kicker>
        <View style={ui.group}>
          {shelf.map((row, i) => {
            const v = getVariant(row.variantId);
            const status = stockStatus(row, now);
            return (
              <Tap
                key={row.variantId}
                style={[ui.row, i < shelf.length - 1 && rowDivider]}
                onPress={() => router.push({ pathname: "/variant/[id]", params: { id: v.id } })}
              >
                <Can variant={v} size={45} dim={status === "unconfirmed"} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{v.fullName}</Text>
                  {v.barcode ? <Text style={styles.barcode}>{v.barcode}</Text> : null}
                  <View style={styles.rowSubRow}>
                    <View
                      style={[
                        styles.stockDot,
                        status === "in_stock" && styles.stockDotOn,
                        status === "fading" && styles.stockDotFading,
                      ]}
                    />
                    <Text style={styles.rowSub}>
                      {STOCK_LABEL[status]} ·{" "}
                      {row.source === "official_feed"
                        ? `official feed, sold ${relativeTime(row.seenAt, now)}`
                        : row.source === "featured"
                          ? "listed by the store"
                          : `hunter photo, ${relativeTime(row.seenAt, now)}`}
                    </Text>
                  </View>
                </View>
                <Text
                  style={[styles.rowPrice, row.price === best.price && { color: color.accent }]}
                >
                  {ils(row.price)}
                </Text>
              </Tap>
            );
          })}
        </View>

        {shelfPromos.length > 0 ? (
          <>
            <Kicker style={styles.kicker}>Current deals</Kicker>
            <PromoList promos={shelfPromos.map((promo) => ({ promo }))} />
          </>
        ) : null}

        <Kicker style={styles.kicker}>Price spread · {bestVariant.name}</Kicker>
        <View style={[ui.card, styles.chart]}>
          <View style={styles.bars}>
            {spread.rows.map(({ s, r }) => {
              const range = Math.max(0.01, spread.max - spread.min);
              const height = 22 + ((r.price - spread.min) / range) * 56;
              const here = s.id === store.id;
              return (
                <View key={`${s.id}-${r.variantId}`} style={styles.barCol}>
                  <View
                    style={[
                      styles.bar,
                      { height, backgroundColor: here ? color.accent : color.accent800 },
                    ]}
                  />
                  <Text style={[styles.barLabel, here && { color: color.accent }]} numberOfLines={1}>
                    {here ? "here" : s.city.slice(0, 4)}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={styles.chartFoot}>
            <Text style={styles.chartPrice}>{ils(best.price)}</Text>
            <Text style={styles.chartMeta}>
              {cheaperCount === 0
                ? "cheapest shelf Energy Radar can see for this variant"
                : `${cheaperCount} ${cheaperCount === 1 ? "shelf" : "shelves"} cheaper, from ${ils(spread.min)}`}
            </Text>
          </View>
        </View>

        <Text style={styles.footnote}>
          Stock status is a plain estimate — how the price was sourced and how long ago — not a live feed
          from the register. A listed can may already be off the shelf even when it reads "In stock".
        </Text>

        <Tap style={styles.reportButton} onPress={() => setReportOpen(true)}>
          <Info size={13} color={textAlpha(55)} />
          <Text style={styles.reportLabel}>Report a problem with this store</Text>
        </Tap>
      </View>

      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Report a problem</Text>
              <Tap onPress={() => setReportOpen(false)} hitSlop={10}>
                <X size={16} color={textAlpha(60)} />
              </Tap>
            </View>
            <Text style={styles.modalSub}>
              Wrong address, closed down, bad price — whatever it is, this opens a public GitHub issue with
              your note and this store's details already filled in.
            </Text>
            <TextInput
              multiline
              autoFocus
              value={reportText}
              onChangeText={setReportText}
              placeholder="What's wrong with this store?"
              placeholderTextColor={textAlpha(38)}
              style={styles.modalInput}
            />
            <Tap
              haptic="medium"
              style={[ui.ghostButton, styles.modalSubmit, !reportText.trim() && styles.modalSubmitOff]}
              onPress={submitReport}
            >
              <Text style={ui.ghostLabel}>Open issue on GitHub</Text>
            </Tap>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  missing: { flex: 1, backgroundColor: color.bg, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  missingText: { color: muted, fontSize: 13 },
  hero: {
    height: 232,
    backgroundColor: "#0b0d0b",
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  heroGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,255,65,0.05)",
  },
  heroCans: { flexDirection: "row", alignItems: "flex-end", gap: space[2], paddingBottom: 4 },
  heroButton: {
    position: "absolute",
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: "rgba(10,11,10,0.82)",
    borderWidth: 1,
    borderColor: color.neutral800,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { paddingHorizontal: 16, paddingTop: space[6] },
  openRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  open: {
    fontSize: 9.5,
    fontWeight: "600",
    letterSpacing: 1.3,
    color: color.accent,
    textTransform: "uppercase",
  },
  name: { fontSize: 24, lineHeight: 26, fontWeight: "800", letterSpacing: -0.7, color: color.text, marginTop: space[3] },
  address: {
    fontSize: 11.5,
    lineHeight: 17,
    color: textAlpha(50),
    marginTop: 5,
    writingDirection: "ltr",
  },
  action: { height: 44, marginTop: space[6] },
  nearCard: {
    marginTop: space[3],
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: color.surface,
    padding: space[4],
  },
  nearCardOn: { borderColor: color.accent },
  nearText: { flex: 1, minWidth: 0 },
  nearTitle: { fontSize: 12.5, fontWeight: "700", color: color.text },
  nearSub: { fontSize: 10, lineHeight: 14, color: textAlpha(45), marginTop: 2 },
  kicker: { marginTop: space[8], marginBottom: space[4] },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 12.5, fontWeight: "600", color: color.text },
  barcode: {
    fontSize: 9.5,
    color: textAlpha(35),
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  rowSubRow: { flexDirection: "row", alignItems: "center", gap: space[2], marginTop: 3 },
  stockDot: { width: 5, height: 5, borderRadius: 3, borderWidth: 1, borderColor: textAlpha(35) },
  stockDotOn: { backgroundColor: color.accent, borderColor: color.accent },
  stockDotFading: { backgroundColor: "#e0b23d", borderColor: "#e0b23d" },
  rowSub: { fontSize: 10, color: muted },
  rowPrice: { fontSize: 14, fontWeight: "700", color: color.text },
  chart: { padding: space[6] },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 5, height: 96 },
  barCol: { flex: 1, alignItems: "center", gap: space[2] },
  bar: { width: "100%", borderRadius: 2 },
  barLabel: { fontSize: 8, color: textAlpha(32) },
  chartFoot: { flexDirection: "row", alignItems: "baseline", gap: space[3], marginTop: space[4] },
  chartPrice: { fontSize: 18, fontWeight: "700", color: color.accent },
  chartMeta: { flex: 1, fontSize: 10.5, color: muted },
  footnote: { fontSize: 10.5, lineHeight: 16, color: textAlpha(38), marginTop: space[6] },
  dealPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: space[3],
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,90,46,0.4)",
    backgroundColor: "rgba(255,90,46,0.12)",
  },
  dealPillText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "#ff8a5f",
  },
  reportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    marginTop: space[6],
    paddingVertical: space[3],
  },
  reportLabel: { fontSize: 11, color: textAlpha(55) },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(4,5,4,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: color.surface,
    padding: space[6],
  },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 15, fontWeight: "700", color: color.text },
  modalSub: { fontSize: 11.5, lineHeight: 16, color: textAlpha(55), marginTop: space[3] },
  modalInput: {
    minHeight: 90,
    marginTop: space[4],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 13,
    textAlignVertical: "top",
  },
  modalSubmit: { height: 44, marginTop: space[4] },
  modalSubmitOff: { opacity: 0.5 },
});
