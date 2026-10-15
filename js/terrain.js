import * as THREE from 'three';
import { snoise, fbm } from './noise.js';
import { C, smoothstep, clamp01, lerp } from './shared.js';

// ── 世界布局常量 ──────────────────────────────────────────────
export const WORLD_HALF = 1300;      // 地形半宽
export const WATER_HALF = 2500;      // 海面半宽
const R_ISLAND = 950;                // 主岛半径

const polar = (a, r) => ({ x: r * Math.cos(a), z: r * Math.sin(a) });

export const SITES = {
  village:    { ...polar(-0.62, 335), r: 95, h: 13, name: '渔火村' },
  lighthouse: { ...polar(2.35, 815),  r: 55, h: 27, name: '灯塔海角' },
  windmill:   polar(0.55, 470),
  mountain:   polar(1.95, 170),
  islet:      polar(4.35, 1185),
};
SITES.islet.r = 90;
SITES.turbines = [0.6, 1.35, 5.35].map(a => ({
  x: SITES.mountain.x + Math.cos(a) * 135,
  z: SITES.mountain.z + Math.sin(a) * 135,
}));

// ── 栈桥(渔火村前的海滩,纳入高度场可直接骑行)─────────────────
let pier = null;
export function ensurePier() {
  if (pier) return pier;
  const len = Math.hypot(SITES.village.x, SITES.village.z);
  const ux = SITES.village.x / len, uz = SITES.village.z / len;
  let ax = 0, az = 0, ay = 0;
  for (let r = 700; r > 300; r -= 3) {
    const x = ux * r, z = uz * r;
    const h = rawHeight(x, z);
    if (h > 1.4) { ax = x; az = z; ay = h; break; }
  }
  pier = { ax, ay, az, bx: ax + ux * 62, bz: az + uz * 62, by: 1.8, ux, uz };
  return pier;
}

function flatten(y, x, z, cx, cz, rad, target) {
  const d = Math.hypot(x - cx, z - cz);
  const w = 1 - smoothstep(rad * 0.5, rad, d);
  return lerp(y, target, w);
}

// ── 跨海大桥(离岛方向):先求岸点,再叠桥面走廊 ────────────────
let bridge = null;
export function ensureBridge() {
  if (bridge) return bridge;
  const len = Math.hypot(SITES.islet.x, SITES.islet.z);
  const ux = SITES.islet.x / len, uz = SITES.islet.z / len;
  // 从主岛内侧往外走,记录露出水面的最后一个点(主岛海岸,避免撞上离岛山坡)
  let ax = 0, az = 0, ay = 0, rLand = 0;
  for (let r = 500; r <= 1150; r += 3) {
    const h = rawHeight(ux * r, uz * r);
    if (h > 1.6) { rLand = r; }
    else if (rLand > 0) break;
  }
  for (let r = rLand + 3; r > rLand - 4; r -= 0.5) { // 细化岸点
    const h = rawHeight(ux * r, uz * r);
    if (h > 1.6) { ax = ux * r; az = uz * r; ay = h; break; }
  }
  const b = rawHeight(SITES.islet.x, SITES.islet.z);
  bridge = { ax, ay, az, bx: SITES.islet.x, by: b, bz: SITES.islet.z };
  return bridge;
}

// ── 核心高度场 ────────────────────────────────────────────────
function rawHeight(x, z) {
  const wx = x + fbm(x * 0.0008 + 7.3, z * 0.0008 + 2.1, 2) * 150;
  const wz = z + fbm(x * 0.0008 - 4.7, z * 0.0008 + 9.4, 2) * 150;
  const d = Math.hypot(wx, wz);
  const m = smoothstep(R_ISLAND + 300, R_ISLAND - 140, d);
  let h = 7 + fbm(x * 0.00115 + 11.2, z * 0.00115 - 6.4, 4) * 30;
  h += fbm(x * 0.006 + 3.3, z * 0.006 + 8.8, 2) * 2.2;
  const dm = Math.hypot(x - SITES.mountain.x, z - SITES.mountain.z);
  h += Math.exp(-(dm * dm) / (2 * 205 * 205)) * 66;   // 主峰
  let y = -24 + (h + 24) * Math.pow(m, 1.28);
  const di = Math.hypot(x - SITES.islet.x, z - SITES.islet.z);
  y += Math.exp(-(di * di) / (2 * 90 * 90)) * 30;      // 离岛(独立于主岛掩膜)
  // 缓和海岸坡度,做出宽沙滩
  if (y > -6 && y < 8) { const k = 1 - Math.abs(y - 1) / 7; y -= (y - 1) * 0.28 * Math.max(0, k) * k; }
  y = flatten(y, x, z, SITES.village.x, SITES.village.z, SITES.village.r, SITES.village.h);
  y = flatten(y, x, z, SITES.lighthouse.x, SITES.lighthouse.z, SITES.lighthouse.r, SITES.lighthouse.h);
  return y;
}

