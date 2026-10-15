import * as THREE from 'three';
import { terrainHeight, terrainNormal, roadDistance, roadTangentNear, SITES, roadPts } from './terrain.js';
import { C, fishGeo, clamp01, lerp } from './shared.js';
import { rng } from './noise.js';

const _fwd = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export function spawnFish(scene) {
  const list = [];
  const gold = new THREE.MeshStandardMaterial({
    color: 0xf5c542, roughness: 0.25, metalness: 0.85,
    emissive: 0x8a5a00, emissiveIntensity: 0.55,
  });
  const geo = fishGeo(0.9);
  const add = (x, z, y) => {
    const m = new THREE.Mesh(geo, gold);
    const h = y ?? terrainHeight(x, z) + 2.1;
    m.position.set(x, h, z);
    m.castShadow = true;
    scene.add(m);
    list.push({ m, x, z, y: h, taken: false, ph: rng() * 10 });
  };
  // 沿环岛路撒
  for (let i = 6; i < 760; i += 26) {
    const p = roadPts[i];
    const nx = p.x + (rng() - 0.5) * 16, nz = p.z + (rng() - 0.5) * 16;
    const h = terrainHeight(nx, nz);
    if (h > 1.5) add(nx, nz);
  }
  // 风景名胜
  add(SITES.village.x + 8, SITES.village.z + 8);
  add(SITES.village.x - 10, SITES.village.z - 6);
  add(SITES.windmill.x + 5, SITES.windmill.z + 3);
  add(SITES.lighthouse.x + 4, SITES.lighthouse.z + 6);
  add(SITES.mountain.x, SITES.mountain.z);
  add(SITES.islet.x, SITES.islet.z + 8);
  add(SITES.islet.x - 10, SITES.islet.z - 4);
  return list;
}

const PLACES = [
  { ...SITES.village, r: 70, text: '渔火村 —— 灯火与鱼干香气' },
  { ...SITES.lighthouse, r: 60, text: '灯塔海角 —— 为夜航的船点灯' },
  { x: SITES.windmill.x, z: SITES.windmill.z, r: 40, text: '山岗风车 —— 磨坊的吱呀声' },
  { x: SITES.mountain.x, z: SITES.mountain.z, r: 80, text: '主峰观景台 —— 整座岛尽收眼底' },
  { x: SITES.islet.x, z: SITES.islet.z, r: 95, text: '鹈鹕岩 —— 跨海大桥的另一端' },
];

