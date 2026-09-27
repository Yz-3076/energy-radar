# web — the Energy Radar app, in a browser

Builds to `docs/app/`, which GitHub Pages serves at `/app/`. The landing page
at `docs/index.html` stays what it is: an overview of the dataset. This is the
thing you actually use — the same map, the same cans, the same search as the
phone app.

```bash
npm install
npm run build      # -> ../docs/app/
npm run watch      # rebuild on change, with a sourcemap
```

To look at it locally, serve the **repo root** (not `docs/`) and open
`/docs/app/`, so the page can read `data/` from the working tree:

```bash
py -m http.server 8124
```

## Why it imports the app instead of copying it

`src/shared.ts` re-exports the mobile app's own modules — the flavour
catalogue, `Can.tsx`, `Crown.tsx`, the icon set, the map style, the filter
definitions, the stock heuristic, the palette. esbuild resolves `@/` to
`../mobile/src` (see `tsconfig.json`) and bundles them.

The alternative was a second copy of all of it. That copy would have been
wrong within a week: change a can's artwork or the freshness window in the
app, and the website would quietly keep showing the old one. Nothing here
can drift, because there is only one definition of any of it.

The drawing components are React Native components, which the browser cannot
run. `src/shim/` solves that rather than forking them:

- `shim/react/jsx-runtime.js` — a JSX runtime that calls the component and
  concatenates the result, so a component tree evaluates to an HTML string.
- `shim/react/index.js` — `memo` (identity) and `useId` (a counter), the only
  two React APIs these components use.
- `shim/react-native-svg.js` — `Svg`, `Path`, `G`, `Defs`, `LinearGradient`
  and friends as string builders, translating camelCase props to SVG
  attributes.

`build.mjs` aliases `react` and `react-native-svg` to those. The result is
that `Can({ variant, size: 52 })` returns SVG markup, and the website draws
exactly the can the app draws, down to the gradient stops.

This only works for modules free of React Native's runtime. Screens, layout
and navigation are rebuilt for the browser in `src/*.js`.

## What is here, and what is deliberately not

| screen | file | notes |
| --- | --- | --- |
| Map | `src/map.js` | MapLibre GL with the app's own style object and 62° pitch, supercluster, can pins, and the detail card a pin opens |
| Search | `src/screens.js` | flavour-first, filter chips, "known but not nearby" |
| Store | `src/screens.js` | shelf with stock dots, deals, price spread |
| Flavour | `src/screens.js` | hero can, figures, deals, closest shelves |

That is the whole app: **find a cold can near you**. Two things are
deliberately absent.

There is **no profile**. The app's Me tab holds saved shelves, alerts, the
drink log and a streak — all per-device state tied to an account the website
does not have.

There are **no statistics in here either**. They have two pages of their own
at the site root (`docs/index.html` and `docs/analysis.html`) which are older,
richer and already linked from everywhere. A Stats screen briefly lived in
this app and was removed: it was a third, worse copy of those pages inside a
map. The dock's right tab now opens them instead, naming both destinations
and what is on each, and both pages carry an "Open the live map" button back.

## Data

Read over the network from the repo (`data/latest.json`, `promotions.json`,
`stats.json`), the same three files the phone app reads. On localhost it
reads the working tree instead so a pipeline change can be seen before it is
pushed.

The price history (`data/history/*.ndjson`) is never fetched here — 55 MB on
disk, 4.3 MB gzipped, and it grows every run. The pipeline folds it to one
row per day and publishes that as `stats.timeline`. Nothing reads that field
yet; it exists because `docs/index.html` and `docs/analysis.html` still do
download the whole archive to draw their charts, and that is the fix waiting
for them when it starts to hurt.
