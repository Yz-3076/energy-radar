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
  Text,
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

/**
 * Silhouette: short neck, soft shoulder, straight body, rounded foot.
 *
 * Rounder and chunkier than the photographic can it replaced, because a
 * 2 px ink outline needs room to turn a corner — on the old silhouette the
 * shoulder curve and the outline fought each other and read as a dent.
 */
const BODY_PATH =
  "M19,13 C14,15 10,20 10,27 L10,81 C10,88 16,92 27,92 C38,92 44,88 44,81 L44,27 C44,20 40,15 35,13 Z";

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

/**
 * The Energy Radar mark: a sweep, an arc and a blip.
 *
 * Our own logo, in our own product's language — the pulsing dot is already
 * the site's brand element and the ring is already the map's "sold here
 * recently" motif. It sits where a real can puts its brand, which is simply
 * where a brand goes on a cylinder, and it is the one thing that is
 * identical on all eighteen: a set that reads as a set.
 */
function RadarMark({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={r * 0.26} opacity={0.55} />
      <Path
        d={`M${x},${y} L${x + r},${y} A${r},${r} 0 0 0 ${(x + r * 0.35).toFixed(2)},${(y - r * 0.94).toFixed(2)} Z`}
        fill={color}
      />
      <Circle cx={x + r * 0.46} cy={y - r * 0.5} r={r * 0.2} fill={color} />
    </G>
  );
}

