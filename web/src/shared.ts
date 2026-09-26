/**
 * Everything the website takes from the mobile app, compiled from the app's
 * own source files rather than copied. Change a flavour, a colour, the map
 * style or a can drawing in mobile/ and `npm run build` here picks it up.
 *
 * Only modules free of React Native are imported. Screens and layout are
 * rebuilt for the browser in src/*.js; this is the data, the rules and the
 * artwork, which are the parts that have to match exactly.
 */
export { Can } from "@/components/Can";
export { Crown } from "@/components/Crown";
export * as Icons from "@/components/icons";
export { VARIANTS, getVariant, variantById } from "@/data/catalog";
export {
  FRESH_HOURS,
  hoursSince,
  isFresh,
  lastSeen,
  storeIsFresh,
  cheapest,
  originalRow,
  relativeTime,
  distanceM,
  prettyDistance,
  ils,
  chainLabel,
  walkMinutes,
} from "@/data/stores";
export { FILTERS, matchesFilter } from "@/data/filters";
export { STOCK_LABEL, stockStatus } from "@/data/stock";
export { MAP_STYLE, PITCH_3D, PITCH_FLAT, DEFAULT_ZOOM } from "@/map/style";
export { color } from "@/theme";