export class Player {
  constructor(opt) {
    this.rig = opt.rig;
    this.camera = opt.camera;
    this.dom = opt.dom;
    this.particles = opt.particles;
    this.onCollect = opt.onCollect;
    this.audio = opt.audio;
    this.toast = opt.toast;

    this.pos = new THREE.Vector3();
    this.heading = roadTangentNear(SITES.village.x, SITES.village.z + 30);
    const sx = SITES.village.x, sz = SITES.village.z + 30;
    this.pos.set(sx, terrainHeight(sx, sz), sz);
    this.speed = 0;
    this.steer = 0;
    this.vy = 0;
    this.airborne = false;
    this.camMode = 0;
    this.orbit = { yaw: 0.6, pitch: 0.35, dist: 11 };
    this.camPos = new THREE.Vector3(sx, this.pos.y + 4, sz - 9);
    this.camLook = new THREE.Vector3();
    this.fov = 55;
    this.normalS = new THREE.Vector3(0, 1, 0);
    this.visited = new Set();
    this.dustAcc = 0;
    this.fish = [];

    this.keys = {};
    dom_keybind(this);

    let dragging = false, lx = 0, ly = 0;
    opt.dom.addEventListener('mousedown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this.orbit.yaw -= (e.clientX - lx) * 0.006;
      this.orbit.pitch = Math.max(0.05, Math.min(1.3, this.orbit.pitch + (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
    });
    opt.dom.addEventListener('wheel', (e) => {
      this.orbit.dist = Math.max(4.5, Math.min(34, this.orbit.dist + e.deltaY * 0.012));
    }, { passive: true });
  }

  setFish(list) { this.fish = list; }

  reset() {
    this.pos.set(SITES.village.x, terrainHeight(SITES.village.x, SITES.village.z + 30), SITES.village.z + 30);
    this.heading = roadTangentNear(this.pos.x, this.pos.z);
    this.speed = 0; this.vy = 0;
    this.toast('回到渔火村');
  }

  cycleCam() {
    this.camMode = (this.camMode + 1) % 3;
    return ['追尾视角', '电影视角', '环绕视角(拖拽旋转·滚轮缩放)'][this.camMode];
  }

  update(dt, t) {
    const k = this.keys;
    const fwdIn = (k.KeyW || k.ArrowUp) ? 1 : 0;
    const backIn = (k.KeyS || k.ArrowDown) ? 1 : 0;
    const steerIn = ((k.KeyA || k.ArrowLeft) ? 1 : 0) - ((k.KeyD || k.ArrowRight) ? 1 : 0);
    const drift = !!(k.ShiftLeft || k.ShiftRight);

    const rd = roadDistance(this.pos.x, this.pos.z);
    const roadK = 1 - clamp01((rd - 4) / 3);

    const maxSpd = lerp(23, 32, roadK);
    const accel = 15 + roadK * 4;
    if (fwdIn) this.speed += accel * dt;
    if (backIn) this.speed -= (this.speed > 0.5 ? 30 : 9) * dt;
    const fric = 1.6 + (1 - roadK) * 3.4 + (drift ? 5 : 0);
    this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), fric * dt);
    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    const gh1 = terrainHeight(this.pos.x + _fwd.x * 2.4, this.pos.z + _fwd.z * 2.4);
    const gh2 = terrainHeight(this.pos.x - _fwd.x * 2.4, this.pos.z - _fwd.z * 2.4);
    const grad = (gh1 - gh2) / 4.8;
    this.speed -= grad * 13.5 * dt;
    this.speed = Math.max(-6, Math.min(maxSpd, this.speed));

    const steerT = steerIn * (drift ? 1.5 : 1);
    this.steer = lerp(this.steer, steerT, 1 - Math.exp(-9 * dt));
    const yawRate = this.steer * lerp(2.15, 1.05, clamp01(Math.abs(this.speed) / maxSpd)) * (this.speed < -0.5 ? -1 : 1);
    this.heading += yawRate * dt * clamp01(Math.abs(this.speed) / 3);

    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.pos.x += _fwd.x * this.speed * dt;
    this.pos.z += _fwd.z * this.speed * dt;
    const lim = 1450;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));

    const ground = Math.max(terrainHeight(this.pos.x, this.pos.z), -1.2);
    if (this.airborne) {
      this.vy -= 19 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) { this.pos.y = ground; this.airborne = false; this.vy = 0; }
    } else {
      this.pos.y = lerp(this.pos.y, ground, 1 - Math.exp(-22 * dt));
    }

    terrainNormal(this.pos.x, this.pos.z, 2, _n);
    this.normalS.lerp(_n, 1 - Math.exp(-8 * dt)).normalize();
    _q1.setFromUnitVectors(UP, this.normalS);
    _q2.setFromAxisAngle(UP, this.heading);
    _q1.premultiply(_q2);
    this.rig.root.position.copy(this.pos);
    this.rig.root.quaternion.copy(_q1);
    this.rig.update(dt, { speed: this.speed, steer: this.steer, t, hopAir: this.airborne });

    const spdK = clamp01(Math.abs(this.speed) / maxSpd);
    const wantDust = !this.airborne && ((
      (drift && Math.abs(this.steer) > 0.4 && Math.abs(this.speed) > 9) ||
      ((1 - roadK) > 0.5 && spdK > 0.5)));
    if (wantDust) {
      this.dustAcc += dt * (drift ? 42 : 16);
      const dustCol = roadK > 0.5 ? [new THREE.Color('#c9b283')] : [new THREE.Color('#7da05a'), new THREE.Color('#96a851')];
      while (this.dustAcc > 1) {
        this.dustAcc -= 1;
        this.particles.dust.spawn(
          new THREE.Vector3(this.pos.x - _fwd.x * 0.8, this.pos.y + 0.15, this.pos.z - _fwd.z * 0.8),
          1,
          { color: dustCol, vy: 1.4, size: 1.6 + rng() * 1.6, life: 0.7 + rng() * 0.4, a: 0.34 }
        );
      }
    }

    this.collectFish();
    this.checkPlaces();

    this.updateCamera(dt, t);
    return { speedK: spdK, roadK };
  }

  collectFish() {
    for (const f of this.fish) {
      if (f.taken) continue;
      const dd = Math.hypot(f.x - this.pos.x, f.z - this.pos.z);
      if (dd < 3.3) {
        f.taken = true;
        f.m.visible = false;
        this.particles.spark.spawn(new THREE.Vector3(f.x, f.y, f.z), 24, {
          color: [new THREE.Color('#ffd97a'), new THREE.Color('#f5c542'), new THREE.Color('#fff2c8')],
          vy: 2.6, jit: 3.2, size: 1.1, life: 0.85, grav: 3.4, a: 0.9,
        });
        this.onCollect();
      }
    }
  }

  checkPlaces() {
    for (const p of PLACES) {
      if (this.visited.has(p.text)) continue;
      const dd = Math.hypot(this.pos.x - p.x, this.pos.z - p.z);
      if (dd < p.r) {
        this.visited.add(p.text);
        this.toast(p.text);
      }
    }
  }

  updateCamera(dt, t) {
    const cam = this.camera;
    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    let desired, look;
    if (this.camMode === 0) {
      const rightX = Math.cos(this.heading), rightZ = -Math.sin(this.heading);
      desired = _n.set(
        this.pos.x - _fwd.x * 8.0 + rightX * 3.0,
        this.pos.y + 3.4,
        this.pos.z - _fwd.z * 8.0 + rightZ * 3.0
      );
      look = new THREE.Vector3(this.pos.x + _fwd.x * 4, this.pos.y + 1.8, this.pos.z + _fwd.z * 4);
      this.fov = lerp(this.fov, 55 + clamp01(this.speed / 32) * 16, 1 - Math.exp(-3 * dt));
    } else if (this.camMode === 1) {
      const a = t * 0.22;
      desired = _n.set(this.pos.x + Math.cos(a) * 8.5, this.pos.y + 1.35, this.pos.z + Math.sin(a) * 8.5);
      look = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);
      this.fov = lerp(this.fov, 44, 1 - Math.exp(-3 * dt));
    } else {
      const o = this.orbit;
      const cp = Math.cos(o.pitch);
      desired = _n.set(
        this.pos.x + Math.sin(o.yaw) * cp * o.dist,
        this.pos.y + Math.sin(o.pitch) * o.dist,
        this.pos.z + Math.cos(o.yaw) * cp * o.dist
      );
      look = new THREE.Vector3(this.pos.x, this.pos.y + 1.4, this.pos.z);
      this.fov = lerp(this.fov, 55, 1 - Math.exp(-3 * dt));
    }
    const groundMin = terrainHeight(desired.x, desired.z) + 0.7;
    if (desired.y < groundMin) desired.y = groundMin;
    const kk = 1 - Math.exp(-(this.camMode === 0 ? 5.2 : 3.4) * dt);
    this.camPos.lerp(desired, kk);
    this.camLook.lerp(look, 1 - Math.exp(-8 * dt));
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}

function dom_keybind(player) {
  player.dom.addEventListener('keydown', (e) => {
    player.keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space' && !player.airborne) { player.vy = 6.4; player.airborne = true; }
  });
  player.dom.addEventListener('keyup', (e) => { player.keys[e.code] = false; });
}