export function terrainHeight(x, z) {
  let y = rawHeight(x, z);
  const B = bridge;
  if (B) {
    const vx = B.bx - B.ax, vz = B.bz - B.az;
    const len2 = vx * vx + vz * vz;
    const t = ((x - B.ax) * vx + (z - B.az) * vz) / len2;
    if (t > -0.02 && t < 1.02) {
      const px = B.ax + vx * t, pz = B.az + vz * t;
      const dist = Math.hypot(x - px, z - pz);
      const w = 1 - smoothstep(3.2, 4.8, dist);
      if (w > 0) {
        const deck = lerp(B.ay, B.by, clamp01(t)) + Math.sin(clamp01(t) * Math.PI) * 2.6 + 0.25;
        y = lerp(y, deck, w);
      }
    }
  }
  const P = pier;
  if (P) {
    const dot = (x - P.ax) * P.ux + (z - P.az) * P.uz;
    if (dot > -1 && dot < 64) {
      const px = P.ax + P.ux * dot, pz = P.az + P.uz * dot;
      const dist = Math.hypot(x - px, z - pz);
      const w = 1 - smoothstep(2.2, 4.0, dist);
      if (w > 0) {
        const deck = lerp(P.ay - 0.45, P.by, clamp01(dot / 16));
        y = lerp(y, deck, w);
      }
    }
  }
  return y;
}

export function terrainNormal(x, z, e = 1.6, out = new THREE.Vector3()) {
  const hL = terrainHeight(x - e, z), hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e), hU = terrainHeight(x, z + e);
  return out.set(hL - hR, 2 * e, hD - hU).normalize();
}

// ── 道路:环岛主路 + 两条支路,空间哈希供查询 ──────────────────
export let roadPts = [];
let roadGrid = null;
const ROAD_CELL = 48;

export function buildRoads() {
  if (roadPts.length) return roadPts;
  const loop = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 425 + snoise(a * 2.2, 7.7) * 85;
    loop.push(polar(a, r));
  }
  const curve = new THREE.CatmullRomCurve3(loop.map(p => new THREE.Vector3(p.x, 0, p.z)), true, 'catmullrom', 0.6);
  const samples = curve.getSpacedPoints(760).map(v => ({ x: v.x, z: v.z }));

  const nearest = (px, pz) => {
    let best = 0, bd = 1e9;
    samples.forEach((p, i) => { const d = (p.x - px) ** 2 + (p.z - pz) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const spur = (from, to) => {
    const i0 = nearest(from.x, from.z);
    const pts = [];
    for (let t = 0; t <= 1.001; t += 1 / 90) {
      const x = lerp(samples[i0].x, to.x, t) + fbm(t * 9 + from.x * 0.01, t * 7, 2) * 14 * Math.sin(t * Math.PI);
      const z = lerp(samples[i0].z, to.z, t) + fbm(t * 8 - from.z * 0.01, t * 6, 2) * 14 * Math.sin(t * Math.PI);
      pts.push({ x, z });
    }
    return pts;
  };
  roadPts = [...samples, ...spur(SITES.village, SITES.village), ...spur(SITES.village, SITES.lighthouse)];

  roadGrid = new Map();
  const key = (cx, cz) => cx * 4096 + cz;
  roadPts.forEach(p => {
    const cx = Math.floor(p.x / ROAD_CELL), cz = Math.floor(p.z / ROAD_CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const k = key(cx + dx, cz + dz);
      if (!roadGrid.has(k)) roadGrid.set(k, []);
      roadGrid.get(k).push(p);
    }
  });
  return roadPts;
}

export function roadDistance(x, z) {
  if (!roadGrid) buildRoads();
  const cx = Math.floor(x / ROAD_CELL), cz = Math.floor(z / ROAD_CELL);
  const list = roadGrid.get(cx * 4096 + cz);
  if (!list) return 999;
  let bd = 1e9;
  for (const p of list) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) bd = d; }
  return bd;
}

