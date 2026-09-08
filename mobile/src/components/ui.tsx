import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CaretLeft } from "./icons";
import { accentAlpha, color, kicker, muted, radius, space, textAlpha } from "@/theme";

/* ── text ──────────────────────────────────────────────────────────────── */

export const Kicker = ({ children, style, ...rest }: TextProps) => (
  <Text {...rest} style={[kicker as never, style]}>
    {children}
  </Text>
);

export const Display = ({ children, style, ...rest }: TextProps) => (
  <Text {...rest} style={[styles.display, style]}>
    {children}
  </Text>
);

/* ── pressable with a spring + haptic, used for every tappable surface ─── */

type TapProps = PressableProps & {
  style?: StyleProp<ViewStyle>;
  haptic?: "light" | "medium" | "none";
  scaleTo?: number;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Tap({ style, haptic = "light", scaleTo = 0.97, onPress, children, ...rest }: TapProps) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const spring = (toValue: number) =>
    Animated.spring(scale, { toValue, speed: 40, bounciness: 4, useNativeDriver: true }).start();

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={() => spring(scaleTo)}
      onPressOut={() => spring(1)}
      onPress={(e) => {
        if (haptic !== "none") {
          Haptics.impactAsync(
            haptic === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
          ).catch(() => {});
        }
        onPress?.(e);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

/* ── chips ─────────────────────────────────────────────────────────────── */

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Tap
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? color.accent900 : "rgba(20,22,20,0.86)",
          borderColor: active ? color.accent : color.neutral800,
        },
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          { color: active ? color.accent : textAlpha(70) },
        ]}
      >
        {label}
      </Text>
    </Tap>
  );
}

/* ── badges ────────────────────────────────────────────────────────────── */

export function Badge({
  label,
  tone = "accent",
}: {
  label: string;
  tone?: "accent" | "neutral" | "gold";
}) {
  const fg = tone === "accent" ? color.accent : tone === "gold" ? "#f0b429" : muted;
  return (
    <View style={[styles.badge, { borderColor: fg }]}>
      <Text style={[styles.badgeLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

/* ── the one accent-filled card ─────────────────────────────────────────── */

/** The canvas's promo card: a 160° wash from accent-900 into the surface,
 *  not the flat green fill a plain View gives. */
export function AccentCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient
      colors={[color.accent900, color.surface]}
      locations={[0, 0.72]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[styles.accentCard, style]}
    >
      {children}
    </LinearGradient>
  );
}

/* ── screens ───────────────────────────────────────────────────────────── */

/** A scrolling screen with the canvas's 16 px gutter and tab-bar clearance. */
export function Screen({
  children,
  scroll = true,
  topPad = 12,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  topPad?: number;
}) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + topPad,
    paddingBottom: insets.bottom + 108,
    paddingHorizontal: 16,
  };
  if (!scroll) return <View style={[styles.screen, padding]}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={padding}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={styles.backButton} hitSlop={10}>
      <CaretLeft size={15} color={color.text} />
    </Tap>
  );
}

/* ── a pulsing ring, the canvas's "live" motif ─────────────────────────── */

export function PulseRing({ size, color: ringColor }: { size: number; color: string }) {
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 2800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: ringColor,
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
        transform: [
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 2.5] }) },
        ],
      }}
    />
  );
}

/* ── list row divider used inside bordered groups ───────────────────────── */

export const rowDivider = { borderBottomWidth: 1, borderBottomColor: color.neutral900 } as const;

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  display: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.84,
    color: color.text,
    textTransform: "uppercase",
  },
  muted: { fontSize: 11.5, color: muted },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space[8],
    marginBottom: space[4],
  },
  chip: {
    height: 29,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipLabel: { fontSize: 11.5, fontWeight: "500" },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  badgeLabel: {
    fontSize: 8.5,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  /** Bordered group the canvas uses for every list of rows. */
  group: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: color.surface,
    padding: space[4],
  },
  accentCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: accentAlpha(40),
    padding: space[6],
    overflow: "hidden",
  },
  primaryButton: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: color.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryLabel: { fontSize: 14, fontWeight: "700", color: "#04140a" },
  ghostButton: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  ghostLabel: { fontSize: 13, fontWeight: "700", color: color.accent },
});