type Props = {
  /** Everything the label needs. Passing the variant keeps call sites honest —
   *  a can is always some specific flavour, never a loose colour. */
  variant: Pick<Variant, "name" | "accent" | "secondary" | "body" | "artwork">;
  /** Rendered height in px; width follows the can's aspect ratio. */
  size: number;
  dim?: boolean;
  /** Hero treatment: the glow pooled behind the can and a cast shadow.
   *  Only worth drawing large — at pin size it is invisible detail costing
   *  paint time on every marker. */
  hero?: boolean;
  /**
   * Web only: the blink, the float and the shine, driven by CSS classes the
   * stylesheet animates (see app.css).
   *
   * Never passed on the phone — react-native-svg has no stylesheet to hook
   * into — and never passed for a pin or a list row on the web either. The
   * map draws up to 36 markers at once and each animated can is a layer the
   * compositor has to keep awake; this is for the big cans on screen.
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

/** Below this the face is dropped: two eyes and a mouth inside 30 px is
 *  three grey smudges, which reads as dirt on the can rather than a face. */
const FACE_MIN = 34;
/** And below this the logo goes too — at 3 px it is a speck. */
const LOGO_MIN = 58;
/**
 * The flavour name needs real height before it is worth setting.
 *
 * Type is drawn at 4-8 of the 100 viewBox units, so a 52 px pin renders it
 * at 2-4 px: a grey smear that only looks like text. 110 px puts the
 * smallest names around 8 px, which is the floor for reading them. In
 * practice that means the name appears on the detail card and the flavour
 * page, and pins and rows rely on the label the UI already prints beside
 * them.
 */
const NAME_MIN = 110;

/**
 * Is this accent bright enough that the name has to be set in dark ink?
 *
 * The plate takes the flavour's own colour, and those run from a near-black
 * blue to Aussie Lemonade's #ffe066. White type on that yellow is unreadable
 * and dark type on the blue is worse, so the ink follows the plate rather
 * than being picked once. Rec. 709 luma, which is close enough to perceived
 * brightness for a two-way choice.
 */
function isLight(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
}

/**
 * The flavour name, broken and sized to fit the plate.
 *
 * The plate is 34 units wide and the names run from "Ultra" to "Ultra
 * Peachy Keen", so a single size cannot serve both — the first attempt set
 * everything on one line and half the catalogue ran off the side of the
 * can as "ULTRA PARADIS" and "MANGO LOC".
 *
 * Anything that does not fit on one line is split across two at the word
 * boundary that leaves the two halves closest in length, which keeps the
 * type far bigger than shrinking a single line would. 0.70 em is about the
 * average advance of upper-case bold Archivo, measured rather than guessed:
 * the first estimate of 0.62 left "REHAB LEMONAD" and "ONARCH" running off
 * the sides of the can.
 */
// 27, not the 29 the maths allows: measuring the rendered type showed
// "MONARCH" landing at 32.3 units on a 34-unit can, which is inside the
// plate but hard against the body's curved edge. Wide letters (M, W) run
// well past the average advance, so the budget carries the slack.
const PLATE_W = 27;

function namePlate(name: string) {
  const words = name.toUpperCase().split(/\s+/);
  const fits = (line: string, size: number) => line.length * 0.70 * size <= PLATE_W;

  if (words.length === 1 || fits(words.join(" "), 6.6)) {
    const line = words.join(" ");
    return { lines: [line], size: Math.min(8.4, PLATE_W / (line.length * 0.70)) };
  }

  let at = 1;
  let narrowest = Infinity;
  for (let i = 1; i < words.length; i++) {
    const longer = Math.max(
      words.slice(0, i).join(" ").length,
      words.slice(i).join(" ").length,
    );
    if (longer < narrowest) {
      narrowest = longer;
      at = i;
    }
  }
  const lines = [words.slice(0, at).join(" "), words.slice(at).join(" ")];
  return { lines, size: Math.min(6.2, PLATE_W / (narrowest * 0.70)) };
}

function CanBase({ variant, size, dim = false, hero = false, animated = false }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const w = (size * VB_W) / VB_H;
  const white = variant.body === "white";
  const marks = artworkPaths(variant.artwork);
  const face = size >= FACE_MIN;
  const logo = size >= LOGO_MIN;
  const name = size >= NAME_MIN;
  const plate = { ...namePlate(variant.name), onLight: isLight(variant.accent) };

  /* Sticker palette. The body is charcoal rather than true black: the app's
     own background is #0a0b0a, and a black can outlined in black on it is a
     hole. The ink outline is what gives the whole thing its cartoon read. */
  const shell = white ? "#f4f7f2" : "#23291f";
  const shellLit = white ? "#ffffff" : "#343b2f";
  const outline = white ? "#171c15" : "#080a07";
  const metal = white ? "#c9d1c6" : "#8e978a";

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

  const eye = (cx: number, delay: string) => (
    <G {...(animated ? webOnly<object>({ className: "can-eye", style: { animationDelay: delay } }) : null)}>
      <Ellipse cx={cx} cy={61} rx={5.1} ry={5.7} fill="#ffffff" stroke={outline} strokeWidth={1.5} />
      <Circle cx={cx + 0.9} cy={62} r={2.5} fill={outline} />
      <Circle cx={cx + 2} cy={60.4} r={1} fill="#ffffff" />
    </G>
  );

  return (
    <Svg width={w} height={size} viewBox={`0 0 ${VB_W} ${VB_H}`}>
      <Defs>
        <ClipPath id={`body${id}`}>
          <Path d={BODY_PATH} />
        </ClipPath>

        <RadialGradient id={`glow${id}`} cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={variant.accent} stopOpacity={0.34} />
          <Stop offset="0.6" stopColor={variant.accent} stopOpacity={0.1} />
          <Stop offset="1" stopColor={variant.accent} stopOpacity={0} />
        </RadialGradient>

        {/* The cartoon shine: a hard-edged band, not a soft specular. */}
        <LinearGradient id={`shine${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity={white ? 0.55 : 0.3} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {hero ? (
        <Ellipse
          cx={27}
          cy={52}
          rx={31}
          ry={36}
          fill={`url(#glow${id})`}
          {...(animated ? webOnly<object>({ className: "can-glow" }) : null)}
        />
      ) : null}

      {/* One group for the whole character, so the float moves all of it. */}
      <G
        opacity={dim ? 0.45 : 1}
        {...(animated ? webOnly<object>({ className: "can-float" }) : null)}
      >
        {/* lid + pull tab */}
        <Ellipse cx={27} cy={12} rx={9.6} ry={3.1} fill={metal} stroke={outline} strokeWidth={1.6} />
        <Ellipse cx={27} cy={11.4} rx={5.6} ry={1.5} fill="none" stroke={outline} strokeWidth={1} opacity={0.6} />
        <Ellipse cx={24.6} cy={11.2} rx={2.2} ry={0.8} fill={shellLit} opacity={0.8} />

        <Path d={BODY_PATH} fill={shell} />

        <G clipPath={`url(#body${id})`}>
          {/* The flavour mark, scaled and dropped into the label area — the
              artwork is authored around y=33 for a taller label than this
              silhouette has, so it is placed rather than redrawn. */}
          <G transform="translate(7.56,15.24) scale(0.72)">
            {marks.map((m, i) => {
              const paint = ink(m.tone);
              const stroked = m.w
                ? {
                    fill: "none",
                    stroke: paint,
                    strokeWidth: m.w,
                    strokeLinecap: m.cap ?? "round",
                    strokeLinejoin: "round" as const,
                  }
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
          </G>

          {logo ? <RadarMark x={27} y={21.5} r={4.1} color={variant.accent} /> : null}

          {/* The flavour name, on the can, where every real can puts it.
              This is the part that answers "which one is this" — a drawing
              of a mango matches the flavour but not the thing you picked up
              in the shop, which had the words on it. Nominative use of a
              product name is ordinary; the label around it is ours. */}
          {/* The flavour name, on the can, where every real can puts it.
              This is the part that answers "which one is this" — a drawing
              of a mango matches the flavour but not the thing you picked up
              in the shop, which had the words on it. Nominative use of a
              product name is ordinary; the label around it is ours. */}
          <Path d="M10,73.5 L44,73.5 L44,89.5 L10,89.5 Z" fill={variant.accent} />
          <Path d="M10,73.5 L44,73.5 L44,75.6 L10,75.6 Z" fill="#ffffff" opacity={0.3} />
          {name
            ? plate.lines.map((line, i) => (
                <Text
                  key={i}
                  x={27}
                  y={
                    plate.lines.length === 1
                      ? 81.6
                      : 78.6 + i * (plate.size * 1.15)
                  }
                  fill={plate.onLight ? "#14180f" : "#ffffff"}
                  fontSize={plate.size}
                  fontWeight="800"
                  fontFamily="Archivo, system-ui, sans-serif"
                  textAnchor="middle"
                >
                  {line}
                </Text>
              ))
            : null}

          {/* Cartoon shading: one lit edge, one shadowed, both hard. */}
          <Path d="M13,20 C11.5,26 11.5,62 13,80 C16.5,81 17.5,78 16.5,62 C16,44 16,28 16.5,22 Z" fill={shellLit} opacity={white ? 0.85 : 0.5} />
          <Path d="M39,17 C41,24 41,64 39.5,86 L44,86 L44,20 Z" fill={outline} opacity={0.22} />

          {animated ? (
            <Rect
              x={-16}
              y={0}
              width={11}
              height={VB_H}
              fill={`url(#shine${id})`}
              {...webOnly<RectProps>({ className: "can-shine" })}
            />
          ) : null}
        </G>

        {/* The ink outline last, so nothing inside overlaps it. */}
        <Path d={BODY_PATH} fill="none" stroke={outline} strokeWidth={2} strokeLinejoin="round" />

        {face ? (
          <G>
            {eye(20.4, "0s")}
            {eye(33.6, "0.12s")}
            {/* A closed smile: an open one needs a tongue, and a tongue at
                40 px is a pink smear. */}
            <Path
              d="M21.8,69.4 C24.2,73.2 29.8,73.2 32.2,69.4"
              fill="none"
              stroke={outline}
              strokeWidth={1.9}
              strokeLinecap="round"
            />
            <Circle cx={15.4} cy={67.5} r={2} fill={variant.accent} opacity={0.4} />
            <Circle cx={38.6} cy={67.5} r={2} fill={variant.accent} opacity={0.4} />
          </G>
        ) : null}
      </G>

      {hero ? <Ellipse cx={27} cy={95.5} rx={15} ry={2.6} fill={outline} opacity={0.45} /> : null}
    </Svg>
  );
}

export const Can = memo(CanBase);
