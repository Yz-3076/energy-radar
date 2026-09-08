# Monster Finder — web prototype

> Superseded by [`../mobile/`](../mobile/), the real iOS + Android app. This
> still runs and is handy for poking at the map in a desktop browser.

The "Prowl Energy Finder" Claude Design concept, built for real: an iPhone-shaped
app (402×874) with a status bar, tab bar, a genuinely 3D map, 3D can pins, and
the focused-pin → hero can + bubble interaction.

Source design: [`../design-import/`](../design-import/).

## Run

```bash
npm install
npm run dev          # http://localhost:5180
```

On a desktop window the app renders inside a phone frame (scaled to fit the
window). Under 440px wide it goes full-bleed, like the real app on a handset.
`owner.html` (the paid store-listing flow) also needs the backend in
[`../server/`](../server/) running — the map works fine without it, it just
shows no featured pins.

## Screens

| Screen | State |
|---|---|
| **Map** | 3D tilted map, filter chips, search bar, card deck, 3D/locate/layers controls |
| **Focused pin** | camera dollies the pin to the left quarter, hero can appears (drag to spin), white bubble opens beside it |
| **Search** | live flavour/store search with filter chips, cheapest-first results |
| **Nearby list** | distance-sorted store cards with Featured/Fresh/In-stock badges |
| **Store detail** | shelf photo header, full shelf list with barcodes + prices, price history |
| **Me** | stats + the "list your store" entry point |
| Vault / Alerts | placeholders — not built yet |

## How the "3D map" works

The design's map is a hand-drawn grid with rectangle "buildings" (Claude Design
can't load real tiles). This does it for real instead:

- **Stadia Maps vector basemap** (`alidade_smooth_dark`), recoloured toward
  black/green through each layer's own paint properties in `tintMapGreen()` —
  not a CSS filter over raster tiles, which is what an earlier pass did and why
  it looked muddy.
- **`pitch: 62`** for the tilted camera the design mocks up with
  `perspective(1100px) rotateX(52deg)`.
- **Real extruded buildings** — an `add3DBuildings()` `fill-extrusion` layer
  driven by the tiles' own `render_height` / `render_min_height`. That's the
  actual 3D city, rather than drawn rectangles.

Stadia allows unauthenticated tile access from **localhost/127.0.0.1** only.
Deploying anywhere else needs a free Stadia API key appended to
`STADIA_STYLE_URL` — a signup only you can do.

## Architecture notes

- **3D can pins**: one shared Three.js renderer/scene over the map, NOT a
  context per marker (browsers cap live WebGL contexts near ~16). Meshes are
  positioned each frame from `map.project([lng,lat])` through an orthographic
  camera whose frustum is the map container in pixels.
- **Can geometry** is ported from the design's `gl-can.js` (shoulder, neck, rim,
  pull-tab, tapered base), textured with our own claw-scratch label rather than
  reproducing Monster's registered wordmark. `createHeroCan()` is the large
  draggable one shown when a pin is focused; the tiny map pin hides underneath
  so the pin visually "becomes" it.
- **Viewport loading**: a Supercluster index answers "what's in this bbox at
  this zoom" on debounced moveend/zoomend. `fetchStoresInBounds()` is written as
  an async bbox query so it can become a real `GET /stores?bbox=…` without
  touching rendering code.
- **Phone scaling**: the frame is CSS-`transform: scale()`d to fit short
  windows, so everything measuring the map uses `clientWidth/clientHeight`
  (unscaled layout box), never `getBoundingClientRect()`.
- **Featured pins** (from the owner backend) get a gold outline instead of the
  green "recently sold" one, and sort first in the list — see
  [`../docs/owner-monetization.md`](../docs/owner-monetization.md).
- **No consumer paywall.** The source design had a $4.99 unlock and a $2.99/mo
  "Pro" tier; both were deliberately left out. Store owners pay, users don't.

## Known gaps

- The 3D can is still procedural. Swapping in a downloaded `.glb` means
  replacing `createCanMesh()` in `src/canModel.js` with a `GLTFLoader` load —
  blocked on picking/downloading a model (Sketchfab requires a login).
- Store coordinates are town-centre jitter, not geocoded addresses. Owner
  submissions likewise land at a placeholder point until geocoding is wired up.
- Vault / Alerts screens are placeholders.
