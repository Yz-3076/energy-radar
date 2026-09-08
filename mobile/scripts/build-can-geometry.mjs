/**
 * Extracts real can geometry AND the scan's own baked label photo from
 * downloaded .glb models into a tiny generated module — no GLTFLoader, no
 * runtime image decoding, no asset resolution on-device.
 *
 * Earlier versions of this script threw the baked texture away and drew a
 * hand-painted label instead. That turned out to be a mistake: a scanned
 * photo of a real can is exactly what makes the 3-D can look like something
 * real rather than a render, and no amount of procedural shading gets there.
 * So this now also pulls the material's base-colour/diffuse image out of the
 * glb, decodes it (PNG via a hand-rolled inflate-based reader — same trick as
 * build-brand-assets.mjs; JPEG via the `jpeg-js` pure-JS decoder, a
 * build-time-only devDependency that never ships in the app bundle), and
 * downsamples it to a shippable size. It ships as raw RGBA, base64-encoded,
 * for the same reason the geometry does: Hermes has no `Image()` / PNG or
 * JPEG decode, so whatever CanGL uses has to already be plain pixels.
 *
 * UVs are the scan's own TEXCOORD_0 now too (not a computed cylindrical
 * projection) — they're what the baked photo was actually painted against,
 * so they're the only ones that line up with it.
 *
 *   node scripts/build-can-geometry.mjs <black.glb> <white.glb>
 */
