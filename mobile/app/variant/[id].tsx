import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Can } from "@/components/Can";
import { CaretLeft, Bell, BellRinging, Check } from "@/components/icons";
import { PromoList } from "@/components/PromoList";
import { Kicker, Tap, rowDivider, styles as ui } from "@/components/ui";
import { FLAVOUR_NEARBY_METRES } from "@/data/alerts";
import { getVariant } from "@/data/catalog";
import { distanceM, ils, prettyDistance, relativeTime } from "@/data/stores";
import { useApp } from "@/state/AppState";
import { color, muted, radius, space, textAlpha } from "@/theme";

export default function VariantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { stores, coord, flavourAlertFor, toggleFlavourAlert, logDrink, promosForVariant } = useApp();
  const now = useMemo(() => new Date(), []);

  const [justLogged, setJustLogged] = useState(false);
  const loggedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (loggedTimer.current) clearTimeout(loggedTimer.current);
  }, []);

  const variant = getVariant(String(id));

  const listings = useMemo(
    () =>
      stores
        .flatMap((s) => s.shelf.filter((r) => r.variantId === variant.id).map((r) => ({ s, r })))
        .map((x) => ({ ...x, metres: distanceM(coord, x.s) }))
        .sort((a, b) => a.metres - b.metres),
    [stores, variant.id, coord],
  );

  const lowest = listings.length ? Math.min(...listings.map((l) => l.r.price)) : null;
  const promos = promosForVariant(variant.id);
  const alert = flavourAlertFor(variant.id);
  // Proximity, not price — nothing to configure, so this is a plain toggle.
  const onToggleAlert = () => toggleFlavourAlert(variant.id);

  const onLogDrink = () => {
    logDrink(variant.id);
    setJustLogged(true);
    if (loggedTimer.current) clearTimeout(loggedTimer.current);
    loggedTimer.current = setTimeout(() => setJustLogged(false), 1800);
  };

  // "—" for a figure we don't have, rather than a plausible-looking
  // number — see the Variant type on why these can be null.
  const stats = [
    { v: lowest !== null ? ils(lowest) : "—", k: "cheapest nearby", accent: true },
    { v: variant.caffeineMg !== null ? `${variant.caffeineMg} mg` : "—", k: "caffeine", accent: false },
    {
      v: variant.zeroSugar ? "0 g" : variant.sugarG !== null ? `${variant.sugarG} g` : "—",
      k: "sugar",
      accent: false,
    },
  ];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 48, paddingHorizontal: 18 }}
      showsVerticalScrollIndicator={false}
    >
      <Tap style={styles.back} onPress={() => router.back()}>
        <CaretLeft size={15} color={color.text} />
      </Tap>

      <View style={styles.stage}>
        <View style={styles.glow} />
        <Can variant={variant} size={268} hero />
      </View>

      <Text style={styles.rarity}>
        {listings.length === 0
          ? "No shelf lists it right now"
          : `At ${listings.length} ${listings.length === 1 ? "shelf" : "shelves"} nearby`}
      </Text>
      <Text style={styles.name}>{variant.name}</Text>
      <Text style={styles.blurb}>{variant.blurb}</Text>

      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.k} style={[ui.card, styles.stat]}>
            <Text style={[styles.statValue, s.accent && { color: color.accent }]}>{s.v}</Text>
            <Text style={styles.statKey}>{s.k}</Text>
          </View>
        ))}
      </View>

      {variant.barcode ? (
        <Text style={styles.barcode}>Barcode {variant.barcode} · {variant.sizeMl} ml</Text>
      ) : (
        <Text style={styles.barcode}>
          No barcode confirmed in the price feed yet · {variant.sizeMl} ml
        </Text>
      )}

      {promos.length > 0 ? (
        <>
          <Kicker style={styles.kickerTight}>Current deals</Kicker>
          <PromoList promos={promos} />
        </>
      ) : null}

      <Tap
        haptic="medium"
        style={[styles.drinkButton, justLogged && styles.drinkButtonOn]}
        onPress={onLogDrink}
      >
        {justLogged ? (
          <Check size={15} color={color.bg} weight="fill" />
        ) : null}
        <Text style={[styles.drinkLabel, justLogged && styles.drinkLabelOn]}>
          {justLogged ? "Logged" : "I drank one"}
        </Text>
      </Tap>

      <Tap style={[ui.card, styles.alert, alert && styles.alertOn]} onPress={onToggleAlert}>
        {alert ? (
          <BellRinging size={16} color={color.accent} weight="fill" />
        ) : (
          <Bell size={16} color={textAlpha(60)} />
        )}
        <View style={styles.alertText}>
          <Text style={[styles.alertTitle, alert && { color: color.accent }]}>
            {alert ? "Alert on" : "Notify me when it's near me"}
          </Text>
          <Text style={styles.alertSub}>
            {alert
              ? `You'll see it on Me when a shelf within ${Math.round(FLAVOUR_NEARBY_METRES / 100) / 10} km has it`
              : "Checked in-app, not a push notification — see Me for all your alerts"}
          </Text>
        </View>
      </Tap>

      <Kicker style={styles.kicker}>Closest shelves</Kicker>
      <View style={ui.group}>
        {listings.slice(0, 6).map(({ s, r, metres }, i, arr) => (
          <Tap
            key={`${s.id}-${i}`}
            style={[ui.row, i < arr.length - 1 && rowDivider]}
            onPress={() => router.push({ pathname: "/store/[id]", params: { id: s.id } })}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.rowSub}>
                {prettyDistance(metres)} ·{" "}
                {r.source === "official_feed"
                  ? `official feed · ${relativeTime(r.seenAt, now)}`
                  : `${r.qty ?? "?"} on shelf · ${relativeTime(r.seenAt, now)}`}
              </Text>
            </View>
            <Text style={styles.rowPrice}>{ils(r.price)}</Text>
          </Tap>
        ))}
        {listings.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>
              Nothing in range lists this one right now.
            </Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  back: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stage: { height: 280, alignItems: "center", justifyContent: "center", marginTop: space[2] },
  glow: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(0,255,65,0.09)",
  },
  rarity: { fontSize: 9.5, fontWeight: "500", letterSpacing: 1.7, textTransform: "uppercase", color: muted },
  name: {
    fontSize: 31,
    fontWeight: "800",
    letterSpacing: -1.1,
    textTransform: "uppercase",
    color: color.text,
    marginTop: space[3],
  },
  blurb: { fontSize: 13, lineHeight: 20, color: textAlpha(62), marginTop: space[3] },
  stats: { flexDirection: "row", gap: space[3], marginTop: space[6] },
  stat: { flex: 1 },
  statValue: { fontSize: 17, fontWeight: "700", color: color.text },
  statKey: { fontSize: 9.5, color: muted, marginTop: space[2] },
  barcode: { fontSize: 10.5, color: textAlpha(38), marginTop: space[4] },
  drinkButton: {
    marginTop: space[4],
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
  },
  drinkButtonOn: { backgroundColor: color.accent },
  drinkLabel: { fontSize: 13, fontWeight: "700", color: color.accent },
  drinkLabelOn: { color: color.bg },
  alert: {
    marginTop: space[6],
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  alertOn: { borderColor: color.accent },
  alertText: { flex: 1, minWidth: 0 },
  alertTitle: { fontSize: 12.5, fontWeight: "700", color: color.text },
  alertSub: { fontSize: 10, lineHeight: 14, color: textAlpha(45), marginTop: 2 },
  kicker: { marginTop: space[8], marginBottom: space[4] },
  kickerTight: { marginTop: space[6], marginBottom: space[4] },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 12.5, fontWeight: "600", color: color.text },
  rowSub: { fontSize: 10, color: muted, marginTop: 3 },
  rowPrice: { fontSize: 13.5, fontWeight: "700", color: color.accent },
  emptyRow: { padding: space[6] },
  emptyText: { fontSize: 11.5, lineHeight: 17, color: muted },
});
