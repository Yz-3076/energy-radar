// Browsers stop firing rAF entirely in a backgrounded/occluded tab, which
// stalls MapLibre's own render loop as well as ours. Fall back to a timer
// ONLY while hidden so real (visible) usage keeps native, battery-friendly rAF.
(function patchRafWhileHidden() {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    document.visibilityState === "hidden"
      ? setTimeout(() => cb(performance.now()), 16)
      : nativeRAF(cb);
})();

import "./style.css";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as THREE from "three";
import Supercluster from "supercluster";
import { buildMockStores, isRecent } from "./data.js";
import { createCanMesh, animateOutlinePulse, createHeroCan } from "./canModel.js";

/* ------------------------------------------------------------------------
 * PERFORMANCE STRATEGY ("we can't load every location at once")
 *
 * 1. A Supercluster index answers "what's inside this viewport at this zoom"
 *    on every moveend/zoomend (debounced) — zoomed out gives a few cluster
 *    badges, zoomed in gives individual stores. fetchStoresInBounds() is
 *    written as an async bbox query so it can become a real
 *    `GET /stores?bbox=…` without touching any rendering code.
 * 2. Every 3D can shares ONE WebGL context (a single canvas over the map).
 *    Browsers cap live contexts near ~16, so a context-per-pin approach
 *    breaks long before realistic pin counts.
 * 3. Cluster badges and click hit-targets are diffed by id and reused
 *    across recomputes rather than rebuilt every frame.
 * ------------------------------------------------------------------------ */

const NOW = () => new Date("2026-09-06T09:00:00");
const ILS = (n) => `₪${n.toFixed(2)}`;

const ALL_STORES = buildMockStores();
const storeById = new Map(ALL_STORES.map((s) => [s.id, s]));
const allStores = () => [...storeById.values()];

let index = buildIndex();
function buildIndex() {
  return new Supercluster({ radius: 60, maxZoom: 17 }).load(
    allStores().map((s) => ({
      type: "Feature",
      properties: { storeId: s.id },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    }))
  );
}

async function fetchStoresInBounds(bounds) {
  await new Promise((r) => setTimeout(r, 120)); // stand-in for network latency
  return allStores().filter(
    (s) =>
      s.lng >= bounds.getWest() && s.lng <= bounds.getEast() &&
      s.lat >= bounds.getSouth() && s.lat <= bounds.getNorth()
  );
}

// Owner-paid listings from monster-tracker/server. Best-effort: the map is
// fully usable with the backend down, it just shows no featured pins.
const OWNER_API = "http://localhost:8790";
async function loadFeaturedListings() {
  try {
    const res = await fetch(`${OWNER_API}/api/listings`);
    if (!res.ok) return;
    let added = false;
    for (const l of await res.json()) {
      if (!l.featured || storeById.has(`listing-${l.id}`)) continue;
      storeById.set(`listing-${l.id}`, {
        id: `listing-${l.id}`,
        chain: "Featured listing",
        name: l.storeName,
        address: l.address,
        // owner submissions aren't geocoded yet (see docs/owner-monetization.md)
        lat: 32.08 + (Math.random() - 0.5) * 0.05,
        lng: 34.78 + (Math.random() - 0.5) * 0.05,
        variants: l.flavors.map((f, i) => ({ code: `owner-${i}`, name: f.name, price: f.price })),
        lastSale: new Date().toISOString(),
        featured: true,
      });
      added = true;
    }
    if (added) { index = buildIndex(); recompute(); renderDeck(); }
  } catch { /* backend not running — fine */ }
}

/* ---------------------------- Map setup --------------------------------- */

// Stadia's real vector basemap. Unauthenticated access works for localhost /
// 127.0.0.1 dev traffic per their documented policy; deploying anywhere else
// needs a free Stadia API key appended as ?api_key=… (a signup only you can do).
const STADIA_STYLE_URL = "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json";
const PITCH_3D = 62;

const map = new maplibregl.Map({
  container: "map",
  style: STADIA_STYLE_URL,
  center: [34.7806, 32.0809],
  zoom: 13.6,
  pitch: PITCH_3D,
  bearing: -18,
  attributionControl: { compact: true },
});
// no NavigationControl — the design has its own 3D / locate / layers stack,
// and the default +/- widget collides with the card deck

