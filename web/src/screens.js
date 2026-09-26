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
import {
  Can,
  Icons,
  VARIANTS,
  getVariant,
  cheapest,
  chainLabel,
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
                  <span class="row-sub">${h(isolate(hit.store.name))} · ${h(prettyDistance(hit.metres))} · ${h(relativeTime(hit.seenAt, app.now))}</span>
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
              <span class="row-sub">${h(isolate(chainLabel(store.chain)))} · ${h(prettyDistance(metres))} · ${store.shelf.length} variants</span>
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

export function createStoreScreen(root, app) {
  let storeId = null;

  function draw() {
    const store = app.storeById.get(storeId);
    if (!store) {
      root.innerHTML = `<div class="sheet"><div class="notice"><div class="notice-title">That shelf is no longer in the dataset.</div></div></div>`;
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

    root.innerHTML = `
      <div class="sheet">
        <div class="hero-band">
          <div class="hero-cans">
            ${shelf.slice(0, 3).map((r, i) => Can({ variant: getVariant(r.variantId), size: i === 1 ? 92 : 74 })).join("")}
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="back tap" id="back">${Icons.CaretLeft({ size: 15, color: "#eaf0ea" })}</button>
        </div>

        <div class="open-row">
          <span class="chain-pill">${h(chainLabel(store.chain))}</span>
          ${store.closesAt ? `${Icons.Clock({ size: 12, color: "#00ff41", weight: "fill" })}<span class="open-label">${store.closesAt === "24h" ? "Open 24 hours" : `Open until ${h(store.closesAt)}`}</span>` : ""}
          ${deals.length ? `<span class="deal-pill">${Icons.Flame({ size: 10, color: "#ff5a2e" })}${deals.length} ${deals.length === 1 ? "deal" : "deals"}</span>` : ""}
        </div>

        <div class="detail-name">${h(store.name)}</div>
        <div class="detail-addr">${h(isolate(store.address))} · ${walkMinutes(metres)} min walk · ${h(prettyDistance(metres))}</div>
        ${
          store.approximate
            ? `<div class="approx-note">Approximate — this branch is listed only as ${h(isolate(store.city))}, with no street address.</div>`
            : ""
        }

        <button class="ghost tap" id="directions">
          ${Icons.NavigationArrow({ size: 14, color: "#00ff41", weight: "fill" })}Directions
        </button>

        <div class="kicker k-top">On the shelf · ${shelf.length}</div>
        <div class="group">
          ${shelf
            .map((row) => {
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
              return `
                <button class="row tap" data-variant="${h(v.id)}">
                  ${Can({ variant: v, size: 45, dim: status === "unconfirmed" || status === "likely_out" })}
                  <span class="row-text">
                    <span class="row-title">${h(v.fullName)}</span>
                    ${v.barcode ? `<span class="row-sub" style="font-variant-numeric:tabular-nums">${h(v.barcode)}</span>` : ""}
                    <span class="row-sub" style="display:flex;align-items:center;gap:6px">
                      <span class="stock-dot ${h(status)}"></span>${h(STOCK_LABEL[status])} · ${h(why)}
                    </span>
                  </span>
                  <span class="row-price" style="${row.price === best.price ? "" : "color:#eaf0ea"}">${h(ils(row.price))}</span>
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
        </div>
      </div>`;

    root.querySelector("#back").onclick = () => app.back();
    root.querySelector("#directions").onclick = () => openDirections(store);
    root.querySelector(".sheet").onclick = (e) => {
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
          ${Can({ variant, size: 268, hero: true })}
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
                    <span class="row-sub">${h(prettyDistance(metres))} · ${
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
