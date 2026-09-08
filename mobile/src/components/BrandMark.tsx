import React from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { accentAlpha, color, radius } from "@/theme";

/**
 * The Energy Radar mark. Used sparingly — the launcher icon, the top of onboarding,
 * and one badge on the map's brand row. Everywhere else the app identifies
 * itself through the palette rather than by repeating its own logo.
 */
export function BrandMark({
  size = 34,
  glow = false,
  style,
}: {
  size?: number;
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: Math.max(radius.md, size * 0.26),
        },
        glow && styles.glow,
        style,
      ]}
    >
      <Image
        source={require("../../assets/logo.png")}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="Energy Radar"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: accentAlpha(28),
    backgroundColor: color.bg,
  },
  glow: {
    shadowColor: color.accent,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
});
