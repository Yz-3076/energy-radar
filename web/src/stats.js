/**
 * Stats — the website's second purpose, and the one thing here the phone
 * app does not have.
 *
 * The app answers "where is a cold Monster, and what does it cost". This
 * answers "what is the Israeli Monster market actually doing" — who is
 * cheapest, which flavours are stocked, what the price has done over time.
 * It takes the tab slot the app gives to Me, which is deliberate: the
 * website has no account, no saved shelves and no profile, so a personal
 * tab here would be an empty room. Analysis is what a public page can
 * offer that a phone in your pocket cannot.
 *
 * Every number is derived from data already on disk. `stats.json` carries
 * the pre-aggregated figures the pipeline computes (including the daily
 * timeline); anything that needs today's shelves is computed from the same
 * latest.json the map draws.
 */
import { Can, getVariant, chainLabel, ils, VARIANTS } from "./shared.ts";
import { h, isolate } from "./ui.js";

/** Bars sorted big-to-small, the largest highlighted. */
function hbars(rows, format) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return rows
    .map(
      (r, i) => `
      <div class="hbar-row">
        <span class="hbar-name" title="${h(r.name)}">${h(r.name)}</span>
        <span class="hbar-track"><span class="hbar-fill${i === 0 ? " hot" : ""}" style="width:${((r.value / max) * 100).toFixed(1)}%"></span></span>
        <span class="hbar-val">${h(format(r.value))}</span>
      </div>`,
    )
    .join("");
}

/**
 * The price trend as an SVG line with a filled area beneath.
 *
 * Median, not mean: the feed occasionally carries a mispriced line, and one
 * ₪0.10 or ₪130 row should not bend the curve everyone reads.
 */
