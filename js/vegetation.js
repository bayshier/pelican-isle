import * as THREE from 'three';
import { terrainHeight, terrainNormal, roadDistance, ensureBridge, ensurePier, SITES } from './terrain.js';
import { fbm, rng } from './noise.js';
import { part, merge, addSway, makeMat, C } from './shared.js';

// ── 物种几何(带顶点色 + aSway 风摆权重)───────────────────────
function palmGeo() {
  const parts = [];
  const H = 7 + rng() * 5;
  const bend = rng() * Math.PI * 2, lean = 0.14 + rng() * 0.18;
  const dx = Math.cos(bend), dz = Math.sin(bend);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(dx * 1.1, H * 0.38, dz * 1.1),
    new THREE.Vector3(dx * 3.1, H * 0.76, dz * 3.1),
    new THREE.Vector3(dx * 5.2, H, dz * 5.2),
  ]);
  parts.push(part(new THREE.TubeGeometry(curve, 10, 0.26, 7), '#8a6a4a', { jit: 0.08, rnd: rng }));
  const top = new THREE.Vector3(dx * 5.2, H, dz * 5.2);
  const nF = 8 + (rng() * 2 | 0);
  for (let k = 0; k < nF; k++) {
    const yaw = (k / nF) * Math.PI * 2 + rng() * 0.4;
    const droop = 0.55 + rng() * 0.6;
    const g = part(new THREE.PlaneGeometry(3.8, 0.9, 7, 1), '#4a8a38', { jit: 0.1, rnd: rng });
    // 手动弯曲 + 渐变 + 锥形
    const pos = g.attributes.position, col = g.attributes.color;
    const base = C('#2f7030'), tip = C('#8cc04a');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + 1.9;              // 0..3.8
      pos.setX(i, x);
      pos.setY(i, pos.getY(i) * (1 - (x / 3.8) * 0.75) - (x / 3.8) ** 2 * droop * 2.4);
      c.copy(base).lerp(tip, x / 3.8);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    g.rotateX(-Math.PI / 2);
    g.rotateY(yaw);
    g.translate(top.x, top.y - 0.15, top.z);
    parts.push(g);
  }
  for (let k = 0; k < 3; k++) {
    parts.push(part(new THREE.IcosahedronGeometry(0.22, 1), '#6b5232', {
      x: top.x + (rng() - 0.5) * 0.7, y: top.y - 0.35, z: top.z + (rng() - 0.5) * 0.7, rnd: rng, jit: 0.1,
    }));
  }
  const geo = merge(parts);
  addSway(geo, H * 0.5, H * 1.3, 0, 1.15);
  return geo;
}

function broadleafGeo() {
  const H = 4 + rng() * 2.2;
  const parts = [part(new THREE.CylinderGeometry(0.22, 0.4, H, 7), '#6d5138', { y: H / 2, jit: 0.08, rnd: rng })];
  const n = 3 + (rng() * 3 | 0);
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2, r = 0.5 + rng() * 1.3;
    const g = part(new THREE.IcosahedronGeometry(1.1 + rng() * 0.8, 1), k % 2 ? '#3f7d3a' : '#549247', {
      x: Math.cos(a) * r, y: H + 0.4 + rng() * 1.1, z: Math.sin(a) * r,
      sy: 0.8, jit: 0.1, rnd: rng,
    });
    parts.push(g);
  }
  const geo = merge(parts);
  addSway(geo, H * 0.55, H + 2.2, 0, 0.5);
  return geo;
}

function pineGeo() {
  const H = 4.5 + rng() * 2;
  const parts = [part(new THREE.CylinderGeometry(0.14, 0.26, H * 0.5, 6), '#5d4630', { y: H * 0.25, jit: 0.06, rnd: rng })];
  const tiers = [[2.0, H * 0.45], [1.55, H * 0.68], [1.05, H * 0.88]];
  tiers.forEach(([r, y], i) => {
    parts.push(part(new THREE.ConeGeometry(r, H * 0.42, 8), i % 2 ? '#2c5e33' : '#27542e', { y, jit: 0.07, rnd: rng }));
  });
  const geo = merge(parts);
  addSway(geo, H * 0.4, H * 1.15, 0, 0.35);
  return geo;
}

