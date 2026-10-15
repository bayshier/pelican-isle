import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { part, merge } from './shared.js';

const _c1 = new THREE.Color(), _c2 = new THREE.Color();

// 按太阳高度角 e 插值的配色关键帧
const STOPS = [
  { e: -0.22, fog: '#131a30', waterSky: '#1d2c4a', deep: '#071426', shallow: '#12304a', sun: '#b8c8ff', sunI: 0,   hemiSky: '#31406a', hemiGnd: '#1a2130', hemiI: 0.34 },
  { e: -0.05, fog: '#4a3a68', waterSky: '#d98a5c', deep: '#122036', shallow: '#274a60', sun: '#ff9a5c', sunI: 0.35,hemiSky: '#54547e', hemiGnd: '#2a232e', hemiI: 0.36 },
  { e: 0.06,  fog: '#eec397', waterSky: '#ffd9a6', deep: '#11384f', shallow: '#1f7d84', sun: '#ffc27d', sunI: 2.4, hemiSky: '#c9b39a', hemiGnd: '#4a4034', hemiI: 0.42 },
  { e: 0.28,  fog: '#cfe3ef', waterSky: '#cfe4f0', deep: '#0c4a6e', shallow: '#23a3a0', sun: '#fff0d8', sunI: 3.3, hemiSky: '#bcd6ee', hemiGnd: '#6b6046', hemiI: 0.6 },
  { e: 0.7,   fog: '#c9e2ef', waterSky: '#c4e0ee', deep: '#0b4a6e', shallow: '#26a8a2', sun: '#fff6ea', sunI: 3.6, hemiSky: '#c2dcf2', hemiGnd: '#6f6448', hemiI: 0.66 },
];

function palette(e) {
  const out = {};
  let i = 0;
  while (i < STOPS.length - 2 && e > STOPS[i + 1].e) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const t = THREE.MathUtils.clamp((e - a.e) / (b.e - a.e), 0, 1);
  for (const k of ['fog', 'waterSky', 'deep', 'shallow', 'sun', 'hemiSky', 'hemiGnd']) {
    out[k] = _c1.set(a[k]).lerp(_c2.set(b[k]), t).clone();
  }
  out.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
  out.hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);
  return out;
}