export function roadTangentNear(x, z) {
  buildRoads();
  let bi = 0, bd = 1e9;
  for (let i = 0; i < roadPts.length; i++) {
    const d = (roadPts[i].x - x) ** 2 + (roadPts[i].z - z) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  const a = roadPts[(bi + 3) % roadPts.length], b = roadPts[(bi - 3 + roadPts.length) % roadPts.length];
  return Math.atan2(a.x - b.x, a.z - b.z);
}

// ── 地形网格 + 顶点色 ─────────────────────────────────────────
const SEG = 320;

export function buildTerrainMesh() {
  ensureBridge(); ensurePier(); buildRoads();
  const geo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;

  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const sand = C('#e6d5a0'), sandWet = C('#c9b283'), deep = C('#173f4a');
  const grassDry = C('#96a851'), grassLush = C('#3d7a41'), jungle = C('#2e6b39');
  const rock = C('#8d8579'), rockHi = C('#a39d92'), snow = C('#edf0f2');
  const dirt = C('#b49668'), dirtWear = C('#a8895f');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const slope = 1 - nrm.getY(i);
    const moist = fbm(x * 0.004 + 21, z * 0.004 - 13, 3) * 0.5 + 0.5;
    const patch = fbm(x * 0.0028 - 31, z * 0.0028 + 17, 2);

    if (y < 0.6) {
      c.copy(sandWet).lerp(deep, clamp01((0.6 - y) / 9));
    } else {
      c.copy(sand).lerp(grassDry, clamp01((y - 3.2) / 3.5));
      const g = grassDry.clone().lerp(grassLush, moist);
      if (patch > 0.28) g.lerp(jungle, clamp01((patch - 0.28) * 2.2));
      c.lerp(g, clamp01((y - 3.2) / 3.5));
      const rk = clamp01((slope - 0.42) * 3.2) + clamp01((y - 46) / 22) * 0.8;
      c.lerp(y > 46 ? rockHi : rock, clamp01(rk));
      c.lerp(snow, clamp01((y - 66) / 9));
    }
    const rd = roadDistance(x, z);
    if (rd < 4.6 && y > 0.8) {
      const t = 1 - smoothstep(2.6, 4.6, rd);
      const rc = rd < 1.4 ? dirtWear : dirt;
      c.lerp(rc, t * 0.88);
    }
    const j = 1 + ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * 0.055;
    colors[i * 3] = Math.min(1, c.r * j); colors[i * 3 + 1] = Math.min(1, c.g * j); colors[i * 3 + 2] = Math.min(1, c.b * j);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

// ── 高度烘焙纹理(供水面做深度/泡沫)─────────────────────────
export function buildHeightTexture(N = 256) {
  const data = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1) - 0.5) * 2 * WORLD_HALF;
      const z = (j / (N - 1) - 0.5) * 2 * WORLD_HALF;
      data[j * N + i] = terrainHeight(x, z);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ── 海面:程序化法线 + 菲涅尔 + 太阳高光 + 岸边泡沫 ───────────
function makeWaterNormalTexture(size = 256) {
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    h[j * size + i] = snoise(i * 0.055, j * 0.055) * 0.65 + snoise(i * 0.13 + 40, j * 0.13 - 9) * 0.35;
  }
  const data = new Uint8Array(size * size * 4);
  const at = (i, j) => h[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const nx = (at(i - 1, j) - at(i + 1, j)) * 2.4;
    const nz = (at(i, j - 1) - at(i, j + 1)) * 2.4;
    const k = (j * size + i) * 4;
    data[k] = Math.round(THREE.MathUtils.clamp(nx * 0.5 + 0.5, 0, 1) * 255);
    data[k + 1] = Math.round(THREE.MathUtils.clamp(nz * 0.5 + 0.5, 0, 1) * 255);
    data[k + 2] = Math.round((at(i, j) * 0.5 + 0.5) * 255);
    data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildWater(heightTex) {
  const geo = new THREE.PlaneGeometry(WATER_HALF * 2, WATER_HALF * 2, 128, 128);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uNormalMap: { value: makeWaterNormalTexture() },
    uHeightMap: { value: heightTex },
    uWorldHalf: { value: WORLD_HALF },
    uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uSky: { value: new THREE.Color('#b8d9ec') },
    uDeep: { value: new THREE.Color('#0b4a6e') },
    uShallow: { value: new THREE.Color('#23a3a0') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    transparent: true,
    fog: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWorldPos;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.y += sin(p.x * 0.045 + uTime * 0.9) * 0.16 + cos(p.z * 0.05 + uTime * 1.15) * 0.14
             + sin((p.x + p.z) * 0.02 + uTime * 0.6) * 0.1;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNormalMap, uHeightMap;
      uniform float uTime, uWorldHalf;
      uniform vec3 uSunDir, uSunColor, uSky, uDeep, uShallow;
      varying vec3 vWorldPos;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 huv = vWorldPos.xz / (uWorldHalf * 2.0) + 0.5;
        float th = texture2D(uHeightMap, huv).x;
        float depth = max(-th, 0.0);

        vec2 uv1 = vWorldPos.xz * 0.055 + vec2(uTime * 0.031, uTime * 0.021);
        vec2 uv2 = vWorldPos.xz * 0.105 - vec2(uTime * 0.026, uTime * 0.018);
        vec3 n1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;
        vec3 N = normalize(vec3(n1.x + n2.x, 1.35, n1.y + n2.y));
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

        vec3 base = mix(uShallow, uDeep, clamp(depth / 7.0, 0.0, 1.0));
        vec3 col = mix(base, uSky, fres * 0.78);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 240.0) * 2.4;
        col += uSunColor * spec * clamp(uSunDir.y * 5.0, 0.0, 1.0);

        float band = smoothstep(2.8, 0.5, depth);
        float inland = smoothstep(1.6, 0.3, th);          // 离岸渐隐:内陆洼地不画水
        band *= inland;
        float fz = texture2D(uNormalMap, vWorldPos.xz * 0.09 + vec2(uTime * 0.045, 0.0)).z;
        float foam = band * smoothstep(0.62, 0.86, fz * 0.5 + 0.5 + 0.14 * sin(uTime * 2.2 + th * 4.0));
        col = mix(col, vec3(0.93, 0.97, 1.0), foam * 0.85);

        float alpha = clamp(depth / 1.8, 0.14, 1.0);
        alpha = max(alpha, foam) * inland;
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return { mesh, uniforms: mat.uniforms };
}
