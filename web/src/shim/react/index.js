/**
 * Just enough of React for the mobile app's drawing components to run in a
 * browser as plain functions that return SVG markup strings.
 *
 * The website reuses the app's own Can.tsx, Crown.tsx and icons.tsx rather
 * than keeping copies of them, so a flavour's can looks identical on both
 * and cannot drift. Those files only ever use memo and useId, and build
 * their output from react-native-svg primitives (shimmed alongside this),
 * so this is all they need. Anything that reaches for real React state or
 * effects fails loudly here, which is the point: it should not be imported.
 */
let seq = 0;

export const memo = (component) => component;

/** Unique per call. Can.tsx derives its gradient ids from this, and every
 *  can on a page shares one document, so ids must never repeat. */
export const useId = () => `r${(++seq).toString(36)}`;

export { Fragment } from "./jsx-runtime.js";

export default { memo, useId };
