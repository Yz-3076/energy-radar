/**
 * react-native-svg, as string builders. Each component returns the markup
 * of the matching SVG element; see ./react/index.js for why.
 *
 * react-native-svg takes camelCase props and SVG wants kebab-case
 * attributes for the presentation ones. Only these need translating — the
 * geometry attributes (viewBox, x1, cx, rx, d…) are spelled the same.
 */
import { renderChildren } from "./react/jsx-runtime.js";

const KEBAB = {
  fontSize: "font-size",
  fontWeight: "font-weight",
  fontFamily: "font-family",
  textAnchor: "text-anchor",
  letterSpacing: "letter-spacing",
  // react-native-svg has no concept of a CSS class, but the browser does,
  // and it is how the animated cans hook into the stylesheet. On the phone
  // the prop is simply never passed.
  className: "class",
  stopColor: "stop-color",
  stopOpacity: "stop-opacity",
  strokeOpacity: "stroke-opacity",
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  fillOpacity: "fill-opacity",
  fillRule: "fill-rule",
  clipPath: "clip-path",
};

const attr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function element(tag, extra = "") {
  return (props) => {
    let attrs = extra;
    for (const [key, value] of Object.entries(props)) {
      if (key === "children" || value == null || value === false) continue;
      attrs += ` ${KEBAB[key] ?? key}="${attr(value)}"`;
    }
    return `<${tag}${attrs}>${renderChildren(props.children)}</${tag}>`;
  };
}

const Svg = element("svg", ' xmlns="http://www.w3.org/2000/svg"');
export default Svg;
export { Svg };
export const Path = element("path");
export const G = element("g");
export const Defs = element("defs");
export const ClipPath = element("clipPath");
export const LinearGradient = element("linearGradient");
export const RadialGradient = element("radialGradient");
export const Stop = element("stop");
export const Rect = element("rect");
export const Ellipse = element("ellipse");
export const Circle = element("circle");
/** react-native-svg centres <Text> on its y; SVG puts the baseline there.
 *  dominant-baseline="central" makes the browser agree with the phone, so
 *  the same y lands the flavour name in the same place on both. */
export const Text = element("text", ' dominant-baseline="central"');