export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.time24 = 8.3;          // 起始:上午
    this.cycleSec = 900;        // 一整天 = 15 分钟
    this.speedModes = [1, 40, 0];
    this.speedIdx = 0;

    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5.2;
    u.rayleigh.value = 1.7;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.85;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120;
    sc.near = 20; sc.far = 620;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);

    this.moonLight = new THREE.DirectionalLight(0x93b4e8, 0);
    scene.add(this.moonLight, this.moonLight.target);

    this.hemi = new THREE.HemisphereLight(0xbcd6ee, 0x6b6046, 0.55);
    scene.add(this.hemi);

    // 星空
    const starN = 1400, sp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const a = Math.random() * Math.PI * 2, y = 0.06 + Math.random() * 0.94;
      const r = Math.sqrt(1 - y * y) * 7400;
      sp[i * 3] = Math.cos(a) * r; sp[i * 3 + 1] = y * 7400; sp[i * 3 + 2] = Math.sin(a) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 2.1, sizeAttenuation: false, color: 0xcfe0ff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    scene.add(this.stars);

    // 月亮
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(90, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xf2efdd, fog: false, transparent: true, opacity: 0 })
    );
    scene.add(this.moon);

    // 云
    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, flatShading: true,
      transparent: true, opacity: 0.88, envMapIntensity: 0.25,
    });
    this.cloudMat = cloudMat;
    for (let i = 0; i < 15; i++) {
      const blobs = [];
      const n = 4 + (Math.random() * 4 | 0);
      for (let k = 0; k < n; k++) {
        const g = new THREE.IcosahedronGeometry(14 + Math.random() * 16, 1);
        blobs.push(part(g, '#ffffff', {
          x: (Math.random() - 0.5) * 42, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 26,
          sx: 1.5 + Math.random(), sy: 0.55 + Math.random() * 0.3, sz: 1 + Math.random() * 0.6, jit: 0.04,
        }));
      }
      const merged = new THREE.Mesh(merge(blobs), cloudMat);
      const a = Math.random() * Math.PI * 2, r = 300 + Math.random() * 1600;
      merged.position.set(Math.cos(a) * r, 250 + Math.random() * 180, Math.sin(a) * r);
      merged.userData.speed = 2 + Math.random() * 3;
      scene.add(merged);
      this.clouds.push(merged);
    }

    // PMREM 环境光
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(10000);
    this.envScene.add(this.envSky);
    this.envRT = null;
    this._envTimer = 99;

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.state = { nightK: 0, dayK: 1, e: 1, pal: palette(1) };
  }

  setFog(fog) { this.fog = fog; }
  cycleSpeed() {
    this.speedIdx = (this.speedIdx + 1) % this.speedModes.length;
    return this.speedModes[this.speedIdx];
  }

  update(dt, playerPos) {
    const mult = this.speedModes[this.speedIdx];
    this.time24 = (this.time24 + (dt * mult) / this.cycleSec * 24) % 24;

    const ang = ((this.time24 - 6) / 12) * Math.PI;
    const alt = Math.asin(THREE.MathUtils.clamp(Math.sin(ang), -1, 1)) * 0.72 + 0.0;
    const az = (this.time24 / 24) * Math.PI * 2 + 1.2;
    const e = Math.sin(alt);
    this.sunDir.set(Math.cos(alt) * Math.sin(az), Math.sin(alt), Math.cos(alt) * Math.cos(az)).normalize();
    this.moonDir.copy(this.sunDir).negate();

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);

    const pal = palette(e);
    const dayK = THREE.MathUtils.smoothstep(e, -0.06, 0.25);
    const nightK = 1 - THREE.MathUtils.smoothstep(e, -0.14, 0.03);
    this.state = { nightK, dayK, e, pal };

    // 太阳/阴影跟随玩家,保证近处影子清晰
    const anchorX = Math.round(playerPos.x / 0.5) * 0.5;
    const anchorZ = Math.round(playerPos.z / 0.5) * 0.5;
    this.sun.position.set(anchorX + this.sunDir.x * 260, this.sunDir.y * 260, anchorZ + this.sunDir.z * 260);
    this.sun.target.position.set(anchorX, 0, anchorZ);
    this.sun.intensity = pal.sunI;
    this.sun.color.copy(pal.sun);
    this.sun.castShadow = e > 0.02;

    this.moonLight.position.set(anchorX + this.moonDir.x * 260, Math.abs(this.moonDir.y) * 260, anchorZ + this.moonDir.z * 260);
    this.moonLight.target.position.set(anchorX, 0, anchorZ);
    this.moonLight.intensity = 0.65 * nightK;

    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGnd);
    this.hemi.intensity = pal.hemiI;

    if (this.fog) {
      this.fog.color.copy(pal.fog);
      this.fog.near = 550;
      this.fog.far = THREE.MathUtils.lerp(2100, 2700, dayK);
    }

    this.starMat.opacity = nightK * 0.9;
    this.moon.position.set(playerPos.x + this.moonDir.x * 7000, this.moonDir.y * 7000, playerPos.z + this.moonDir.z * 7000);
    this.moon.material.opacity = nightK;

    // 云漂移
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 2100) c.position.x = -2100;
      c.material.opacity = 0.25 + dayK * 0.6;
    }
    this.cloudMat.color.setScalar(0.22 + dayK * 0.85);

    // 环境光照:每 2.5s 重生成一次
    this._envTimer += dt;
    if (this._envTimer > 2.5) {
      this._envTimer = 0;
      const eu = this.envSky.material.uniforms;
      eu.turbidity.value = u.turbidity.value;
      eu.rayleigh.value = u.rayleigh.value;
      eu.mieCoefficient.value = u.mieCoefficient.value;
      eu.mieDirectionalG.value = u.mieDirectionalG.value;
      eu.sunPosition.value.copy(this.sunDir);
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 20000);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    return this.state;
  }

  clockText() {
    const h = Math.floor(this.time24), m = Math.floor((this.time24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
