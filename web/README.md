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
| Map | `src/map.js` | MapLibre GL with the app's own style object and 62° pitch, supercluster, can pins, the focused-pin bubble |
| Search | `src/screens.js` | flavour-first, filter chips, "known but not nearby" |
| Store | `src/screens.js` | shelf with stock dots, deals, price spread |
| Flavour | `src/screens.js` | hero can, figures, deals, closest shelves |
| Stats | `src/stats.js` | the website's second purpose — market analysis |

There is **no profile**. The app's Me tab holds saved shelves, alerts, the
drink log and a streak, all of which are per-device state tied to an account
the website does not have. Stats takes that tab slot instead: analysis is
something a public page can do that a phone in your pocket cannot.

## Data

Read over the network from the repo (`data/latest.json`, `promotions.json`,
`stats.json`), the same three files the phone app reads. On localhost it
reads the working tree instead so a pipeline change can be seen before it is
pushed.

The price history (`data/history/*.ndjson`) is never fetched — it is tens of
megabytes and grows every run. The pipeline folds it to one row per day and
ships that as `stats.timeline`, which is what the trend chart draws.
