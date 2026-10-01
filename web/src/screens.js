/**
 * Search, store and flavour screens — the app's /search, /store/[id] and
 * /variant/[id], rebuilt for the browser.
 *
 * The layout, copy and ordering follow the app's screens closely enough
 * that someone who uses both should not have to relearn anything. What is
 * deliberately absent is everything behind the app's Me tab: saved
 * shelves, alerts, drink logging and the streak. Those are personal state
 * tied to a device, and the website has no profile to keep them in — see
 * the Stats screen, which takes that slot instead.
 */
import maplibregl from "maplibre-gl";

import {
  Can,
  Crown,
  Icons,
  VARIANTS,
  getVariant,
  cheapest,
  chainLabel,
  chainColor,
  MAP_STYLE,
  PITCH_3D,
  stockStatus,
  STOCK_LABEL,
  FILTERS,
  matchesFilter,
  distanceM,
  prettyDistance,
  relativeTime,
  walkMinutes,
  ils,
} from "./shared.ts";
import {
  h,
  isolate,
  promoCard,
  promosAtStore,
  promosForVariant,
  shortCity,
  openDirections,
  distanceLabel,
  walkLabel,
} from "./ui.js";

/* ── search ──────────────────────────────────────────────────────────── */

export function createSearchScreen(root, app) {
  root.innerHTML = `
    <div class="sheet">
      <div class="search-row">
        <label class="search-field" style="flex:1">
          ${Icons.MagnifyingGlass({ size: 15, color: "#00ff41" })}
          <input id="q" type="search" placeholder="Flavour, store, barcode…" autocomplete="off">
        </label>
        <button class="cancel tap" id="cancel">Cancel</button>
      </div>
      <div class="chip-row" id="s-chips" style="margin-top:11px"></div>
      <div id="s-results"></div>
    </div>`;

  const input = root.querySelector("#q");
  const results = root.querySelector("#s-results");
  const chips = root.querySelector("#s-chips");
  let filter = "all";

  chips.innerHTML = FILTERS.map(
    (f) => `<button class="chip tap${f.id === "all" ? " on" : ""}" data-filter="${h(f.id)}">${h(f.label)}</button>`,
  ).join("");
  chips.onclick = (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    filter = btn.dataset.filter;
    for (const c of chips.children) c.classList.toggle("on", c === btn);
    draw();
  };

  root.querySelector("#cancel").onclick = () => app.go("map");
  input.oninput = draw;

  /**
   * Search is about what you can actually go and buy, so results come from
   * shelves within reach first. Sorting the whole country by price alone
   * put Eilat at the top of every list for someone standing in Tel Aviv:
   * a true answer to a question nobody asked. If nothing is in range —
   * a visitor abroad, or a town the feed does not cover — it widens to the
   * whole country and the heading says so rather than showing nothing.
   */
  const IN_RANGE_M = 25_000;

  function draw() {
    const q = input.value.trim().toLowerCase();
    const all = app.stores.filter((s) => matchesFilter(s, filter, app.now));
    const near = all.filter((s) => distanceM(app.coord, s) <= IN_RANGE_M);
    const wide = near.length < 3;
    const pool = wide ? all : near;

    // Cheapest live listing per matching flavour, as in the app.
    const best = new Map();
    for (const store of pool) {
      const metres = distanceM(app.coord, store);
      for (const row of store.shelf) {
        const v = getVariant(row.variantId);
        const hay = `${v.name} ${v.fullName} ${v.rarity} ${v.barcode ?? ""}`.toLowerCase();
        if (q && !hay.includes(q)) continue;
        const prev = best.get(v.id);
        if (!prev || row.price < prev.price) {
          best.set(v.id, { variantId: v.id, store, price: row.price, seenAt: row.seenAt, metres });
        }
      }
    }
    const hits = [...best.values()].sort((a, b) => a.price - b.price);

    const storeHits = q
      ? pool
          .filter((s) => `${s.name} ${s.chain} ${s.address}`.toLowerCase().includes(q))
          .map((s) => ({ store: s, metres: distanceM(app.coord, s) }))
          .sort((a, b) => a.metres - b.metres)
          .slice(0, 6)
      : [];

    // Flavours nobody is carrying — an honest "nothing found" rather than
    // silence, same as the app.
    const found = new Set(hits.map((x) => x.variantId));
    const missing = q
      ? VARIANTS.filter((v) => !found.has(v.id) && `${v.name} ${v.fullName}`.toLowerCase().includes(q))
      : [];

    const scope = wide ? "in the country" : "within 25 km";
    let html = `<div class="kicker k-top">${q ? `Flavour matches · ${scope}` : `Cheapest right now · ${scope}`}</div><div class="group">`;
    html += hits.length
      ? hits
          .slice(0, q ? 12 : 6)
          .map((hit) => {
            const v = getVariant(hit.variantId);
            return `
              <button class="row tap" data-variant="${h(v.id)}">
                ${Can({ variant: v, size: 45 })}
                <span class="row-text">
                  <span class="row-title">${h(v.fullName)}</span>
                  <span class="row-sub">${h(isolate(hit.store.name))} · ${h(distanceLabel(hit.store, hit.metres))} · ${h(relativeTime(hit.seenAt, app.now))}</span>
                </span>
                <span class="row-price">${h(ils(hit.price))}</span>
              </button>`;
          })
          .join("")
      : `<div class="empty-row">No shelf ${wide ? "in the dataset" : "within 25 km"} lists that.</div>`;
    html += `</div>`;

    if (missing.length) {
      html += `<div class="kicker k-top">Known, but not nearby</div><div class="group">`;
      html += missing
        .map(
          (v) => `
          <button class="row tap" data-variant="${h(v.id)}">
            ${Can({ variant: v, size: 45, dim: true })}
            <span class="row-text">
              <span class="row-title" style="color:rgba(234,240,234,.65)">${h(v.fullName)}</span>
              <span class="row-sub">${wide ? "Not on any shelf Energy Radar can see right now" : "Not on any shelf within 25 km"}</span>
            </span>
            <span class="muted">—</span>
          </button>`,
        )
        .join("");
      html += `</div>`;
    }

    if (storeHits.length) {
      html += `<div class="kicker k-top">Stores</div><div class="group">`;
      html += storeHits
        .map(
          ({ store, metres }) => `
          <button class="row tap" data-store="${h(store.id)}">
            ${Icons.Storefront({ size: 18, color: "rgba(234,240,234,.5)" })}
            <span class="row-text">
              <span class="row-title">${h(store.name)}</span>
              <span class="row-sub">${h(isolate(chainLabel(store.chain)))} · ${h(distanceLabel(store, metres))} · ${store.shelf.length} variants</span>
            </span>
          </button>`,
        )
        .join("");
      html += `</div>`;
    }

    if (!q) {
      html += `<div class="kicker k-top">Try</div><div class="suggestions">`;
      html += ["ultra", "zero sugar", "mango", "rare", "5060639128051"]
        .map((s) => `<button class="chip tap" data-suggest="${h(s)}">${h(s)}</button>`)
        .join("");
      html += `</div>`;
    }

    results.innerHTML = html;

    results.onclick = (e) => {
      const v = e.target.closest("[data-variant]");
      if (v) return app.go("variant", v.dataset.variant);
      const s = e.target.closest("[data-store]");
      if (s) return app.go("store", s.dataset.store);
      const sug = e.target.closest("[data-suggest]");
      if (sug) {
        input.value = sug.dataset.suggest;
        draw();
      }
    };
  }

  return {
    onShow(query) {
      if (typeof query === "string") input.value = query;
      draw();
      input.focus();
    },
    update: draw,
  };
}

