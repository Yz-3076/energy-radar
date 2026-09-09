import React, { memo } from "react";
import Svg, { Path } from "react-native-svg";

/**
 * A small crown mark — not part of the generated Phosphor set (see
 * scripts/build-icons.mjs), so it's hand-drawn here rather than pulling in
 * phosphor-react-native as a dependency just for one glyph. Matches the
 * same {size, color} shape as the generated icons so it drops in anywhere
 * they do.
 */
function CrownBase({ size = 16, color = "#ffb020" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" fill={color}>
      <Path d="M232 96a20 20 0 1 0-34.6 13.7l-30 43L136 88.9a20 20 0 1 0-16 0l-31.4 63.8-30-43A20 20 0 1 0 24 96a19.9 19.9 0 0 0 8.6 16.4L52 191.5A12 12 0 0 0 63.7 200h128.6a12 12 0 0 0 11.7-8.5l19.4-79.1A19.9 19.9 0 0 0 232 96Z" />
    </Svg>
  );
}

export const Crown = memo(CrownBase);
