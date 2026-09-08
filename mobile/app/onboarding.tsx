import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";

import { Crosshair } from "@/components/icons";
import { useLoopValue } from "@/components/motion";
import { Tap, styles as ui } from "@/components/ui";
import { useApp } from "@/state/AppState";
import { accentAlpha, color, radius, space, textAlpha } from "@/theme";

const RADAR = 224;
const R = RADAR / 2;
/** A 96° sector from the centre — the sweep blade, faded along its trailing
 *  edge. React Native has no conic gradient, so the fade is a linear one
 *  running across the wedge. */
const SWEEP_ANGLE = (96 * Math.PI) / 180;
const SWEEP_PATH = [
  `M ${R} ${R}`,
  `L ${R} 0`,
  `A ${R} ${R} 0 0 1 ${R + R * Math.sin(SWEEP_ANGLE)} ${R - R * Math.cos(SWEEP_ANGLE)}`,
  "Z",
].join(" ");

/** The radar sweep from the canvas: concentric rings plus a rotating blade. */
function Radar() {
  const sweep = useLoopValue(3600);
  const pulse = useLoopValue(3200, Easing.out(Easing.quad));

  const sweepStyle = {
    transform: [
      { rotate: sweep.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
    ],
  };
  const pulseStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1.52] }) }],
  };

  return (
    <View style={styles.radar}>
      <Animated.View style={[styles.ring, styles.ringOuter, pulseStyle]} />
      <View style={[styles.ring, { inset: 34, borderColor: accentAlpha(22) }]} />
      <View style={[styles.ring, { inset: 74, borderColor: accentAlpha(30) }]} />
      <Animated.View style={[styles.sweepWrap, sweepStyle]}>
        <Svg width={RADAR} height={RADAR}>
          <Defs>
            <SvgGradient id="sweep" x1="0" y1="0" x2="1" y2="0.35">
              <Stop offset="0" stopColor={color.accent} stopOpacity={0.34} />
              <Stop offset="1" stopColor={color.accent} stopOpacity={0} />
            </SvgGradient>
          </Defs>
          <Path d={SWEEP_PATH} fill="url(#sweep)" />
        </Svg>
      </Animated.View>
      <Crosshair size={30} color={color.accent} weight="fill" />
    </View>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requestLocation, completeOnboarding } = useApp();

  const enter = async (ask: boolean) => {
    if (ask) await requestLocation();
    completeOnboarding();
    router.replace("/(tabs)");
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.brand}>
        <Text style={styles.wordmark}>Energy Radar</Text>
      </View>

      <View style={styles.leadIn} />
      <Radar />

      <Text style={styles.title}>Turn on the radar</Text>
      <Text style={styles.body}>
        Energy Radar sorts shelves by walking distance and finds what's actually near you. Your location
        never leaves the device — it's only ever used to sort what you see.
      </Text>

      <View style={styles.spacer} />

      <Tap haptic="medium" style={[ui.ghostButton, styles.cta]} onPress={() => enter(true)}>
        <Text style={ui.ghostLabel}>Allow while using app</Text>
      </Tap>
      <Tap haptic="none" style={styles.skip} onPress={() => enter(false)}>
        <Text style={styles.skipLabel}>Not now</Text>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg, alignItems: "center", paddingHorizontal: 26 },
  brand: { alignItems: "center", gap: space[3] },
  wordmark: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 3.4,
    textTransform: "uppercase",
    color: color.text,
  },
  leadIn: { flex: 0.4 },
  radar: { width: RADAR, height: RADAR, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderRadius: 999, borderWidth: 1 },
  ringOuter: { width: RADAR, height: RADAR, borderColor: accentAlpha(20) },
  sweepWrap: { position: "absolute", width: RADAR, height: RADAR },
  title: {
    fontSize: 29,
    fontWeight: "800",
    letterSpacing: -0.87,
    textTransform: "uppercase",
    color: color.text,
    textAlign: "center",
    marginTop: 40,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 21,
    color: textAlpha(60),
    textAlign: "center",
    marginTop: space[4],
    maxWidth: 300,
  },
  spacer: { flex: 1.1 },
  cta: { width: "100%", height: 52, borderRadius: radius.md },
  skip: { marginTop: space[4], paddingVertical: space[2] },
  skipLabel: { fontSize: 12, color: textAlpha(45) },
});
