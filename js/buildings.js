import * as THREE from 'three';
import { terrainHeight, ensureBridge, ensurePier, SITES } from './terrain.js';
import { rng } from './noise.js';
import { part, merge, makeMat, C } from './shared.js';

function segGeo(a, b, r, hex, rnd) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return part(g, hex, { rnd, jit: 0.06 });
}

const V = SITES.village;

// ── 村舍 ──────────────────────────────────────────────────────
const HOUSE_PALETTES = [
  { wall: '#f2e8d8', roof: '#b5563a' },
  { wall: '#e9d6c2', roof: '#a34e33' },
  { wall: '#dde7dc', roof: '#5f7d8c' },
];
function houseGeo(pal) {
  const W = 5.6, H = 3.3, D = 4.6;
  const parts = [
    part(new THREE.BoxGeometry(W, H, D), pal.wall, { y: H / 2, jit: 0.02, rnd: rng }),
    part(new THREE.BoxGeometry(W + 0.3, 0.35, D + 0.3), '#8f8a80', { y: 0.12, jit: 0.03, rnd: rng }),
    part(new THREE.BoxGeometry(0.9, 1.75, 0.12), '#5a3a26', { y: 0.95, z: D / 2 + 0.05, rnd: rng }),
    part(new THREE.BoxGeometry(1.3, 0.2, 0.8), '#9a958c', { y: 0.12, z: D / 2 + 0.45, rnd: rng }),
    part(new THREE.BoxGeometry(0.55, 1.5, 0.55), '#8a4a38', { x: W * 0.28, y: H + 0.7, z: 0.3, jit: 0.05, rnd: rng }),
  ];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push(part(new THREE.BoxGeometry(0.2, H, 0.2), '#7a5c40', { x: sx * (W / 2 - 0.05), y: H / 2, z: sz * (D / 2 - 0.05), rnd: rng }));
  }
  const tri = new THREE.Shape();
  tri.moveTo(-W / 2 - 0.45, 0); tri.lineTo(W / 2 + 0.45, 0); tri.lineTo(0, 2.0); tri.closePath();
  const roof = new THREE.ExtrudeGeometry(tri, { depth: D + 0.6, bevelEnabled: false });
  roof.translate(0, 0, -(D + 0.6) / 2);
  parts.push(part(roof, pal.roof, { y: H, jit: 0.04, rnd: rng }));
  return merge(parts);
}

