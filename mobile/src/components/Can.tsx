import React, { memo, useId } from "react";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  type CircleProps,
  type RectProps,
} from "react-native-svg";

import type { Artwork, Body, Variant } from "@/data/catalog";

/**
 * Every can in the app, from a 26 px pin to the 240 px hero — `hero` adds
 * the large-size treatment rather than there being a second renderer.
 *
 * It replaced a 3-D renderer that drew photographic label textures baked
 * out of downloaded can scans. Those reproduced the real trade dress —
 * logo, label, nutrition panel — with unclear provenance on the scans
 * themselves, which is not something to ship in a store listing.
 *
 * So nothing here is a reproduction: a shell (black, or the Ultra line's
 * white), an accent band, a second stripe, and one mark drawn per flavour.
 * Identity comes from colour, shell and a shape that says what is in the
 * can — the mango one is a mango, the grape one is grapes.
 *
 * Every flavour has its own mark, which was the point of the rewrite.
 * Before it, four flavours shared `citrus` and three shared `berry`, so
 * thirteen of eighteen cans were the same picture in a different hue —
 * and a map pin is mostly seen at 52 px, where hue is all you have if the
 * shapes match.
 */

const VB_W = 54;
const VB_H = 100;

/** Silhouette: neck, shoulder, straight body, rolled base. */
const BODY_PATH =
  "M17,9 C13,11 8,15 8,21 L8,85 C8,90 11,93 27,93 C43,93 46,90 46,85 L46,21 C46,15 41,11 37,9 Z";

const SHELL_BLACK: [string, string][] = [
  ["0", "#141814"],
  ["0.45", "#050705"],
  ["1", "#0d100d"],
];
const SHELL_WHITE: [string, string][] = [
  ["0", "#f4f7f4"],
  ["0.45", "#dfe5df"],
  ["1", "#eef2ee"],
];

/**
 * Which of the four label inks a shape is drawn in.
 *
 * `light` and `shade` are what let a mark read as an object rather than a
 * silhouette — pith inside a citrus wheel, seeds on a strawberry, the lit
 * cheek of a peach. Two tones only ever produced flat stencils.
 */
type Tone = "accent" | "secondary" | "light" | "shade";

/** Ink, opacity, and — when `w` is set — drawn as a stroke of that width
 *  instead of a fill. Shared by every shape so a circle can be an outline. */
type Ink = { tone?: Tone; o?: number; w?: number; cap?: "round" | "butt" };

type Mark =
  | (Ink & { t: "p"; d: string })
  | (Ink & { t: "c"; cx: number; cy: number; r: number })
  | (Ink & { t: "e"; cx: number; cy: number; rx: number; ry: number; rot?: number });

/** A ring of evenly spaced dots — citrus pips, kiwi seeds. */
function ring(
  cx: number,
  cy: number,
  radius: number,
  count: number,
  dot: number,
  tone: Tone,
  o = 1,
  offset = 0,
): Mark[] {
  return Array.from({ length: count }, (_, i) => {
    const a = offset + (i / count) * Math.PI * 2;
    return {
      t: "e" as const,
      cx: +(cx + Math.cos(a) * radius).toFixed(2),
      cy: +(cy + Math.sin(a) * radius).toFixed(2),
      rx: dot * 0.62,
      ry: dot,
      rot: +((a * 180) / Math.PI + 90).toFixed(1),
      tone,
      o,
    };
  });
}

/** Wedge segments of a fruit wheel, drawn from the centre outwards. */
function segments(
  cx: number,
  cy: number,
  radius: number,
  count: number,
  tone: Tone,
  o = 1,
  gap = 0.13,
  from = 0,
  sweep = Math.PI * 2,
): Mark[] {
  return Array.from({ length: count }, (_, i) => {
    const step = sweep / count;
    const a0 = from + i * step + gap;
    const a1 = from + (i + 1) * step - gap;
    const x0 = (cx + Math.cos(a0) * radius).toFixed(2);
    const y0 = (cy + Math.sin(a0) * radius).toFixed(2);
    const x1 = (cx + Math.cos(a1) * radius).toFixed(2);
    const y1 = (cy + Math.sin(a1) * radius).toFixed(2);
    return {
      t: "p" as const,
      d: `M${cx},${cy} L${x0},${y0} A${radius},${radius} 0 0 1 ${x1},${y1} Z`,
      tone,
      o,
    };
  });
}