/* ── store ───────────────────────────────────────────────────────────── */

/**
 * How this shelf's price compares to the same can everywhere else.
 *
 * Six rows of "₪9.90" is a list with nothing to read. The national median
 * per flavour is already computed by the pipeline and shipped in
 * stats.json, so each row can say whether this branch is under or over it —
 * which is both the missing information and the missing colour.
 */
function priceDelta(app, variantId, price) {
  const median = app.stats?.price_by_variant?.[variantId]?.median;
  if (typeof median !== "number") return null;
  const diff = +(price - median).toFixed(2);
  if (Math.abs(diff) < 0.05) return { label: "average", tone: "mid" };
  return diff < 0
    ? { label: `${ils(Math.abs(diff))} under`, tone: "good" }
    : { label: `${ils(diff)} over`, tone: "high" };
}

/**
 * What a branch is usually like, in a few words.
 *
 * A shelf listing tells you about one moment; before walking somewhere you
 * want to know what the place is normally like. Most of these come from
 * `store.tags`, which pipeline.py works out from the price archive — the
 * site never sees that archive, so it cannot derive them itself.
 *
 * `title` carries the rule behind each one, because a badge whose meaning
 * you have to guess is decoration.
 */
const TAG_META = {
  reliable: {
    label: "Usually has it",
    tone: "good",
    why: "Monster was on this shelf on at least 85% of the days since this branch first appeared in the data.",
  },
  intermittent: {
    label: "Comes and goes",
    tone: "warn",
    why: "Monster was missing from this branch on more than 40% of the days since it first appeared.",
  },
  new: {
    label: "New here",
    tone: "",
    why: "This branch has only been in the dataset a few days, so there is not enough history to judge it yet.",
  },
  wide: {
    label: "Wide range",
    tone: "",
    why: "Eight or more flavours on the shelf — most branches carry fewer.",
  },
  cheap: {
    label: "Cheap for the chain",
    tone: "good",
    why: "This branch's median price is at least ₪0.20 below the median across its whole chain.",
  },
  sells_fast: {
    label: "Sells steadily",
    tone: "good",
    why: "Most cans here are still being rung up recently, rather than sitting unsold.",
  },
  runs_out: {
    label: "Often runs out",
    tone: "warn",
    why: "Two or more flavours here sold regularly and then went quiet, which usually means an empty shelf.",
  },
  delivery: {
    label: "Delivery only",
    tone: "warn",
    why: "A dark store: real stock at a real address, picked by couriers. There is no shop floor, so this one comes to you rather than you to it.",
  },
  deal_regular: {
    label: "Often has deals",
    tone: "good",
    why: "This branch has been running a promotion on at least 40% of the days since Energy Radar started keeping a record of them.",
  },
};