// Recolor the real vector style toward black/green through each layer's own
// paint properties — not a blunt CSS filter over the whole map.
function tintMapGreen() {
  for (const layer of map.getStyle().layers) {
    try {
      if (layer.id === "background") {
        map.setPaintProperty(layer.id, "background-color", "#0a0b0a");
      } else if (layer.id === "water") {
        map.setPaintProperty(layer.id, "fill-color", "#04140a");
      } else if (layer.id === "building") {
        map.setPaintProperty(layer.id, "fill-color", "#121b14");
      } else if (layer.type === "fill") {
        map.setPaintProperty(layer.id, "fill-color", "rgba(0,255,65,0.045)");
      } else if (layer.type === "line") {
        const major = /motorway|major/.test(layer.id);
        map.setPaintProperty(layer.id, "line-color", major ? "#1c7a3a" : "#12331d");
      } else if (layer.type === "symbol") {
        map.setPaintProperty(layer.id, "text-color", "#8fd9a8");
        map.setPaintProperty(layer.id, "text-halo-color", "#04140a");
        map.setPaintProperty(layer.id, "text-halo-width", 1.2);
      }
    } catch { /* layer doesn't support that property — skip */ }
  }
}

// The "3D map" from the design, done for real: extruded buildings out of the
// vector tiles' building heights rather than drawn rectangles.
function add3DBuildings() {
  if (map.getLayer("3d-buildings")) return;
  try {
    map.addLayer({
      id: "3d-buildings",
      source: "openmaptiles",
      "source-layer": "building",
      type: "fill-extrusion",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8],
          0, "#101a13", 40, "#16301f", 120, "#1d4a2b",
        ],
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.92,
      },
    });
  } catch (e) {
    console.warn("3D buildings unavailable for this style:", e.message);
  }
}

/* ------------------------ Three.js shared overlay ------------------------ */

const overlayCanvas = document.getElementById("can-overlay");
const mapEl = document.getElementById("map");
const renderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(2, 4, 3);
scene.add(sun);

let camera = makeCamera();
// clientWidth/Height, not getBoundingClientRect — the phone frame is CSS-scaled
// to fit the window, and we need the unscaled layout size that map.project()
// and the overlay canvas both work in.
function mapSize() {
  return { w: mapEl.clientWidth || 402, h: mapEl.clientHeight || 874 };
}
function makeCamera() {
  const { w, h } = mapSize();
  const cam = new THREE.OrthographicCamera(0, w, 0, h, -1000, 1000);
  cam.position.z = 500;
  return cam;
}
function resizeRenderer() {
  const { w, h } = mapSize();
  renderer.setSize(w, h, false);
  camera = makeCamera();
}
// Fit the 402x874 frame into whatever window we're in (desktop preview only —
// under 440px wide the phone goes full-bleed and this stays at 1).
function fitPhone() {
  const scale = window.innerWidth <= 440
    ? 1
    : Math.min(1, (window.innerHeight - 40) / 874, (window.innerWidth - 32) / 402);
  document.documentElement.style.setProperty("--phone-scale", scale.toFixed(3));
}
fitPhone();

resizeRenderer();
window.addEventListener("resize", () => {
  fitPhone(); resizeRenderer(); map.resize(); scheduleRecluster(0);
});

const CAN_SCALE = 52 / 2.06; // constant on-screen size — a pin, not a world object

/* ---------------------- Active marker bookkeeping ------------------------ */

const screenMap = document.querySelector('.screen[data-name="map"]');
const activeCans = new Map();
const activeClusters = new Map();
let currentOpenStoreId = null;
let previousCamera = null;
let hiddenCanGroup = null;
const clock = new THREE.Clock();

