/**
 * The web app: shared state, the router, and the dock.
 *
 * Structure follows the app's tab layout (mobile/app/(tabs)/_layout.tsx) —
 * Map on the left, the search FAB in the middle, one tab on the right. The
 * right tab is Stats rather than the app's Me: there is no account here, so
 * saved shelves, alerts and the drink log have nothing to live in, and a
 * public page can offer analysis a phone cannot. That is the one deliberate
 * difference between the two products.
 *
 * Screens are created once and kept — MapLibre in particular is expensive
 * to tear down and rebuild — and shown by toggling a class, which is why
 * each screen exposes `onShow`.
 */
import { color, distanceM, VARIANTS } from "./shared.ts";
import { Icons } from "./shared.ts";
import { loadAll, locate } from "./data.js";
import { createMapScreen } from "./map.js";
import { createSearchScreen, createStoreScreen, createVariantScreen } from "./screens.js";
import { createStatsScreen } from "./stats.js";

/** The app's fallback until the browser gives us a real fix (AppState.tsx). */
const FALLBACK_COORD = { lat: 32.0765, lng: 34.7742 };

/* The app's palette is the source of truth for colour; app.css reads these. */
const root = document.documentElement;
root.style.setProperty("--bg", color.bg);
root.style.setProperty("--surface", color.surface);
root.style.setProperty("--text", color.text);
root.style.setProperty("--accent", color.accent);

const app = {
  stores: [],
  storeById: new Map(),
  promotions: {},
  stats: null,
  coord: FALLBACK_COORD,
  hasFix: false,
  placeLabel: "",
  /** One clock for the whole render pass, so "2h ago" cannot disagree with
   *  a stock dot computed a millisecond later. Refreshed on every load. */
  now: new Date(),
  go,
  back,
};

/* ── shell ───────────────────────────────────────────────────────────── */

const mount = document.getElementById("root");
mount.innerHTML = `
  <div class="screen" id="s-map"></div>
  <div class="screen" id="s-search"></div>
  <div class="screen" id="s-store"></div>
  <div class="screen" id="s-variant"></div>
  <div class="screen" id="s-stats"></div>
  <div class="dock">
    <div class="dock-bar" id="dock-bar"></div>
    <button class="dock-fab tap" id="fab" aria-label="Search flavours and prices">
      ${Icons.MagnifyingGlass({ size: 20, color: color.accent, weight: "fill" })}
    </button>
  </div>`;

/* Map and Stats, drawn the way the app draws its dock: 19 px, filled when
   selected, outline when not. Stats sits where the app puts Me. */
const TABS = [
  { id: "map", label: "Map", Icon: Icons.MapTrifold },
  { id: "stats", label: "Stats", Icon: Icons.StackSimple },
];

const dockBar = document.getElementById("dock-bar");

function renderDock(active) {
  dockBar.innerHTML = TABS.map(
    ({ id, label, Icon }) => `
      <button class="dock-tab tap${id === active ? " on" : ""}" data-tab="${id}"
              aria-label="${label}"${id === active ? ' aria-current="page"' : ""}>
        ${Icon({ size: 19, color: id === active ? color.accent : "rgba(234,240,234,.38)", weight: id === active ? "fill" : "regular" })}
        <span class="dock-label">${label}</span>
      </button>`,
  ).join("");
  for (const btn of dockBar.children) btn.onclick = () => go(btn.dataset.tab);
}

const screens = {
  map: { el: document.getElementById("s-map"), make: createMapScreen, tab: "map" },
  search: { el: document.getElementById("s-search"), make: createSearchScreen },
  store: { el: document.getElementById("s-store"), make: createStoreScreen },
  variant: { el: document.getElementById("s-variant"), make: createVariantScreen },
  stats: { el: document.getElementById("s-stats"), make: createStatsScreen, tab: "stats" },
};

document.getElementById("fab").onclick = () => go("search");

/* ── routing ─────────────────────────────────────────────────────────── */

/**
 * Routes live in the URL hash so a shelf or a flavour can be linked to, the
 * browser's own Back button works, and a reload lands where you were.
 * Hash rather than a path because GitHub Pages serves static files and has
 * no rewrite rule to fall back on.
 */
function go(name, arg) {
  const hash = arg ? `#/${name}/${encodeURIComponent(arg)}` : `#/${name}`;
  if (location.hash === hash) show(name, arg);
  else location.hash = hash;
}

function back() {
  if (history.length > 1) history.back();
  else go("map");
}

function show(name, arg) {
  const target = screens[name] ? name : "map";
  const screen = screens[target];

  if (!screen.instance) screen.instance = screen.make(screen.el, app);

  for (const [key, s] of Object.entries(screens)) s.el.classList.toggle("on", key === target);
  renderDock(screen.tab);

  screen.instance.onShow?.(arg);
}

function readHash() {
  const [, name, arg] = (location.hash || "#/map").split("/");
  show(name || "map", arg ? decodeURIComponent(arg) : undefined);
}

window.addEventListener("hashchange", readHash);

/* ── data ────────────────────────────────────────────────────────────── */

function refresh() {
  for (const s of Object.values(screens)) {
    if (s.instance) s.instance.update?.();
  }
}

/** The town the visitor is standing in, named by the nearest shelf rather
 *  than by a reverse-geocode request — it is the same answer, and it does
 *  not send the visitor's coordinates to a third party. */
function updatePlaceLabel() {
  if (!app.stores.length) return;
  let nearest = null;
  let best = Infinity;
  for (const s of app.stores) {
    const d = distanceM(app.coord, s);
    if (d < best) {
      best = d;
      nearest = s;
    }
  }
  app.placeLabel = nearest?.city || "Israel";
}

async function boot() {
  readHash();

  const { stores, promotions, stats } = await loadAll();
  app.now = new Date();
  app.stores = stores;
  app.storeById = new Map(stores.map((s) => [s.id, s]));
  app.promotions = promotions;
  app.stats = stats;
  updatePlaceLabel();
  refresh();

  if (!stores.length) {
    screens.map.el.insertAdjacentHTML(
      "beforeend",
      `<div class="notice floating">
        <div class="notice-title">Could not load the shelves.</div>
        <div class="notice-body">The price files may be mid-update — they are rewritten a few times a day. Reload in a minute.</div>
      </div>`,
    );
  }

  locate((coord) => {
    app.coord = coord;
    app.hasFix = true;
    updatePlaceLabel();
    refresh();
  });
}

boot();

/* Named exports are not used by the page; this keeps the catalogue reachable
   from the console for anyone poking at the data, which is a fair thing to
   want from a site whose whole point is the dataset. */
window.EnergyRadar = { app, VARIANTS };
