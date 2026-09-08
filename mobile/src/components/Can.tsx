import React, { memo, useId } from "react";
import Svg, {
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";

import type { Artwork, Body, Variant } from "@/data/catalog";

/**
 * The flat can — pins, list rows, pickers, anywhere a can appears below hero
 * size. Same label vocabulary as the 3-D one in CanGL, so a variant reads the
 * same at 26 px and at 260.
 *
 * Deliberately not a reproduction of the real packaging: a shell (black or the
 * Ultra line's white), an accent band, a second stripe, and one of four
 * abstract marks. Identity comes from colour and shell, the way the source
 * design does it, without copying a registered mark.
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

/** The mark across the middle of the label, in viewBox units. */
function artworkPaths(kind: Artwork): { d: string; opacity: number; secondary?: boolean }[] {
  switch (kind) {
    case "burst":
      // Wedges radiating from behind the band — the Juice line's fruit splash.
      return [
        { d: "M27,52 L10,24 L18,20 Z", opacity: 0.95 },
        { d: "M27,52 L20,17 L29,17 Z", opacity: 0.8, secondary: true },
        { d: "M27,52 L36,19 L43,25 Z", opacity: 0.62 },
        { d: "M27,52 L44,33 L47,41 Z", opacity: 0.4, secondary: true },
      ];
    case "wave":
      // Two swells, the shape the tropical/tea flavours print.
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
    default:
      // Three tapered claw slashes.
      return [
        { d: "M14,20 L20,20 L26,46 L20,46 Z", opacity: 0.95 },
        { d: "M23,19 L28,19 L34,46 L29,46 Z", opacity: 0.75, secondary: true },
        { d: "M31,21 L35,21 L40,46 L36,46 Z", opacity: 0.5 },
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
};

function CanBase({ variant, size, dim = false }: Props) {
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
      </Defs>

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
        </G>

        <Path
          d={BODY_PATH}
          fill="none"
          stroke="#000000"
          strokeOpacity={white ? 0.35 : 0.6}
          strokeWidth={0.8}
        />
      </G>
    </Svg>
  );
}

export const Can = memo(CanBase);