import fs from "node:fs";
import zlib from "node:zlib";
import jpeg from "jpeg-js";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_TYPES = {
  5126: { name: "f32", bytes: 4, read: (b, o) => b.readFloatLE(o) },
  5125: { name: "u32", bytes: 4, read: (b, o) => b.readUInt32LE(o) },
  5123: { name: "u16", bytes: 2, read: (b, o) => b.readUInt16LE(o) },
  5121: { name: "u8", bytes: 1, read: (b, o) => b.readUInt8(o) },
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Longest edge a baked label ships at. Plenty for a can rendered at a few
 *  hundred px on screen; keeps two textures a few hundred KB each instead of
 *  multi-megabyte source-resolution scans. */
const MAX_TEX_EDGE = 640;

function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file}: not a glb`);
  const length = buf.readUInt32LE(8);
  let json = null;
  let bin = null;
  for (let off = 12; off < length; ) {
    const chunkLen = buf.readUInt32LE(off);
    const chunkType = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + chunkLen);
    if (chunkType === CHUNK_JSON) json = JSON.parse(data.toString("utf8"));
    else if (chunkType === CHUNK_BIN) bin = data;
    off += 8 + chunkLen;
  }
  if (!json || !bin) throw new Error(`${file}: missing JSON or BIN chunk`);
  return { json, bin };
}

/** Reads an accessor into a plain JS number array (fine at build-time scale). */
function readAccessor(json, bin, accessorIndex) {
  const acc = json.accessors[accessorIndex];
  const view = json.bufferViews[acc.bufferView];
  const comp = COMPONENT_TYPES[acc.componentType];
  const width = TYPE_COMPONENTS[acc.type];
  const stride = view.byteStride || width * comp.bytes;
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);

  const out = new Array(acc.count * width);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < width; c++) {
      out[i * width + c] = comp.read(bin, base + i * stride + c * comp.bytes);
    }
  }
  return out;
}

/** Merges every triangle-mode primitive of every mesh into one position/normal/uv/index set. */
function extractMergedGeometry(json, bin) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.mode != null && prim.mode !== 4) continue; // TRIANGLES only
      const posAttr = prim.attributes.POSITION;
      if (posAttr == null) continue;

      const vertexOffset = positions.length / 3;
      const pos = readAccessor(json, bin, posAttr);
      positions.push(...pos);

      if (prim.attributes.NORMAL != null) {
        normals.push(...readAccessor(json, bin, prim.attributes.NORMAL));
      } else {
        // Flat-shaded fallback; CanGL recomputes smooth normals if these look wrong.
        for (let i = 0; i < pos.length / 3; i++) normals.push(0, 1, 0);
      }

      if (prim.attributes.TEXCOORD_0 != null) {
        uvs.push(...readAccessor(json, bin, prim.attributes.TEXCOORD_0));
      } else {
        for (let i = 0; i < pos.length / 3; i++) uvs.push(0, 0);
      }

      if (prim.indices != null) {
        const idx = readAccessor(json, bin, prim.indices);
        for (const i of idx) indices.push(i + vertexOffset);
      } else {
        for (let i = 0; i < pos.length / 3; i++) indices.push(i + vertexOffset);
      }
    }
  }
  return { positions, normals, uvs, indices };
}

/**
 * Centres the mesh, figures out which axis is "up" (a can is far taller than
 * it is wide, so the axis with the largest extent wins), permutes that axis
 * onto Y, and scales to a 1.42-unit tall can — matching the proportions the
 * rest of CanGL already assumes (camera distance, lighting, pin scale).
 *
 * Normals get the same axis permutation as positions — a rotation has to
 * carry both, or the lighting ends up pointing the way the *original* scan's
 * axes pointed instead of the way the can now actually faces.
 */
function normalize(positions, normals) {
  const n = positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const upAxis = extent.indexOf(Math.max(...extent));
  const center = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
  const others = [0, 1, 2].filter((a) => a !== upAxis);

  const TARGET_HEIGHT = 1.42;
  const scale = TARGET_HEIGHT / extent[upAxis];

  const outPos = new Float32Array(positions.length);
  const outNorm = new Float32Array(normals.length);
  for (let i = 0; i < n; i++) {
    const p = [
      positions[i * 3] - center[0],
      positions[i * 3 + 1] - center[1],
      positions[i * 3 + 2] - center[2],
    ];
    outPos[i * 3] = p[others[0]] * scale;
    outPos[i * 3 + 1] = p[upAxis] * scale;
    outPos[i * 3 + 2] = p[others[1]] * scale;

    // Same permutation, no translation/scale — a normal is a direction.
    const nrm = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    outNorm[i * 3] = nrm[others[0]];
    outNorm[i * 3 + 1] = nrm[upAxis];
    outNorm[i * 3 + 2] = nrm[others[1]];
  }
  return { positions: outPos, normals: outNorm };
}

/* ── PNG decode (build-time only; mirrors build-brand-assets.mjs) ───────── */

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

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

function decodeJPEG(buf) {
  const { width, height, data } = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { w: width, h: height, rgba: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
}

/** Box-filter downsample to at most MAX_TEX_EDGE on the long edge. */
function downsample(src) {
  const longest = Math.max(src.w, src.h);
  if (longest <= MAX_TEX_EDGE) return src;
  const scale = MAX_TEX_EDGE / longest;
  const w = Math.max(1, Math.round(src.w * scale));
  const h = Math.max(1, Math.round(src.h * scale));
  const out = Buffer.alloc(w * h * 4);

  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y / h) * src.h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / h) * src.h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x / w) * src.w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / w) * src.w));
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
      const d = (y * w + x) * 4;
      out[d] = r / n;
      out[d + 1] = g / n;
      out[d + 2] = b / n;
      out[d + 3] = a / n;
    }
  }
  return { w, h, rgba: out };
}

/**
 * Mirrors one rectangle of a decoded texture horizontally, in place.
 *
 * The black can's baked label needs a 180° UV rotation at runtime to read
 * correctly (see CanGL.tsx's ROTATE_180) — confirmed on-device: the claw
 * mark comes out correctly oriented that way. But the "MONSTER ENERGY"
 * wordmark directly under it stays mirrored even then, which only makes
 * sense if that one design element was composited into the source texture
 * already mirrored relative to the claw (an authoring quirk in the original
 * scan, not something any single whole-image transform can fix — flipping
 * the runtime rotation the other way would just un-mirror the wordmark and
 * mirror the claw instead). So this pre-mirrors just that rectangle at
 * build time, cancelling the runtime rotation for that region alone.
 */
function mirrorRegionX(tex, x0, y0, x1, y1) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < (x0 + x1) / 2; x++) {
      const mirrored = x0 + x1 - 1 - x;
      const a = (y * tex.w + x) * 4;
      const b = (y * tex.w + mirrored) * 4;
      for (let c = 0; c < 4; c++) {
        const t = tex.rgba[a + c];
        tex.rgba[a + c] = tex.rgba[b + c];
        tex.rgba[b + c] = t;
      }
    }
  }
}

/** Finds the material's base-colour (or specular/glossiness diffuse) texture
 *  and decodes it, whichever image format the scan happened to embed. */
function extractLabelTexture(json, bin) {
  const material = json.materials?.[0];
  if (!material) throw new Error("no material on this scan");

  const texInfo =
    material.pbrMetallicRoughness?.baseColorTexture ??
    material.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture;
  if (!texInfo) throw new Error("no base-colour/diffuse texture on this scan's material");

  const texture = json.textures[texInfo.index];
  const image = json.images[texture.source];
  const view = json.bufferViews[image.bufferView];
  const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);

  const decoded =
    image.mimeType === "image/png"
      ? decodePNG(bytes)
      : image.mimeType === "image/jpeg"
        ? decodeJPEG(bytes)
        : (() => {
            throw new Error(`unsupported image mimeType ${image.mimeType}`);
          })();

  return downsample(decoded);
}

function b64(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString("base64");
}

function buildOne(file, mirrorBox) {
  const { json, bin } = readGLB(file);
  const { positions, normals, uvs, indices } = extractMergedGeometry(json, bin);
  const { positions: posOut, normals: normOut } = normalize(positions, normals);
  const uvOut = new Float32Array(uvs);
  let maxIndex = 0;
  for (const i of indices) if (i > maxIndex) maxIndex = i;
  const idxOut = maxIndex > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);

  const tex = extractLabelTexture(json, bin);
  if (mirrorBox) mirrorRegionX(tex, ...mirrorBox);

  console.log(
    `${file}: ${posOut.length / 3} verts, ${idxOut.length / 3} tris, ` +
      `label ${tex.w}x${tex.h} (${(tex.rgba.length / 1024).toFixed(0)}KB raw), ` +
      `${(fs.statSync(file).size / 1024).toFixed(0)}KB source`,
  );

  return {
    position: b64(posOut),
    normal: b64(normOut),
    uv: b64(uvOut),
    index: b64(idxOut),
    indexType: idxOut instanceof Uint32Array ? "u32" : "u16",
    vertexCount: posOut.length / 3,
    indexCount: idxOut.length,
    texWidth: tex.w,
    texHeight: tex.h,
    texture: tex.rgba.toString("base64"),
  };
}

const [blackFile, whiteFile] = process.argv.slice(2);
if (!blackFile || !whiteFile) {
  console.error("usage: node scripts/build-can-geometry.mjs <black.glb> <white.glb>");
  process.exit(1);
}

// Box (in the 640×640 downsampled label) around the "MONSTER ENERGY"
// wordmark beneath the claw mark — see mirrorRegionX for why.
const BLACK_WORDMARK_BOX = [280, 220, 640, 350];

const black = buildOne(blackFile, BLACK_WORDMARK_BOX);
const white = buildOne(whiteFile);

const out = `/* GENERATED by scripts/build-can-geometry.mjs — do not edit by hand.
 *
 * Real can geometry (positions, normals, the scan's own UVs, triangle
 * indices) AND the scan's own baked label photo, extracted from downloaded
 * .glb scans. The photo ships as raw RGBA (base64) rather than compressed
 * PNG/JPEG bytes, since Hermes has no image decoder to turn compressed bytes
 * back into pixels — CanGL builds a THREE.DataTexture straight from this.
 *
 * Source files are not committed — this generated module is what ships.
 */

export type RawCanGeometry = {
  position: string;
  normal: string;
  uv: string;
  index: string;
  indexType: "u16" | "u32";
  vertexCount: number;
  indexCount: number;
  texWidth: number;
  texHeight: number;
  /** Raw RGBA pixels, base64-encoded, texWidth × texHeight × 4 bytes. */
  texture: string;
};

export const BLACK_CAN: RawCanGeometry = ${JSON.stringify(black)};

export const WHITE_CAN: RawCanGeometry = ${JSON.stringify(white)};
`;

fs.writeFileSync("src/components/canGeometry.gen.ts", out);
console.log("wrote src/components/canGeometry.gen.ts");
