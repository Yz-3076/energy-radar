import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type ViewStyle } from "react-native";
import * as THREE from "three";

import { Can } from "./Can";
import { BLACK_CAN, WHITE_CAN, type RawCanGeometry } from "./canGeometry.gen";
import type { Body, Variant } from "@/data/catalog";

/**
 * The hero can — a real three.js mesh you can spin with a finger, built from
 * an actual downloaded 3-D scan (geometry, UVs and the scan's own baked
 * label photo — see canGeometry.gen.ts and build-can-geometry.mjs). An
 * earlier version replaced the photo with a hand-painted procedural label;
 * that made every flavour distinct but never looked like a real can, so this
 * now renders the real photo instead. Flavour still shows up as a coloured
 * rim light rather than a different label — there's only one real scan per
 * shell colour, not one per flavour.
 */

/**
 * `secondary`/`artwork` aren't used by the real-scan render below — they're
 * carried here only so the flat 2-D `Can` fallback (still procedural, used
 * when a device can't run WebGL2) has what it needs without a second prop.
 */
export type CanVariant = Pick<Variant, "id" | "accent" | "secondary" | "body" | "artwork">;

/* ── real scanned geometry + baked texture, decoded once and shared ──────
 *
 * Turns the base64 blobs from canGeometry.gen.ts into a BufferGeometry and a
 * DataTexture, so both the shape and the label are the actual downloaded can
 * scan. Two of each (one per shell colour), decoded on first use and reused
 * by every mesh after that.
 */

/** RN's JS engine has no `atob`; this decodes the same base64 alphabet
 *  Node's `Buffer.toString("base64")` produces, straight into bytes. */
function decodeBase64(b64: string): Uint8Array {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const LOOKUP = new Int16Array(128).fill(-1);
  for (let i = 0; i < CHARS.length; i++) LOOKUP[CHARS.charCodeAt(i)] = i;

  let len = b64.length;
  while (len > 0 && b64.charCodeAt(len - 1) === 61 /* '=' */) len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));

  let o = 0;
  for (let i = 0; i < len; ) {
    const c0 = LOOKUP[b64.charCodeAt(i++)];
    const c1 = LOOKUP[b64.charCodeAt(i++)];
    const c2 = i < len ? LOOKUP[b64.charCodeAt(i++)] : -1;
    const c3 = i < len ? LOOKUP[b64.charCodeAt(i++)] : -1;
    out[o++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0 && o < out.length) out[o++] = ((c1 & 0xf) << 4) | (c2 >> 2);
    if (c3 >= 0 && o < out.length) out[o++] = ((c2 & 0x3) << 6) | c3;
  }
  return out;
}

function decodeFloat32(b64: string): Float32Array {
  const bytes = decodeBase64(b64);
  return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4);
}

function decodeIndex(raw: RawCanGeometry): Uint16Array | Uint32Array {
  const bytes = decodeBase64(raw.index);
  return raw.indexType === "u32"
    ? new Uint32Array(bytes.buffer, 0, bytes.byteLength / 4)
    : new Uint16Array(bytes.buffer, 0, bytes.byteLength / 2);
}

const geometryCache = new Map<Body, THREE.BufferGeometry>();
const textureCache = new Map<Body, THREE.DataTexture>();

/**
 * Rotate a shell colour's UVs 180° (u,v → 1-u,1-v) if its baked photo renders
 * upside-down/mirrored on the mesh. Confirmed on-device for "black": the
 * wordmark reads perfectly once both axes are flipped together — a plain
 * U-only flip left it rotated 180°, so this needs both, not one. If a body
 * ever looks wrong on a real device, adjust its entry here rather than
 * re-exporting the model.
 */
const ROTATE_180: Record<Body, boolean> = { black: true, white: false };

/** Builds (and caches) the BufferGeometry for one shell colour, using the
 *  scan's own UVs — the only ones that line up with its own baked photo. */
