import * as THREE from "three";

// Can geometry/anatomy ported from the Claude Design project's gl-can.js
// (monster-tracker/design-import/gl-can.js) — shoulder/neck/rim/pull-tab/
// base, not just a plain cylinder. The label texture is our own: black body
// + green claw-scratch streaks, deliberately not a pixel copy of Monster's
// actual registered wordmark/logo (trademark reasons) — gl-can.js used a
// fictional "VENOM" brand for the same reason; we're reading as "Monster"
// via color language + the claw-scratch motif instead.
function buildLabelTexture(label) {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0d0f0d");
  grad.addColorStop(0.45, "#050605");
  grad.addColorStop(1, "#0b0d0b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // claw-scratch streaks (wraps around the can, so draw it twice side by side
  // like gl-can.js does for its accent band)
  for (let i = 0; i < 2; i++) {
    const ox = i * (w / 2);
    ctx.save();
    ctx.translate(ox + w / 4, h * 0.5);
    ctx.rotate(-0.3);
    const streakColors = ["#39ff6a", "#22c94f", "#0fae3a"];
    for (let j = 0; j < 3; j++) {
      const x = (j - 1) * 130;
      const g = ctx.createLinearGradient(x, -330, x, 330);
      g.addColorStop(0, "rgba(57,255,106,0)");
      g.addColorStop(0.15, streakColors[j]);
      g.addColorStop(0.85, streakColors[j]);
      g.addColorStop(1, "rgba(57,255,106,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 34, -330);
      ctx.lineTo(x + 14, -330);
      ctx.lineTo(x + 56, 330);
      ctx.lineTo(x + 8, 330);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // wordmark + flavor label
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = '700 150px Archivo, Inter, system-ui, sans-serif';
    ctx.fillText("MONSTER", ox + w / 4, h * 0.235);
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.font = '500 58px Archivo, Inter, system-ui, sans-serif';
    ctx.fillText(String(label || "ENERGY").toUpperCase(), ox + w / 4, 700);
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 3;
    ctx.strokeRect(ox + w / 4 - 262, 760, 524, 4);
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.font = '500 38px Archivo, Inter, system-ui, sans-serif';
    ctx.fillText("500 ML · ENERGY", ox + w / 4, 850);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const labelTextureCache = new Map();
function getLabelTexture(label) {
  const key = label || "ENERGY";
  if (!labelTextureCache.has(key)) labelTextureCache.set(key, buildLabelTexture(key));
  return labelTextureCache.get(key);
}

/**
 * Builds a can mesh group (body + shoulder + neck + rim + pull-tab + base).
 * `recent` adds a pulsing green rim-outline signaling "sold here recently".
 */
export function createCanMesh({ recent = false, featured = false, label = "Original" } = {}) {
  const group = new THREE.Group();
  group.name = "EnergyCan";

  const R = 0.5;
  const H = 1.42;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R * 0.985, H, 64, 1, true),
    new THREE.MeshStandardMaterial({ map: getLabelTexture(label), metalness: 0.5, roughness: 0.34 })
  );
  body.name = "Body";
  group.add(body);

  const metal = new THREE.MeshStandardMaterial({ color: 0xbfc6bf, metalness: 1, roughness: 0.26 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x6e746e, metalness: 1, roughness: 0.38 });

  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R, H * 0.11, 64, 1, true), metal);
  shoulder.position.y = H / 2 + H * 0.055;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.7, R * 0.72, H * 0.05, 64), metal);
  neck.position.y = H / 2 + H * 0.135;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.7, R * 0.035, 10, 64), metal);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H / 2 + H * 0.158;
  const lid = new THREE.Mesh(new THREE.CircleGeometry(R * 0.7, 64), darkMetal);
  lid.rotation.x = -Math.PI / 2;
  lid.position.y = H / 2 + H * 0.152;
  const tab = new THREE.Mesh(new THREE.TorusGeometry(R * 0.16, R * 0.022, 8, 32), metal);
  tab.rotation.x = Math.PI / 2;
  tab.position.set(0, H / 2 + H * 0.168, R * 0.16);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.78, H * 0.09, 64, 1, true), darkMetal);
  base.position.y = -H / 2 - H * 0.04;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(R * 0.78, 64), darkMetal);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -H / 2 - H * 0.085;

  group.add(shoulder, neck, rim, lid, tab, base, bottom);

  // Featured (a store owner is paying to be boosted) takes visual priority
  // over the "recently sold" glow when both are true — gold beats green.
  let outline = null;
  if (recent || featured) {
    const color = featured ? 0xffd23f : 0x39ff6a;
    const outlineMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.85,
    });
    outline = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.985, H, 32, 1, true), outlineMat);
    outline.scale.setScalar(1.14);
    group.add(outline);

    const glow = new THREE.PointLight(color, 1.4, 4);
    glow.position.set(0, 0, 0.9);
    group.add(glow);
  }

  group.userData.outlineMesh = outline;
  group.userData.recent = recent;
  group.userData.featured = featured;
  return group;
}