function storeTags(store, dealCount) {
  const tags = (store.tags ?? [])
    .filter((id) => TAG_META[id])
    .map((id) => TAG_META[id]);

  // Not from the archive: promotions.json is rewritten whole every run and
  // no history of it is kept, so this can only ever say what is running
  // now — never that a branch runs deals *often*.
  if (dealCount > 0) {
    tags.unshift({
      label: dealCount === 1 ? "1 deal on now" : `${dealCount} deals on now`,
      tone: "hot",
      why: "Deals published by the chain for this branch right now. Energy Radar keeps no history of promotions, so this says nothing about how often this branch runs them.",
    });
  }
  return tags;
}

export function createStoreScreen(root, app) {
  let storeId = null;
  let map = null;
  let marker = null;

  /*
   * The page is built once and only its body is redrawn, because the mini
   * map has to survive between stores — a MapLibre instance per store would
   * be a new GL context every time you tapped a shelf.
   */
  root.innerHTML = `
    <div class="sheet">
      <div class="mini-map" id="mini-map">
        <button class="back floating tap" id="back" aria-label="Back"></button>
        <button class="mini-open tap" id="mini-open">Open on the map</button>
      </div>
      <div id="store-body"></div>
    </div>`;

  const body = root.querySelector("#store-body");
  root.querySelector("#back").innerHTML = Icons.CaretLeft({ size: 15, color: "#eaf0ea" });
  root.querySelector("#back").onclick = () => app.back();
  root.querySelector("#mini-open").onclick = () => {
    const store = app.storeById.get(storeId);
    if (store) app.go("map", store.id);
  };

  /** Non-interactive on purpose: it is a picture of where the shop is, and
   *  a map inside a scrolling page that eats drags is a trap. */
  function ensureMap(store) {
    if (!map) {
      map = new maplibregl.Map({
        container: root.querySelector("#mini-map"),
        style: MAP_STYLE,
        center: [store.lng, store.lat],
        zoom: 15.2,
        pitch: PITCH_3D,
        interactive: false,
        attributionControl: false,
      });
    }
    map.resize();
    map.jumpTo({ center: [store.lng, store.lat], zoom: 15.2, pitch: PITCH_3D });

    const node = marker?.getElement() ?? document.createElement("div");
    node.className = "mini-pin";
    node.innerHTML = `<span class="ring" style="width:44px;height:44px;color:rgba(0,255,65,.5)"></span><span class="mini-dot"></span>`;
    if (!marker) marker = new maplibregl.Marker({ element: node }).setLngLat([store.lng, store.lat]).addTo(map);
    else marker.setLngLat([store.lng, store.lat]);
  }

  function draw() {
    const store = app.storeById.get(storeId);
    if (!store) {
      body.innerHTML = `<div class="notice"><div class="notice-title">That shelf is no longer in the dataset.</div></div>`;
      return;
    }

    const shelf = [...store.shelf].sort((a, b) => a.price - b.price);
    const best = cheapest(store);
    const bestVariant = getVariant(best.variantId);
    const metres = distanceM(app.coord, store);
    const deals = promosAtStore(app.promotions, store, getVariant);

    // Price spread for the store's cheapest flavour, always including this
    // store — the app learned the hard way that a spread chart which drops
    // the branch you are looking at is the one case where it matters most.
    const all = app.stores.flatMap((s) =>
      s.shelf.filter((r) => r.variantId === best.variantId).map((r) => ({ s, r })),
    );
    const mine = all.filter((x) => x.s.id === store.id);
    const others = all
      .filter((x) => x.s.id !== store.id)
      .sort((a, b) => a.r.price - b.r.price)
      .slice(0, Math.max(0, 10 - mine.length));
    const rows = [...others, ...mine].sort((a, b) => a.r.price - b.r.price);
    const max = Math.max(...rows.map((x) => x.r.price), best.price);
    const min = Math.min(...rows.map((x) => x.r.price), best.price);
    const cheaper = rows.filter((x) => x.r.price < best.price).length;

    const tags = storeTags(store, deals.length);
    const bestDelta = priceDelta(app, best.variantId, best.price);
    const priceRange =
      shelf.length > 1 && shelf[0].price !== shelf[shelf.length - 1].price
        ? `${ils(shelf[0].price)}–${ils(shelf[shelf.length - 1].price)}`
        : ils(best.price);
    const freshest = shelf.reduce((a, r) => (r.seenAt > a.seenAt ? r : a), shelf[0]);

    body.innerHTML = `
        <div class="store-head">
          <span class="chain-tag" style="--chain:${h(chainColor(store.chain))}">${h(chainLabel(store.chain))}</span>
          ${store.closesAt ? `<span class="open-label">${Icons.Clock({ size: 12, color: "#00ff41", weight: "fill" })}${store.closesAt === "24h" ? "Open 24 hours" : `Open until ${h(store.closesAt)}`}</span>` : ""}
        </div>

        <div class="detail-name">${h(store.name)}</div>
        <div class="detail-addr">${h(isolate(store.address))} · ${h(walkLabel(store, metres))}</div>
        ${
          store.approximate
            ? `<div class="approx-note">Approximate — this branch is listed only as ${h(isolate(store.city))}, with no street address.</div>`
            : ""
        }

        ${
          tags.length
            ? `<div class="tag-row">${tags
                .map(
                  (t) =>
                    `<span class="tag ${h(t.tone)}" title="${h(t.why)}">${h(t.label)}</span>`,
                )
                .join("")}</div>`
            : ""
        }

        <!-- The answer, before the list. Every other screen in the app leads
             with the number; this one used to bury it in row four. -->
        <div class="store-hero">
          <span class="store-hero-glow"></span>
          <div class="store-hero-can">${Can({ variant: bestVariant, size: 104, hero: true, animated: true })}</div>
          <div class="store-hero-text">
            <div class="kicker">Cheapest here</div>
            <div class="store-hero-price">${h(ils(best.price))}</div>
            <div class="store-hero-name">${h(bestVariant.fullName)}</div>
            ${
              bestDelta
                ? `<span class="delta ${h(bestDelta.tone)}">${
                    bestDelta.tone === "mid"
                      ? "At the national median"
                      : `${h(bestDelta.label)} the national median`
                  }</span>`
                : ""
            }
          </div>
        </div>

        <div class="stats">
          <div class="card"><div class="stat-v">${shelf.length}</div><div class="stat-k">flavours here</div></div>
          <div class="card"><div class="stat-v" style="font-size:14px">${h(priceRange)}</div><div class="stat-k">price range</div></div>
          <div class="card"><div class="stat-v" style="font-size:14px">${h(relativeTime(freshest.seenAt, app.now))}</div><div class="stat-k">last sold</div></div>
        </div>

        <button class="ghost tap" id="directions">
          ${Icons.NavigationArrow({ size: 14, color: "#00ff41", weight: "fill" })}Directions
        </button>

        <div class="kicker k-top">On the shelf · ${shelf.length}</div>
        <div class="group">
          ${shelf
            .map((row, i) => {
              const v = getVariant(row.variantId);
              const status = stockStatus(row, app.now);
              const why =
                status === "likely_out"
                  ? "sold regularly here, then stopped"
                  : row.source === "official_feed"
                    ? `official feed, sold ${relativeTime(row.seenAt, app.now)}`
                    : row.source === "featured"
                      ? "listed by the store"
                      : `hunter photo, ${relativeTime(row.seenAt, app.now)}`;
              const delta = priceDelta(app, v.id, row.price);
              // Only the first row: at a branch where every can is the
              // same price this was crowning all six, which says nothing.
              const isBest = i === 0 && shelf.length > 1;
              return `
                <button class="row tap${isBest ? " row-best" : ""}" data-variant="${h(v.id)}">
                  <span class="row-can">
                    ${Can({ variant: v, size: 45, dim: status === "unconfirmed" || status === "likely_out" })}
                    ${isBest ? `<span class="row-crown">${Crown({ size: 11, color: "#0a0b0a" })}</span>` : ""}
                  </span>
                  <span class="row-text">
                    <span class="row-title">${h(v.fullName)}</span>
                    <span class="row-sub" style="display:flex;align-items:center;gap:6px">
                      <span class="stock-dot ${h(status)}"></span>${h(STOCK_LABEL[status])} · ${h(why)}
                    </span>
                  </span>
                  <span class="row-money">
                    <span class="row-price" style="${isBest ? "" : "color:#eaf0ea"}">${h(ils(row.price))}</span>
                    ${delta ? `<span class="delta ${h(delta.tone)}">${h(delta.label)}</span>` : ""}
                  </span>
                </button>`;
            })
            .join("")}
        </div>

        ${deals.length ? `<div class="kicker k-top">Current deals</div><div class="group">${deals.map((p) => promoCard(p)).join("")}</div>` : ""}

        <div class="kicker k-top">Price spread · ${h(bestVariant.name)}</div>
        <div class="card">
          <div class="bars">
            ${rows
              .map(({ s, r }) => {
                const height = 22 + ((r.price - min) / Math.max(0.01, max - min)) * 56;
                const here = s.id === store.id;
                return `
                  <span class="bar-col">
                    <span class="bar${here ? " here" : ""}" style="height:${height.toFixed(1)}px"></span>
                    <span class="bar-label${here ? " here" : ""}">${h(here ? "here" : shortCity(s.city))}</span>
                  </span>`;
              })
              .join("")}
          </div>
          <div class="chart-foot">
            <span class="chart-price">${h(ils(best.price))}</span>
            <span class="chart-meta">${
              cheaper === 0
                ? "cheapest shelf Energy Radar can see for this variant"
                : `${cheaper} ${cheaper === 1 ? "shelf" : "shelves"} cheaper, from ${h(ils(min))}`
            }</span>
          </div>
        </div>

        <div class="footnote">
          Stock status is an estimate from two things: how fresh this price is, and whether the chain's own
          files show this flavour still being rung up at this branch. Neither is a live look at the shelf —
          a can may already be gone even when it reads "In stock".
        </div>`;

    // Built here rather than in onShow: opening a store link directly runs
    // onShow before the store data exists, and only draw() is re-run once it
    // arrives. Guarded on visibility because MapLibre cannot measure itself
    // inside a display:none screen, and update() redraws hidden screens too.
    if (root.classList.contains("on")) ensureMap(store);

    body.querySelector("#directions").onclick = () => openDirections(store);
    body.onclick = (e) => {
      const v = e.target.closest("[data-variant]");
      if (v) app.go("variant", v.dataset.variant);
    };
  }

  return {
    onShow(id) {
      storeId = id;
      root.querySelector(".sheet")?.scrollTo(0, 0);
      draw();
    },
    update: draw,
  };
}

