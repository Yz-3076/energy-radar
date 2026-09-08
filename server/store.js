// Deliberately not a real database — this is a prototype. Swap for Postgres/
// SQLite/etc. before this ever handles real money or real store owners.
// Single JSON file, read-modify-write, guarded by an in-process write queue
// so concurrent requests in this one dev process don't corrupt it (a real
// multi-process deployment would need a real DB's transactions instead).
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "data", "listings.json");

let writeQueue = Promise.resolve();

async function readAll() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeAll(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

function withWriteLock(fn) {
  const result = writeQueue.then(fn);
  // swallow errors here so one failed write doesn't wedge the queue forever;
  // the caller still sees the rejection via `result`.
  writeQueue = result.catch(() => {});
  return result;
}

export async function getListing(id) {
  const all = await readAll();
  return all[id] || null;
}

export async function listAllListings() {
  const all = await readAll();
  return Object.values(all);
}

export async function createListing(listing) {
  return withWriteLock(async () => {
    const all = await readAll();
    all[listing.id] = listing;
    await writeAll(all);
    return listing;
  });
}

export async function updateListing(id, patch) {
  return withWriteLock(async () => {
    const all = await readAll();
    if (!all[id]) throw new Error(`no listing ${id}`);
    all[id] = { ...all[id], ...patch, updatedAt: new Date().toISOString() };
    await writeAll(all);
    return all[id];
  });
}
