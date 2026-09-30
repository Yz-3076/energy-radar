/**
 * The map screen — the app's home screen, on the web.
 *
 * Same basemap (mobile/src/map/style.ts, imported not copied), same tilted
 * camera, same can-shaped pins, same clustering, same focused-pin move
 * where the camera parks the pin at the left quarter and the hero can and
 * white bubble slide in beside it.
 *
 * The app uses @maplibre/maplibre-react-native; this uses maplibre-gl,
 * which is the same renderer with a different binding. That is why the
 * style object and the pitch constants transfer unchanged.
 */
import maplibregl from "maplibre-gl";
import Supercluster from "supercluster";

import {
  Can,
  Crown,
  Icons,
  MAP_STYLE,
  PITCH_3D,
  PITCH_FLAT,
  DEFAULT_ZOOM,
  FILTERS,
  matchesFilter,
  getVariant,
  cheapest,
  originalRow,
  storeIsFresh,
  isFresh,
  distanceM,
  prettyDistance,
  relativeTime,
  walkMinutes,
  chainLabel,
  stockStatus,
  STOCK_LABEL,
  ils,
} from "./shared.ts";
import {
  h, isolate, openDirections, storeHasPromo, promoCard, promosAtStore,
  distanceLabel, walkLabel,
} from "./ui.js";

/** Matches the app: never flood the view with marker elements. */
const MAX_MARKERS = 36;

/** Metres covered by one screen pixel at this latitude and zoom. */
const metresPerPixel = (lat, zoom) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

/** Longitude delta that shifts the map `px` pixels east at this zoom. */
function eastOffset(lat, zoom, px) {
  return (px * metresPerPixel(lat, zoom)) / (111320 * Math.cos((lat * Math.PI) / 180));
}

/** Latitude delta that shifts the map `px` pixels north at this zoom. */
function northOffset(lat, zoom, px) {
  return (px * metresPerPixel(lat, zoom)) / 111320;
}

/** Below this the detail card is a bottom sheet; above it, a side card. */
const WIDE = 720;