function recompute() {
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const clusters = index.getClusters(bbox, Math.round(map.getZoom()));

  const nextCans = new Set();
  const nextClusters = new Set();

  for (const f of clusters) {
    const [lng, lat] = f.geometry.coordinates;
    if (f.properties.cluster) {
      const key = `c${f.properties.cluster_id}`;
      nextClusters.add(key);
      let entry = activeClusters.get(key);
      if (!entry) {
        const el = document.createElement("div");
        el.className = "cluster-badge";
        el.textContent = f.properties.point_count_abbreviated;
        el.addEventListener("click", () => {
          const z = Math.min(index.getClusterExpansionZoom(f.properties.cluster_id), 17);
          map.easeTo({ center: [lng, lat], zoom: z, duration: 600 });
        });
        screenMap.appendChild(el);
        entry = { el, lng, lat };
        activeClusters.set(key, entry);
      }
      entry.lng = lng; entry.lat = lat;
    } else {
      const store = storeById.get(f.properties.storeId);
      if (!store) continue;
      nextCans.add(store.id);
      if (!activeCans.has(store.id)) {
        const group = createCanMesh({
          recent: isRecent(store.lastSale, NOW()),
          featured: !!store.featured,
          label: store.variants[0]?.name,
        });
        scene.add(group);
        const hitEl = document.createElement("div");
        hitEl.className = "hit-target";
        hitEl.title = store.name;
        hitEl.addEventListener("click", () => openStore(store.id));
        screenMap.appendChild(hitEl);
        activeCans.set(store.id, { group, hitEl, store });
      }
    }
  }

  for (const [id, e] of activeCans) {
    if (!nextCans.has(id)) { scene.remove(e.group); e.hitEl.remove(); activeCans.delete(id); }
  }
  for (const [k, e] of activeClusters) {
    if (!nextClusters.has(k)) { e.el.remove(); activeClusters.delete(k); }
  }
}

let reclusterTimer = null;
function scheduleRecluster(delay = 200) {
  clearTimeout(reclusterTimer);
  reclusterTimer = setTimeout(async () => {
    await fetchStoresInBounds(map.getBounds());
    recompute();
  }, delay);
}

function syncPositions() {
  for (const { group, hitEl, store } of activeCans.values()) {
    const p = map.project([store.lng, store.lat]);
    group.position.set(p.x, p.y, 0);
    group.scale.setScalar(CAN_SCALE);
    hitEl.style.left = `${p.x}px`;
    hitEl.style.top = `${p.y}px`;
  }
  for (const e of activeClusters.values()) {
    const p = map.project([e.lng, e.lat]);
    e.el.style.left = `${p.x}px`;
    e.el.style.top = `${p.y}px`;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  for (const { group } of activeCans.values()) {
    group.rotation.y = t * 0.6;
    animateOutlinePulse(group, t);
  }
  syncPositions();
  renderer.render(scene, camera);
}

map.on("load", () => {
  tintMapGreen();
  add3DBuildings();
  recompute();
  renderDeck();
  animate();
  loadFeaturedListings();
});
map.on("moveend", () => scheduleRecluster());
map.on("zoomend", () => scheduleRecluster());

/* ------------------------------ screens --------------------------------- */

const phone = document.getElementById("phone");
function setScreen(name) {
  if (name === "owner") { window.location.href = "/owner.html"; return; }
  phone.dataset.screen = name;
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.goto === name);
  }
  if (name === "map") map.resize();
  if (name === "list") renderNearby();
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-goto]");
  if (el) setScreen(el.dataset.goto);
});

/* ------------------------- map screen chrome ----------------------------- */

const CHIPS = ["All 34", "In stock", "Recently sold", "Under ₪10", "Zero sugar"];
let activeChip = 0;
const chipsEl = document.getElementById("chips");
CHIPS.forEach((label, i) => {
  const el = document.createElement("div");
  el.className = `chip${i === activeChip ? " on" : ""}`;
  el.textContent = label;
  el.addEventListener("click", () => {
    activeChip = i;
    [...chipsEl.children].forEach((c, j) => c.classList.toggle("on", j === i));
    renderDeck();
  });
  chipsEl.appendChild(el);
});

function chipFilter(stores) {
  const now = NOW();
  switch (activeChip) {
    case 1: return stores; // "In stock" — every listed store carries stock
    case 2: return stores.filter((s) => isRecent(s.lastSale, now));
    case 3: return stores.filter((s) => Math.min(...s.variants.map((v) => v.price)) < 10);
    case 4: return stores.filter((s) => s.variants.some((v) => /zero|ultra/i.test(v.name)));
    default: return stores;
  }
}

// distance from the map centre, purely for demo ordering
function distanceKm(store) {
  const c = map.getCenter();
  const dx = (store.lng - c.lng) * 92;
  const dy = (store.lat - c.lat) * 111;
  return Math.hypot(dx, dy);
}
const prettyDist = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

