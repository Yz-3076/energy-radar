/**
 * Design sheet: every flavour, every size, side by side.
 *
 * The whole point of the can artwork is that flavours are distinguishable
 * *from each other*, and that is a judgement you can only make with all of
 * them in one eyeline. On the phone you can see one at a time.
 *
 * Unlike mobile/scripts/preview_cans.py, which reads the path data back out
 * of Can.tsx with regular expressions, this renders the real component
 * through the real shim — the same code path the website uses. It cannot
 * show something the site would not draw.
 *
 *   npm run preview   ->  ../web/.preview/index.html
 */
import { Can, VARIANTS, color } from "./shared.ts";

const SIZES = [
  { label: "pin 52", size: 52 },
  { label: "row 45", size: 45 },
  { label: "deck 59", size: 59 },
];

const root = document.getElementById("root");

const swatch = (hex) =>
  `<span class="sw" style="background:${hex}" title="${hex}"></span>`;

root.innerHTML = `
  <header>
    <h1>Can artwork</h1>
    <p>${VARIANTS.length} flavours, rendered through the same shim the site uses.
       Hero cans are animated; pins and rows deliberately are not — there can be
       three dozen markers on screen at once.</p>
    <label class="toggle"><input type="checkbox" id="motion" checked> Animation</label>
    <label class="toggle"><input type="checkbox" id="light"> Light background</label>
  </header>

  <section class="heroes">
    ${VARIANTS.map(
      (v) => `
      <figure class="hero">
        <div class="stage">${Can({ variant: v, size: 210, hero: true, animated: true })}</div>
        <figcaption>
          <b>${v.name}</b>
          <span class="meta">${v.artwork} · ${v.body} · ${v.rarity}</span>
          <span class="meta">${swatch(v.accent)}${swatch(v.secondary)} ${v.accent} / ${v.secondary}</span>
        </figcaption>
      </figure>`,
    ).join("")}
  </section>

  <h2>At working sizes</h2>
  <table class="sizes">
    <thead><tr><th>flavour</th>${SIZES.map((s) => `<th>${s.label}</th>`).join("")}<th>dim</th></tr></thead>
    <tbody>
      ${VARIANTS.map(
        (v) => `<tr>
          <td class="nm">${v.name}</td>
          ${SIZES.map((s) => `<td>${Can({ variant: v, size: s.size })}</td>`).join("")}
          <td>${Can({ variant: v, size: 52, dim: true })}</td>
        </tr>`,
      ).join("")}
    </tbody>
  </table>

  <h2>Pin row — the real test</h2>
  <p class="note">How they read crowded together on a map at 52&nbsp;px, which is
     where nearly every can in the product is actually seen.</p>
  <div class="pinrow">${VARIANTS.map((v) => Can({ variant: v, size: 52 })).join("")}</div>
`;

document.getElementById("motion").onchange = (e) =>
  document.documentElement.classList.toggle("no-motion", !e.target.checked);
document.getElementById("light").onchange = (e) =>
  document.documentElement.classList.toggle("light", e.target.checked);

document.documentElement.style.setProperty("--accent", color.accent);
