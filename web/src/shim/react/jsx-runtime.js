/** Automatic-runtime JSX that renders to strings. See ./index.js. */
export const Fragment = Symbol("Fragment");

export function renderChildren(children) {
  if (children == null || children === false || children === true) return "";
  if (Array.isArray(children)) return children.map(renderChildren).join("");
  return String(children);
}

export function jsx(type, props) {
  if (type === Fragment) return renderChildren(props.children);
  if (typeof type === "function") return type(props);
  throw new Error(`web shim renders components only, got <${String(type)}>`);
}

export const jsxs = jsx;
export const jsxDEV = jsx;
