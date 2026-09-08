import { BlurView } from "expo-blur";
import { Redirect, Tabs, useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MagnifyingGlass, MapTrifold, User } from "@/components/icons";
import { Tap } from "@/components/ui";
import { useApp } from "@/state/AppState";
import { accentAlpha, color, radius, textAlpha } from "@/theme";

/**
 * Two tabs plus the dock's raised search action — Map to find it, Me for
 * saved shelves, search history and alerts. The List tab (a store-by-store
 * price list) was folded into /search, which already does the same job
 * flavour-first; Vault and Alerts-as-a-tab (collection/rarity, streak/XP/
 * quests) were cut earlier for the same reason — a retention layer for an
 * app that doesn't have users to retain yet. Nothing about re-adding any of
 * this later is precluded, the screens just aren't in this build.
 */
const ICONS = {
  index: MapTrifold,
  me: User,
} as const;

const LABELS = {
  index: "Map",
  me: "Me",
} as const;

type TabName = keyof typeof ICONS;

/** expo-router owns the tab navigator; take the tabBar prop's shape from it. */
type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.dock, { bottom: Math.max(insets.bottom, 12) + 8 }]} pointerEvents="box-none">
      <BlurView intensity={40} tint="dark" style={styles.bar}>
        {state.routes.map((route, index) => {
          const name = route.name as TabName;
          const Icon = ICONS[name];
          if (!Icon) return null;
          const focused = state.index === index;
          const fg = focused ? color.accent : textAlpha(38);
          return (
            <Tap
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={LABELS[name]}
              scaleTo={0.92}
              style={styles.tab}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
            >
              <Icon size={19} color={fg} weight={focused ? "fill" : "regular"} />
              <Text style={[styles.tabLabel, { color: fg }]}>{LABELS[name]}</Text>
            </Tap>
          );
        })}
      </BlurView>

      {/*
        The dock's raised action. Used to be "log a sighting" (a plus button),
        but that's a contributor action, not what most people open the app to
        do — search is. Logging a sighting still lives on every store's own
        page; this button now goes straight to flavour/price/stock search.
      */}
      <Tap
        accessibilityLabel="Search flavours and prices"
        haptic="medium"
        scaleTo={0.9}
        style={styles.fab}
        onPress={() => router.push("/search")}
      >
        <MagnifyingGlass size={20} color={color.accent} weight="fill" />
      </Tap>
    </View>
  );
}

export default function TabsLayout() {
  const { ready, seenOnboarding } = useApp();
  if (ready && !seenOnboarding) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 12, right: 12 },
  bar: {
    height: 60,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: "rgba(12,14,12,0.84)",
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  tab: { flex: 1, height: 60, alignItems: "center", justifyContent: "center", gap: 4 },
  tabLabel: { fontSize: 8.5, fontWeight: "500", letterSpacing: 0.7, textTransform: "uppercase" },
  fab: {
    position: "absolute",
    left: "50%",
    marginLeft: -26,
    top: -20,
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: color.accent,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  fabGlow: { borderColor: accentAlpha(40) },
});
