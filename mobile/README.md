# Prowl — Energy Finder (iOS + Android)

The real app: an Expo / React Native build of the
[Prowl Energy Finder](../design-import/) Claude Design canvas, on top of the
Monster price data described in [`../docs/israel-pipeline.md`](../docs/israel-pipeline.md).

One codebase, both platforms. Native MapLibre for the tilted 3-D map, real
three.js for the can you can spin, and every price row tagged with where it
actually came from.

## Run it

The app uses native modules (MapLibre, expo-gl), so it needs a dev build —
Expo Go can't load it.

```bash
npm install
npm run android     # device or emulator, needs Android SDK + JDK 17
npm run ios         # macOS only
```

`npx expo prebuild` regenerates `android/` and `ios/` from `app.json`; both are
gitignored and safe to delete.

**Windows path limit.** Android's C++ build writes object files whose full
path runs to ~365 characters, and Windows refuses anything over 260, so the
arm64 build fails with `ninja: Filename longer than 260 characters`. The
x86_64 emulator build squeaks under the limit. To build for a physical
device from Windows, enable long paths once, in an admin PowerShell:

```powershell
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' `
  -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
```

Moving the project to a shorter path does not get under the limit on its
own (`C:\p` still lands at ~265), and EAS builds on Linux where the limit
does not exist.

Two more things worth knowing on Android: the build wants **JDK 17**
(`JAVA_HOME="C:\Program Files\Java\jdk-17"`), and a debug APK carrying every
ABI is ~97 MB, which an emulator with a nearly-full data partition will refuse.
`./gradlew assembleRelease -PreactNativeArchitectures=x86_64` produces a
~58 MB single-ABI build that installs fine and is what the screenshots came
from.

`npm run icons` regenerates the icon module; `npm run brand-assets`
regenerates the launcher, splash and adaptive icons.

For a device build without a Mac, EAS does the iOS half in the cloud.
[`eas.json`](eas.json) already has the three profiles:

```bash
npx eas login && npx eas init      # links the project, writes the project id
npx eas build -p ios --profile preview        # installable internal build
npx eas build -p android --profile production # .aab for Play
```

The account setup — an Expo account and an Apple developer account — can only
be done by you.

### Optional backend

`../server` serves the paid store-owner listings. The app finds it automatically
at `http://<metro-host>:8790` in development; set `EXPO_PUBLIC_PROWL_API` to
point somewhere else. With the server down the map simply has no featured pins —
nothing else changes, because the dataset ships in the bundle.

## Screens

| Route | What it is |
|---|---|
| `onboarding` | Radar sweep + location permission. Shown once. |
| `(tabs)/index` | The map: tilted 3-D basemap, clustered can pins, filter chips, nearest-shelf deck, and the focused-pin state |
| `(tabs)/list` | Nearby shelves, sortable by distance / price / freshness |
| `(tabs)/vault` | Variant collection, filled by your own sightings |
| `(tabs)/alerts` | Derived alerts: tracked variants, rare finds in range, best price |
| `(tabs)/me` | Level, stats, the store-owner entry point, and where the data comes from |
| `search` | Flavour / store / barcode search, cheapest first |
| `store/[id]` | Shelf list with barcodes, provenance per row, and a price spread across nearby branches |
| `variant/[id]` | Spinnable 3-D can, nutrition, closest shelves, tracking toggle |
| `report` | Log a sighting: photo, variant, store, price, count |
| `saved`, `streak` | Tracked variants / saved shelves, and the contribution log |

## How the map works

