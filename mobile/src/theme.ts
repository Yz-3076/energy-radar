/**
 * Nocturne — the design system the Energy Radar canvas was drawn against.
 * Ported verbatim from design-import/ds/nocturne.css so colour values stay
 * in one place and match the source design exactly.
 *
 * Deliberately a three-colour palette: near-black, one green accent, and
 * white for text — nothing else. `text` is a hair off pure white (a warm
 * #eaf0ea, not #fff) because pure white on near-black background causes
 * visible halation/glow on OLED and just reads as harsh; `white` below is
 * true #fff for the rare spot that wants to pop harder than body text does.
 */

export const color = {
  bg: "#0a0b0a",
  surface: "#141614",
  text: "#eaf0ea",
  white: "#ffffff",
  accent: "#00ff41",

  neutral100: "#f2f5f2",
  neutral200: "#e2e6e2",
  neutral300: "#cbd0cb",
  neutral400: "#adb3ad",
  neutral500: "#8b938b",
  neutral600: "#6b726b",
  neutral700: "#474d47",
  neutral800: "#2d312d",
  neutral900: "#1c1f1c",

  accent100: "#eafff0",
  accent200: "#c9ffd9",
  accent300: "#97ffb8",
  accent400: "#4dfd87",
  accent500: "#00e93a",
  accent600: "#00c934",
  accent700: "#009a28",
  accent800: "#00691b",
  accent900: "#063f14",
} as const;

/** `color-mix(in srgb, var(--color-text) N%, transparent)` — the design's
 *  muted-text idiom. React Native has no color-mix, so it is baked to rgba. */
export const textAlpha = (pct: number) => `rgba(234, 240, 234, ${pct / 100})`;
export const accentAlpha = (pct: number) => `rgba(0, 255, 65, ${pct / 100})`;

export const muted = textAlpha(48);
export const dim = textAlpha(30);

export const space = {
  1: 3,
  2: 6,
  3: 8,
  4: 11,
  6: 17,
  8: 22,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 14,
} as const;

/**
 * The canvas sets everything in Archivo. Bundling a variable font would add
 * ~250 KB per weight for a face the platform nearly matches already, so the
 * type ramp keeps the design's sizes/tracking and leans on the system UI face
 * (SF Pro on iOS, Roboto on Android), which shares Archivo's grotesque
 * skeleton at these sizes.
 */
export const font = {
  /** Display / heading sizes lifted from the canvas. */
  display: { fontSize: 28, fontWeight: "800", letterSpacing: -0.84 },
  title: { fontSize: 24, fontWeight: "800", letterSpacing: -0.72 },
  heading: { fontSize: 17, fontWeight: "700", letterSpacing: -0.25 },
  cardTitle: { fontSize: 13, fontWeight: "600" },
  body: { fontSize: 13, fontWeight: "400" },
  small: { fontSize: 11, fontWeight: "400" },
  micro: { fontSize: 10, fontWeight: "400" },
} as const;

/** Uppercase micro-label — used above every section on the canvas. */
export const kicker = {
  fontSize: 10,
  fontWeight: "600",
  letterSpacing: 1.6,
  textTransform: "uppercase",
  color: textAlpha(45),
} as const;

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  bubble: {
    shadowColor: "#000",
    shadowOpacity: 0.65,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 20 },
    elevation: 18,
  },
  glow: {
    shadowColor: color.accent,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
} as const;