/**
 * The mark across the middle of the label, in viewBox units.
 *
 * None of these reproduce real packaging. The set used to include a "claw"
 * of three tapered slashes, which was too close to the actual registered
 * mark to keep once these images were going on a store listing; `bolt`
 * replaces it wherever it was used.
 */
function artworkPaths(kind: Artwork): Mark[] {
  switch (kind) {
    /* ── the green one ─────────────────────────────────────────────── */
    case "bolt":
      return [
        { t: "p", d: "M35,16 L13,45 L24,45 L19,58 L41,28 L29,28 Z", tone: "accent" },
        { t: "p", d: "M35,16 L25,28 L29,28 Z", tone: "light", o: 0.3 },
        { t: "p", d: "M24,45 L19,59 L27,45 Z", tone: "shade", o: 0.22 },
      ];

    /** Zero-sugar green: the same charge, drawn hollow. */
    case "bolt-outline":
      return [
        { t: "p", d: "M35,16 L13,45 L24,45 L19,58 L41,28 L29,28 Z", tone: "accent", o: 0.16 },
        { t: "p", d: "M35,16 L13,45 L24,45 L19,58 L41,28 L29,28 Z", tone: "accent", w: 2.2 },
        { t: "c", cx: 27, cy: 33, r: 19, tone: "accent", o: 0.22, w: 0.9 },
      ];

    /* ── Ultra: the app's own radar language on the plain white can ── */
    case "ripple":
      return [
        { t: "c", cx: 27, cy: 47, r: 4.6, tone: "accent" },
        { t: "p", d: "M15,41 A13,13 0 0 1 39,41", tone: "accent", o: 0.78, w: 2.4, cap: "round" },
        { t: "p", d: "M10,34 A19,19 0 0 1 44,34", tone: "secondary", o: 0.5, w: 2, cap: "round" },
        { t: "p", d: "M6,26 A25,25 0 0 1 48,26", tone: "secondary", o: 0.26, w: 1.6, cap: "round" },
      ];

    /* ── fruit ─────────────────────────────────────────────────────── */
    /** Kiwi: pale core, seed ring, radiating flesh — Ultra Paradise. */
    case "kiwi":
      return [
        { t: "c", cx: 27, cy: 33, r: 15.5, tone: "secondary", o: 0.55 },
        { t: "c", cx: 27, cy: 33, r: 13.6, tone: "accent" },
        ...segments(27, 33, 13, 16, "light", 0.14, 0.055),
        ...ring(27, 33, 8.4, 11, 1.15, "shade", 0.6),
        { t: "c", cx: 27, cy: 33, r: 4.2, tone: "light", o: 0.85 },
      ];

    /** Lemon wheel, whole — Aussie Lemonade. */
    case "lemon":
      return [
        { t: "c", cx: 27, cy: 33, r: 15.5, tone: "secondary", o: 0.6 },
        { t: "c", cx: 27, cy: 33, r: 13.4, tone: "light", o: 0.28 },
        ...segments(27, 33, 12.4, 8, "accent", 0.95, 0.15),
        { t: "c", cx: 27, cy: 33, r: 2.6, tone: "light", o: 0.55 },
        { t: "p", d: "M17,22 A14,14 0 0 1 30,19", tone: "light", o: 0.4, w: 1.6, cap: "round" },
      ];

    /** Orange half, cut face on, with juice thrown off it — Juice Khaotic. */
    case "orange":
      return [
        { t: "c", cx: 26, cy: 34, r: 14.4, tone: "secondary", o: 0.6 },
        { t: "c", cx: 26, cy: 34, r: 12.4, tone: "light", o: 0.22 },
        ...segments(26, 34, 11.6, 7, "accent", 0.95, 0.16),
        { t: "c", cx: 26, cy: 34, r: 2.3, tone: "light", o: 0.5 },
        { t: "e", cx: 42, cy: 20, rx: 2.1, ry: 2.6, rot: -28, tone: "accent", o: 0.75 },
        { t: "e", cx: 45, cy: 27, rx: 1.4, ry: 1.8, rot: -18, tone: "accent", o: 0.5 },
        { t: "e", cx: 39, cy: 14, rx: 1.1, ry: 1.4, rot: -34, tone: "accent", o: 0.35 },
      ];

    /** A mango, still on its stem — Mango Loco. */
    case "mango":
      return [
        { t: "p", d: "M30,25 C38,26 41,34 40,41 C38,49 31,52 25,51 C17,50 13,43 15,35 C17,27 23,24 30,25 Z", tone: "accent" },
        { t: "p", d: "M30,25 C35,26 38,29 40,34 C36,29 30,28 24,30 C26,26 28,25 30,25 Z", tone: "light", o: 0.32 },
        { t: "p", d: "M25,51 C18,50 14,44 15,37 C17,45 21,49 27,50 Z", tone: "shade", o: 0.3 },
        { t: "p", d: "M30,24 C32,20 36,18 40,19 C39,23 35,25 31,25 Z", tone: "secondary" },
        { t: "p", d: "M29,25 C31,22 34,20 37,20", tone: "shade", o: 0.34, w: 0.8, cap: "round" },
      ];

    /** The same fruit lit from behind — Ultra Fiesta is the sunny one, so
     *  it gets the rays and the mango sits in front of them. */
    case "sunray":
      return [
        ...segments(27, 38, 20, 11, "secondary", 0.34, 0.05, Math.PI * 1.08, Math.PI * 0.84),
        { t: "c", cx: 27, cy: 38, r: 19, tone: "accent", o: 0.1 },
        { t: "p", d: "M28,24 C36,25 40,32 39,39 C37,47 31,51 25,50 C18,49 14,42 15,35 C17,27 21,23 28,24 Z", tone: "accent" },
        { t: "p", d: "M28,24 C33,25 36,28 38,33 C34,28 28,27 23,29 C25,25 26,24 28,24 Z", tone: "light", o: 0.36 },
        { t: "p", d: "M29,23 C31,19 35,17 39,18 C38,22 34,24 30,24 Z", tone: "secondary", o: 0.95 },
      ];

    /** Peach: two lobes and a cleft — Ultra Peachy Keen. */
    case "peach":
      return [
        { t: "c", cx: 22, cy: 35, r: 11.2, tone: "accent" },
        { t: "c", cx: 32, cy: 35, r: 11.2, tone: "secondary", o: 0.82 },
        { t: "p", d: "M27,24 C29.5,30 29.5,41 27,47", tone: "shade", o: 0.3, w: 1.1, cap: "round" },
        { t: "e", cx: 19, cy: 30, rx: 4.2, ry: 2.8, rot: -32, tone: "light", o: 0.38 },
        { t: "p", d: "M28,24 C30,19 35,16 40,17 C39,22 34,25 29,25 Z", tone: "secondary" },
      ];

    /** Grape cluster with a leaf — Ultra Violet. */
    case "grape":
      return [
        { t: "p", d: "M27,18 C30,15 34,13 38,14 C37,18 33,21 28,20 Z", tone: "secondary", o: 0.9 },
        { t: "p", d: "M27,19 L27,24", tone: "shade", o: 0.4, w: 1, cap: "round" },
        { t: "c", cx: 20, cy: 27, r: 4.6, tone: "accent" },
        { t: "c", cx: 29, cy: 26, r: 4.6, tone: "secondary", o: 0.9 },
        { t: "c", cx: 24.5, cy: 34, r: 4.9, tone: "accent" },
        { t: "c", cx: 33.5, cy: 33, r: 4.6, tone: "accent", o: 0.85 },
        { t: "c", cx: 16, cy: 35, r: 4.3, tone: "secondary", o: 0.85 },
        { t: "c", cx: 20.5, cy: 42, r: 4.4, tone: "secondary", o: 0.95 },
        { t: "c", cx: 29.5, cy: 42, r: 4.1, tone: "accent", o: 0.8 },
        { t: "c", cx: 25, cy: 49, r: 3.6, tone: "secondary", o: 0.7 },
        { t: "c", cx: 18.6, cy: 25.6, r: 1.5, tone: "light", o: 0.45 },
        { t: "c", cx: 23.2, cy: 32.4, r: 1.5, tone: "light", o: 0.4 },
      ];

    /** Strawberry: heart-shaped berry, calyx, pips — Strawberry. */
    case "strawberry":
      return [
        { t: "p", d: "M27,52 C18,46 13,38 14,30 C15,24 20,21 27,25 C34,21 39,24 40,30 C41,38 36,46 27,52 Z", tone: "accent" },
        { t: "p", d: "M27,25 C22,22 18,23 16,26 C19,24 23,24 27,27 Z", tone: "light", o: 0.3 },
        ...ring(27, 36, 8.6, 9, 1.05, "light", 0.55),
        { t: "e", cx: 27, cy: 44, rx: 1, ry: 1.5, tone: "light", o: 0.5 },
        { t: "p", d: "M27,26 L20,19 L26,20 L27,13 L28,20 L34,19 Z", tone: "secondary" },
      ];

    /** Pineapple: crosshatched body under a crown — Ultra Gold. */
    case "pineapple":
      return [
        { t: "p", d: "M27,25 L20,15 L26,18 L27,11 L28,18 L34,15 Z", tone: "secondary" },
        { t: "p", d: "M27,24 C34,24 38,30 38,38 C38,46 33,51 27,51 C21,51 16,46 16,38 C16,30 20,24 27,24 Z", tone: "accent" },
        { t: "p", d: "M18,30 L36,44 M18,38 L33,50 M21,26 L37,37 M36,30 L18,44 M36,38 L22,50 M33,26 L17,37", tone: "shade", o: 0.32, w: 0.85 },
        { t: "p", d: "M27,24 C31,24 35,27 37,31 C33,27 28,26 23,27 Z", tone: "light", o: 0.3 },
      ];

    /* ── not fruit ─────────────────────────────────────────────────── */
    /** A barrelling wave — Pipeline Punch is named for a reef break. */
    case "surf":
      return [
        { t: "p", d: "M6,47 C13,24 28,14 46,18 C34,22 25,29 21,39 C30,31 39,29 47,32 C36,35 28,41 24,50 Z", tone: "accent" },
        { t: "p", d: "M9,50 C19,39 31,36 45,38 C34,41 27,45 23,52 Z", tone: "secondary", o: 0.62 },
        { t: "p", d: "M12,44 C18,31 28,24 39,22", tone: "light", o: 0.3, w: 1.2, cap: "round" },
      ];

    /** The nitrogen surge: bubbles driven down, not up — Nitro Super Dry. */
    case "nitro":
      return [
        { t: "c", cx: 27, cy: 33, r: 17, tone: "secondary", o: 0.16 },
        { t: "c", cx: 20, cy: 19, r: 2.3, tone: "light", o: 0.5 },
        { t: "c", cx: 30, cy: 22, r: 3.1, tone: "accent", o: 0.9 },
        { t: "c", cx: 22, cy: 28, r: 3.9, tone: "accent" },
        { t: "c", cx: 33, cy: 31, r: 2.7, tone: "light", o: 0.42 },
        { t: "c", cx: 26, cy: 37, r: 4.6, tone: "accent", o: 0.92 },
        { t: "c", cx: 18, cy: 39, r: 2.4, tone: "secondary", o: 0.75 },
        { t: "c", cx: 34, cy: 42, r: 3.3, tone: "accent", o: 0.8 },
        { t: "c", cx: 24, cy: 47, r: 2.9, tone: "secondary", o: 0.8 },
        { t: "c", cx: 30, cy: 51, r: 2.1, tone: "light", o: 0.32 },
      ];

    /** Half a lemon over tea leaves — Rehab Lemonade is iced tea.
     *  The first version drew the leaf as one big sweeping shape with the
     *  wedge on top, and at can size it read as a scallop shell. Fruit
     *  above, foliage below, both whole, is legible at 52 px. */
    case "lemon-tea":
      return [
        { t: "p", d: "M11,34 A16,16 0 0 1 43,34 Z", tone: "secondary", o: 0.6 },
        { t: "p", d: "M13,34 A14,14 0 0 1 41,34 Z", tone: "light", o: 0.26 },
        ...segments(27, 34, 13, 5, "accent", 0.95, 0.12, Math.PI, Math.PI),
        { t: "c", cx: 27, cy: 34, r: 2.2, tone: "light", o: 0.5 },
        { t: "p", d: "M11,34 L43,34", tone: "secondary", o: 0.55, w: 1.1, cap: "butt" },
        // Drawn in the accent, not the secondary: this can's secondary is a
        // muted khaki that vanished into the black shell, and a leaf you
        // cannot see is just an odd shadow under the fruit.
        { t: "p", d: "M27,37 C22,38 17,42 15,48 C21,49 26,45 27,37 Z", tone: "accent", o: 0.62 },
        { t: "p", d: "M27,37 C32,38 37,42 39,48 C33,49 28,45 27,37 Z", tone: "accent", o: 0.44 },
        { t: "p", d: "M26,39 C22,41 18,44 16,47", tone: "shade", o: 0.34, w: 0.75, cap: "round" },
        { t: "p", d: "M28,39 C32,41 36,44 38,47", tone: "shade", o: 0.28, w: 0.75, cap: "round" },
      ];

    /** Five points on a band — for the one actually called Monarch. */
    case "crown":
      return [
        { t: "p", d: "M11,45 L13,20 L21,33 L27,16 L33,33 L41,20 L43,45 Z", tone: "accent" },
        { t: "p", d: "M11,46 L43,46 L43,51 L11,51 Z", tone: "secondary" },
        { t: "c", cx: 13, cy: 19, r: 2, tone: "secondary" },
        { t: "c", cx: 27, cy: 15, r: 2.3, tone: "secondary" },
        { t: "c", cx: 41, cy: 19, r: 2, tone: "secondary" },
        { t: "c", cx: 27, cy: 39, r: 2.6, tone: "light", o: 0.45 },
        { t: "p", d: "M11,45 L13,20 L18,28 Z", tone: "light", o: 0.22 },
      ];

    /** Chevrons pulling away from their own slipstream — Rossi is the
     *  racing one. Drawn as arrows rather than the tilted bars it had
     *  first, which read as three coloured blocks and said nothing. */
    case "speed":
      return [
        { t: "p", d: "M7,22 L28,22", tone: "secondary", o: 0.4, w: 2.2, cap: "round" },
        { t: "p", d: "M5,31 L24,31", tone: "secondary", o: 0.3, w: 2.8, cap: "round" },
        { t: "p", d: "M8,40 L27,40", tone: "secondary", o: 0.24, w: 2.2, cap: "round" },
        { t: "p", d: "M9,47 L22,47", tone: "secondary", o: 0.16, w: 1.6, cap: "round" },
        { t: "p", d: "M21,17 L34,32 L21,47 L14,47 L27,32 L14,17 Z", tone: "accent", o: 0.5 },
        { t: "p", d: "M32,17 L45,32 L32,47 L25,47 L38,32 L25,17 Z", tone: "accent" },
        { t: "p", d: "M32,17 L45,32 L41,32 L28,17 Z", tone: "light", o: 0.3 },
      ];

    /** A hard diagonal — the zero-sugar can's flat colour block. */
    case "split":
    default:
      return [
        { t: "p", d: "M0,17 L54,6 L54,33 L0,44 Z", tone: "accent" },
        { t: "p", d: "M0,17 L54,6 L54,11 L0,22 Z", tone: "light", o: 0.22 },
        { t: "p", d: "M0,46 L54,35 L54,42 L0,53 Z", tone: "secondary", o: 0.7 },
      ];
  }
}