function buildCanGeometry(body: Body): THREE.BufferGeometry {
  const cached = geometryCache.get(body);
  if (cached) return cached;

  const raw = body === "white" ? WHITE_CAN : BLACK_CAN;
  const position = decodeFloat32(raw.position);
  const normal = decodeFloat32(raw.normal);
  const index = decodeIndex(raw);
  const uv = decodeFloat32(raw.uv);
  if (ROTATE_180[body]) {
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = 1 - uv[i];
      uv[i + 1] = 1 - uv[i + 1];
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  geometryCache.set(body, geometry);
  return geometry;
}

/** Builds (and caches) the DataTexture for one shell colour's real baked photo. */
function buildCanTexture(body: Body): THREE.DataTexture {
  const cached = textureCache.get(body);
  if (cached) return cached;

  const raw = body === "white" ? WHITE_CAN : BLACK_CAN;
  const pixels = decodeBase64(raw.texture);
  const tex = new THREE.DataTexture(pixels, raw.texWidth, raw.texHeight, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.needsUpdate = true;

  textureCache.set(body, tex);
  return tex;
}

function buildCan(variant: CanVariant) {
  const group = new THREE.Group();
  const white = variant.body === "white";

  const mesh = new THREE.Mesh(
    buildCanGeometry(variant.body),
    new THREE.MeshStandardMaterial({
      map: buildCanTexture(variant.body),
      // Tuned for a real printed-photo label, not the old flat painted one:
      // that one was mostly dark and forgiving of a hot metallic finish, but
      // a photo has bright, high-contrast print detail (barcode, nutrition
      // panel) that a highly metallic/glossy surface blows straight into
      // reflection under the rim/spec lights below. Lower metalness keeps
      // the print legible; the can still reads as a can from the shape and
      // the directional lighting, not from a mirror finish.
      metalness: white ? 0.12 : 0.15,
      roughness: white ? 0.5 : 0.45,
    }),
  );
  group.add(mesh);
  return group;
}

/**
 * three has refused to run on WebGL 1 since r163, and it decides which it has
 * with `context instanceof WebGLRenderingContext`. expo-gl's context class
 * extends that polyfilled global even when the underlying context is GLES 3,
 * so three rejects a perfectly good WebGL 2 context and throws.
 *
 * `supportsWebGL2` asks the context itself — WebGL2-only entry points exist
 * only when expo-gl actually got a GLES 3 context — and `withGL1Hidden` takes
 * the misleading global out of scope for exactly the length of the
 * constructor. Where the answer is no, the caller draws the flat can instead.
 */
function supportsWebGL2(gl: ExpoWebGLRenderingContext): boolean {
  const c = gl as unknown as Record<string, unknown>;
  return typeof c.createVertexArray === "function" && typeof c.texStorage2D === "function";
}

function withGL1Hidden<T>(fn: () => T): T {
  const g = globalThis as unknown as { WebGLRenderingContext?: unknown };
  const saved = g.WebGLRenderingContext;
  g.WebGLRenderingContext = undefined;
  try {
    return fn();
  } finally {
    g.WebGLRenderingContext = saved;
  }
}

/** three needs a canvas-shaped object; expo-gl has no DOM, so this is the
 *  smallest stand-in the renderer actually reads from. */
function buildRenderer(gl: ExpoWebGLRenderingContext, width: number, height: number) {
  const renderer = withGL1Hidden(
    () =>
      new THREE.WebGLRenderer({
        canvas: {
          width,
          height,
          style: {},
          addEventListener: () => {},
          removeEventListener: () => {},
          clientWidth: width,
          clientHeight: height,
          getContext: () => gl,
        } as unknown as HTMLCanvasElement,
        context: gl as unknown as WebGLRenderingContext,
        antialias: true,
        alpha: true,
      }),
  );
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

type Props = {
  variant: CanVariant;
  style?: ViewStyle;
  /** Idle spin speed in radians/second. */
  spin?: number;
  interactive?: boolean;
  /** Height of the flat can drawn if this device cannot run the 3-D one. */
  fallbackSize?: number;
};

export function CanGL({ variant, style, spin = 0.34, interactive = true, fallbackSize = 220 }: Props) {
  const drag = useRef({ active: false, lastX: 0, velocity: 0, rotation: -0.35 });
  const frame = useRef<number | null>(null);
  const [fallback, setFallback] = useState(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => interactive,
        onMoveShouldSetPanResponder: (_, g) => interactive && Math.abs(g.dx) > 2,
        onPanResponderGrant: (e) => {
          drag.current.active = true;
          drag.current.lastX = e.nativeEvent.pageX;
        },
        onPanResponderMove: (e) => {
          const x = e.nativeEvent.pageX;
          const dx = x - drag.current.lastX;
          drag.current.lastX = x;
          drag.current.rotation += dx * 0.012;
          drag.current.velocity = dx * 0.012;
        },
        onPanResponderRelease: () => {
          drag.current.active = false;
        },
        onPanResponderTerminate: () => {
          drag.current.active = false;
        },
      }),
    [interactive],
  );

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    if (!supportsWebGL2(gl)) {
      setFallback(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = buildRenderer(gl, width, height);
    } catch {
      // Any driver we cannot render on falls back to the flat can rather than
      // taking the screen down with it.
      setFallback(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
    camera.position.set(0, 0.18, 4.6);

    let can: THREE.Group;
    try {
      can = buildCan(variant);
    } catch {
      // A geometry decode problem is exactly as unrecoverable as a driver
      // problem, from the user's point of view — same fallback either way.
      renderer.dispose();
      setFallback(true);
      return;
    }
    scene.add(can);

    scene.add(new THREE.HemisphereLight(0xdfe8df, 0x050705, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.7);
    key.position.set(2.4, 3.2, 3.4);
    const fill = new THREE.DirectionalLight(0xa9b6a9, 0.7);
    fill.position.set(-3, 0.6, 1.6);
    // Both point lights below were tuned against the old procedural label
    // (mostly dark, non-metallic) and were bright enough to wash the real
    // photo label out solid green/white once metalness came down to a
    // legible level. Same idea (a coloured rim + a soft specular kiss), a
    // small fraction of the intensity.
    const rimLight = new THREE.PointLight(new THREE.Color(variant.accent), 1.4, 8, 2);
    rimLight.position.set(-1.5, 0.4, -1.8);
    const spec = new THREE.PointLight(0xffffff, 1, 9, 2);
    spec.position.set(1.6, -0.8, 2.2);
    scene.add(key, fill, rimLight, spec);

    const clock = new THREE.Clock();
    let bob = 0;

    const loop = () => {
      frame.current = requestAnimationFrame(loop);
      const dt = Math.min(0.05, clock.getDelta());
      const d = drag.current;
      if (!d.active) {
        d.rotation += spin * dt + d.velocity;
        d.velocity *= 0.9;
      }
      bob += dt;
      can.rotation.y = d.rotation;
      can.rotation.z = Math.sin(bob * 0.6) * 0.02;
      can.position.y = Math.sin(bob * 0.9) * 0.02;
      renderer.render(scene, camera);
      gl.endFrameEXP();
    };
    loop();
  };

  React.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // Only Original has a real scan whose baked photo actually matches the
  // flavour on screen — every other flavour would either show that same
  // Original photo (there is one real label per shell colour, not one per
  // flavour) or the white/Ultra scan, which still doesn't render right (see
  // canGeometry.gen.ts / build-can-geometry.mjs). Rather than show something
  // wrong or broken, everything else falls back to the flat, honestly-
  // abstract can — the same one used everywhere real 3D isn't worth the cost.
  const hasRealScan = variant.id === "original";

  if (fallback || !hasRealScan) {
    return (
      <View style={[styles.wrap, styles.center, style]}>
        <Can variant={variant} size={fallbackSize} />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]} {...(interactive ? responder.panHandlers : {})}>
      <GLView
        // Remounting on variant change rebuilds the scene with the new label.
        key={variant.id}
        style={StyleSheet.absoluteFill}
        onContextCreate={onContextCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  center: { alignItems: "center", justifyContent: "center" },
});
