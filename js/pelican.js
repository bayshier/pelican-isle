import * as THREE from 'three';
import { C, fishGeo } from './shared.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function tube(a, b, r, mat, r2 = r) {
  const dir = _v1.subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r, len, 8);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = true;
  return m;
}

// 单位骨骼:中心在原点、高 1 的圆柱,靠 setSegment 摆放
function boneMesh(r, mat) {
  const g = new THREE.CylinderGeometry(r, r * 0.9, 1, 7);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
function setSegment(mesh, a, b) {
  const d = _v2.subVectors(b, a);
  const len = Math.max(d.length(), 0.001);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  mesh.scale.set(1, len, 1);
}

export function buildPelican() {
  const root = new THREE.Group();      // 玩家控制:位置 + 朝向
  const lean = new THREE.Group();      // 侧倾/俯仰/颠簸
  root.add(lean);

  // ── 材质 ──
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.32, metalness: 0.65, envMapIntensity: 0.8 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.92 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.25, metalness: 0.9, envMapIntensity: 1 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.72, envMapIntensity: 0.5 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xf0e3c8, roughness: 0.78 });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xf2a03d, roughness: 0.5 });
  const pouchMat = new THREE.MeshStandardMaterial({ color: 0xf5b04d, roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xe8892b, roughness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 0.4 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.7 });
  const capWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.7 });
  const basketMat = new THREE.MeshStandardMaterial({ color: 0x9a7648, roughness: 0.9 });
  const bellMat = new THREE.MeshStandardMaterial({ color: 0xe8c34a, roughness: 0.25, metalness: 0.85 });
  const fishMat = new THREE.MeshStandardMaterial({ color: 0x88b6c9, roughness: 0.4, metalness: 0.2 });

  // ── 车轮 ──
  function wheel() {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.085, 10, 26), tireMat);
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = true;
    g.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.022, 6, 22), chromeMat);
    rim.rotation.y = Math.PI / 2;
    g.add(rim);
    for (let k = 0; k < 12; k++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.94, 4), chromeMat);
      spoke.rotation.x = (k / 12) * Math.PI;
      g.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 8).rotateX(Math.PI / 2), chromeMat);
    g.add(hub);
    return g;
  }
  const rearWheel = wheel(); rearWheel.position.set(0, 0.55, -0.62);
  const rearFender = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.055, 8, 14, Math.PI * 0.72), frameMat);
  rearFender.rotation.y = Math.PI / 2;
  rearFender.rotation.z = Math.PI * 0.14;
  rearFender.position.set(0, 0.55, -0.62);
  rearFender.castShadow = true;
  const steerGroup = new THREE.Group(); steerGroup.position.set(0, 1.02, 0.56);
  const frontWheel = wheel(); frontWheel.position.set(0, -0.47, 0.17);
  const frontFender = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 8, 14, Math.PI * 0.66), frameMat);
  frontFender.rotation.y = Math.PI / 2;
  frontFender.rotation.z = Math.PI * 0.2;
  frontFender.position.set(0, -0.47, 0.17);
  frontFender.castShadow = true;
  steerGroup.add(frontWheel, frontFender);
  lean.add(rearWheel, rearFender, steerGroup);

  // ── 车架 ──
  const bb = _v3.set(0, 0.42, 0.02).clone();           // 五通
  const seatPos = new THREE.Vector3(0, 1.24, -0.34);
  const frameParts = [
    [new THREE.Vector3(0, 0.98, 0.5), bb, 0.07],        // 下管
    [new THREE.Vector3(0, 1.2, -0.3), new THREE.Vector3(0, 1.14, 0.52), 0.06], // 上管
    [seatPos, bb, 0.07],                                 // 座管
    [new THREE.Vector3(-0.07, 0.55, -0.62), new THREE.Vector3(-0.05, 0.42, 0.02), 0.045], // 后下叉
    [new THREE.Vector3(0.07, 0.55, -0.62), new THREE.Vector3(0.05, 0.42, 0.02), 0.045],
    [new THREE.Vector3(-0.06, 0.55, -0.62), seatPos, 0.04], // 后上叉
    [new THREE.Vector3(0.06, 0.55, -0.62), seatPos, 0.04],
  ];
  for (const [a, b, r] of frameParts) lean.add(tube(a, b, r, frameMat));
  const seatPost = tube(seatPos, new THREE.Vector3(0, 1.42, -0.38), 0.028, chromeMat);
  lean.add(seatPost);
  const saddle = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), darkMat);
  saddle.scale.set(0.75, 0.4, 1.5);
  saddle.position.set(0, 1.46, -0.38);
  saddle.castShadow = true;
  lean.add(saddle);
  // 牙盘 / 飞轮
  const chainring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 18), chromeMat);
  chainring.rotation.y = Math.PI / 2;
  chainring.position.copy(bb).add(new THREE.Vector3(0.11, 0, 0));
  lean.add(chainring);

  // 车把 + 前叉(随转向)
  const forkParts = [
    [new THREE.Vector3(-0.07, 0, 0), new THREE.Vector3(-0.07, -0.47, 0.17), 0.028],
    [new THREE.Vector3(0.07, 0, 0), new THREE.Vector3(0.07, -0.47, 0.17), 0.028],
    [new THREE.Vector3(-0.07, 0, 0), new THREE.Vector3(0.07, 0, 0), 0.03],
  ];
  for (const [a, b, r] of forkParts) steerGroup.add(tube(a, b, r, frameMat));
  const bar = tube(new THREE.Vector3(-0.46, 0.34, 0.1), new THREE.Vector3(0.46, 0.34, 0.1), 0.026, chromeMat);
  steerGroup.add(bar);
  steerGroup.add(tube(new THREE.Vector3(0, 0.05, 0.05), new THREE.Vector3(0, 0.34, 0.1), 0.03, chromeMat));
  for (const s of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 8).rotateZ(Math.PI / 2), darkMat);
    grip.position.set(s * 0.42, 0.34, 0.1);
    steerGroup.add(grip);
  }
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), bellMat);
  bell.position.set(0.12, 0.42, 0.12);
  steerGroup.add(bell);
  // 车筐 + 鱼
  const basket = new THREE.Group();
  basket.position.set(0, 0.16, 0.46);
  const bkb = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.3, 0.42), basketMat);
  bkb.castShadow = true;
  basket.add(bkb);
  const basketEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.58, 0.3, 0.42)),
    new THREE.LineBasicMaterial({ color: 0x5d4527 })
  );
  basket.add(basketEdge);
  const basketFish = [];
  for (let k = 0; k < 5; k++) {
    const f = new THREE.Mesh(fishGeo(0.34), fishMat);
    f.position.set(-0.14 + (k % 3) * 0.14, 0.16 + Math.floor(k / 3) * 0.1, (rngOff(k) - 0.5) * 0.15);
    f.rotation.set(0, k * 1.3, (k - 2) * 0.2);
    f.visible = false;
    basket.add(f);
    basketFish.push(f);
  }
  steerGroup.add(basket);

  // ── 曲柄与踏板 ──
  const crank = new THREE.Group();
  crank.position.copy(bb);
  lean.add(crank);
  const crankArms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.05), chromeMat);
    arm.position.set(s * 0.15, -0.12, 0);
    crank.add(arm);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.11), darkMat);
    pedal.position.set(s * 0.19, -0.25, 0);
    crank.add(pedal);
    crankArms.push({ arm, pedal, s });
  }

  // ── 鹈鹕本体 ──
  const pel = new THREE.Group();
  pel.position.set(0, 1.56, -0.36);
  lean.add(pel);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 14), whiteMat);
  body.scale.set(0.66, 0.76, 1.06);
  body.castShadow = true;
  pel.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), creamMat);
  belly.scale.set(0.64, 0.66, 0.96);
  belly.position.set(0, -0.1, 0.05);
  pel.add(belly);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 8), whiteMat);
  tail.position.set(0, 0.18, -0.6);
  tail.rotation.x = -2.25;
  tail.castShadow = true;
  pel.add(tail);
  // 脖子
  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.12, 0.3),
    new THREE.Vector3(0, 0.5, 0.52),
    new THREE.Vector3(0, 0.86, 0.58),
  ]);
  const neck = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 10, 0.13, 9), whiteMat);
  neck.castShadow = true;
  pel.add(neck);
  // 头
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.95, 0.6);
  pel.add(headGroup);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), whiteMat);
  skull.castShadow = true;
  headGroup.add(skull);
  for (const s of [-1, 1]) {
    const eyePatch = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), capWhiteMat);
    eyePatch.position.set(s * 0.1, 0.05, 0.13);
    headGroup.add(eyePatch);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), darkMat);
    pupil.position.set(s * 0.11, 0.05, 0.17);
    headGroup.add(pupil);
  }
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.55, 4), beakMat);
  beak.scale.set(1.5, 1, 0.55);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.01, 0.42);
  beak.castShadow = true;
  headGroup.add(beak);
  const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), pouchMat);
  pouch.scale.set(1.25, 0.95, 1.7);
  pouch.position.set(0, -0.1, 0.28);
  headGroup.add(pouch);
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), whiteMat);
  crest.position.set(0, 0.16, -0.1);
  crest.rotation.x = -0.7;
  headGroup.add(crest);
  // 水手帽
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.1, 12), capWhiteMat);
  capTop.position.set(0, 0.19, -0.02);
  capTop.rotation.x = -0.12;
  headGroup.add(capTop);
  const capBand = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.17, 0.05, 12), capMat);
  capBand.position.set(0, 0.13, -0.015);
  capBand.rotation.x = -0.12;
  headGroup.add(capBand);

  // 翅膀(搭在车把上)
  const wingL = boneMesh(0.095, whiteMat);
  const wingR = boneMesh(0.095, whiteMat);
  const wingTipL = boneMesh(0.062, whiteMat);
  const wingTipR = boneMesh(0.062, whiteMat);
  pel.add(wingL, wingR, wingTipL, wingTipR);
  const shoulderL = new THREE.Vector3(-0.36, 0.22, 0.05);
  const shoulderR = new THREE.Vector3(0.36, 0.22, 0.05);

  // 腿(IK)
  const thighL = boneMesh(0.05, legMat), shinL = boneMesh(0.04, legMat);
  const thighR = boneMesh(0.05, legMat), shinR = boneMesh(0.04, legMat);
  pel.add(thighL, shinL, thighR, shinR);
  const footL = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 4), legMat);
  const footR = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 4), legMat);
  footL.scale.set(1.4, 1, 0.9); footR.scale.set(1.4, 1, 0.9);
  footL.rotation.x = Math.PI / 2; footR.rotation.x = Math.PI / 2;
  pel.add(footL, footR);
  const hipL = new THREE.Vector3(-0.18, -0.1, 0.12);
  const hipR = new THREE.Vector3(0.18, -0.1, 0.12);
  const L1 = 0.58, L2 = 0.58;

  function rngOff(k) { return Math.abs(Math.sin(k * 127.1)) % 1; }

  // 状态
  let wheelRot = 0, crankRot = 0.6, bellT = 1;
  const knee = new THREE.Vector3(), footT = new THREE.Vector3();

  function legIK(hip, foot, thigh, shin) {
    const dy = foot.y - hip.y, dz = foot.z - hip.z;
    let L = Math.hypot(dy, dz);
    const maxL = (L1 + L2) * 0.995;
    if (L > maxL) L = maxL;
    const a = (L1 * L1 - L2 * L2 + L * L) / (2 * L);
    const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0.0001));
    const uy = dy / Math.hypot(dy, dz), uz = dz / Math.hypot(dy, dz);
    knee.set(hip.x, hip.y + uy * a + uz * h, hip.z + uz * a - uy * h);
    setSegment(thigh, hip, knee);
    setSegment(shin, knee, foot);
  }

  const gripWorldL = new THREE.Vector3(), gripWorldR = new THREE.Vector3();

  return {
    root,
    lean,
    bell() { bellT = 0; },
    setBasketFish(n) {
      basketFish.forEach((f, i) => { f.visible = i < n; });
    },
    update(dt, s) {
      const speed = s.speed || 0;
      const steer = s.steer || 0;
      const t = s.t;
      const speedK = Math.min(1, Math.abs(speed) / 14);

      // 车轮与曲柄
      wheelRot -= (speed * dt) / 0.55;
      rearWheel.rotation.x = wheelRot;
      frontWheel.rotation.x = wheelRot;
      crankRot -= speed * dt * 0.85;
      crank.rotation.x = -crankRot;
      for (const { pedal } of crankArms) pedal.rotation.x = crankRot;

      // 腿部 IK:踏板位置
      const cpy = -0.96, cpz = 0.38, r = 0.24;
      const thL = crankRot, thR = crankRot + Math.PI;
      footT.set(-0.18, cpy - Math.cos(thL) * r, cpz + Math.sin(thL) * r);
      legIK(hipL, footT, thighL, shinL);
      footT.set(0.18, cpy - Math.cos(thR) * r, cpz + Math.sin(thR) * r);
      legIK(hipR, footT, thighR, shinR);
      footL.position.set(-0.18, cpy - Math.cos(thL) * r - 0.02, cpz + Math.sin(thL) * r + 0.06);
      footR.position.set(0.18, cpy - Math.cos(thR) * r - 0.02, cpz + Math.sin(thR) * r + 0.06);

      // 车把转向 → 前轮 + 翅膀跟随
      steerGroup.rotation.y = steer * 0.42;
      gripWorldL.set(-0.42, 0.34, 0.1);
      steerGroup.localToWorld(gripWorldL);
      lean.worldToLocal(gripWorldL);
      gripWorldR.set(0.42, 0.34, 0.1);
      steerGroup.localToWorld(gripWorldR);
      lean.worldToLocal(gripWorldR);
      const flap = Math.sin(t * 6 + crankRot * 2) * 0.02 * (0.4 + speedK);
      // 肩→握把,转为 pel 局部坐标(pel 无旋转,直接减位置)
      const gl = _v1.copy(gripWorldL).sub(pel.position);
      const gr = _v2.copy(gripWorldR).sub(pel.position);
      gl.y += flap; gr.y -= flap;
      setSegment(wingL, shoulderL, gl);
      setSegment(wingR, shoulderR, gr);
      const elbL = _v3.lerpVectors(shoulderL, gl, 0.72); setSegment(wingTipL, elbL, gl);
      const elbR = _v3.lerpVectors(shoulderR, gr, 0.72); setSegment(wingTipR, elbR, gr);

      // 头部看向转向方向 + 随速度低头
      headGroup.rotation.y = THREE.MathUtils.lerp(headGroup.rotation.y, steer * 0.5 + Math.sin(t * 0.6) * 0.06, 0.12);
      headGroup.rotation.x = THREE.MathUtils.lerp(headGroup.rotation.x, -speedK * 0.14 + Math.sin(t * 1.3) * 0.03, 0.1);

      // 侧倾 + 颠簸
      const roll = -steer * 0.34 * speedK;
      lean.rotation.z = THREE.MathUtils.lerp(lean.rotation.z, roll, 0.12);
      lean.position.y = Math.sin(crankRot * 2) * 0.018 * speedK + (s.hopAir ? 0.04 : 0);

      // 铃铛脉冲
      if (bellT < 1) {
        bellT = Math.min(1, bellT + dt * 3.2);
        const k = 1 + Math.sin(bellT * Math.PI) * 0.9;
        bell.scale.setScalar(k);
      }
    },
  };
}