/* ── flavour ─────────────────────────────────────────────────────────── */

export function createVariantScreen(root, app) {
  let variantId = null;

  function draw() {
    const variant = getVariant(variantId);

    const listings = app.stores
      .flatMap((s) => s.shelf.filter((r) => r.variantId === variant.id).map((r) => ({ s, r })))
      .map((x) => ({ ...x, metres: distanceM(app.coord, x.s) }))
      .sort((a, b) => a.metres - b.metres);

    // "Cheapest nearby" has to mean nearby, or the number under it is a
    // price in a town four hours away. Within reach if anything is; the
    // whole country only when nothing is, and then the label says so.
    const NEARBY_M = 25_000;
    const inRange = listings.filter((l) => l.metres <= NEARBY_M);
    const priced = inRange.length ? inRange : listings;
    const lowest = priced.length ? Math.min(...priced.map((l) => l.r.price)) : null;
    const deals = promosForVariant(app.promotions, variant.id);

    // "—" rather than a plausible-looking number: these are real nutrition
    // facts people may be choosing on, and a guess is indistinguishable on
    // screen from a sourced figure.
    const stats = [
      {
        v: lowest !== null ? ils(lowest) : "—",
        k: inRange.length ? "cheapest within 25 km" : "cheapest in the country",
        accent: true,
      },
      { v: variant.caffeineMg !== null ? `${variant.caffeineMg} mg` : "—", k: "caffeine" },
      { v: variant.zeroSugar ? "0 g" : variant.sugarG !== null ? `${variant.sugarG} g` : "—", k: "sugar" },
    ];

    root.innerHTML = `
      <div class="sheet">
        <button class="back tap" id="back">${Icons.CaretLeft({ size: 15, color: "#eaf0ea" })}</button>

        <div class="variant-stage">
          <span class="variant-glow"></span>
          ${Can({ variant, size: 268, hero: true, animated: true })}
        </div>

        <div class="variant-rarity">${
          listings.length === 0
            ? "No shelf lists it right now"
            : inRange.length
              ? `${inRange.length} ${inRange.length === 1 ? "shelf" : "shelves"} within 25 km · ${listings.length} in the country`
              : `${listings.length} ${listings.length === 1 ? "shelf" : "shelves"} in the country, none nearby`
        }</div>
        <div class="variant-name">${h(variant.name)}</div>
        <div class="variant-blurb">${h(variant.blurb)}</div>

        <div class="stats">
          ${stats
            .map(
              (s) => `<div class="card">
                <div class="stat-v"${s.accent ? ' style="color:#00ff41"' : ""}>${h(s.v)}</div>
                <div class="stat-k">${h(s.k)}</div>
              </div>`,
            )
            .join("")}
        </div>

        <div class="barcode">${
          variant.barcode
            ? `Barcode ${h(variant.barcode)} · ${h(variant.sizeMl)} ml`
            : `No barcode confirmed in the price feed yet · ${h(variant.sizeMl)} ml`
        }</div>

        ${deals.length ? `<div class="kicker k-top">Current deals</div><div class="group">${deals.map(({ promo, storeCount }) => promoCard(promo, storeCount)).join("")}</div>` : ""}

        <div class="kicker k-top">Closest shelves</div>
        <div class="group">
          ${
            listings.length
              ? listings
                  .slice(0, 8)
                  .map(
                    ({ s, r, metres }) => `
                <button class="row tap" data-store="${h(s.id)}">
                  <span class="row-text">
                    <span class="row-title-line">
                      <span class="row-title">${h(s.name)}</span>
                      <span class="pill">${h(chainLabel(s.chain))}</span>
                    </span>
                    <span class="row-sub">${h(distanceLabel(s, metres))} · ${
                      r.source === "official_feed"
                        ? `official feed · ${h(relativeTime(r.seenAt, app.now))}`
                        : `${h(r.qty ?? "?")} on shelf · ${h(relativeTime(r.seenAt, app.now))}`
                    }</span>
                  </span>
                  <span class="row-price">${h(ils(r.price))}</span>
                </button>`,
                  )
                  .join("")
              : `<div class="empty-row">Nothing in range lists this one right now.</div>`
          }
        </div>
      </div>`;

    root.querySelector("#back").onclick = () => app.back();
    root.querySelector(".sheet").onclick = (e) => {
      const s = e.target.closest("[data-store]");
      if (s) app.go("store", s.dataset.store);
    };
  }

  return {
    onShow(id) {
      variantId = id;
      root.querySelector(".sheet")?.scrollTo(0, 0);
      draw();
    },
    update: draw,
  };
}
