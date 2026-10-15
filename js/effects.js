import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { terrainHeight } from './terrain.js';
import { fbm, rng } from './noise.js';

// ── 粒子池 ────────────────────────────────────────────────────
export class ParticlePool {
  constructor(scene, max = 500, additive = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float aSize, aAlpha;
        attribute vec3 aColor;
        varying float vAlpha; varying vec3 vColor;
        void main() {
          vAlpha = aAlpha; vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vAlpha; varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.12, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p, n, opt) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * (opt.spread || 0.4);
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * (opt.spread || 0.4);
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * (opt.spread || 0.4);
      this.vel[i * 3] = (opt.vx || 0) + (Math.random() - 0.5) * (opt.jit || 1.4);
      this.vel[i * 3 + 1] = (opt.vy || 1.2) + Math.random() * (opt.jit || 1.4);
      this.vel[i * 3 + 2] = (opt.vz || 0) + (Math.random() - 0.5) * (opt.jit || 1.4);
      this.life[i] = this.maxLife[i] = opt.life || (0.6 + Math.random() * 0.5);
      this.size[i] = opt.size || (1.2 + Math.random() * 1.2);
      this.grav[i] = opt.grav ?? 2.2;
      const c = opt.color;
      const cc = Array.isArray(c) ? c[(Math.random() * c.length) | 0] : c;
      this.col[i * 3] = cc.r; this.col[i * 3 + 1] = cc.g; this.col[i * 3 + 2] = cc.b;
      this.alpha[i] = opt.a ?? 0.55;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]) * 0.6;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}

// ── 电影感调色 ────────────────────────────────────────────────
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette;
    uniform vec2 uRes;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      float ca = 0.0022 * r * r;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.13);
      col *= 1.0 - uVignette * smoothstep(0.32, 0.85, r);
      float g = fract(sin(dot(vUv * uRes + vec2(uTime * 61.0, uTime * 83.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.024;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function buildComposer(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.45, 1.15);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return { composer, bloom, grade };
}

// ── 环境:海鸥 / 蝴蝶 / 萤火虫 ────────────────────────────────
export function buildAmbient(scene) {
  // 海鸥编队
  const flocks = [];
  const anchors = [
    { x: 300, z: 500, h: 60 }, { x: -600, z: -300, h: 90 }, { x: 500, z: -650, h: 55 },
  ];
  const birdMat = new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.9, side: THREE.DoubleSide });
  for (const a of anchors) {
    const birds = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.3), birdMat);
      const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.3), birdMat);
      wl.position.x = -0.42; wr.position.x = 0.42;
      g.add(wl, wr);
      scene.add(g);
      birds.push({ g, wl, wr, ph: i * 0.55, rad: 3 + i * 1.4 });
    }
    flocks.push({ anchor: a, birds, ang: rng() * Math.PI * 2, speed: 0.12 + rng() * 0.08 });
  }

  // 蝴蝶
  const bflies = [];
  const bMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, color: 0xffffff });
  const bColors = [0xff9f43, 0x74b9ff, 0xe055a0, 0xfdcb6e];
  for (let i = 0; i < 16; i++) {
    let x = 0, z = 0, h = 0;
    for (let k = 0; k < 30; k++) {
      x = (rng() - 0.5) * 1900; z = (rng() - 0.5) * 1900;
      h = terrainHeight(x, z);
      if (h > 4 && h < 40) break;
    }
    const g = new THREE.Group();
    const c = bColors[i % 4];
    const ml = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), bMat.clone());
    const mr = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), bMat.clone());
    ml.material.color.setHex(c); mr.material.color.setHex(c);
    ml.position.x = -0.11; mr.position.x = 0.11;
    g.add(ml, mr);
    scene.add(g);
    bflies.push({ g, ml, mr, x, z, h, ph: rng() * 10 });
  }

  // 萤火虫(夜间)
  const N = 240;
  const fp = new Float32Array(N * 3), fbase = new Float32Array(N * 3), fph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let x = 0, z = 0, h = 0;
    for (let k = 0; k < 30; k++) {
      x = (rng() - 0.5) * 2000; z = (rng() - 0.5) * 2000;
      h = terrainHeight(x, z);
      if (h > 2.5 && h < 45) break;
    }
    fbase[i * 3] = x; fbase[i * 3 + 1] = h + 0.8 + rng() * 2; fbase[i * 3 + 2] = z;
    fph[i] = rng() * 20;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  const fMat = new THREE.PointsMaterial({
    color: 0xd8ffa0, size: 0.5, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const fireflies = new THREE.Points(fg, fMat);
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  function update(dt, t, nightK, dayK) {
    for (const f of flocks) {
      f.ang += dt * f.speed;
      const cx = f.anchor.x + Math.cos(f.ang) * 55;
      const cz = f.anchor.z + Math.sin(f.ang) * 55;
      const ch = f.anchor.h + terrainHeight(cx, cz);
      for (const b of f.birds) {
        const a = f.ang * 1.15 + b.ph;
        b.g.position.set(cx + Math.cos(a) * b.rad, ch + Math.sin(a * 1.7) * 1.6, cz + Math.sin(a) * b.rad);
        b.g.rotation.y = -a - Math.PI / 2;
        const flap = Math.sin(t * 9 + b.ph * 4) * 0.55;
        b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
      }
    }
    for (const b of bflies) b.g.visible = dayK > 0.3;
    if (dayK > 0.3) {
      for (const b of bflies) {
        const px = b.x + Math.sin(t * 0.5 + b.ph) * 6 + Math.sin(t * 0.23 + b.ph * 2) * 8;
        const pz = b.z + Math.cos(t * 0.43 + b.ph) * 6;
        b.g.position.set(px, terrainHeight(px, pz) + 1 + Math.sin(t * 1.7 + b.ph) * 0.5, pz);
        b.g.rotation.y = t * 0.8 + b.ph;
        const flap = Math.sin(t * 22 + b.ph) * 0.9;
        b.ml.rotation.y = flap; b.mr.rotation.y = -flap;
      }
    }
    if (nightK > 0.01) {
      for (let i = 0; i < N; i++) {
        fp[i * 3] = fbase[i * 3] + Math.sin(t * 0.5 + fph[i]) * 2.2;
        fp[i * 3 + 1] = fbase[i * 3 + 1] + Math.sin(t * 0.9 + fph[i] * 2) * 0.8;
        fp[i * 3 + 2] = fbase[i * 3 + 2] + Math.cos(t * 0.4 + fph[i]) * 2.2;
      }
      fg.attributes.position.needsUpdate = true;
      fMat.opacity = nightK * (0.55 + Math.sin(t * 2.2) * 0.25);
    } else {
      fMat.opacity = 0;
    }
  }

  return { update };
}