function nearestStores(n = 12) {
  return chipFilter(allStores()).sort((a, b) => distanceKm(a) - distanceKm(b)).slice(0, n);
}

const deckEl = document.getElementById("deck");
function renderDeck() {
  deckEl.innerHTML = "";
  for (const s of nearestStores(6)) {
    const min = Math.min(...s.variants.map((v) => v.price));
    const card = document.createElement("div");
    card.className = `deckcard${s.featured ? " featured" : ""}`;
    card.innerHTML = `
      <div class="deck-can"></div>
      <div style="min-width:0">
        <div class="deck-store">${s.name}</div>
        <div class="deck-sub">${prettyDist(distanceKm(s))} · ${s.variants.length} variants</div>
        <div class="deck-price">${ILS(min)}</div>
      </div>`;
    card.addEventListener("click", () => openStore(s.id));
    deckEl.appendChild(card);
  }
}
map.on("moveend", renderDeck);

document.getElementById("btn-3d").addEventListener("click", (e) => {
  const on = map.getPitch() < 10;
  map.easeTo({ pitch: on ? PITCH_3D : 0, duration: 600 });
  e.currentTarget.classList.toggle("active", on);
});
document.getElementById("btn-locate").addEventListener("click", () => {
  map.easeTo({ center: [34.7806, 32.0809], zoom: 13.6, duration: 700 });
});
document.getElementById("btn-layers").addEventListener("click", () => {
  const layer = map.getLayer("3d-buildings");
  if (!layer) return;
  const vis = map.getLayoutProperty("3d-buildings", "visibility") === "none" ? "visible" : "none";
  map.setLayoutProperty("3d-buildings", "visibility", vis);
});

/* ------------------------------ focused pin ------------------------------ */

const bubble = document.getElementById("bubble");
const backdrop = document.getElementById("backdrop");
const heroCanEl = document.getElementById("hero-can");
const heroGlowEl = document.getElementById("hero-glow");
const heroCan = createHeroCan();
heroCan.mount(heroCanEl);

function relativeTime(iso) {
  const hours = (NOW().getTime() - new Date(iso).getTime()) / 3600000;
  if (hours < 1) return "under an hour ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function populateBubble(store) {
  const fresh = isRecent(store.lastSale, NOW());
  document.getElementById("b-freshness-text").textContent =
    fresh ? `Sold here ${relativeTime(store.lastSale)}` : `Last sold ${relativeTime(store.lastSale)}`;
  document.getElementById("b-chain").textContent =
    store.featured ? `${store.chain} · ★ Featured` : store.chain;
  document.getElementById("b-name").textContent = store.name;
  document.getElementById("b-address").textContent = store.address;

  const min = Math.min(...store.variants.map((v) => v.price));
  document.getElementById("b-minprice").textContent = ILS(min);
  document.getElementById("b-count").textContent = `${store.variants.length} variants`;

  const list = document.getElementById("b-list");
  list.innerHTML = "";
  for (const v of [...store.variants].sort((a, b) => a.price - b.price).slice(0, 4)) {
    const li = document.createElement("li");
    li.className = "variant-row";
    li.innerHTML = `
      <div class="vrow-can"></div>
      <div style="min-width:0">
        <div class="vrow-name">${v.name}</div>
        <div class="vrow-code">${v.code}</div>
      </div>
      <span class="vrow-price">${ILS(v.price)}</span>`;
    list.appendChild(li);
  }
}

