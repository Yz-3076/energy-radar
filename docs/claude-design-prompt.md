# Prompt for Claude Design

Copy everything below into Claude Design.

---

Design the UI for **Monster Finder** — a map-based app that shows where to
buy Monster Energy drinks nearby: which store, which flavor/variant they
carry, the price, and how recently it was actually sold there.

## Brand & visual language

- **Palette**: near-black background (`#060807`), electric green accent
  (`#39ff6a`), a dimmer supporting green (`#1c7a3a`) for secondary UI, and
  pure white (`#ffffff`) reserved specifically for the one informational
  panel (see below) so it pops against the dark map.
- **Mood**: energy-drink / gaming-adjacent, high contrast, glowing accents
  — think a dark "gamer" aesthetic rather than a clean neutral productivity
  app. Green glow/bloom on interactive elements is welcome (box-shadow style
  glows, pulsing where something is "live").
- Do **not** reproduce Monster Energy's actual claw-scratch logo or
  wordmark verbatim — this is inspired by the brand's black/green energy
  aesthetic, not a literal trademark reproduction. A stylized abstract
  mark (diagonal scratch/streak motif) is the right level of reference.

## Core screen: full-bleed map

The map fills the entire viewport, edge to edge, no chrome around it.

- Dark, mostly-desaturated basemap tinted toward black/green (roads and
  labels in muted green tones, water/background near-black).
- **Top-left**: small wordmark "MONSTER FINDER" in glowing green, bold,
  letter-spaced.
- **Top-right**: a small pill-shaped legend badge, dark background, green
  border, containing a glowing green dot + the text "Glowing can = sold
  there in the last 36h".
- **Bottom-center**: a small pill that appears only while new data is
  loading for the current view (e.g. "loading stores in view…") — subtle,
  low-emphasis, fades in/out.
- **Bottom-right**: standard map zoom controls (+ / − / compass), styled
  to match the dark theme.

## Markers on the map

Two distinct marker types, both circular/badge-like at a glance:

1. **Cluster badge** (multiple stores grouped, shown when zoomed out): a
   dark circular badge with a glowing green ring border and a number in
   the center (count of stores in that group). Should read clearly even
   with several visible at once across the map.
2. **Individual store pin**: a small 3D-rendered can icon (black body,
   green abstract claw-streak graphic, metallic cap) sitting where a
   normal map pin would be, rendered at a constant on-screen size
   regardless of zoom (like an icon, not a to-scale 3D object). Some pins
   have a **pulsing green outline/glow around the can** — this means
   "sold here recently"; pins without it are dimmer/no glow.

## The core interaction: selecting a store

This is the signature interaction — design it as a distinct state/frame,
not just a tooltip:

1. User taps/clicks an individual can pin.
2. The camera/map recenters so that **the selected pin ends up roughly
   one-quarter of the way from the left edge of the screen**, leaving the
   right ~70% of the screen free.
3. A **white, rounded-corner info panel** slides in from the right edge,
   vertically centered, roughly 380px wide on desktop (nearly full-width
   on mobile), with a small pointer/tail on its left edge aiming back at
   the pin. This is the one place pure white appears in the whole UI —
   it should feel like a distinct "card" floating over the dark map.

### Info panel contents (top to bottom)

- A small "✕" close button, top-right corner of the panel.
- Chain name in small caps, muted green, bold (e.g. "RAMI LEVY").
- Store name, large bold black text (e.g. "רמי לוי פתח תקווה").
- Store address, smaller gray text below it.
- A small rounded "freshness" pill: green background + dark green text
  when recent ("Sold here 1d ago"), neutral gray pill when stale ("Last
  sold 12d ago").
- A **summary strip**: a light-gray horizontal band showing two stats
  side by side — "N variants here" and "from ₪X.XX" (lowest price
  available at this store).
- A **scrollable list of variants carried**, each row showing: flavor
  name (bold), barcode (small gray monospace-ish text beneath it), and
  price (bold green, right-aligned).

### Closing the panel

Any of these should dismiss the panel and **restore the camera to exactly
where it was before the pin was selected** (reverse the pan/zoom, don't
just snap): tapping the ✕, tapping anywhere on the dimmed map background
outside the panel, swiping the panel away, or a system/browser back
gesture. Design a subtle dark scrim/backdrop over the map while the panel
is open to reinforce that it's a modal-ish focused state, without fully
hiding the map.

## States to design as separate artboards

1. **Default map view, zoomed out** — several cluster badges + a couple
   of individual glowing/non-glowing can pins visible, legend + brand
   top bar, loading pill hidden.
2. **Zoomed in, mostly individual pins** — a mix of glowing (recent) and
   dim (stale) can pins, no clusters left.
3. **Store selected** — the full interaction state: pin shifted left,
   dark scrim, white info panel open on the right with realistic sample
   content (2–6 variant rows).
4. **Mobile portrait version** of state 3 — panel becomes closer to
   full-width, likely anchored lower on the screen or as a bottom sheet
   rather than a right-side card, given limited horizontal space.

## Motion notes (annotate, don't need to animate)

- Camera pan/zoom on selection: smooth ease, ~800ms.
- Info panel: fades and slides in from the right, ~300ms, slight
  overshoot/ease-out.
- Recent-pin glow: slow pulse (~2.5s cycle), not distracting.
