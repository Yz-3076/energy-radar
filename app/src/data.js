// Mock dataset for the map PoC.
// The first two entries are the REAL results from the Shufersal price-transparency
// scrape (see ../../docs/israel-pipeline.md) — real barcodes, real prices, real
// addresses, real last-sale timestamps. Everything else is synthetic, generated
// around real Israeli town centers, to give the clustering/viewport demo enough
// density to be meaningful. "variants" carried is a real, honest count; there is
// no real per-store stock-quantity source (see docs), so we never fabricate one.

const MONSTER_VARIANTS = [
  { code: "5060639128051", name: "Monster Ultra", price: 9.9 },
  { code: "5060639129102", name: "Monster Mango Loco", price: 9.9 },
  { code: "5060751219033", name: "Monster Ultra Paradise", price: 9.9 },
  { code: "5060896625249", name: "Monster Ultra Fiesta", price: 9.9 },
  { code: "5061013942249", name: "Monster Energy Original", price: 9.9 },
  { code: "5061013948364", name: "Monster Full Zero", price: 10.9 },
  { code: "5060639127078", name: "Monster Ultra Violet", price: 9.9 },
  { code: "5060751219118", name: "Monster Juice Khaotic", price: 11.9 },
];

const TOWN_CENTERS = [
  { chain: "Shufersal Sheli", name: 'שלי ת"א- בן יהודה', address: "בן יהודה 79, תל אביב", lat: 32.0798, lng: 34.7695, real: true },
  { chain: "Shufersal Sheli", name: "שלי ירושלים- אגרון", address: "אגרון 1, ירושלים", lat: 31.7784, lng: 35.2177, real: true },
  { chain: "Shufersal Deal", name: "דיל דיזנגוף סנטר", address: "דיזנגוף 50, תל אביב", lat: 32.0742, lng: 34.7745 },
  { chain: "Rami Levy", name: "רמי לוי רוטשילד", address: "שדרות רוטשילד 12, תל אביב", lat: 32.0656, lng: 34.7735 },
  { chain: "Victory", name: "ויקטורי פלורנטין", address: "פלורנטין 45, תל אביב", lat: 32.0553, lng: 34.7688 },
  { chain: "AM:PM", name: "AM:PM נמל תל אביב", address: "התחנה 4, תל אביב", lat: 32.0973, lng: 34.7736 },
  { chain: "Osher Ad", name: "אושר עד רמת אביב", address: "איינשטיין 2, תל אביב", lat: 32.1122, lng: 34.8021 },
  { chain: "Yellow", name: "ילו הרצליה פיתוח", address: "סוקולוב 88, הרצליה", lat: 32.1656, lng: 34.8437 },
  { chain: "Shufersal Sheli", name: "שלי רעננה", address: "אחוזה 100, רעננה", lat: 32.1848, lng: 34.8713 },
  { chain: "Rami Levy", name: "רמי לוי פתח תקווה", address: "כביש 4812, פתח תקווה", lat: 32.0917, lng: 34.8767 },
  { chain: "Victory", name: "ויקטורי חולון", address: "סוקולוב 60, חולון", lat: 32.0117, lng: 34.7719 },
  { chain: "Dor Alon", name: "AM:PM בת ים", address: "רוטשילד 30, בת ים", lat: 32.0171, lng: 34.7513 },
  { chain: "Osher Ad", name: "אושר עד נתניה", address: "בן גוריון 20, נתניה", lat: 32.3215, lng: 34.8532 },
  { chain: "Shufersal Deal", name: "דיל חיפה הדר", address: "הרצל 45, חיפה", lat: 32.8058, lng: 34.9896 },
  { chain: "Rami Levy", name: "רמי לוי מודיעין", address: "עמק דותן 5, מודיעין", lat: 31.8969, lng: 35.0095 },
  { chain: "Yellow", name: "ילו אשדוד", address: "רוגוזין 12, אשדוד", lat: 31.7940, lng: 34.6446 },
];

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function jitter(rand, spread) {
  return (rand() - 0.5) * spread;
}

export function buildMockStores() {
  const rand = seededRandom(42);
  const now = new Date("2026-09-05T09:00:00");
  const stores = [];
  let id = 0;

  for (const town of TOWN_CENTERS) {
    // a small cluster of branches around each town center so zoomed-out
    // view shows real clustering behavior
    const branchesHere = town.real ? 1 : 1 + Math.floor(rand() * 3);
    for (let b = 0; b < branchesHere; b++) {
      id++;
      const lat = town.lat + (b === 0 ? 0 : jitter(rand, 0.02));
      const lng = town.lng + (b === 0 ? 0 : jitter(rand, 0.02));

      const variantCount = 2 + Math.floor(rand() * 5);
      const shuffled = [...MONSTER_VARIANTS].sort(() => rand() - 0.5);
      const variants = shuffled.slice(0, variantCount);

      // hours-ago last sale: real two entries keep their real timestamps
      let lastSale;
      if (town.real && b === 0) {
        lastSale = town.name.includes("בן יהודה")
          ? new Date("2026-09-04T15:27:04")
          : new Date("2026-09-03T20:58:24");
      } else {
        const hoursAgo = rand() < 0.4 ? rand() * 30 : 30 + rand() * 300;
        lastSale = new Date(now.getTime() - hoursAgo * 3600 * 1000);
      }

      stores.push({
        id: `store-${id}`,
        chain: town.chain,
        name: b === 0 ? town.name : `${town.name} - סניף ${b + 1}`,
        address: town.address,
        lat,
        lng,
        variants,
        lastSale: lastSale.toISOString(),
      });
    }
  }
  return stores;
}

export const RECENT_THRESHOLD_HOURS = 36;

export function isRecent(isoString, now = new Date("2026-09-05T09:00:00")) {
  const diffHours = (now.getTime() - new Date(isoString).getTime()) / 3600000;
  return diffHours <= RECENT_THRESHOLD_HOURS;
}
