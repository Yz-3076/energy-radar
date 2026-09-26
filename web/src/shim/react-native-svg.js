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