export function animateOutlinePulse(group, elapsedSeconds) {
  const outline = group.userData.outlineMesh;
  if (!outline) return;
  const pulse = 1.12 + Math.sin(elapsedSeconds * 2.4) * 0.03;
  outline.scale.setScalar(pulse);
  outline.material.opacity = 0.55 + Math.sin(elapsedSeconds * 2.4) * 0.25;
}

/**
 * A standalone, self-contained draggable "hero" can — its own scene/camera/
 * renderer/lighting/animation loop, for the large can shown beside the info
 * bubble when a pin is focused. Drag-to-spin physics ported from gl-can.js.
 * Call `.mount(container)` once, `.setLabel(name)` when the focused store's
 * variant changes, and `.dispose()` when the container is torn down for good
 * (not needed here since we keep one instance alive for the app's lifetime).
 */
export function createHeroCan() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.18, 4.6);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let group = createCanMesh({ recent: false, label: "Original" });
  scene.add(group);

  scene.add(new THREE.HemisphereLight(0xdfe8df, 0x050705, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.7);
  key.position.set(2.4, 3.2, 3.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa9b6a9, 0.7);
  fill.position.set(-3, 0.6, 1.6);
  scene.add(fill);
  const rimLight = new THREE.PointLight(0x39ff6a, 9, 8, 2);
  rimLight.position.set(-1.5, 0.4, -1.8);
  scene.add(rimLight);
  const spec = new THREE.PointLight(0xffffff, 6, 9, 2);
  spec.position.set(1.6, -0.8, 2.2);
  scene.add(spec);

  group.rotation.y = -0.35;
  let dragging = false;
  let lastX = 0;
  let vel = 0;
  let tilt = 0;
  let raf = 0;
  let t0 = performance.now();
  let host = null;

  const onDown = (e) => {
    dragging = true;
    lastX = e.clientX;
    host.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    group.rotation.y += dx * 0.012;
    vel = dx * 0.012;
  };
  const onUp = () => { dragging = false; };

  function resize() {
    if (!host) return;
    // clientWidth/Height, not getBoundingClientRect — the phone frame may be
    // CSS-scaled to fit the window and we want the unscaled layout size.
    const w = host.clientWidth || 150;
    const h = host.clientHeight || 276;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - t0) / 1000);
    t0 = t;
    if (!dragging) {
      group.rotation.y += 0.34 * dt + vel;
      vel *= 0.9;
    }
    tilt += dt;
    group.rotation.z = Math.sin(tilt * 0.6) * 0.02;
    group.position.y = Math.sin(tilt * 0.9) * 0.02;
    renderer.render(scene, camera);
  }

  return {
    mount(container) {
      host = container;
      host.appendChild(renderer.domElement);
      Object.assign(renderer.domElement.style, { display: "block", width: "100%", height: "100%" });
      host.addEventListener("pointerdown", onDown);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerup", onUp);
      host.addEventListener("pointercancel", onUp);
      new ResizeObserver(resize).observe(host);
      resize();
      raf = requestAnimationFrame(loop);
    },
    setLabel(label) {
      scene.remove(group);
      group = createCanMesh({ recent: false, label });
      group.rotation.y = -0.35;
      scene.add(group);
    },
    dispose() {
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}