`src/map/style.ts` is a hand-authored MapLibre style over
[OpenFreeMap](https://openfreemap.org)'s planet tiles — free, keyless, and
licensed for commercial use, so there is no map credential in the app to expire
or leak. (The web prototype recoloured Stadia's `alidade_smooth_dark` at
runtime, which only works unauthenticated from localhost.)

- Every colour is ours, written directly into the layer paint — not a CSS
  filter over someone else's basemap.
- `building-3d` is a real `fill-extrusion` driven by the tiles' own
  `render_height` / `render_min_height`. The 3-D toggle animates the camera
  pitch between 62° and 0°.
- Clustering runs in JS (`supercluster`) and renders through MapLibre
  `Marker`s, capped at 36 on screen so panning stays smooth. Cluster badges and
  can pins are both React views, which is what lets a pin be an actual drawn
  can with a pulsing "sold recently" ring.
- Focusing a pin parks it at roughly the left quarter — the framing the canvas
  designed — then the white card slides in beside it, and closing restores the
  exact camera the map had before. The offset is applied by moving the target
  centre east, **not** by asking for camera `padding`: padding hands the
  renderer an off-centre frustum, and on that path MapLibre paints red speckle
  across the extruded blocks.

## The cans

Two renderers, deliberately:

- `src/components/Can.tsx` — flat SVG, used for pins, list rows and pickers.
  Cheap enough to draw dozens of.
- `src/components/CanGL.tsx` — the hero can: real three.js geometry (shoulder,
  neck, rim, lid, pull-tab, rolled base) ported from the design's `gl-can.js`,
  running on `expo-gl`, drag to spin with momentum.

React Native has no DOM canvas, so the label texture is generated procedurally
into a `THREE.DataTexture` — body gradient, accent band, claw streaks. That
means no image asset to decode or ship, and the artwork stays an abstract
claw/accent motif rather than a reproduction of Monster's registered mark.

Each flavour is its own can, not a hue swap: the catalogue carries a shell
(the Ultra line's white can, everything else black), an accent, a second
colour and one of four marks — claw, burst, wave, split. Both renderers read
the same four fields, so a variant looks like itself at 26 px in a list and
at 260 px spinning.

Two things three.js and expo-gl disagree about, handled in `CanGL.tsx`: three
refuses WebGL 1 since r163 and detects it with `context instanceof
WebGLRenderingContext`, which an expo-gl context satisfies even when the real
context is GLES 3 — so the renderer is constructed with that global
temporarily out of scope, but only after WebGL2-only entry points confirm the
context really is one. Anywhere that check fails, or the renderer throws, the
component quietly draws the flat can at the same size instead of taking the
screen down.

Launcher, splash and adaptive icons are all derived from one source artwork,
`assets/logo.png`, by `scripts/build-brand-assets.mjs` — a hand-rolled PNG
decoder, box filter and encoder, so the toolchain still needs no image
dependency. The same mark appears at the top of onboarding and as the badge on
the map brand row, and nowhere else.

## Data honesty

The dataset is seeded from the real 2026-09-05 Shufersal price-transparency
scrape. `store-1` and `store-2` carry the **real** branches, addresses,
barcodes, prices and last-sale times that scrape returned; the rest is
synthetic density around real Israeli town centres so clustering has something
to do.

Every shelf row carries a `source`:

| source | means | shows stock? |
|---|---|---|
| `official_feed` | published price file | **no** — the feed has no stock field, so the app never invents one |
| `hunter` | someone logged it in the app | yes, they counted the cans |
| `featured` | a paid, verified store listing | no |

Variants without a barcode confirmed in the feed carry `barcode: null` and the
UI says so rather than printing a made-up number. `store/[id]` shows a price
*spread across branches* instead of a price *history*, because nothing is
recording history yet.

There is no consumer paywall — the source canvas had a $4.99 unlock and a
$2.99/month tier, and both were left out on purpose. Store owners pay for
featured pins; hunters don't pay at all.

## Known gaps

- **The 3-D can is procedural, not a downloaded model.** Swapping in a real
  `.glb` means loading it with three's `GLTFLoader` in `createCanMesh` and
  decoding its textures, which expo-gl cannot do without an image decoder —
  so a model with baked material colours works, a textured one does not yet.
  Sourcing one is also blocked on a login: the free model sites all require
  an account.
- **Store coordinates are town-centre jitter**, not geocoded addresses. The
  pipeline doc's geocoding step (address + ZIP → lat/lng, cached) has not been
  run, so branch pins are approximate outside the two real ones.
- **The feed is a snapshot, not a live fetch.** Wiring the app to a scheduled
  scrape means an endpoint that serves the `sightings` table; `src/data/api.ts`
  is shaped for it, but the endpoint doesn't exist yet.
- **Push notifications aren't wired.** Alerts are computed on screen from the
  dataset; making them arrive while the app is closed needs a server and
  `expo-notifications`.
- **Sightings are local only.** `logSighting()` writes to AsyncStorage; nothing
  uploads them, so a sighting helps you and no one else yet.
- **iOS is unbuilt on this machine** (Windows). The project is configured for
  it — bundle id, permission strings, plugins — but it has only been run on
  Android.
