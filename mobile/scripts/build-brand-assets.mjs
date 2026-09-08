/**
 * Derives every launcher/splash asset from one source artwork.
 *
 *   assets/logo.png  →  icon.png, splash-icon.png, android-icon-*.png, favicon.png
 *
 * No image dependency: Node already ships the zlib half of PNG, so this reads
 * the source, box-filters it to each size, composes it on the right ground,
 * and writes the result. Adaptive icons get the mark inset into the 66% safe
 * zone so the launcher's mask never clips it.
 *
 *   node scripts/build-brand-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BG = [10, 11, 10];

/* ── PNG read ───────────────────────────────────────────────────────────── */

/** Decodes a non-interlaced 8-bit RGB/RGBA PNG to {w, h, rgba}. */
function readPNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG: " + file);

  let w = 0;
  let h = 0;
  let colorType = 0;
  const idat = [];

  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error("only 8-bit PNGs are supported");
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNGs are not supported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error("unsupported PNG colour type " + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }

    for (let x = 0; x < w; x++) {
      const s = x * channels;
      const d = (y * w + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    line.copy(prev);
  }

  return { w, h, rgba: out };
}

/* ── PNG write ──────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePNG(file, size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/* ── compose ────────────────────────────────────────────────────────────── */

/**
 * Box-filters the source down to `inner` px and centres it on a `size` canvas.
 *
 * @param opaque paint the near-black ground behind it (launcher icon, favicon)
 *   or leave the surround transparent (adaptive foreground, splash)
 */
function compose(src, size, inner, opaque) {
  const out = Buffer.alloc(size * size * 4);
  if (opaque) {
    for (let i = 0; i < size * size; i++) {
      out[i * 4] = BG[0];
      out[i * 4 + 1] = BG[1];
      out[i * 4 + 2] = BG[2];
      out[i * 4 + 3] = 255;
    }
  }

  const offset = Math.round((size - inner) / 2);
  const scale = src.w / inner;

  for (let y = 0; y < inner; y++) {
    const sy0 = Math.floor(y * scale);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < inner; x++) {
      const sx0 = Math.floor(x * scale);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * scale));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.w + sx) * 4;
          r += src.rgba[i];
          g += src.rgba[i + 1];
          b += src.rgba[i + 2];
          a += src.rgba[i + 3];
          n++;
        }
      }

      const d = ((y + offset) * size + x + offset) * 4;
      const alpha = a / n / 255;
      if (opaque) {
        out[d] = BG[0] * (1 - alpha) + (r / n) * alpha;
        out[d + 1] = BG[1] * (1 - alpha) + (g / n) * alpha;
        out[d + 2] = BG[2] * (1 - alpha) + (b / n) * alpha;
        out[d + 3] = 255;
      } else {
        out[d] = r / n;
        out[d + 1] = g / n;
        out[d + 2] = b / n;
        out[d + 3] = a / n;
      }
    }
  }
  return out;
}

const dir = path.join(process.cwd(), "assets");
const src = readPNG(path.join(dir, "logo.png"));

const jobs = [
  // [file, canvas, artwork size inside it, opaque ground]
  ["icon.png", 1024, 1024, true],
  ["splash-icon.png", 512, 512, false],
  // Adaptive icons are masked hard: keep the mark inside the 66% safe zone.
  ["android-icon-foreground.png", 432, 286, false],
  ["android-icon-background.png", 432, 0, true],
  ["android-icon-monochrome.png", 432, 286, false],
  ["favicon.png", 96, 96, true],
];

for (const [name, size, inner, opaque] of jobs) {
  const rgba = inner > 0 ? compose(src, size, inner, opaque) : compose(src, size, 1, opaque);
  writePNG(path.join(dir, name), size, rgba);
  console.log(`wrote assets/${name} (${size}px)`);
}