function openStore(storeId) {
  const store = storeById.get(storeId);
  if (!store) return;
  if (phone.dataset.screen !== "map") setScreen("map");

  if (currentOpenStoreId === null) {
    previousCamera = {
      center: map.getCenter(), zoom: map.getZoom(),
      pitch: map.getPitch(), bearing: map.getBearing(),
    };
    history.pushState({ monsterBubble: true }, "");
  }
  currentOpenStoreId = storeId;

  // land the pin on the left ~quarter, leaving room for the bubble — the same
  // anchor the design's own camera transform uses (96px of a 402px frame)
  const w = mapEl.clientWidth;
  map.easeTo({
    center: [store.lng, store.lat],
    offset: [w * 0.24 - w * 0.5, -60],
    zoom: Math.max(map.getZoom(), 16),
    pitch: PITCH_3D,
    duration: 850,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  populateBubble(store);
  heroCan.setLabel(store.variants[0]?.name);
  bubble.classList.add("open");
  backdrop.classList.add("open");
  heroCanEl.classList.add("open");
  heroGlowEl.classList.add("open");

  // the tiny pin "becomes" the big draggable can — hide it underneath
  const active = activeCans.get(storeId);
  if (active) { active.group.visible = false; hiddenCanGroup = active.group; }
}

function closeStore({ fromPopState = false } = {}) {
  if (currentOpenStoreId === null) return;
  currentOpenStoreId = null;
  bubble.classList.remove("open");
  backdrop.classList.remove("open");
  heroCanEl.classList.remove("open");
  heroGlowEl.classList.remove("open");
  if (hiddenCanGroup) { hiddenCanGroup.visible = true; hiddenCanGroup = null; }
  if (previousCamera) {
    map.easeTo({ ...previousCamera, offset: [0, 0], duration: 750, easing: (t) => 1 - Math.pow(1 - t, 3) });
    previousCamera = null;
  }
  if (!fromPopState) history.back();
}

document.querySelector(".bubble-close").addEventListener("click", () => closeStore());
backdrop.addEventListener("click", () => closeStore());
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeStore(); });
window.addEventListener("popstate", () => closeStore({ fromPopState: true }));

let touchStart = null;
bubble.addEventListener("touchstart", (e) => { touchStart = [e.touches[0].clientX, e.touches[0].clientY]; });
bubble.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart[0];
  const dy = e.changedTouches[0].clientY - touchStart[1];
  if (Math.hypot(dx, dy) > 80) closeStore();
  touchStart = null;
});

document.getElementById("b-details").addEventListener("click", () => {
  if (currentOpenStoreId) showStoreDetail(currentOpenStoreId);
});

/* ------------------------------ search screen ---------------------------- */

const FILTERS = ["Recently sold", "In stock", "Under ₪10", "Walk < 10 min", "Zero sugar", "Featured"];
let activeFilter = 0;
const filtersEl = document.getElementById("filters");
FILTERS.forEach((label, i) => {
  const el = document.createElement("div");
  el.className = `chip${i === activeFilter ? " on" : ""}`;
  el.textContent = label;
  el.addEventListener("click", () => {
    activeFilter = i;
    [...filtersEl.children].forEach((c, j) => c.classList.toggle("on", j === i));
    runSearch();
  });
  filtersEl.appendChild(el);
});

const searchInput = document.getElementById("search-input");
const resultsEl = document.getElementById("search-results");
searchInput.addEventListener("input", runSearch);

function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  const rows = [];
  for (const s of allStores()) {
    for (const v of s.variants) {
      if (q && !v.name.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) continue;
      if (activeFilter === 0 && !isRecent(s.lastSale, NOW())) continue;
      if (activeFilter === 2 && v.price >= 10) continue;
      if (activeFilter === 3 && distanceKm(s) > 0.8) continue;
      if (activeFilter === 4 && !/zero|ultra/i.test(v.name)) continue;
      if (activeFilter === 5 && !s.featured) continue;
      rows.push({ store: s, variant: v });
    }
  }
  rows.sort((a, b) => a.variant.price - b.variant.price);

  resultsEl.innerHTML = "";
  if (!rows.length) {
    resultsEl.innerHTML = `<div class="listrow"><div class="listrow-main"><div class="listrow-sub">No shelves match that yet.</div></div></div>`;
    return;
  }
  for (const { store, variant } of rows.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "listrow";
    row.innerHTML = `
      <div class="listrow-can"></div>
      <div class="listrow-main">
        <div class="listrow-title">${variant.name}</div>
        <div class="listrow-sub">${store.name} · ${prettyDist(distanceKm(store))}</div>
      </div>
      <span class="listrow-price">${ILS(variant.price)}</span>`;
    row.addEventListener("click", () => showStoreDetail(store.id));
    resultsEl.appendChild(row);
  }
}

