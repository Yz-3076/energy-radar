/**
 * The variant catalogue.
 *
 * Barcodes marked real were observed in Shufersal's price-transparency feed on
 * 2026-09-05 (see docs/israel-pipeline.md). Variants without a confirmed
 * barcode carry `barcode: null` rather than a made-up number — the app shows
 * the barcode row only when it actually has one.
 *
 * Caffeine/sugar are the published per-500 ml figures, rounded; they are
 * reference values for the variant, not a per-store measurement.
 */

export type Rarity = "Common" | "Uncommon" | "Rare" | "Ultra";

/** Which shell the can is printed on. The Ultra line ships on a white can, the
 *  rest on the black one, and that single fact does more to tell the flavours
 *  apart on a map pin than the accent colour does. */
export type Body = "black" | "white";

/** The mark across the label. Both can renderers read this, so a variant looks
 *  like itself whether it is 26 px of SVG in a list or the spun 3-D hero. */
export type Artwork = "claw" | "burst" | "wave" | "split";

export type Variant = {
  id: string;
  /** Product name as printed on the can, without the brand word. */
  name: string;
  /** Full shelf name, used where the row needs to stand alone. */
  fullName: string;
  accent: string;
  /** Second label colour: the thin stripe under the band and the tips of the
   *  artwork. Gives each can a two-tone read instead of one flat hue. */
  secondary: string;
  body: Body;
  artwork: Artwork;
  barcode: string | null;
  rarity: Rarity;
  sizeMl: number;
  /** Published per-500 ml figures, or null where we genuinely don't have
   *  them. Null rather than a plausible-looking number: these are real
   *  nutrition facts people may be choosing on, and a guessed 150 mg is
   *  indistinguishable on screen from a sourced one. The UI shows "—". */
  caffeineMg: number | null;
  sugarG: number | null;
  /** Only true where the product is sugar-free beyond doubt — the Ultra
   *  line, or a name that says zero. Unknown counts as false, so an
   *  unverified can can never surface under the Zero sugar filter. */
  zeroSugar: boolean;
  blurb: string;
};

