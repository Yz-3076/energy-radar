/**
 * The web app: shared state, the router, and the dock.
 *
 * Structure follows the app's tab layout (mobile/app/(tabs)/_layout.tsx) —
 * Map on the left, the search FAB in the middle, one tab on the right.
 *
 * The right tab is where the app puts Me, and where a Stats screen briefly
 * lived here. Both are gone. There is no account on the website, so saved
 * shelves and the drink log have nothing to live in; and the statistics
 * already have two pages of their own at the site root, which this tab now
 * opens rather than reimplementing them a third time in a worse place. This
 * screen is for finding a cold can near you. That is the whole job.
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
  <div id="exit-layer"></div>
  <div class="dock">
    <div class="dock-bar" id="dock-bar"></div>
    <button class="dock-fab tap" id="fab" aria-label="Search flavours and prices">
      ${Icons.MagnifyingGlass({ size: 20, color: color.accent, weight: "fill" })}
    </button>
  </div>`;

/* Drawn the way the app draws its dock: 19 px, filled when selected,
   outline when not. Stats is not a screen — it opens the sheet below. */
const TABS = [
  { id: "map", label: "Map", Icon: Icons.MapTrifold },
  { id: "stats", label: "Stats", Icon: Icons.TrendDown },
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
  for (const btn of dockBar.children) {
    btn.onclick = () => (btn.dataset.tab === "stats" ? toggleExitSheet() : go(btn.dataset.tab));
  }
}

const screens = {
  map: { el: document.getElementById("s-map"), make: createMapScreen, tab: "map" },
  search: { el: document.getElementById("s-search"), make: createSearchScreen },
  store: { el: document.getElementById("s-store"), make: createStoreScreen },
  variant: { el: document.getElementById("s-variant"), make: createVariantScreen },
};

document.getElementById("fab").onclick = () => go("search");

/* ── the way back to the statistics ──────────────────────────────────── */

/**
 * The numbers live on two pages at the site root, not in here. Rather than
 * a bare link labelled "Stats" — which gives a visitor no idea whether it
 * is the heatmap, the deals or the chain comparison they are about to get —
 * the tab names both destinations and says what is on each.
 */
const EXITS = [
  {
    href: "../index.html",
    Icon: Icons.GridFour,
    title: "Price stats",
    desc: "National heatmap, cheapest chain, stock health, flavour reach, price over time and every live deal.",
  },
  {
    href: "../analysis.html",
    Icon: Icons.TrendDown,
    title: "Deep price analysis",
    desc: "How prices are distributed, the range per flavour, chain × flavour, and whether where you are changes what you pay.",
  },
];

const exitLayer = document.getElementById("exit-layer");

function toggleExitSheet() {
  if (exitLayer.firstChild) return closeExitSheet();

  exitLayer.innerHTML = `
    <div class="focus-scrim" id="exit-scrim"></div>
    <div class="exit-sheet" role="dialog" aria-label="More from Energy Radar">
      <div class="exit-head">
        <span class="kicker">The numbers behind the map</span>
        <button class="cancel tap" id="exit-close">Close</button>
      </div>
      ${EXITS.map(
        ({ href, Icon, title, desc }) => `
        <a class="exit-link tap" href="${href}">
          <span class="exit-icon">${Icon({ size: 17, color: color.accent, weight: "fill" })}</span>
          <span style="flex:1;min-width:0">
            <span class="exit-title">${title}</span>
            <span class="exit-desc">${desc}</span>
          </span>
          <span class="exit-arrow">↗</span>
        </a>`,
      ).join("")}
    </div>`;

  exitLayer.querySelector("#exit-scrim").onclick = closeExitSheet;
  exitLayer.querySelector("#exit-close").onclick = closeExitSheet;
  renderDock("stats");
}

function closeExitSheet() {
  exitLayer.innerHTML = "";
  renderDock(screens[currentScreen]?.tab);
}

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

let currentScreen = "map";

function show(name, arg) {
  const target = screens[name] ? name : "map";
  const screen = screens[target];

  if (!screen.instance) screen.instance = screen.make(screen.el, app);

  for (const [key, s] of Object.entries(screens)) s.el.classList.toggle("on", key === target);
  currentScreen = target;
  exitLayer.innerHTML = "";
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