const recentsEl = document.getElementById("recents");
for (const r of ["ultra paradise", "cheapest zero sugar", "mango loco", "juice khaotic"]) {
  const el = document.createElement("div");
  el.className = "recent";
  el.innerHTML = `<i class="ph ph-clock-counter-clockwise"></i><span>${r}</span>`;
  el.addEventListener("click", () => { searchInput.value = r; runSearch(); });
  recentsEl.appendChild(el);
}
runSearch();

/* ------------------------------ nearby list ------------------------------ */

const nearbyEl = document.getElementById("nearby-list");
function renderNearby() {
  const stores = nearestStores(14);
  document.getElementById("list-meta").textContent =
    `${stores.length} shelves · ${stores.filter((s) => distanceKm(s) < 0.5).length} within 500 m`;
  nearbyEl.innerHTML = "";
  for (const s of stores) {
    const min = Math.min(...s.variants.map((v) => v.price));
    const fresh = isRecent(s.lastSale, NOW());
    const card = document.createElement("div");
    card.className = `storecard${s.featured ? " featured" : ""}`;
    card.innerHTML = `
      <div class="listrow-can" style="height:70px;width:38px"></div>
      <div class="listrow-main">
        <div class="row-gap">
          <span class="listrow-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name}</span>
          <span class="badge ${s.featured ? "gold" : fresh ? "fresh" : ""}">${s.featured ? "Featured" : fresh ? "Fresh" : "In stock"}</span>
        </div>
        <div class="listrow-sub">${prettyDist(distanceKm(s))} · ${s.variants.length} variants · sold ${relativeTime(s.lastSale)}</div>
        <div class="row-gap baseline" style="margin-top:6px">
          <span style="font:600 17px var(--font-heading)">${ILS(min)}</span>
          <span class="listrow-sub" style="margin:0">cheapest</span>
        </div>
      </div>
      <i class="ph ph-caret-right" style="align-self:center;color:var(--muted)"></i>`;
    card.addEventListener("click", () => showStoreDetail(s.id));
    nearbyEl.appendChild(card);
  }
}

/* --------------------------------- me ------------------------------------ */

(function renderMeStats() {
  const stores = allStores();
  const variants = new Set(stores.flatMap((s) => s.variants.map((v) => v.name)));
  const featured = stores.filter((s) => s.featured).length;
  const stats = [
    [stores.length, "shelves tracked"],
    [variants.size, "variants seen"],
    [featured, "featured shops"],
  ];
  const el = document.getElementById("me-stats");
  el.innerHTML = stats
    .map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
    .join("");
})();

/* ----------------------------- store detail ------------------------------ */

function showStoreDetail(storeId) {
  const s = storeById.get(storeId);
  if (!s) return;
  document.getElementById("s-name").textContent = s.name;
  document.getElementById("s-address").textContent =
    `${s.address} · ${prettyDist(distanceKm(s))} walk`;

  const sorted = [...s.variants].sort((a, b) => a.price - b.price);
  document.getElementById("s-shelf-label").textContent = `On the shelf · ${sorted.length}`;
  const shelf = document.getElementById("s-shelf");
  shelf.innerHTML = "";
  for (const v of sorted) {
    const row = document.createElement("div");
    row.className = "listrow";
    row.innerHTML = `
      <div class="listrow-can"></div>
      <div class="listrow-main">
        <div class="listrow-title">${v.name}</div>
        <div class="listrow-sub">${v.code}</div>
      </div>
      <span class="listrow-price">${ILS(v.price)}</span>`;
    shelf.appendChild(row);
  }

  const min = Math.min(...s.variants.map((v) => v.price));
  const months = ["D", "J", "F", "M", "A", "M", "J", "J", "A", "S"];
  const series = months.map((_, i) => min * (1 + Math.sin(i * 1.3) * 0.06 + (9 - i) * 0.004));
  // normalise the series into the 78px-tall chart rather than scaling raw ₪
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const barPx = (p) => Math.round(14 + ((p - lo) / (hi - lo || 1)) * 44);
  const hist = document.getElementById("s-history");
  hist.innerHTML = "";
  series.forEach((p, i) => {
    const col = document.createElement("div");
    col.innerHTML = `<b style="height:${barPx(p)}px" class="${i === series.length - 1 ? "now" : ""}"></b><span>${months[i]}</span>`;
    hist.appendChild(col);
  });
  document.getElementById("s-hist-price").textContent = ILS(min);

  setScreen("store");
}
