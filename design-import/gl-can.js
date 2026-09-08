// <gl-can accent="#00ff41" label="Reef Punch" spin="0.35"> — real three.js energy can.
// Drag to rotate. Original packaging design (not a licensed brand).
import * as THREE from 'https://esm.sh/three@0.166.0';

function labelTexture(accent, label) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  // base black body with vertical sheen
  const grad = g.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, '#0d0f0d'); grad.addColorStop(.45, '#050605'); grad.addColorStop(1, '#0b0d0b');
  g.fillStyle = grad; g.fillRect(0, 0, 2048, 1024);
  for (let i = 0; i < 2; i++) {
    const ox = i * 1024;
    // accent band
    g.save();
    g.translate(ox + 512, 470); g.rotate(-0.2);
    g.fillStyle = accent; g.fillRect(-700, -74, 1400, 148);
    g.globalAlpha = .45; g.fillRect(-700, 150, 1400, 34);
    g.restore();
    // top accent glow
    const tg = g.createLinearGradient(0, 40, 0, 250);
    tg.addColorStop(0, accent); tg.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = .3; g.fillStyle = tg; g.fillRect(ox, 40, 1024, 210); g.globalAlpha = 1;
    // wordmark
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = '700 168px Archivo, Inter, system-ui, sans-serif';
    g.fillText('VENOM', ox + 512, 320);
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.font = '500 62px Archivo, Inter, system-ui, sans-serif';
    g.fillText(String(label || 'ORIGINAL').toUpperCase(), ox + 512, 700);
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 3;
    g.strokeRect(ox + 250, 760, 524, 4);
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.font = '500 40px Archivo, Inter, system-ui, sans-serif';
    g.fillText('500 ML · ENERGY', ox + 512, 850);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

class GLCan extends HTMLElement {
  connectedCallback() {
    if (this._init) return;
    this._init = true;
    this.style.display = 'block';
    this.style.width = this.style.width || '100%';
    this.style.height = this.style.height || '100%';
    this.style.touchAction = 'none';
    this.style.cursor = 'grab';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0.18, 4.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.style.position = this.style.position || 'relative';
    this.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%' });

    const accent = this.getAttribute('accent') || '#00ff41';
    const group = new THREE.Group();
    group.name = 'EnergyCan';

    const R = 0.5, H = 1.42;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.985, H, 96, 1, true),
      new THREE.MeshStandardMaterial({
        map: labelTexture(accent, this.getAttribute('label')),
        metalness: 0.5, roughness: 0.34,
      })
    );
    body.name = 'Body';
    group.add(body);

    const metal = new THREE.MeshStandardMaterial({ color: 0xbfc6bf, metalness: 1, roughness: 0.26 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x6e746e, metalness: 1, roughness: 0.38 });

    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R, H * 0.11, 96, 1, true), metal);
    shoulder.position.y = H / 2 + H * 0.055; shoulder.name = 'Shoulder';
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.7, R * 0.72, H * 0.05, 96), metal);
    neck.position.y = H / 2 + H * 0.135; neck.name = 'Neck';
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.7, R * 0.035, 12, 96), metal);
    rim.rotation.x = Math.PI / 2; rim.position.y = H / 2 + H * 0.158; rim.name = 'Rim';
    const lid = new THREE.Mesh(new THREE.CircleGeometry(R * 0.7, 96), darkMetal);
    lid.rotation.x = -Math.PI / 2; lid.position.y = H / 2 + H * 0.152; lid.name = 'Lid';
    const tab = new THREE.Mesh(new THREE.TorusGeometry(R * 0.16, R * 0.022, 8, 40), metal);
    tab.rotation.x = Math.PI / 2; tab.position.set(0, H / 2 + H * 0.168, R * 0.16); tab.name = 'Tab';

    const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.78, H * 0.09, 96, 1, true), darkMetal);
    base.position.y = -H / 2 - H * 0.04; base.name = 'Base';
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(R * 0.78, 96), darkMetal);
    bottom.rotation.x = Math.PI / 2; bottom.position.y = -H / 2 - H * 0.085; bottom.name = 'Bottom';
    group.add(shoulder, neck, rim, lid, tab, base, bottom);
    scene.add(group);

    scene.add(new THREE.HemisphereLight(0xdfe8df, 0x050705, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.7); key.position.set(2.4, 3.2, 3.4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xa9b6a9, 0.7); fill.position.set(-3, 0.6, 1.6); scene.add(fill);
    const rimL = new THREE.PointLight(new THREE.Color(accent), 9, 8, 2); rimL.position.set(-1.5, 0.4, -1.8); scene.add(rimL);
    const spec = new THREE.PointLight(0xffffff, 6, 9, 2); spec.position.set(1.6, -0.8, 2.2); scene.add(spec);

    const resize = () => {
      const host = this.getBoundingClientRect();
      const box = host.height > 1 ? host : (this.parentElement ? this.parentElement.getBoundingClientRect() : host);
      const w = Math.round(box.width) || 190, h = Math.round(box.height) || 300;
      renderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    new ResizeObserver(resize).observe(this);

    let spin = parseFloat(this.getAttribute('spin'));
    if (Number.isNaN(spin)) spin = 0.34;
    let vel = 0, dragging = false, lastX = 0, tilt = 0;
    group.rotation.y = -0.35;

    this.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; this.style.cursor = 'grabbing'; this.setPointerCapture(e.pointerId); });
    this.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX; lastX = e.clientX;
      group.rotation.y += dx * 0.012; vel = dx * 0.012;
    });
    const up = () => { dragging = false; this.style.cursor = 'grab'; };
    this.addEventListener('pointerup', up); this.addEventListener('pointercancel', up);

    let visible = true, raf = 0, t0 = performance.now();
    new IntersectionObserver(en => { visible = en[0].isIntersecting; }).observe(this);
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
      if (!visible) return;
      if (!dragging) { group.rotation.y += spin * dt + vel; vel *= 0.9; }
      tilt += dt;
      group.rotation.z = Math.sin(tilt * 0.6) * 0.02;
      group.position.y = Math.sin(tilt * 0.9) * 0.02;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    this._cleanup = () => { cancelAnimationFrame(raf); renderer.dispose(); };
  }
  disconnectedCallback() { this._cleanup && this._cleanup(); }
}
if (!customElements.get('gl-can')) customElements.define('gl-can', GLCan);