// ── 主入口 ────────────────────────────────────────────────────
export function buildBuildings(scene) {
  const B = ensureBridge(), P = ensurePier();
  const staticMat = makeMat(false, { roughness: 0.85 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x1c2320, emissive: 0xffcf8a, emissiveIntensity: 0.2 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x4a4030, emissive: 0xffd9a0, emissiveIntensity: 0.2 });
  const stringMat = new THREE.MeshStandardMaterial({ color: 0x554433, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x3a3325, emissive: 0xffedb0, emissiveIntensity: 0.4 });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffedb0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
  const animated = [];
  const vh = terrainHeight(V.x, V.z);

  // ── 村庄 ──
  const geos = HOUSE_PALETTES.map(houseGeo);
  const windowMats = [];
  const wm = new THREE.Matrix4(), wq = new THREE.Quaternion(), ws = new THREE.Vector3(1, 1, 1), wp = new THREE.Vector3();
  // 按变体收集房屋实例矩阵 + 窗户矩阵
  const perVariant = [[], [], []];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rng() * 0.25;
    const r = 26 + rng() * 18;
    const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
    const y = terrainHeight(x, z);
    const ry = Math.atan2(V.x - x, V.z - z);
    const dummy = new THREE.Object3D();
    dummy.position.set(x, y - 0.15, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.setScalar(0.9 + rng() * 0.3);
    dummy.updateMatrix();
    perVariant[i % 3].push(dummy.matrix.clone());

    const s = dummy.scale.x;
    wq.setFromEuler(new THREE.Euler(0, ry, 0));
    for (const [lx, lz, faceRy] of [[-1.55, 2.33, 0], [1.55, 2.33, 0], [-1.55, -2.33, Math.PI], [1.55, -2.33, Math.PI]]) {
      const off = new THREE.Vector3(lx, 1.9, lz).applyQuaternion(wq).multiplyScalar(s);
      wp.set(x + off.x, y + 1.9 * s, z + off.z);
      const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry + faceRy, 0));
      wm.compose(wp, q2, ws);
      windowMats.push(wm.clone());
    }
  }
  perVariant.forEach((list, gi) => {
    const inst = new THREE.InstancedMesh(geos[gi], staticMat, list.length);
    list.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = inst.receiveShadow = true;
    scene.add(inst);
  });
  const winInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 1.0), windowMat, windowMats.length);
  windowMats.forEach((m, i) => winInst.setMatrixAt(i, m));
  scene.add(winInst);

  // 水井
  {
    const parts = [
      part(new THREE.CylinderGeometry(1.25, 1.35, 1.05, 10), '#96918a', { y: 0.5, jit: 0.04, rnd: rng }),
      part(new THREE.CylinderGeometry(1.05, 1.05, 0.1, 10), '#1a2a30', { y: 0.98, rnd: rng }),
      part(new THREE.BoxGeometry(0.16, 2.1, 0.16), '#6b5138', { x: -1.05, y: 1.5, rnd: rng }),
      part(new THREE.BoxGeometry(0.16, 2.1, 0.16), '#6b5138', { x: 1.05, y: 1.5, rnd: rng }),
    ];
    const roof = new THREE.ConeGeometry(1.9, 1.0, 4);
    parts.push(part(roof, '#a34e33', { y: 2.9, ry: Math.PI / 4, rnd: rng }));
    const well = new THREE.Mesh(merge(parts), staticMat);
    well.position.set(V.x, vh, V.z);
    well.castShadow = well.receiveShadow = true;
    scene.add(well);
  }

  // 市集摊位 ×3
  for (let i = 0; i < 3; i++) {
    const a = 1.2 + i * 1.35;
    const x = V.x + Math.cos(a) * 15, z = V.z + Math.sin(a) * 15;
    const y = terrainHeight(x, z);
    const parts = [
      part(new THREE.BoxGeometry(2.6, 0.16, 1.3), '#7a5230', { y: 0.95, rnd: rng }),
      part(new THREE.BoxGeometry(2.6, 0.75, 1.2), '#6b5138', { y: 0.5, rnd: rng }),
    ];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      parts.push(part(new THREE.BoxGeometry(0.12, 2.3, 0.12), '#8a6a45', { x: sx * 1.25, y: 1.15, z: sz * 0.62, rnd: rng }));
    }
    const awn = new THREE.BoxGeometry(3.0, 0.07, 1.8);
    const awnPart = part(awn, '#d94f4f', { y: 2.42, z: -0.15, rx: -0.18, rnd: rng });
    const apos = awnPart.attributes.position, acol = awnPart.attributes.color;
    const ca = C('#f5f0e6'), cb = C('#d94f4f');
    for (let k = 0; k < apos.count; k++) {
      const stripe = Math.floor((apos.getX(k) + 1.5) / 0.375) % 2;
      const c = stripe ? cb : ca;
      acol.setXYZ(k, c.r, c.g, c.b);
    }
    parts.push(awnPart);
    for (let f = 0; f < 7; f++) {
      parts.push(part(new THREE.IcosahedronGeometry(0.11, 0), f % 2 ? '#ff8c42' : '#c0d46a', {
        x: -1 + rng() * 2, y: 1.12, z: -0.3 + rng() * 0.6, rnd: rng,
      }));
    }
    const stall = new THREE.Mesh(merge(parts), staticMat);
    stall.position.set(x, y, z);
    stall.rotation.y = Math.atan2(V.x - x, V.z - z);
    stall.castShadow = stall.receiveShadow = true;
    scene.add(stall);
  }

  // 路灯 ×5 + 广场暖光
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.5;
    const x = V.x + Math.cos(a) * 11, z = V.z + Math.sin(a) * 11;
    const y = terrainHeight(x, z);
    const parts = [
      part(new THREE.CylinderGeometry(0.07, 0.1, 3.1, 6), '#3a3f45', { y: 1.55, rnd: rng }),
    ];
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), lampMat);
    const pole = new THREE.Mesh(merge(parts), staticMat);
    pole.position.set(x, y, z);
    lamp.position.set(x, y + 3.2, z);
    pole.castShadow = true;
    scene.add(pole, lamp);
  }
  const plazaLight = new THREE.PointLight(0xffc98a, 0, 90, 1.8);
  plazaLight.position.set(V.x, vh + 6, V.z);
  scene.add(plazaLight);

  // 串灯
  {
    const bulbPts = [];
    const wirePts = [];
    const poles = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const x = V.x + Math.cos(a) * 14, z = V.z + Math.sin(a) * 14;
      poles.push({ x, y: terrainHeight(x, z), z });
      const p = part(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 6), '#5d4630', { y: 1.7, rnd: rng });
      const m = new THREE.Mesh(p, staticMat);
      m.position.set(x, poles[i].y, z);
      m.castShadow = true;
      scene.add(m);
    }
    for (let i = 0; i < 6; i++) {
      const a = poles[i], b = poles[(i + 1) % 6];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const y = a.y + (b.y - a.y) * t + 3.3 - Math.sin(t * Math.PI) * 0.85;
        wirePts.push(new THREE.Vector3(x, y, z));
        if (k > 0 && k < 8) bulbPts.push({ x, y: y - 0.12, z });
      }
    }
    const wire = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(wirePts),
      new THREE.LineBasicMaterial({ color: 0x2a2a2a })
    );
    scene.add(wire);
    const bg = new THREE.SphereGeometry(0.085, 6, 6);
    const bulbs = new THREE.InstancedMesh(bg, stringMat, bulbPts.length);
    const d = new THREE.Object3D();
    bulbPts.forEach((p, i) => { d.position.set(p.x, p.y, p.z); d.updateMatrix(); bulbs.setMatrixAt(i, d.matrix); });
    scene.add(bulbs);
  }

  // ── 风车 ──
  {
    const W = SITES.windmill;
    const y = terrainHeight(W.x, W.z);
    const g = new THREE.Group();
    const towerParts = [
      part(new THREE.CylinderGeometry(2.2, 3.3, 9, 10), '#b7b0a4', { y: 4.5, jit: 0.03, rnd: rng }),
      part(new THREE.BoxGeometry(1.0, 1.9, 0.2), '#4a3626', { y: 1.0, z: 2.85, rnd: rng }),
      part(new THREE.ConeGeometry(2.75, 1.8, 10), '#7a4a32', { y: 9.8, rnd: rng }),
    ];
    const tower = new THREE.Mesh(merge(towerParts), staticMat);
    tower.castShadow = tower.receiveShadow = true;
    g.add(tower);
    const rotor = new THREE.Group();
    const bladeParts = [part(new THREE.SphereGeometry(0.32, 8, 8), '#5d4630', { rnd: rng })];
    for (let k = 0; k < 4; k++) {
      bladeParts.push(part(new THREE.BoxGeometry(0.3, 5.6, 0.14), '#6b5138', { y: 2.9, rz: k * Math.PI / 2, rnd: rng }));
      bladeParts.push(part(new THREE.PlaneGeometry(1.15, 4.6), '#e8dfc8', { x: 0.62, y: 3.0, rz: k * Math.PI / 2, s: 1, rnd: rng }));
    }
    const rotorMesh = new THREE.Mesh(merge(bladeParts), staticMat);
    rotorMesh.castShadow = true;
    rotor.add(rotorMesh);
    rotor.position.set(0, 8.4, 3.0);
    g.add(rotor);
    g.position.set(W.x, y - 0.6, W.z);
    g.rotation.y = Math.atan2(W.x - SITES.mountain.x, W.z - SITES.mountain.z);
    scene.add(g);
    animated.push((dt, t) => { rotor.rotation.z -= dt * 0.55; });
  }

  // ── 灯塔 ──
  let beamGroup, lampLight;
  {
    const L = SITES.lighthouse;
    const y = terrainHeight(L.x, L.z);
    const g = new THREE.Group();
    const parts = [
      part(new THREE.CylinderGeometry(6.2, 7.2, 4.5, 12), '#7d7a72', { y: 2, jit: 0.05, rnd: rng }),
      part(new THREE.CylinderGeometry(2.55, 3.2, 22, 12), '#f4f1ea', { y: 4.5 + 11, jit: 0.015, rnd: rng }),
      part(new THREE.CylinderGeometry(2.86, 2.98, 3.1, 12), '#c0392b', { y: 10.6, rnd: rng }),
      part(new THREE.CylinderGeometry(2.68, 2.8, 3.1, 12), '#c0392b', { y: 18.4, rnd: rng }),
      part(new THREE.CylinderGeometry(3.15, 3.15, 0.5, 12), '#3a3f45', { y: 26.8, rnd: rng }),
      part(new THREE.ConeGeometry(2.5, 1.8, 12), '#c0392b', { y: 30.4, rnd: rng }),
    ];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      parts.push(part(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 5), '#3a3f45', {
        x: Math.cos(a) * 3.0, y: 27.5, z: Math.sin(a) * 3.0, rnd: rng,
      }));
    }
    const body = new THREE.Mesh(merge(parts), staticMat);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 2.5, 12), glassMat);
    lampRoom.position.y = 28.3;
    g.add(lampRoom);
    beamGroup = new THREE.Group();
    for (const s of [1, -1]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(6.5, 135, 20, 1, true), beamMat);
      beam.rotation.z = s * Math.PI / 2;
      beam.position.x = s * 67.5;
      beamGroup.add(beam);
    }
    beamGroup.position.y = 28.3;
    g.add(beamGroup);
    lampLight = new THREE.PointLight(0xffe9b0, 0, 320, 1.6);
    lampLight.position.y = 28.3;
    g.add(lampLight);
    g.position.set(L.x, y - 0.4, L.z);
    scene.add(g);
    animated.push((dt, t) => { beamGroup.rotation.y += dt * 0.5; });
  }

  // ── 栈桥 ──
  {
    const parts = [];
    const n = 28;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = P.ax + (P.bx - P.ax) * t, z = P.az + (P.bz - P.az) * t;
      const y = terrainHeight(x, z);
      parts.push(part(new THREE.BoxGeometry(3.6, 0.14, 2.05), i % 2 ? '#8a6a45' : '#94774f', {
        x, y: y + 0.08, z, ry: Math.atan2(P.ux, P.uz) + Math.PI / 2, jit: 0.06, rnd: rng,
      }));
      if (i % 3 === 0) {
        for (const s of [-1.55, 1.55]) {
          const px = x + Math.cos(Math.atan2(P.ux, P.uz)) * s, pz = z - Math.sin(Math.atan2(P.ux, P.uz)) * s;
          const seabed = Math.min(terrainHeight(px, pz) - 1.5, -2.5);
          parts.push(part(new THREE.CylinderGeometry(0.13, 0.15, y - seabed, 6), '#6b5138', {
            x: px, y: (y + seabed) / 2, z: pz, jit: 0.05, rnd: rng,
          }));
        }
      }
    }
    const pierMesh = new THREE.Mesh(merge(parts), staticMat);
    pierMesh.castShadow = pierMesh.receiveShadow = true;
    scene.add(pierMesh);
  }

  // ── 跨海大桥 ──
  {
    const parts = [];
    const len = Math.hypot(B.bx - B.ax, B.bz - B.az);
    const n = Math.floor(len / 2.4);
    const rx = -(B.bz - B.az) / len, rz = (B.bx - B.ax) / len; // 垂直方向
    const deckAt = (t) => {
      const x = B.ax + (B.bx - B.ax) * t, z = B.az + (B.bz - B.az) * t;
      return { x, z, y: terrainHeight(x, z) };
    };
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = deckAt(t);
      parts.push(part(new THREE.BoxGeometry(4.6, 0.16, 2.3), i % 2 ? '#7a5a3a' : '#84613f', {
        x: p.x, y: p.y + 0.1, z: p.z, ry: Math.atan2(B.bx - B.ax, B.bz - B.az) + Math.PI / 2, jit: 0.05, rnd: rng,
      }));
      if (i % 2 === 0) {
        for (const s of [-2.1, 2.1]) {
          parts.push(part(new THREE.CylinderGeometry(0.09, 0.11, 1.15, 6), '#6b4d30', {
            x: p.x + rx * s, y: p.y + 0.65, z: p.z + rz * s, jit: 0.05, rnd: rng,
          }));
        }
      }
    }
    // 扶手索(连接柱顶)
    for (const s of [-2.1, 2.1]) {
      let prev = null;
      for (let i = 0; i <= n; i += 2) {
        const p = deckAt(i / n);
        const cur = new THREE.Vector3(p.x + rx * s, p.y + 1.2, p.z + rz * s);
        if (prev) parts.push(segGeo(prev, cur, 0.05, '#5d4630', rng));
        prev = cur;
      }
    }
    // 桥墩
    for (let i = 1; i < n; i += 6) {
      const t = i / n;
      const p = deckAt(t);
      const seabed = Math.min(terrainHeight(p.x, p.z) - 2, -3);
      parts.push(part(new THREE.BoxGeometry(1.4, p.y - seabed, 1.4), '#8a857c', {
        x: p.x, y: (p.y + seabed) / 2, z: p.z, jit: 0.04, rnd: rng,
      }));
    }
    const bridgeMesh = new THREE.Mesh(merge(parts), staticMat);
    bridgeMesh.castShadow = bridgeMesh.receiveShadow = true;
    scene.add(bridgeMesh);
  }

  // ── 帆船 ×2 + 小舟 ──
  function boatGeo(sailColor) {
    const parts = [
      part(new THREE.BoxGeometry(1.7, 0.75, 4.4), '#8a5a36', { y: 0.35, jit: 0.05, rnd: rng }),
      part(new THREE.ConeGeometry(0.82, 1.5, 4), '#8a5a36', { y: 0.35, z: 2.7, rx: Math.PI / 2, jit: 0.05, rnd: rng }),
      part(new THREE.CylinderGeometry(0.06, 0.08, 4.6, 6), '#6b4d30', { y: 2.6, z: 0.4, rnd: rng }),
    ];
    const sail = new THREE.PlaneGeometry(1.9, 3.1, 4, 4);
    const sp = sail.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(((sp.getX(i) + 0.95) / 1.9) * Math.PI) * 0.35);
    sail.computeVertexNormals();
    parts.push(part(sail, sailColor, { y: 3.1, z: 0.42, rz: 0, rx: 0, rnd: rng }));
    return merge(parts);
  }
  const boats = [];
  {
    const pdir = Math.atan2(P.ux, P.uz);
    [[3.6, 40, '#f5f0e6'], [-4.2, 50, '#e8b4b4']].forEach(([side, along, col], i) => {
      const bx = P.ax + P.ux * along + Math.cos(pdir) * side;
      const bz = P.az + P.uz * along - Math.sin(pdir) * side;
      const g = new THREE.Group();
      const m = new THREE.Mesh(boatGeo(col), staticMat);
      m.castShadow = true;
      g.add(m);
      g.position.set(bx, 0.1, bz);
      g.rotation.y = rng() * Math.PI * 2;
      scene.add(g);
      boats.push({ g, phase: i * 2.1 });
    });
    const rb = new THREE.Group();
    const rowParts = [
      part(new THREE.BoxGeometry(1.1, 0.5, 2.6), '#a4763e', { y: 0.22, jit: 0.06, rnd: rng }),
      part(new THREE.BoxGeometry(0.9, 0.08, 0.35), '#7a5230', { y: 0.42, rnd: rng }),
    ];
    const rowMesh = new THREE.Mesh(merge(rowParts), staticMat);
    rb.add(rowMesh);
    rb.position.set(P.bx + 6, 0.08, P.bz - 2);
    scene.add(rb);
    boats.push({ g: rb, phase: 4.0 });
    animated.push((dt, t) => {
      for (const b of boats) {
        b.g.position.y = 0.08 + Math.sin(t * 0.85 + b.phase) * 0.13;
        b.g.rotation.z = Math.sin(t * 0.7 + b.phase) * 0.045;
        b.g.rotation.x = Math.sin(t * 0.55 + b.phase * 1.3) * 0.03;
      }
    });
  }

  // ── 风力发电机 ×3 ──
  {
    SITES.turbines.forEach((T, i) => {
      const y = terrainHeight(T.x, T.z);
      const g = new THREE.Group();
      const parts = [
        part(new THREE.CylinderGeometry(0.5, 0.85, 26, 8), '#eceae4', { y: 13, jit: 0.01, rnd: rng }),
        part(new THREE.BoxGeometry(1.7, 1.3, 3.2), '#e2e0da', { y: 26.2, rnd: rng }),
      ];
      const body = new THREE.Mesh(merge(parts), staticMat);
      body.castShadow = true;
      g.add(body);
      const rotor = new THREE.Group();
      const bladeParts = [];
      for (let k = 0; k < 3; k++) {
        bladeParts.push(part(new THREE.BoxGeometry(0.24, 10.8, 0.5), '#f4f2ee', { y: 5.6, rz: k * Math.PI * 2 / 3, rnd: rng }));
      }
      bladeParts.push(part(new THREE.SphereGeometry(0.42, 8, 8), '#d8d6d0', { rnd: rng }));
      const rotorMesh = new THREE.Mesh(merge(bladeParts), staticMat);
      rotorMesh.castShadow = true;
      rotor.add(rotorMesh);
      rotor.position.set(0, 26.2, 1.8);
      g.add(rotor);
      const blink = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 }));
      blink.position.set(0, 27.2, 0);
      g.add(blink);
      g.position.set(T.x, y - 1.2, T.z);
      g.rotation.y = -0.7;
      scene.add(g);
      animated.push((dt, t) => {
        rotor.rotation.z -= dt * 0.85;
        blink.material.emissiveIntensity = nightKRef * (Math.sin(t * 3 + i) > 0 ? 2.5 : 0.1);
      });
    });
  }

  // ── 热气球 ×2 ──
  function balloonGeo(cA, cB) {
    let g = new THREE.SphereGeometry(8, 22, 16);
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const a = C(cA), b = C(cB);
    for (let i = 0; i < pos.count; i++) {
      const az = Math.atan2(pos.getZ(i), pos.getX(i));
      const band = Math.floor((az / Math.PI + 1) * 5) % 2;
      const c = band ? a : b;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const parts = [g];
    parts.push(part(new THREE.ConeGeometry(2.2, 3.2, 10, 1, true), '#c9a227', { y: -9.4, rnd: rng }));
    parts.push(part(new THREE.BoxGeometry(1.9, 1.3, 1.9), '#7a5230', { y: -12.2, rnd: rng }));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const top = new THREE.Vector3(sx * 1.7, -8.6, sz * 1.7);
      const bot = new THREE.Vector3(sx * 0.8, -11.6, sz * 0.8);
      parts.push(segGeo(bot, top, 0.045, '#4a3826', rng));
    }
    const merged = merge(parts);
    merged.scale(1, 1.12, 1);
    return merged;
  }
  {
    const bdef = [
      { r: 520, h: 125, sp: 0.021, ph: 0, geo: balloonGeo('#e8595a', '#f6e7c1') },
      { r: 860, h: 158, sp: -0.015, ph: 2.4, geo: balloonGeo('#4f8fd9', '#f2d5a0') },
    ];
    for (const bd of bdef) {
      const mesh = new THREE.Mesh(bd.geo, staticMat);
      mesh.castShadow = true;
      scene.add(mesh);
      let ang = bd.ph;
      animated.push((dt, t) => {
        ang += dt * bd.sp;
        mesh.position.set(Math.cos(ang) * bd.r, bd.h + Math.sin(t * 0.3 + bd.ph) * 4, Math.sin(ang) * bd.r);
        mesh.rotation.z = Math.sin(t * 0.4 + bd.ph) * 0.04;
      });
    }
  }

  // ── 篝火(栈桥边沙滩)──
  let flameA, flameB, fireLight;
  {
    const fx = P.ax + Math.cos(Math.atan2(P.ux, P.uz)) * 7;
    const fz = P.az - Math.sin(Math.atan2(P.ux, P.uz)) * 7;
    const fy = Math.max(terrainHeight(fx, fz), 0.8);
    const parts = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      parts.push(part(new THREE.IcosahedronGeometry(0.3, 0), '#7d7a72', { x: Math.cos(a) * 0.95, y: 0.18, z: Math.sin(a) * 0.95, jit: 0.12, rnd: rng }));
    }
    for (let k = 0; k < 3; k++) {
      parts.push(part(new THREE.CylinderGeometry(0.09, 0.12, 1.5, 6), '#5d4630', {
        x: 0, y: 0.55, z: 0, rx: 0.9, rz: k * Math.PI * 2 / 3, jit: 0.08, rnd: rng,
      }));
    }
    const fire = new THREE.Mesh(merge(parts), staticMat);
    fire.position.set(fx, fy, fz);
    fire.castShadow = true;
    scene.add(fire);
    flameA = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 8), flameMat);
    flameB = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    flameA.position.set(fx, fy + 0.75, fz);
    flameB.position.set(fx, fy + 0.65, fz);
    scene.add(flameA, flameB);
    fireLight = new THREE.PointLight(0xff9a4a, 2.5, 32, 1.8);
    fireLight.position.set(fx, fy + 1.2, fz);
    scene.add(fireLight);
    animated.push((dt, t) => {
      const s = 1 + Math.sin(t * 11) * 0.16 + Math.sin(t * 17.3) * 0.1;
      flameA.scale.set(s, 1 + Math.sin(t * 13.7) * 0.22, s);
      flameB.scale.copy(flameA.scale);
      flameA.rotation.y += dt * 2;
      flameB.rotation.y -= dt * 2.6;
      fireLight.intensity = 2.2 + Math.sin(t * 13) * 0.7 + nightKRef * 2.2;
    });
  }

  // ── 木路牌 ×3 ──
  function signMesh(text) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#8a6a4a'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#6b5238'; g.lineWidth = 10; g.strokeRect(6, 6, 244, 116);
    g.fillStyle = '#2f2013';
    g.font = 'bold 54px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 70);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const grp = new THREE.Group();
    const post = new THREE.Mesh(part(new THREE.CylinderGeometry(0.07, 0.1, 2.4, 6), '#6b5138', { y: 1.2, rnd: rng }), staticMat);
    post.castShadow = true;
    grp.add(post);
    const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.05, 0.08), boardMat);
    board.position.y = 2.35;
    board.castShadow = true;
    grp.add(board);
    return grp;
  }
  {
    const spots = [
      { text: '渔火村', x: V.x + 20, z: V.z + 24 },
      { text: '灯塔海角', x: V.x - 30, z: V.z - 18 },
      { text: '观海栈桥', x: P.ax - 6, z: P.az + 5 },
    ];
    for (const s of spots) {
      const m = signMesh(s.text);
      m.position.set(s.x, terrainHeight(s.x, s.z), s.z);
      m.rotation.y = rng() * Math.PI * 2;
      scene.add(m);
    }
  }

  let nightKRef = 0;
  return {
    update(dt, t, nightK) {
      nightKRef = nightK;
      for (const fn of animated) fn(dt, t);
      windowMat.emissiveIntensity = 0.18 + nightK * 2.8;
      lampMat.emissiveIntensity = 0.15 + nightK * 3.2;
      stringMat.emissiveIntensity = nightK * 3.4;
      plazaLight.intensity = nightK * 26;
      glassMat.emissiveIntensity = 0.3 + nightK * 3.4;
      beamMat.opacity = nightK * 0.3;
      lampLight.intensity = nightK * 60;
    },
  };
}