type Props = {
  /** Everything the label needs. Passing the variant keeps call sites honest —
   *  a can is always some specific flavour, never a loose colour. */
  variant: Pick<Variant, "accent" | "secondary" | "body" | "artwork">;
  /** Rendered height in px; width follows the can's aspect ratio. */
  size: number;
  dim?: boolean;
  /** Hero treatment: adds the glow behind the can, a sharper specular down
   *  the left edge and a floor reflection. Only worth drawing large — at
   *  pin size it is invisible detail costing paint time on every marker. */
  hero?: boolean;
  /**
   * Web only: carbonation, a travelling specular, and a breathing glow,
   * driven by CSS classes the stylesheet animates (see app.css).
   *
   * Never passed on the phone — react-native-svg has no stylesheet to hook
   * into — and never passed for a pin or a list row on the web either. The
   * map draws up to 36 markers at once and each animated can is a layer the
   * compositor has to keep awake; this is for the one big can on screen.
   */
  animated?: boolean;
};

/**
 * Props react-native-svg has no types for because they only mean anything
 * in a browser. The web build renders these same components through a
 * string shim (web/src/shim), where `className` becomes a real class and
 * `style` a real style attribute; on the phone `animated` is never true,
 * so nothing here is ever emitted. The cast is the honest way to say that
 * — these are web attributes riding through a React Native component.
 */
