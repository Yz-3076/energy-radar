# Monster tracker

Finding a Monster Energy can near you: which shop has it, which variant, what
it costs, and how recently it actually sold there.

| Folder | What it is |
|---|---|
| [`mobile/`](mobile/) | **The app, Energy Radar.** Expo / React Native, iOS + Android. Native MapLibre map, 3-D can pins, the full design built for real. |
| [`app/`](app/) | The earlier web prototype the mobile app grew out of — MapLibre GL JS + three.js in a phone frame. Still runs, useful for comparing behaviour in a desktop browser. |
| [`server/`](server/) | Store-owner listings: submit → verify → subscribe → featured gold pin. Express + a JSON file. Prototype, gaps documented. |
| [`israel-poc/`](israel-poc/) | The scripts that proved the data pipeline against Shufersal's live price files. |
| [`design-import/`](design-import/) | The Claude Design canvas the UI comes from, plus its design system. |
| [`docs/`](docs/) | How the data is obtained, per country, and how the owner monetization works. |

## Where the data comes from

- **Israel** — [`docs/israel-pipeline.md`](docs/israel-pipeline.md). A 2014 price
  transparency law forces every chain with 3+ branches to publish machine-readable
  per-store price files several times a day. Download → filter for Monster
  barcodes → resolve the store from the chain's own branch list. Proven against
  live Shufersal data on 2026-09-05.
- **USA** — [`docs/us-data-sources.md`](docs/us-data-sources.md). No equivalent
  law and no single good answer: the Kroger developer API is the one sanctioned
  source, crowdsourcing is the only universal fallback, and the delivery-platform
  route is a real ToS risk. Research only, nothing built.
- **Staying current** — [`docs/staying-current.md`](docs/staying-current.md). What makes
  the prices refresh once the app is on a phone: the chains republish several
  times a day by law, hunters fill the gaps no feed reaches, owners update their
  own listings.
- **Store owners** — [`docs/owner-monetization.md`](docs/owner-monetization.md).
  Paid featured listings, which is what funds the app. Users never pay.

Every price row in the app keeps its source, because a legally-mandated price
file, a hunter's photo and a paid listing are not equally trustworthy — and none
of them is a live stock feed.