export function createMapScreen(root, app) {
  root.innerHTML = `
    <div id="map"></div>
    <div class="top-scrim"></div>
    <div class="top-bar">
      <div class="brand-row">
        <div style="min-width:0">
          <div class="kicker-sm">Hunting near</div>
          <div class="place" id="place">Israel</div>
        </div>
      </div>
      <button class="search-btn tap" id="open-search">
        ${Icons.MagnifyingGlass({ size: 15, color: "rgba(234,240,234,.45)" })}
        <span>Flavour, store or price…</span>
      </button>
      <div class="chip-row" id="chips"></div>
    </div>
    <div class="controls">
      <button class="control tap on" id="btn-3d">3D</button>
      <button class="control tap" id="btn-locate" title="Centre on me">
        ${Icons.CrosshairSimple({ size: 17, color: "#eaf0ea" })}
      </button>
    </div>
    <div class="loading" id="map-loading"><span class="spinner"></span>loading shelves…</div>
    <div class="deck" id="deck"></div>
    <div id="focus-layer"></div>`;

  const state = {
    filter: "all",
    threeD: true,
    focusId: null,
    view: null,
    restore: null,
    centred: false,
    markers: new Map(),
  };

  const map = new maplibregl.Map({
    container: root.querySelector("#map"),
    style: MAP_STYLE,
    // Open where the app opens: on the visitor's coordinate at street zoom,
    // which until the browser grants a fix is the app's own Tel Aviv
    // fallback. A national view would contradict the deck under it, which is
    // already listing shelves a two-minute walk away.
    center: [app.coord.lng, app.coord.lat],
    zoom: DEFAULT_ZOOM,
    pitch: PITCH_3D,
    // The app disables rotation on the map (touchRotate={false}) so the
    // north-up reading stays stable while panning with one thumb.
    dragRotate: false,
    touchPitch: false,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate?.disableRotation();

  const deckEl = root.querySelector("#deck");
  const focusLayer = root.querySelector("#focus-layer");
  const placeEl = root.querySelector("#place");
  const loadingEl = root.querySelector("#map-loading");

  /* ── filter chips ──────────────────────────────────────────────────── */

  const chipsEl = root.querySelector("#chips");
  chipsEl.innerHTML = FILTERS.map(
    (f) => `<button class="chip tap${f.id === "all" ? " on" : ""}" data-filter="${h(f.id)}">${h(f.label)}</button>`,
  ).join("");
  chipsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    for (const c of chipsEl.children) c.classList.toggle("on", c === btn);
    render();
  });

  root.querySelector("#open-search").onclick = () => app.go("search");

  const btn3d = root.querySelector("#btn-3d");
  btn3d.onclick = () => {
    state.threeD = !state.threeD;
    btn3d.classList.toggle("on", state.threeD);
    map.easeTo({ pitch: state.threeD ? PITCH_3D : PITCH_FLAT, duration: 500 });
  };

  root.querySelector("#btn-locate").onclick = () => {
    map.flyTo({ center: [app.coord.lng, app.coord.lat], zoom: DEFAULT_ZOOM, pitch: state.threeD ? PITCH_3D : PITCH_FLAT, duration: 900 });
  };

  /* ── user puck ─────────────────────────────────────────────────────── */

  let puck = null;
  function drawPuck() {
    if (!app.hasFix) return;
    if (!puck) {
      const node = document.createElement("div");
      node.className = "puck";
      node.innerHTML = `<span class="ring" style="width:64px;height:64px;color:rgba(0,255,65,.55)"></span>
        <span class="puck-halo"></span><span class="puck-dot"></span>`;
      puck = new maplibregl.Marker({ element: node }).setLngLat([app.coord.lng, app.coord.lat]).addTo(map);
    } else {
      puck.setLngLat([app.coord.lng, app.coord.lat]);
    }
  }

  /* ── markers ───────────────────────────────────────────────────────── */

  function visibleStores() {
    return app.stores.filter((s) => matchesFilter(s, state.filter, app.now));
  }

  let cluster = null;
  function rebuildCluster() {
    cluster = new Supercluster({ radius: 62, maxZoom: 16, minPoints: 2 });
    cluster.load(
      visibleStores().map((s) => ({
        type: "Feature",
        properties: { storeId: s.id },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      })),
    );
  }

  function pinHTML(store, { focused, dimmed, showPrice, cheapestHere, hasPromo }) {
    const row = originalRow(store);
    const variant = getVariant(row.variantId);
    const fresh = storeIsFresh(store, app.now);
    const ring = store.featured ? "#f0b429" : focused ? "#00ff41" : "rgba(0,255,65,.30)";

    return `
      <div class="pin${dimmed ? " dim" : ""}">
        ${showPrice ? `<div class="pin-price" style="border-color:${ring}">${h(ils(row.price))}</div>` : ""}
        <div class="pin-can">
          ${fresh ? `<span class="ring" style="width:48px;height:48px;color:${ring}"></span>` : ""}
          ${Can({ variant, size: focused ? 62 : 52, dim: !fresh })}
          ${cheapestHere ? `<span class="badge-crown">${Crown({ size: 13 })}</span>` : ""}
          ${hasPromo ? `<span class="badge-fire">${Icons.Flame({ size: 11, color: "#fff" })}</span>` : ""}
        </div>
        <div class="pin-shadow"></div>
      </div>`;
  }

  /** Any store in this cluster sold recently? Drives the ring colour. */
  function anyFresh(clusterId) {
    try {
      return cluster
        .getLeaves(clusterId, 24)
        .some((leaf) => {
          const s = app.storeById.get(leaf.properties.storeId);
          return s ? storeIsFresh(s, app.now) : false;
        });
    } catch {
      return false;
    }
  }

  function render() {
    if (!state.view || !app.stores.length) return;

    // Tied to the shelves, not to the basemap. It used to clear on the map's
    // own `load` event, so on a slow tile server it sat there reading
    // "loading shelves…" over a screen that was already full of pins.
    loadingEl.style.display = "none";

    rebuildCluster();

    const { bounds, zoom, center } = state.view;
    let features = cluster.getClusters(bounds, Math.round(zoom));
    if (features.length > MAX_MARKERS) {
      const c = { lat: center[1], lng: center[0] };
      features = [...features]
        .sort(
          (a, b) =>
            distanceM(c, { lat: a.geometry.coordinates[1], lng: a.geometry.coordinates[0] }) -
            distanceM(c, { lat: b.geometry.coordinates[1], lng: b.geometry.coordinates[0] }),
        )
        .slice(0, MAX_MARKERS);
    }

    // Crown and flame are scoped to what is on screen, exactly as in the
    // app: "cheapest" must mean cheapest in the city you are looking at,
    // not a nationwide winner nowhere near this view.
    const onScreen = features
      .filter((f) => !f.properties.cluster)
      .map((f) => app.storeById.get(f.properties.storeId))
      .filter(Boolean);

    let cheapestId = null;
    let best = Infinity;
    for (const s of onScreen) {
      const p = cheapest(s).price;
      if (p < best) {
        best = p;
        cheapestId = s.id;
      }
    }

    const wanted = new Set();
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      const key = f.properties.cluster ? `c${f.properties.cluster_id}` : f.properties.storeId;
      wanted.add(key);

      let marker = state.markers.get(key);
      if (!marker) {
        const node = document.createElement("div");
        if (f.properties.cluster) {
          const count = f.properties.point_count;
          const size = count < 10 ? 40 : count < 50 ? 48 : 56;
          node.className = `cluster${anyFresh(f.properties.cluster_id) ? " fresh" : ""}`;
          node.style.width = `${size}px`;
          node.style.height = `${size}px`;
          node.textContent = String(count);
          // stopPropagation because MapLibre puts markers inside the canvas
          // container and listens for clicks there, so without it every
          // marker click is also a map click. On a pin that meant openFocus
          // ran and the map's own handler closed the card in the same tick —
          // the can looked completely dead.
          node.onclick = (e) => {
            e.stopPropagation();
            const z = Math.min(19, cluster.getClusterExpansionZoom(f.properties.cluster_id));
            map.flyTo({ center: [lng, lat], zoom: z, duration: 620 });
          };
        } else {
          const store = app.storeById.get(f.properties.storeId);
          if (!store) continue;
          node.onclick = (e) => {
            e.stopPropagation();
            openFocus(store);
          };
        }
        marker = new maplibregl.Marker({ element: node, anchor: f.properties.cluster ? "center" : "bottom" })
          .setLngLat([lng, lat])
          .addTo(map);
        state.markers.set(key, marker);
      }

      if (!f.properties.cluster) {
        const store = app.storeById.get(f.properties.storeId);
        if (!store) continue;
        marker.getElement().innerHTML = pinHTML(store, {
          focused: state.focusId === store.id,
          dimmed: state.focusId !== null && state.focusId !== store.id,
          showPrice: zoom >= 14 && state.focusId === null,
          cheapestHere: store.id === cheapestId,
          hasPromo: storeHasPromo(app.promotions, store.id),
        });
      }
    }

    for (const [key, marker] of state.markers) {
      if (!wanted.has(key)) {
        marker.remove();
        state.markers.delete(key);
      }
    }

    drawDeck();
  }

  /* ── nearest-shelf deck ────────────────────────────────────────────── */

  function drawDeck() {
    if (state.focusId) {
      deckEl.style.display = "none";
      return;
    }
    deckEl.style.display = "";

    const near = [...visibleStores()]
      .sort((a, b) => distanceM(app.coord, a) - distanceM(app.coord, b))
      .slice(0, 8);

    if (near.length) {
      placeEl.textContent = app.placeLabel || near[0].city || "Israel";
    }

    deckEl.innerHTML = near
      .map((s) => {
        const row = originalRow(s);
        const variant = getVariant(row.variantId);
        return `
          <button class="deck-card tap" data-store="${h(s.id)}">
            ${Can({ variant, size: 59 })}
            <span style="flex:1;min-width:0">
              <span class="deck-store">${h(s.name)}</span>
              <span class="deck-meta">${h(distanceLabel(s, distanceM(app.coord, s)))} · ${h(variant.name)}</span>
              <span style="display:flex;align-items:baseline">
                <span class="deck-price">${h(ils(row.price))}</span>
                <span class="deck-stock">${storeIsFresh(s, app.now) ? "sold today" : `${s.shelf.length} variants`}</span>
              </span>
            </span>
          </button>`;
      })
      .join("");

    for (const card of deckEl.children) {
      card.onclick = () => {
        const store = app.storeById.get(card.dataset.store);
        if (store) openFocus(store);
      };
    }
  }

  /* ── focused pin ───────────────────────────────────────────────────── */

  /** How this shelf's price sits against every other shelf selling the can. */
  function priceVerdict(row) {
    const all = app.stores.flatMap((s) => s.shelf.filter((r) => r.variantId === row.variantId));
    if (all.length < 2) return { label: "Only sighting", tone: "" };
    const sorted = all.map((r) => r.price).sort((a, b) => a - b);
    if (row.price <= sorted[0]) return { label: "Cheapest in the country", tone: "good" };
    if (row.price <= sorted[Math.floor(sorted.length / 2)]) return { label: "Fair price", tone: "" };
    return { label: "Above average", tone: "high" };
  }

  /**
   * Tapping a can opens the whole story of that can at that shelf.
   *
   * This used to be a small bubble with the price and a "Details" button,
   * which meant the interesting half — what the drink actually is, what else
   * the branch stocks, whether a deal is running — was always one tap away
   * and usually never seen. The card now answers it in place: the can on its
   * own stage, the price with a verdict, where the shelf is, what is in the
   * drink, deals at that branch, and the rest of the shelf as cans you can
   * tap straight through to.
   *
   * On a phone it rises from the bottom, because a side card at 375 px is
   * too narrow to read; past 720 px it sits beside the pin as before. Same
   * markup either way — see .focus-card in app.css — and only the camera
   * has to know, so the pin lands in whatever strip of map is left over.
   */
  function openFocus(store, variantId) {
    // Captured on the first focus only. Switching flavour, or tapping
    // another pin while one is open, must still return you to where you
    // were looking before any of this started.
    if (state.focusId === null) {
      state.restore = { center: map.getCenter(), zoom: map.getZoom() };
    }
    state.focusId = store.id;

    const zoom = Math.max(map.getZoom(), 16.2);
    const w = root.clientWidth;
    const h0 = root.clientHeight;
    const wide = w >= WIDE;

    map.flyTo({
      // Shift the centre rather than using viewport padding, which the two
      // renderers disagree about: east on a wide screen so the pin sits in
      // the left quarter, north on a phone so it sits above the sheet.
      center: wide
        ? [store.lng + eastOffset(store.lat, zoom, w * 0.25), store.lat]
        : [store.lng, store.lat - northOffset(store.lat, zoom, h0 * 0.22)],
      zoom,
      pitch: state.threeD ? PITCH_3D : PITCH_FLAT,
      duration: 820,
    });

    const row =
      (variantId && store.shelf.find((r) => r.variantId === variantId)) || originalRow(store);
    const variant = getVariant(row.variantId);
    const metres = distanceM(app.coord, store);
    const fresh = isFresh(row.seenAt, app.now);
    const verdict = priceVerdict(row);
    const status = stockStatus(row, app.now);
    const deals = promosAtStore(app.promotions, store, getVariant);
    const others = store.shelf.filter((r) => r.variantId !== row.variantId).sort((a, b) => a.price - b.price);

    // Only the figures we actually hold. A guessed caffeine number is
    // indistinguishable on screen from a sourced one, so the catalogue
    // stores null and this simply leaves the chip out.
    const facts = [
      variant.caffeineMg !== null ? `${variant.caffeineMg} mg caffeine` : null,
      variant.zeroSugar ? "Zero sugar" : variant.sugarG !== null ? `${variant.sugarG} g sugar` : null,
      `${variant.sizeMl} ml`,
    ].filter(Boolean);

    focusLayer.innerHTML = `
      <div class="focus-scrim" id="focus-scrim"></div>
      <div class="focus-card" role="dialog" aria-label="${h(variant.fullName)} at ${h(store.name)}">
        <button class="focus-close tap" id="focus-close" aria-label="Close">
          ${Icons.X({ size: 13, color: "#474d47", weight: "fill" })}
        </button>

        <div class="focus-stage">
          <span class="focus-glow"></span>
          ${Can({ variant, size: 132, hero: true, animated: true })}
        </div>

        <div class="focus-body">
          <div class="focus-status" style="color:${fresh ? "#009a28" : "#767c76"}">
            ${Icons.CheckCircle({ size: 13, color: fresh ? "#009a28" : "#767c76", weight: "fill" })}
            ${fresh ? "Sold here today" : `Last sold ${h(relativeTime(row.seenAt, app.now))}`}
          </div>
          <div class="focus-vname">${h(variant.fullName)}</div>
          <div class="focus-facts">${facts.map((f) => `<span class="fact">${h(f)}</span>`).join("")}</div>

          <div class="focus-price-row">
            <div>
              <div class="focus-plabel">Shelf price here</div>
              <div class="focus-price">${h(ils(row.price))}</div>
            </div>
            <div class="verdict ${h(verdict.tone)}">
              ${verdict.tone === "good" ? Crown({ size: 11, color: "#00691b" }) : ""}
              ${h(verdict.label)}
            </div>
          </div>

          <div class="focus-sec">Where</div>
          <div class="focus-store">
            <span class="focus-sname">${h(store.name)}</span>
            <span class="focus-chain">${h(chainLabel(store.chain))}</span>
          </div>
          <div class="focus-addr">${h(isolate(store.address))}</div>
          <div class="focus-addr">${h(walkLabel(store, metres))}</div>

          <div class="focus-sec">About this can</div>
          <div class="focus-blurb">${h(variant.blurb)}</div>
          <div class="focus-prov">
            <span class="stock-dot ${h(status)}"></span>${h(STOCK_LABEL[status])} · ${
              row.source === "official_feed"
                ? `official price feed, sold ${h(relativeTime(row.seenAt, app.now))}`
                : row.source === "featured"
                  ? "listed by the store itself"
                  : `hunter photo, ${h(row.qty ?? "?")} on shelf ${h(relativeTime(row.seenAt, app.now))}`
            }
          </div>

          ${
            deals.length
              ? `<div class="focus-sec">Deals at this branch</div>
                 <div class="focus-deals">${deals.slice(0, 3).map((p) => promoCard(p)).join("")}</div>`
              : ""
          }

          ${
            others.length
              ? `<div class="focus-sec">Also on this shelf · ${others.length}</div>
                 <div class="focus-shelf">
                   ${others
                     .slice(0, 10)
                     .map((r) => {
                       const v = getVariant(r.variantId);
                       return `<button class="shelf-can tap" data-variant="${h(v.id)}" title="${h(v.fullName)}">
                         ${Can({ variant: v, size: 40 })}
                         <span class="shelf-price">${h(ils(r.price))}</span>
                         <span class="shelf-name">${h(v.name)}</span>
                       </button>`;
                     })
                     .join("")}
                 </div>`
              : ""
          }

          <div class="focus-actions">
            <button class="btn-dark tap" id="focus-directions">
              ${Icons.NavigationArrow({ size: 13, color: "#f2f5f2", weight: "fill" })}Directions
            </button>
            <button class="btn-light tap" id="focus-details">Full store page</button>
          </div>
        </div>
      </div>`;

    // The card is modal and reaches the bottom of the screen; the dock steps
    // aside for it rather than floating over the actions (see app.css).
    document.documentElement.classList.add("focus-open");

    focusLayer.querySelector("#focus-scrim").onclick = closeFocus;
    focusLayer.querySelector("#focus-close").onclick = closeFocus;
    focusLayer.querySelector("#focus-directions").onclick = () => openDirections(store);
    focusLayer.querySelector("#focus-details").onclick = () => app.go("store", store.id);

    // Tapping another can on the shelf re-renders the card around it rather
    // than leaving the map, so comparing two flavours at one branch costs
    // one tap instead of a round trip through the store page.
    for (const btn of focusLayer.querySelectorAll("[data-variant]")) {
      btn.onclick = () => openFocus(store, btn.dataset.variant);
    }

    render();
  }

  function closeFocus() {
    state.focusId = null;
    focusLayer.innerHTML = "";
    document.documentElement.classList.remove("focus-open");
    if (state.restore) {
      map.flyTo({ ...state.restore, pitch: state.threeD ? PITCH_3D : PITCH_FLAT, duration: 620 });
    }
    render();
  }

  /* ── wiring ────────────────────────────────────────────────────────── */

  function readView() {
    const b = map.getBounds();
    state.view = {
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      zoom: map.getZoom(),
      center: [map.getCenter().lng, map.getCenter().lat],
    };
  }

  map.on("load", () => {
    readView();
    loadingEl.style.display = "none";
    render();
    drawPuck();
  });
  map.on("moveend", () => {
    readView();
    render();
  });
  map.on("click", () => state.focusId && closeFocus());

  return {
    /** Called when stores arrive, or the visitor's position resolves. */
    update() {
      drawPuck();
      if (!state.centred && app.hasFix) {
        state.centred = true;
        map.flyTo({ center: [app.coord.lng, app.coord.lat], zoom: DEFAULT_ZOOM, pitch: state.threeD ? PITCH_3D : PITCH_FLAT, duration: 900 });
      }
      readView();
      render();
    },
    /** MapLibre needs telling when its container becomes visible again. */
    onShow() {
      map.resize();
    },
    focusStore(store) {
      openFocus(store);
    },
  };
}