function sparkline(timeline) {
  if (timeline.length < 2) return "";
  const W = 320;
  const H = 130;
  const pad = 16;
  const values = timeline.map((d) => d.median);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(0.2, hi - lo);
  const x = (i) => pad + (i / (timeline.length - 1)) * (W - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);

  const line = timeline.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.median).toFixed(1)}`).join(" ");
  const area = `${line} L${x(timeline.length - 1).toFixed(1)},${H - pad} L${pad},${H - pad} Z`;
  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return `
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="Median shelf price from ${h(day(first.date))} to ${h(day(last.date))}">
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#00ff41" stop-opacity="0.26"/>
          <stop offset="1" stop-color="#00ff41" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#sparkfill)"/>
      <path d="${line}" fill="none" stroke="#00ff41" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(timeline.length - 1).toFixed(1)}" cy="${y(last.median).toFixed(1)}" r="3.5" fill="#00ff41"/>
    </svg>
    <div class="chart-foot">
      <span class="chart-price">${h(ils(last.median))}</span>
      <span class="chart-meta">median shelf price, ${h(day(first.date))} – ${h(day(last.date))} · low ${h(ils(lo))}, high ${h(ils(hi))}</span>
    </div>`;
}

export function createStatsScreen(root, app) {
  function draw() {
    const s = app.stats;
    const stores = app.stores;

    if (!s && !stores.length) {
      root.innerHTML = `<div class="sheet"><div class="notice">
        <div class="notice-title">The numbers did not load.</div>
        <div class="notice-body">Reload the page. If it keeps happening the data files may be mid-update — the pipeline rewrites them a few times a day.</div>
      </div></div>`;
      return;
    }

    /* Headline counters. Prefer the pipeline's own figures, fall back to
       counting what the map is holding, so the page still says something
       true if stats.json is the one file that failed. */
    const liveListings = s?.live_listings ?? stores.reduce((n, st) => n + st.shelf.length, 0);
    const storeCount = s?.store_count ?? stores.length;
    const flavours = s?.flavours_on_shelves ?? new Set(stores.flatMap((st) => st.shelf.map((r) => r.variantId))).size;
    const observations = s?.total_observations ?? null;

    const chains = Object.entries(s?.stores_per_chain ?? {}).map(([name, value]) => ({
      name: chainLabel(name),
      value,
    }));

    // Cheapest chain by median. Chains with only a handful of listings are
    // excluded — a single ₪6.80 branch should not crown a chain as the
    // country's cheapest.
    const MIN_LISTINGS = 40;
    const byChain = Object.entries(s?.price_by_chain ?? {})
      .filter(([, v]) => v.listings >= MIN_LISTINGS)
      .map(([name, v]) => ({ name: chainLabel(name), ...v }))
      .sort((a, b) => a.median - b.median);
    const thin = Object.values(s?.price_by_chain ?? {}).filter((v) => v.listings < MIN_LISTINGS).length;

    // Bars are scaled across the chains actually on screen, not from zero and
    // not against a chain that was cut from the list. Every chain sells the
    // same 500 ml can, so the medians all sit within about two shekels of each
    // other — from a zero baseline every bar is 85–100% long and the chart
    // says nothing at all. The exact price is printed beside each bar.
    const shownChains = byChain.slice(0, 12);
    const chainLo = shownChains.length ? shownChains[0].median : 0;
    const chainHi = shownChains.length ? shownChains[shownChains.length - 1].median : 0;
    const chainSpan = Math.max(0.01, chainHi - chainLo);

    const byVariant = Object.entries(s?.price_by_variant ?? {})
      .map(([id, v]) => ({ id, variant: getVariant(id), ...v }))
      .sort((a, b) => a.median - b.median);

    const shelfCounts = Object.entries(s?.listings_per_variant ?? {})
      .map(([id, value]) => ({ id, name: getVariant(id).name, value }))
      .sort((a, b) => b.value - a.value);

    const missing = VARIANTS.filter((v) => !(s?.listings_per_variant ?? {})[v.id]);

    const dep = s?.depletion_breakdown ?? {};
    const depTotal = Object.values(dep).reduce((a, b) => a + b, 0);

    const cheapest = s?.cheapest_listing ?? null;
    const timeline = Array.isArray(s?.timeline) ? s.timeline : [];

    const generated = s?.generated_at
      ? new Date(s.generated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : null;

    root.innerHTML = `
      <div class="sheet">
        <div class="kicker">The market</div>
        <h1 class="detail-name" style="margin-top:6px">Monster in Israel, by the numbers</h1>
        <div class="detail-addr">
          Every figure below comes from the chains' own published price files, collected a few times a day.
          ${generated ? `Last collected ${h(generated)}.` : ""}
        </div>

        <div class="kicker k-top">Right now</div>
        <div class="stat-grid">
          <div class="card"><div class="big-num">${liveListings.toLocaleString()}</div><div class="big-k">cans listed on shelves</div></div>
          <div class="card"><div class="big-num">${storeCount.toLocaleString()}</div><div class="big-k">stores carrying Monster</div></div>
          <div class="card"><div class="big-num">${flavours}</div><div class="big-k">flavours in the country</div></div>
          <div class="card"><div class="big-num">${chains.length || (s?.chains_covered?.length ?? 0)}</div><div class="big-k">chains tracked</div></div>
        </div>

        ${
          cheapest
            ? `<div class="kicker k-top">Cheapest can in the country</div>
              <div class="card" style="display:flex;align-items:center;gap:14px">
                ${Can({ variant: getVariant(cheapest.variantId), size: 62 })}
                <div style="flex:1;min-width:0">
                  <div class="stat-v" style="font-size:26px;color:var(--accent)">${h(ils(cheapest.price))}</div>
                  <div class="row-sub" style="font-size:11.5px">${h(getVariant(cheapest.variantId).fullName)}</div>
                  <div class="row-sub">${h(isolate(cheapest.storeName))} · ${h(chainLabel(cheapest.chain))}</div>
                </div>
                <button class="chip tap" data-store="${h(cheapest.storeId)}">Open</button>
              </div>`
            : ""
        }

        ${
          timeline.length > 1
            ? `<div class="kicker k-top">Price over time</div>
              <div class="card">${sparkline(timeline)}</div>
              <div class="footnote">
                One point per day, taken across every listing that day — not one store's price.
                The line moves when chains reprice or when a new chain joins the dataset and brings
                its own price level with it.
              </div>`
            : ""
        }

        ${
          byChain.length
            ? `<div class="kicker k-top">Who is actually cheapest · shorter is cheaper</div>
              <div class="card">
                ${shownChains
                  .map(
                    (c, i) => `
                  <div class="hbar-row">
                    <span class="hbar-name" title="${h(c.name)}">${h(c.name)}</span>
                    <span class="hbar-track">
                      <span class="hbar-fill${i === 0 ? " hot" : ""}" style="width:${(14 + ((c.median - chainLo) / chainSpan) * 86).toFixed(1)}%"></span>
                    </span>
                    <span class="hbar-val">${h(ils(c.median))}</span>
                  </div>`,
                  )
                  .join("")}
              </div>
              <div class="footnote">
                Median price of every Monster listing that chain publishes, cheapest ${shownChains.length} of ${byChain.length} chains.
                ${thin ? `${thin} ${thin === 1 ? "chain is" : "chains are"} left out for having under ${MIN_LISTINGS} listings — too few to rank fairly.` : ""}
                Bar length compares these chains to each other, not to zero — the whole gap between the
                cheapest and dearest shown is ${h(ils(chainHi - chainLo))} a can.
                A median is not a promise: branches of the same chain do differ, which is what the map is for.
              </div>`
            : ""
        }

        ${
          byVariant.length
            ? `<div class="kicker k-top">Price by flavour</div>
              <div class="group">
                ${byVariant
                  .map(
                    (v) => `
                  <button class="row tap" data-variant="${h(v.id)}">
                    ${Can({ variant: v.variant, size: 40 })}
                    <span class="row-text">
                      <span class="row-title">${h(v.variant.name)}</span>
                      <span class="row-sub">${h(ils(v.min))} – ${h(ils(v.max))} across ${v.listings.toLocaleString()} listings</span>
                    </span>
                    <span class="row-price">${h(ils(v.median))}</span>
                  </button>`,
                  )
                  .join("")}
              </div>
              <div class="footnote">Median price, cheapest flavour first. The range is the real spread between the cheapest and dearest shelf in the country.</div>`
            : ""
        }

        ${
          shelfCounts.length
            ? `<div class="kicker k-top">How widely each flavour is stocked</div>
              <div class="card">${hbars(shelfCounts, (n) => `${n.toLocaleString()}`)}</div>
              ${
                missing.length
                  ? `<div class="footnote">${missing.length} ${missing.length === 1 ? "flavour is" : "flavours are"} in the catalogue but on no shelf in the dataset: ${h(missing.map((v) => v.name).join(", "))}.</div>`
                  : ""
              }`
            : ""
        }

        ${
          chains.length
            ? `<div class="kicker k-top">Stores per chain</div>
              <div class="card">${hbars(chains, (n) => `${n}`)}</div>`
            : ""
        }

        ${
          depTotal
            ? `<div class="kicker k-top">Shelf health</div>
              <div class="card">
                ${[
                  ["healthy", "Selling steadily", "in_stock"],
                  ["slowing", "Slowing down", "fading"],
                  ["likely_out", "Likely sold out", "likely_out"],
                  ["insufficient_data", "Too new to tell", ""],
                ]
                  .filter(([key]) => dep[key])
                  .map(
                    ([key, label, dot]) => `
                  <div class="hbar-row">
                    <span class="hbar-name" style="display:flex;align-items:center;gap:6px">
                      ${dot ? `<span class="stock-dot ${dot}"></span>` : ""}${h(label)}
                    </span>
                    <span class="hbar-track"><span class="hbar-fill${key === "healthy" ? " hot" : ""}" style="width:${((dep[key] / depTotal) * 100).toFixed(1)}%"></span></span>
                    <span class="hbar-val">${Math.round((dep[key] / depTotal) * 100)}%</span>
                  </div>`,
                  )
                  .join("")}
              </div>
              <div class="footnote">
                Worked out from whether each branch is still ringing this flavour up, not from anyone
                checking the shelf. "Likely sold out" means it sold regularly here and then went quiet.
              </div>`
            : ""
        }

        ${
          observations
            ? `<div class="kicker k-top">The dataset</div>
              <div class="card">
                <div class="stat-v">${observations.toLocaleString()}</div>
                <div class="stat-k">price observations recorded since tracking began${
                  timeline.length ? `, across ${timeline.length} ${timeline.length === 1 ? "day" : "days"}` : ""
                }</div>
              </div>`
            : ""
        }

        <div class="footnote">
          Prices come from the price-transparency files Israeli chains are required to publish, read
          directly from each chain's own server. Energy Radar does not set, negotiate or receive prices,
          and is not affiliated with Monster Energy or with any of the chains listed here. A published
          price can be wrong or out of date, and the shelf is the final word.
        </div>
      </div>`;

    root.querySelector(".sheet").onclick = (e) => {
      const v = e.target.closest("[data-variant]");
      if (v) return app.go("variant", v.dataset.variant);
      const st = e.target.closest("[data-store]");
      if (st) return app.go("store", st.dataset.store);
    };
  }

  return {
    onShow() {
      root.querySelector(".sheet")?.scrollTo(0, 0);
      draw();
    },
    update: draw,
  };
}