function bushGeo() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    parts.push(part(new THREE.IcosahedronGeometry(0.55 + rng() * 0.5, 1), k % 2 ? '#3e7a3c' : '#4f8f44', {
      x: (rng() - 0.5) * 0.9, y: 0.35 + rng() * 0.4, z: (rng() - 0.5) * 0.9, sy: 0.85, jit: 0.12, rnd: rng,
    }));
  }
  const geo = merge(parts);
  addSway(geo, 0.15, 1.2, 0, 0.55);
  return geo;
}

function rockGeo() {
  const g = part(new THREE.IcosahedronGeometry(1, 1), '#87817a', { sy: 0.75, jit: 0.18, rnd: rng });
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const s = 0.82 + ((Math.sin(i * 12.99) * 43758.55) % 1 + 1) % 1 * 0.36;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function flowerGeo(petal) {
  const parts = [
    part(new THREE.CylinderGeometry(0.025, 0.035, 0.5, 5), '#4c7a34', { y: 0.25, rnd: rng }),
    part(new THREE.IcosahedronGeometry(0.1, 0), petal, { y: 0.52, jit: 0.08, rnd: rng }),
  ];
  const geo = merge(parts);
  addSway(geo, 0.02, 0.55, 0, 1.2);
  return geo;
}

function grassGeo() {
  const parts = [];
  for (let b = 0; b < 2; b++) {
    const g = part(new THREE.PlaneGeometry(0.85, 0.5, 3, 1), '#5d9c3f', { ry: b * Math.PI / 2, jit: 0.15, rnd: rng });
    const pos = g.attributes.position, col = g.attributes.color;
    const base = C('#4a8232'), tip = C('#8ec060');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + 0.25;
      pos.setX(i, pos.getX(i) + (y / 0.5) ** 2 * 0.16);
      c.copy(base).lerp(tip, y / 0.5);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    parts.push(g);
  }
  const geo = merge(parts);
  addSway(geo, 0, 0.5, 0, 1.3);
  return geo;
}

function driftwoodGeo() {
  const L = 1.8 + rng() * 1.6;
  const g = part(new THREE.CylinderGeometry(0.13, 0.2, L, 6), '#9a8a74', { rz: Math.PI / 2, y: 0.16, jit: 0.1, rnd: rng });
  return g;
}

// ── 遮挡区(建筑/桥/栈桥走廊不种东西)─────────────────────────
function makeBlocked() {
  const B = ensureBridge(), P = ensurePier();
  const list = [
    { x: SITES.village.x, z: SITES.village.z, r: SITES.village.r + 6 },
    { x: SITES.lighthouse.x, z: SITES.lighthouse.z, r: SITES.lighthouse.r + 4 },
    { x: SITES.windmill.x, z: SITES.windmill.z, r: 14 },
    ...SITES.turbines.map(t => ({ x: t.x, z: t.z, r: 12 })),
  ];
  const segDist = (px, pz, a, b) => {
    const vx = b.x - a.x, vz = b.z - a.z;
    const t = THREE.MathUtils.clamp(((px - a.x) * vx + (pz - a.z) * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
  };
  return (x, z) => {
    for (const r of list) if ((x - r.x) ** 2 + (z - r.z) ** 2 < r.r * r.r) return true;
    if (segDist(x, z, B, { x: B.bx, z: B.bz }) < 6) return true;
    if (segDist(x, z, P, { x: P.bx, z: P.bz }) < 6) return true;
    return false;
  };
}

// ── 散布 ──────────────────────────────────────────────────────
export function buildVegetation(scene) {
  const blocked = makeBlocked();
  const windMat = makeMat(true);
  const staticMat = makeMat(false);

  const groups = {};   // key -> {geos:[], mats:[], matrices:[]}
  function group(key, geo, mat, count) {
    if (!groups[key]) groups[key] = { geo, mat, matrices: [] };
    groups[key].cap = count;
    return groups[key];
  }

  function tryPlace(count, rules, key, geo, mat) {
    const g = group(key, geo, mat, count);
    const dummy = new THREE.Object3D();
    let placed = 0, attempts = 0;
    while (placed < count && attempts < count * 24) {
      attempts++;
      const r = Math.sqrt(rng()) * 1270, a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z);
      if (h < rules.minH || h > rules.maxH) continue;
      const n = terrainNormal(x, z);
      if (n.y < rules.minNy) continue;
      if (rules.roadMin && roadDistance(x, z) < rules.roadMin) continue;
      if (blocked(x, z)) continue;
      if (rules.p && rng() > rules.p(x, z, h)) continue;
      const s = rules.smin + rng() * (rules.smax - rules.smin);
      dummy.position.set(x, h - (rules.sink ?? 0.25) * s, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      g.matrices.push(dummy.matrix.clone());
      placed++;
    }
    return placed;
  }

  // 湿度/patch 概率函数
  const moistAt = (x, z) => fbm(x * 0.004 + 21, z * 0.004 - 13, 3) * 0.5 + 0.5;
  const patchAt = (x, z, o) => fbm(x * 0.0026 + o, z * 0.0026 - o * 0.7, 2);

  const palmG = [palmGeo(), palmGeo(), palmGeo()];
  const leafG = [broadleafGeo(), broadleafGeo()];
  const pineG = [pineGeo(), pineGeo()];
  const bushG = [bushGeo(), bushGeo()];
  const rockG = [rockGeo(), rockGeo(), rockGeo()];
  const flowerG = [flowerGeo('#ff6b81'), flowerGeo('#ffd93d'), flowerGeo('#f368e0')];

  const defs = [
    ...palmG.map((g, i) => ({ key: `palm${i}`, geo: g, count: 95, roadMin: 7, minH: 1.4, maxH: 26, minNy: 0.86, smin: 0.8, smax: 1.5,
      p: (x, z, h) => h < 5 ? 0.95 : (patchAt(x, z, 91) > 0.12 ? 0.8 : 0.12) })),
    ...leafG.map((g, i) => ({ key: `leaf${i}`, geo: g, count: 135, roadMin: 6, minH: 4, maxH: 42, minNy: 0.82, smin: 0.8, smax: 1.4,
      p: (x, z) => moistAt(x, z) > 0.5 ? 0.8 : 0.18 })),
    ...pineG.map((g, i) => ({ key: `pine${i}`, geo: g, count: 120, roadMin: 6, minH: 26, maxH: 72, minNy: 0.8, smin: 0.9, smax: 1.6,
      p: (x, z, h) => h > 32 ? 0.9 : 0.12 })),
    ...bushG.map((g, i) => ({ key: `bush${i}`, geo: g, count: 200, roadMin: 4.5, minH: 2.5, maxH: 50, minNy: 0.8, smin: 0.7, smax: 1.6,
      p: () => 0.55 })),
    ...rockG.map((g, i) => ({ key: `rock${i}`, geo: g, count: 150, roadMin: 4, minH: -2.5, maxH: 95, minNy: 0.62, smin: 0.5, smax: 2.2, sink: 0.45,
      p: (x, z, h, ny) => 0.4 })),
    ...flowerG.map((g, i) => ({ key: `flower${i}`, geo: g, count: 360, roadMin: 4.5, minH: 3.5, maxH: 46, minNy: 0.85, smin: 0.8, smax: 1.6,
      p: (x, z) => patchAt(x, z, 41 + i * 17) > 0.05 ? 0.75 : 0.15 })),
    { key: 'grass', geo: grassGeo(), count: 2800, roadMin: 3.6, minH: 2.8, maxH: 54, minNy: 0.86, smin: 0.8, smax: 1.7,
      p: () => 0.8 },
    { key: 'driftwood', geo: driftwoodGeo(), count: 26, roadMin: 3, minH: 0.2, maxH: 2.4, minNy: 0.9, smin: 0.8, smax: 1.5, sink: 0.5,
      p: () => 0.9 },
  ];

  const matFor = (key) => (key.startsWith('rock') || key === 'driftwood') ? staticMat : windMat;

  for (const d of defs) tryPlace(d.count, d, d.key, d.geo, matFor(d.key));

  const meshes = [];
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (!g.matrices.length) continue;
    const im = new THREE.InstancedMesh(g.geo, g.mat, g.matrices.length);
    g.matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
    meshes.push(im);
  }
  return { meshes };
}
