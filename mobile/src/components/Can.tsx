import React, { memo, useId } from "react";
import Svg, {
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
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
 * white), an accent band, a second stripe, and one abstract mark drawn
 * per flavour. Identity comes from colour, shell and a shape that hints
 * at what is in the can.
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
 * The mark across the middle of the label, in viewBox units.
 *
 * Each one is meant to say something about the drink — citrus segments,
 * a berry cluster, a barrelling wave — so a row of cans is readable by
 * flavour and not just by colour. Thirteen flavours previously shared
 * four marks, which made most of them the same picture in a different
 * hue.
 *
 * None of these reproduce the real packaging. The set used to include a
 * "claw" of three tapered slashes, which was too close to the actual
 * registered mark to keep once these images were going on a store
 * listing; `bolt` replaces it wherever it was used.
 */
function artworkPaths(kind: Artwork): { d: string; opacity: number; secondary?: boolean }[] {
  switch (kind) {
    case "burst":
      // Wedges radiating from behind the band — a fruit splash.
      return [
        { d: "M27,52 L10,24 L18,20 Z", opacity: 0.95 },
        { d: "M27,52 L20,17 L29,17 Z", opacity: 0.8, secondary: true },
        { d: "M27,52 L36,19 L43,25 Z", opacity: 0.62 },
        { d: "M27,52 L44,33 L47,41 Z", opacity: 0.4, secondary: true },
      ];
    case "wave":
      // Two swells — the tropical and tea flavours.
      return [
        { d: "M6,40 C16,28 24,48 34,36 C40,29 44,32 48,29 L48,44 C42,47 38,42 33,46 C24,53 16,38 6,50 Z", opacity: 0.9 },
        { d: "M6,29 C16,18 25,36 34,25 C40,18 44,21 48,18 L48,25 C44,28 40,25 34,32 C25,42 16,25 6,36 Z", opacity: 0.5, secondary: true },
      ];
    case "split":
      // A hard diagonal — the zero-sugar cans' flat colour block.
      return [
        { d: "M0,18 L54,8 L54,34 L0,44 Z", opacity: 0.92 },
        { d: "M0,46 L54,36 L54,42 L0,52 Z", opacity: 0.55, secondary: true },
      ];
    case "citrus":
      // Half a citrus round, segments fanning from the rind.
      return [
        { d: "M27,50 A21,21 0 0 1 6,29 L48,29 A21,21 0 0 1 27,50 Z", opacity: 0.28, secondary: true },
        { d: "M27,48 L11,31 L18,31 Z", opacity: 0.95 },
        { d: "M27,48 L20,31 L27,31 Z", opacity: 0.8, secondary: true },
        { d: "M27,48 L29,31 L36,31 Z", opacity: 0.95 },
        { d: "M27,48 L38,31 L44,31 Z", opacity: 0.7, secondary: true },
      ];
    case "berry":
      // A cluster of drupelets with a leaf above.
      return [
        { d: "M27,26 C31,22 36,22 37,25 C33,27 30,28 27,30 Z", opacity: 0.7, secondary: true },
        { d: "M20,36 a5.4,5.4 0 1,0 10.8,0 a5.4,5.4 0 1,0 -10.8,0", opacity: 0.95 },
        { d: "M29,33 a4.6,4.6 0 1,0 9.2,0 a4.6,4.6 0 1,0 -9.2,0", opacity: 0.72, secondary: true },
        { d: "M15,33 a4.6,4.6 0 1,0 9.2,0 a4.6,4.6 0 1,0 -9.2,0", opacity: 0.72, secondary: true },
        { d: "M23,43 a4.2,4.2 0 1,0 8.4,0 a4.2,4.2 0 1,0 -8.4,0", opacity: 0.55 },
      ];
    case "peach":
      // Two soft overlapping orbs with a cleft — stone fruit.
      return [
        { d: "M13,34 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0", opacity: 0.9 },
        { d: "M22,34 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0", opacity: 0.6, secondary: true },
        { d: "M27,23 C29,29 29,39 27,45", opacity: 0.45, secondary: true },
      ];
    case "surf":
      // A barrelling wave — the reef-break flavours.
      return [
        { d: "M5,45 C12,25 26,16 44,19 C33,22 25,29 21,38 C29,31 38,29 46,31 C36,33 29,39 25,47 Z", opacity: 0.92 },
        { d: "M8,48 C18,38 30,35 44,37 C33,40 26,44 22,50 Z", opacity: 0.5, secondary: true },
      ];
    case "crown":
      // Five points on a band — for the one actually called Monarch.
      return [
        { d: "M12,44 L14,24 L21,34 L27,21 L33,34 L40,24 L42,44 Z", opacity: 0.95 },
        { d: "M12,45 L42,45 L42,49 L12,49 Z", opacity: 0.7, secondary: true },
      ];
    case "ripple":
      // Concentric arcs — the app's own radar language, for the plain cans.
      return [
        { d: "M27,47 a9,9 0 1,0 0.01,0", opacity: 0.9 },
        { d: "M13,38 A15,15 0 0 1 41,38", opacity: 0.55, secondary: true },
        { d: "M8,32 A21,21 0 0 1 46,32", opacity: 0.32, secondary: true },
      ];
    default:
      // A single bolt — plain, high-voltage, and not three slashes.
      return [
        { d: "M31,17 L17,40 L25,40 L21,52 L37,29 L28,29 Z", opacity: 0.95 },
        { d: "M31,17 L24,29 L28,29 Z", opacity: 0.6, secondary: true },
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
};

function CanBase({ variant, size, dim = false, hero = false }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const w = (size * VB_W) / VB_H;
  const white = variant.body === "white";
  const marks = artworkPaths(variant.artwork);

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
      </Defs>

      {hero ? <Ellipse cx={27} cy={50} rx={30} ry={34} fill={`url(#glow${id})`} /> : null}

      <G opacity={dim ? 0.5 : 1}>
        {/* lid + rim */}
        <Ellipse cx={27} cy={8.6} rx={10.4} ry={2.9} fill={`url(#cap${id})`} />
        <Ellipse cx={27} cy={8.1} rx={7.4} ry={1.7} fill="#3d443d" />
        <Ellipse cx={25} cy={8} rx={2.4} ry={0.7} fill="#aab1aa" opacity={0.7} />

        <Path d={BODY_PATH} fill={`url(#shell${id})`} />

        <G clipPath={`url(#body${id})`}>
          {marks.map((m, i) => (
            <Path
              key={i}
              d={m.d}
              fill={m.secondary ? variant.secondary : variant.accent}
              opacity={m.opacity}
            />
          ))}

          <Rect x={0} y={52} width={VB_W} height={13} fill={`url(#band${id})`} />
          <Rect x={0} y={67} width={VB_W} height={2.6} fill={variant.secondary} opacity={0.75} />

          <Rect x={0} y={64} width={VB_W} height={24} fill={`url(#floor${id})`} />
          <Rect x={0} y={85} width={VB_W} height={8} fill={`url(#base${id})`} opacity={0.9} />

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