export const VARIANTS: Variant[] = [
  {
    id: "original",
    name: "Original",
    fullName: "Monster Energy Original",
    accent: "#00ff41",
    secondary: "#0a8f2a",
    body: "black",
    artwork: "claw",
    barcode: "5061013942249",
    rarity: "Common",
    sizeMl: 500,
    caffeineMg: 160,
    sugarG: 55,
    zeroSugar: false,
    blurb:
      "The one that started it. Citrus-forward and aggressively carbonated — stocked nearly everywhere, which makes it the price floor every other can is judged against.",
  },
  {
    id: "ultra",
    name: "Ultra",
    fullName: "Monster Ultra (Zero Sugar)",
    accent: "#cbd0cb",
    secondary: "#8d968d",
    body: "white",
    artwork: "claw",
    barcode: "5060639128051",
    rarity: "Common",
    sizeMl: 500,
    caffeineMg: 150,
    sugarG: 0,
    zeroSugar: true,
    blurb:
      "Light, dry, almost floral. One of the most-searched variants on Energy Radar and usually the first white can to clear out at the start of the week.",
  },
  {
    id: "ultra-paradise",
    name: "Ultra Paradise",
    fullName: "Monster Ultra Paradise",
    accent: "#5fe6b0",
    secondary: "#1f9e78",
    body: "white",
    artwork: "wave",
    barcode: "5060751219033",
    rarity: "Uncommon",
    sizeMl: 500,
    caffeineMg: 150,
    sugarG: 0,
    zeroSugar: true,
    blurb:
      "Kiwi, lime and cucumber over the Ultra base. Sits on fewer shelves than the white can and moves faster when it lands.",
  },
  {
    id: "ultra-fiesta",
    name: "Ultra Fiesta",
    fullName: "Monster Ultra Fiesta Mango",
    accent: "#ff7a3d",
    secondary: "#c9451c",
    body: "white",
    artwork: "burst",
    barcode: "5060896625249",
    rarity: "Uncommon",
    sizeMl: 500,
    caffeineMg: 150,
    sugarG: 0,
    zeroSugar: true,
    blurb:
      "Mango without the sugar load. Ships in waves — set an alert and it'll show up on Me the moment a shelf near you has one.",
  },
  {
    id: "mango-loco",
    name: "Mango Loco",
    fullName: "Monster Juice Mango Loco",
    accent: "#f0b429",
    secondary: "#c96a10",
    body: "black",
    artwork: "burst",
    barcode: "5060639129102",
    rarity: "Common",
    sizeMl: 500,
    caffeineMg: 160,
    sugarG: 57,
    zeroSugar: false,
    blurb:
      "Thick tropical mango with a bitter finish, 16% juice. The steadiest of the Juice line and rarely discounted.",
  },
  {
    id: "full-zero",
    name: "Full Zero",
    fullName: "Monster Energy Zero Sugar",
    accent: "#2f6fe0",
    secondary: "#1b4aa0",
    body: "black",
    artwork: "split",
    barcode: "5061013948364",
    rarity: "Uncommon",
    sizeMl: 500,
    caffeineMg: 160,
    sugarG: 0,
    zeroSugar: true,
    blurb:
      "The original recipe with the sugar pulled out — the blue can. Priced a shekel above Original at most branches.",
  },
  {
    id: "ultra-violet",
    name: "Ultra Violet",
    fullName: "Monster Ultra Violet",
    accent: "#8f7ce0",
    secondary: "#5a49a8",
    body: "white",
    artwork: "wave",
    barcode: "5060639127078",
    rarity: "Rare",
    sizeMl: 500,
    caffeineMg: 150,
    sugarG: 0,
    zeroSugar: true,
    blurb:
      "Grape soda energy, zero sugar. Distribution is patchy enough that a sighting is usually worth the walk.",
  },
  {
    id: "juice-khaotic",
    name: "Juice Khaotic",
    fullName: "Monster Juice Khaotic",
    accent: "#ff5c8a",
    secondary: "#c92f5c",
    body: "black",
    artwork: "burst",
    barcode: "5060751219118",
    rarity: "Rare",
    sizeMl: 500,
    caffeineMg: 160,
    sugarG: 56,
    zeroSugar: false,
    blurb:
      "Orange-citrus juice blend. One of the harder cans to find outside the big-format branches.",
  },
  {
    id: "pipeline-punch",
    name: "Pipeline Punch",
    fullName: "Monster Juice Pipeline Punch",
    accent: "#ffd166",
    secondary: "#c99a2a",
    body: "black",
    artwork: "wave",
    barcode: null,
    rarity: "Rare",
    sizeMl: 500,
    caffeineMg: 160,
    sugarG: 58,
    zeroSugar: false,
    blurb:
      "Passionfruit, orange and guava. Imported irregularly — no confirmed barcode in the price feed yet, so what's listed here came from a hunter's photo at the shelf.",
  },
  {
    id: "ultra-gold",
    name: "Ultra Gold",
    fullName: "Monster Ultra Gold",
    accent: "#d8b25a",
    secondary: "#9c7c2c",
    body: "white",
    artwork: "split",
    barcode: null,
    rarity: "Ultra",
    sizeMl: 500,
    caffeineMg: 150,
    sugarG: 0,
    zeroSugar: true,
    blurb:
      "Pineapple over the Ultra base. Not in the official feed at all — every sighting on Energy Radar came from a hunter standing in front of the shelf.",
  },
  {
    id: "nitro-super-dry",
    name: "Nitro Super Dry",
    fullName: "Monster Nitro Super Dry",
    accent: "#b08050",
    secondary: "#7a5734",
    body: "black",
    artwork: "split",
    barcode: null,
    rarity: "Ultra",
    sizeMl: 500,
    caffeineMg: 160,
    sugarG: 0,
    zeroSugar: true,
    blurb:
      "Nitrogen-charged and barely sweet, in the widened can. Reaches about one branch in nine, usually a single facing.",
  },
  {
    id: "rehab-lemonade",
    name: "Rehab Lemonade",
    fullName: "Monster Rehab Tea + Lemonade",
    accent: "#f2e6a0",
    secondary: "#b8a45a",
    body: "black",
    artwork: "wave",
    barcode: null,
    rarity: "Ultra",
    sizeMl: 458,
    caffeineMg: 160,
    sugarG: 6,
    zeroSugar: false,
    blurb:
      "Iced tea, lemonade and electrolytes in the short 458 ml can. Effectively a grey-import find in this market.",
  },

  // Everything below was found on Israeli shelves once Victory's feed came
  // back online (2026-09-10) — together they were 56% of that chain's
  // Monster rows, all previously discarded for having no catalogue entry.
  // Names come from the retailer's own product text, which is the only
  // description the feed carries; caffeine and sugar are left null because
  // nothing in the price feed publishes them and a guess would look
  // exactly like a sourced figure on screen.
  {
    id: "ultra-peachy-keen",
    name: "Ultra Peachy Keen",
    fullName: "Monster Ultra Peachy Keen",
    accent: "#ffb38a",
    secondary: "#e07a4f",
    body: "white",
    artwork: "wave",
    barcode: "5056784903865",
    rarity: "Rare",
    sizeMl: 500,
    caffeineMg: null,
    sugarG: 0,
    // Ultra is Monster's sugar-free line, so this one is safe to assert.
    zeroSugar: true,
    blurb: "White-can peach, from the sugar-free Ultra line. New to Israeli shelves and not yet widely stocked.",
  },
  {
    id: "green-zero",
    name: "Green Zero",
    fullName: "Monster Energy Zero Sugar",
    accent: "#7CFC5A",
    secondary: "#2f8f2a",
    body: "black",
    artwork: "claw",
    barcode: "5061013942331",
    rarity: "Uncommon",
    sizeMl: 500,
    caffeineMg: null,
    sugarG: 0,
    // Sold as "גרין זירו" — the name itself is the claim.
    zeroSugar: true,
    blurb: "The original green, without the sugar. Same claw, same profile, sweetened instead of sugared.",
  },
  {
    id: "strawberry",
    name: "Strawberry",
    fullName: "Monster Strawberry",
    accent: "#ff4d6d",
    secondary: "#a3122f",
    body: "black",
    artwork: "burst",
    barcode: "5056784900970",
    rarity: "Rare",
    sizeMl: 500,
    caffeineMg: null,
    sugarG: null,
    zeroSugar: false,
    blurb: "Listed simply as Strawberry on Israeli shelves. Details still thin — we show the price, not a spec sheet we don't have.",
  },
  {
    id: "aussie-lemonade",
    name: "Aussie Lemonade",
    fullName: "Monster Aussie Lemonade",
    accent: "#ffe066",
    secondary: "#c8a415",
    body: "black",
    artwork: "wave",
    barcode: "5061013944991",
    rarity: "Rare",
    sizeMl: 500,
    caffeineMg: null,
    sugarG: null,
    zeroSugar: false,
    blurb: "Cloudy lemonade rather than citrus soda. Turns up in scattered branches rather than as a standing line.",
  },
  {
    id: "monarch",
    name: "Monarch",
    fullName: "Monster Monarch",
    accent: "#f0a500",
    secondary: "#7a4b00",
    body: "black",
    artwork: "split",
    barcode: "5060947547100",
    rarity: "Rare",
    sizeMl: 500,
    caffeineMg: null,
    sugarG: null,
    zeroSugar: false,
    blurb: "Sold here as Monarch. One of the rarer cans in the feed, so worth logging when you actually see one.",
  },
  {
    id: "rossi",
    name: "Rossi",
    fullName: "Monster Rossi",
    accent: "#e8536b",
    secondary: "#8c2033",
    body: "black",
    artwork: "split",
    barcode: "5060517886547",
    rarity: "Rare",
    sizeMl: 500,
    caffeineMg: null,
    sugarG: null,
    zeroSugar: false,
    blurb: "Shelf-listed as רוזי — an uncommon can that shows up in a handful of branches at a time.",
  },
];

export const variantById = new Map(VARIANTS.map((v) => [v.id, v]));

export const getVariant = (id: string): Variant =>
  variantById.get(id) ?? VARIANTS[0];

export const RARITY_ORDER: Record<Rarity, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Ultra: 3,
};
