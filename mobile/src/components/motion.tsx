import React, { useEffect, useRef } from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

/**
 * Motion primitives on React Native's own Animated driver.
 *
 * Every animation the app needs — scale, opacity, rotate, translate — is one
 * the native driver can run off the JS thread, so this covers the design's
 * motion without a second animation runtime. (It also keeps the Android build
 * off react-native-reanimated's C++ toolchain, which does not compile for
 * arm64 on this machine; see mobile/README.md.)
 */

/** A value looping 0 → 1 forever, driven natively. */
export function useLoopValue(duration: number, easing: (v: number) => number = Easing.linear) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, easing]);

  return value;
}

/** A value that runs 0 → 1 once on mount. */
export function useEnterValue(duration = 260, delay = 0) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(value, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [value, duration, delay]);

  return value;
}

type EnterProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
  delay?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
};

/** Fades in on mount. Unmounting is immediate, which reads as snappier than a
 *  fade-out on a surface the user just dismissed. */
export function FadeInView({ children, style, duration = 240, delay = 0, pointerEvents }: EnterProps) {
  const t = useEnterValue(duration, delay);
  return (
    <Animated.View pointerEvents={pointerEvents} style={[style, { opacity: t }]}>
      {children}
    </Animated.View>
  );
}

/** Slides in from the right with a fade — the canvas's card entrance. */
export function SlideInView({
  children,
  style,
  duration = 320,
  delay = 0,
  distance = 26,
  pointerEvents,
}: EnterProps & { distance?: number }) {
  const t = useEnterValue(duration, delay);
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[
        style,
        {
          opacity: t,
          transform: [
            { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