const webOnly = <T,>(props: { className: string; style?: Record<string, string> }) =>
  props as unknown as T;

const BUBBLES = [
  { cx: 17, r: 1.5, dur: 7.5, delay: 0 },
  { cx: 24, r: 2.1, dur: 9.5, delay: 1.7 },
  { cx: 31, r: 1.3, dur: 6.8, delay: 3.1 },
  { cx: 38, r: 1.8, dur: 10.5, delay: 0.9 },
  { cx: 21, r: 1.1, dur: 8.2, delay: 4.6 },
  { cx: 35, r: 1.6, dur: 11.5, delay: 2.4 },
  { cx: 28, r: 1.2, dur: 8.8, delay: 6.0 },
];

function CanBase({ variant, size, dim = false, hero = false, animated = false }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const w = (size * VB_W) / VB_H;
  const white = variant.body === "white";
  const marks = artworkPaths(variant.artwork);

  /** Label inks. `light` and `shade` sit on top of whichever shell is under
   *  them, so they flip with it — a white highlight on a white can is not a
   *  highlight. */
  const ink = (tone: Tone = "accent") =>
    tone === "accent"
      ? variant.accent
      : tone === "secondary"
        ? variant.secondary
        : tone === "light"
          ? white ? "#ffffff" : "#ffffff"
          : white ? "#2a302a" : "#000000";

  return (
    <Svg width={w} height={size} viewBox={`0 0 ${VB_W} ${VB_H}`}>
      <Defs>
        <ClipPath id={`body${id}`}>
          <Path d={BODY_PATH} />
        </ClipPath>

        {/* Shell tone: the ink-black can, or the Ultra line's white one. */}
        <LinearGradient id={`shell${id}`} x1="0" y1="0" x2="0" y2="1">
          {(white ? SHELL_WHITE : SHELL_BLACK).map((stop) => (
            <Stop key={stop[0]} offset={stop[0]} stopColor={stop[1]} />
          ))}
        </LinearGradient>

        {/* Curvature: a hot specular near the left, falling to shadow right. */}
        <LinearGradient id={`cyl${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#000000" stopOpacity={white ? 0.3 : 0.55} />
          <Stop offset="0.17" stopColor="#ffffff" stopOpacity={white ? 0.55 : 0.2} />
          <Stop offset="0.42" stopColor="#ffffff" stopOpacity={0.03} />
          <Stop offset="0.78" stopColor="#000000" stopOpacity={white ? 0.22 : 0.42} />
          <Stop offset="1" stopColor="#000000" stopOpacity={white ? 0.42 : 0.68} />
        </LinearGradient>

        <LinearGradient id={`cap${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#eef2ee" />
          <Stop offset="0.38" stopColor="#9aa39a" />
          <Stop offset="1" stopColor="#565d56" />
        </LinearGradient>

        <LinearGradient id={`band${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={variant.accent} stopOpacity={0.7} />
          <Stop offset="0.28" stopColor={variant.accent} stopOpacity={1} />
          <Stop offset="1" stopColor={variant.secondary} stopOpacity={0.8} />
        </LinearGradient>

        {/* Light bouncing off the base, so the lower third reads as metal
            rather than as a hole in the map. */}
        <LinearGradient id={`floor${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={variant.accent} stopOpacity={0} />
          <Stop offset="1" stopColor={variant.accent} stopOpacity={white ? 0.14 : 0.24} />
        </LinearGradient>

        <LinearGradient id={`base${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#d3dad3" />
          <Stop offset="0.45" stopColor="#828a82" />
          <Stop offset="1" stopColor="#3f453f" />
        </LinearGradient>

        {/* Hero-only: a soft pool of the flavour's own colour behind the
            can, so the silhouette separates from a dark screen. */}
        <RadialGradient id={`glow${id}`} cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={variant.accent} stopOpacity={0.3} />
          <Stop offset="0.6" stopColor={variant.accent} stopOpacity={0.09} />
          <Stop offset="1" stopColor={variant.accent} stopOpacity={0} />
        </RadialGradient>

        {/* Hero-only: the reflection under the can fades out downwards. */}
        <LinearGradient id={`refl${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={variant.accent} stopOpacity={0.22} />
          <Stop offset="1" stopColor={variant.accent} stopOpacity={0} />
        </LinearGradient>

        {/* Animated only: the band of light that travels across the can. */}
        <LinearGradient id={`sweep${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity={white ? 0.5 : 0.34} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {hero ? (
        <Ellipse
          cx={27}
          cy={50}
          rx={30}
          ry={34}
          fill={`url(#glow${id})`}
          {...(animated ? webOnly<CircleProps>({ className: "can-glow" }) : null)}
        />
      ) : null}

      <G opacity={dim ? 0.5 : 1}>
        {/* lid + rim */}
        <Ellipse cx={27} cy={8.6} rx={10.4} ry={2.9} fill={`url(#cap${id})`} />
        <Ellipse cx={27} cy={8.1} rx={7.4} ry={1.7} fill="#3d443d" />
        <Ellipse cx={25} cy={8} rx={2.4} ry={0.7} fill="#aab1aa" opacity={0.7} />

        <Path d={BODY_PATH} fill={`url(#shell${id})`} />

        <G clipPath={`url(#body${id})`}>
          {marks.map((m, i) => {
            const paint = ink(m.tone);
            const stroked = m.w
              ? { fill: "none", stroke: paint, strokeWidth: m.w, strokeLinecap: m.cap ?? "round", strokeLinejoin: "round" as const }
              : { fill: paint };
            if (m.t === "c") {
              return <Circle key={i} cx={m.cx} cy={m.cy} r={m.r} opacity={m.o ?? 1} {...stroked} />;
            }
            if (m.t === "e") {
              return (
                <Ellipse
                  key={i}
                  cx={m.cx}
                  cy={m.cy}
                  rx={m.rx}
                  ry={m.ry}
                  opacity={m.o ?? 1}
                  {...(m.rot ? { transform: `rotate(${m.rot} ${m.cx} ${m.cy})` } : null)}
                  {...stroked}
                />
              );
            }
            return <Path key={i} d={m.d} opacity={m.o ?? 1} {...stroked} />;
          })}

          <Rect x={0} y={52} width={VB_W} height={13} fill={`url(#band${id})`} />
          <Rect x={0} y={67} width={VB_W} height={2.6} fill={variant.secondary} opacity={0.75} />

          <Rect x={0} y={64} width={VB_W} height={24} fill={`url(#floor${id})`} />
          <Rect x={0} y={85} width={VB_W} height={8} fill={`url(#base${id})`} opacity={0.9} />

          {/* Carbonation. Below the cylinder shading because it is inside
              the can: the same curve that darkens the right edge has to
              darken the bubbles drifting up it. */}
          {animated ? (
            <>
              {BUBBLES.map((b, i) => (
                <Circle
                  key={i}
                  cx={b.cx}
                  cy={78}
                  r={b.r}
                  fill="#ffffff"
                  opacity={0}
                  {...webOnly<CircleProps>({
                    className: "can-bub",
                    style: { animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` },
                  })}
                />
              ))}
            </>
          ) : null}

          <Rect x={0} y={0} width={VB_W} height={VB_H} fill={`url(#cyl${id})`} />

          {/* Hero-only: a tight specular running down the aluminium, and a
              cooler one on the far edge. Enough to read as a cylinder
              without needing a photographic texture. */}
          {hero ? (
            <>
              <Rect x={11.5} y={10} width={2.2} height={80} fill="#ffffff" opacity={white ? 0.5 : 0.22} rx={1.1} />
              <Rect x={40} y={12} width={1.4} height={76} fill="#ffffff" opacity={white ? 0.26 : 0.1} rx={0.7} />
            </>
          ) : null}

          {/* A light travelling across the metal. This one belongs on top:
              it is a reflection off the outside of the can. */}
          {animated ? (
            <Rect x={-16} y={0} width={13} height={VB_H} fill={`url(#sweep${id})`} {...webOnly<RectProps>({ className: "can-sweep" })} />
          ) : null}
        </G>

        <Path
          d={BODY_PATH}
          fill="none"
          stroke="#000000"
          strokeOpacity={white ? 0.35 : 0.6}
          strokeWidth={0.8}
        />

        {hero ? (
          <Ellipse cx={27} cy={95} rx={17} ry={3.4} fill={`url(#refl${id})`} />
        ) : null}
      </G>
    </Svg>
  );
}

export const Can = memo(CanBase);
