import * as THREE from 'three';
import { uTime, clamp01 } from './shared.js';
import { buildTerrainMesh, buildHeightTexture, buildWater, SITES, roadPts, terrainHeight, WORLD_HALF } from './terrain.js';
import { SkySystem } from './sky.js';
import { buildVegetation } from './vegetation.js';
import { buildBuildings } from './buildings.js';
import { buildPelican } from './pelican.js';
import { ParticlePool, buildComposer, buildAmbient } from './effects.js';
import { Player, spawnFish } from './player.js';

const $ = (id) => document.getElementById(id);
const toastEl = $('toast');
let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ── 程序化音频 ────────────────────────────────────────────────
class GameAudio {
  constructor() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    this.noiseBuf = buf;
    this.windGain = this._loopNoise('lowpass', 420);
    this.waveGain = this._loopNoise('bandpass', 500);
    this.muted = false;
  }
  _loopNoise(type, freq) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    return g;
  }
  update(speedK, shoreK, t) {
    const w = 0.015 + speedK * 0.26;
    this.windGain.gain.value += (w - this.windGain.gain.value) * 0.05;
    const wave = shoreK * (0.04 + 0.032 * Math.sin(t * 0.62));
    this.waveGain.gain.value += (wave - this.waveGain.gain.value) * 0.04;
  }
  strike(freq, when, dur = 0.5, vol = 0.3) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g); g.connect(this.master);
    o.start(when); o.stop(when + dur + 0.05);
  }
  bell() {
    const t0 = this.ctx.currentTime;
    this.strike(2093, t0, 0.5, 0.22);
    this.strike(2794, t0 + 0.02, 0.4, 0.12);
    this.strike(2093, t0 + 0.13, 0.5, 0.2);
    this.strike(2794, t0 + 0.15, 0.4, 0.1);
  }
  blip() {
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(740, t0);
    o.frequency.exponentialRampToValueAtTime(1480, t0 + 0.12);
    g.gain.setValueAtTime(0.22, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + 0.3);
  }
  toggleMute() {
    this.muted = !this.muted;
    this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
}

// ── 小地图 ────────────────────────────────────────────────────
function bakeMinimap() {
  const N = 88, S = 176;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const cell = S / N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1) - 0.5) * 2 * WORLD_HALF;
      const z = (j / (N - 1) - 0.5) * 2 * WORLD_HALF;
      const h = terrainHeight(x, z);
      let col;
      if (h < -0.5) col = '#15506b';
      else if (h < 1.2) col = '#2a7a8a';
      else if (h < 3.5) col = '#d8c48f';
      else if (h < 42) col = h > 26 ? '#5a7d46' : '#5e8f4a';
      else if (h < 62) col = '#7a7468';
      else col = '#e8e8ea';
      g.fillStyle = col;
      g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    }
  }
  g.fillStyle = '#b28d5e';
  for (const p of roadPts) {
    const px = (p.x / (2 * WORLD_HALF) + 0.5) * S;
    const pz = (p.z / (2 * WORLD_HALF) + 0.5) * S;
    g.fillRect(px - 0.8, pz - 0.8, 1.8, 1.8);
  }
  return cv;
}

// ── 启动 ──────────────────────────────────────────────────────
async function boot() {
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe3ef, 550, 2600);
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 20000);
  camera.position.set(0, 60, 120);

  const setProgress = (pct, label) => {
    $('loadBar').style.width = pct + '%';
    $('loadLabel').textContent = label;
  };
  const steps = [
    ['生成地形网格(320×320)', () => { scene.add(buildTerrainMesh()); }],
    ['烘焙海面数据', () => {
      const heightTex = buildHeightTexture();
      const water = buildWater(heightTex);
      scene.add(water.mesh);
      G.water = water;
    }],
    ['点亮天空与昼夜', () => { G.sky = new SkySystem(scene, renderer); G.sky.setFog(scene.fog); }],
    ['种植 6000+ 株植被', () => { buildVegetation(scene); }],
    ['建造村庄·灯塔·大桥', () => { G.buildings = buildBuildings(scene); }],
    ['组装鹈鹕与单车', () => { G.rig = buildPelican(); scene.add(G.rig.root); }],
    ['撒下金色小鱼', () => { G.fish = spawnFish(scene); }],
    ['准备相机与后期', () => {
      G.particles = { dust: new ParticlePool(scene, 400, false), spark: new ParticlePool(scene, 300, true) };
      G.ambient = buildAmbient(scene);
      const c = buildComposer(renderer, scene, camera);
      G.composer = c.composer; G.grade = c.grade;
      G.mapBake = bakeMinimap();
      G.player = new Player({
        rig: G.rig, camera, dom: window, particles: G.particles,
        onCollect, audio: null, toast,
      });
      G.player.setFish(G.fish);
    }],
  ];

  const G = (window.__G = {});
  let fishCount = 0, fishTotal = 0;
  function onCollect() {
    fishCount++;
    $('hudFish').textContent = `🐟 ${fishCount} / ${fishTotal}`;
    G.rig.setBasketFish(Math.min(fishCount, 5));
    if (G.audio) G.audio.blip();
  }

  for (let i = 0; i < steps.length; i++) {
    setProgress(Math.round((i / steps.length) * 100), steps[i][0]);
    await new Promise(r => setTimeout(r, 30));
    steps[i][1]();
  }
  fishTotal = G.fish.length;
  $('hudFish').textContent = `🐟 0 / ${fishTotal}`;
  setProgress(100, '完成!');
  $('loading').classList.add('done');
  $('title').classList.add('ready');

  // 标题页:镜头绕村缓推
  let started = false;
  $('startBtn').addEventListener('click', () => {
    started = true;
    $('title').classList.add('gone');
    try { G.audio = new GameAudio(); G.player.audio = G.audio; } catch (e) { console.warn('音频初始化失败', e); }
    G.player.camPos.set(G.player.pos.x - Math.sin(G.player.heading) * 8, G.player.pos.y + 4, G.player.pos.z - Math.cos(G.player.heading) * 8);
    toast('骑上单车,去看看这座岛吧!W 前进 · Space 跳');
  });

  // 快捷键
  window.addEventListener('keydown', (e) => {
    if (!started) return;
    if (e.code === 'KeyC') toast(G.player.cycleCam());
    if (e.code === 'KeyM') $('minimapWrap').classList.toggle('hide');
    if (e.code === 'KeyP') document.body.classList.toggle('photo');
    if (e.code === 'KeyT') {
      const m = G.sky.cycleSpeed();
      toast(m === 0 ? '时间暂停' : `时间流速 ${m}×`);
    }
    if (e.code === 'KeyF') { G.rig.bell(); if (G.audio) G.audio.bell(); }
    if (e.code === 'KeyR') G.player.reset();
    if (e.code === 'KeyN' && G.audio) toast(G.audio.toggleMute() ? '已静音' : '声音开启');
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    G.composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── 主循环 ──
  const clock = new THREE.Clock();
  const mapCtx = $('minimap').getContext('2d');
  const mapS = 176;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    uTime.value = t;

    if (!started) {
      // 标题环绕镜头
      const a = t * 0.07;
      const vx = SITES.village.x, vz = SITES.village.z;
      camera.position.set(vx + Math.cos(a) * 55, terrainHeight(vx, vz) + 22, vz + Math.sin(a) * 55);
      camera.lookAt(vx, terrainHeight(vx, vz) + 5, vz);
      G.sky.update(dt, camera.position);
    } else {
      const st = G.player.update(dt, t);
      G.sky.update(dt, G.player.pos);
      if (G.audio) {
        const h = terrainHeight(G.player.pos.x, G.player.pos.z);
        const shoreK = clamp01(1 - (h - 0.5) / 9);
        G.audio.update(st.speedK, Math.max(0, shoreK), t);
      }
      // HUD
      $('hudSpeed').textContent = Math.round(Math.abs(G.player.speed) * 2.4);
    }

    const state = G.sky.state;
    const pal = state.pal;
    const wu = G.water.uniforms;
    wu.uTime.value = t;
    const glitDay = state.e > 0.02;
    wu.uSunDir.value.copy(glitDay ? G.sky.sunDir : G.sky.moonDir);
    if (!glitDay) wu.uSunDir.value.y = Math.abs(wu.uSunDir.value.y);
    wu.uSunColor.value.copy(pal.sun).multiplyScalar(0.25 + pal.sunI * 0.25);
    wu.uSky.value.copy(pal.waterSky);
    wu.uDeep.value.copy(pal.deep);
    wu.uShallow.value.copy(pal.shallow);

    G.buildings.update(dt, t, state.nightK);
    G.ambient.update(dt, t, state.nightK, state.dayK);
    G.particles.dust.update(dt);
    G.particles.spark.update(dt);
    if (G.grade) {
      G.grade.uniforms.uTime.value = t;
      const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
      G.grade.uniforms.uRes.value.copy(sz);
    }
    $('hudTime').textContent = (state.dayK > 0.45 ? '☀ ' : state.nightK > 0.5 ? '🌙 ' : '🌇 ') + G.sky.clockText();

    // 小地图
    if (!$('minimapWrap').classList.contains('hide') && started) {
      mapCtx.clearRect(0, 0, mapS, mapS);
      mapCtx.drawImage(G.mapBake, 0, 0);
      const toMap = (x, z) => [(x / (2 * WORLD_HALF) + 0.5) * mapS, (z / (2 * WORLD_HALF) + 0.5) * mapS];
      mapCtx.fillStyle = '#ffd94a';
      for (const f of G.fish) {
        if (f.taken) continue;
        const [mx, my] = toMap(f.x, f.z);
        mapCtx.fillRect(mx - 1, my - 1, 2.4, 2.4);
      }
      const [px, py] = toMap(G.player.pos.x, G.player.pos.z);
      mapCtx.save();
      mapCtx.translate(px, py);
      mapCtx.rotate(G.player.heading);
      mapCtx.fillStyle = '#ffffff';
      mapCtx.strokeStyle = '#1a2a3a';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -6); mapCtx.lineTo(4.2, 4.5); mapCtx.lineTo(0, 2.2); mapCtx.lineTo(-4.2, 4.5);
      mapCtx.closePath();
      mapCtx.fill(); mapCtx.stroke();
      mapCtx.restore();
    }

    G.composer.render();
  }
  frame();
}

boot().catch((err) => {
  console.error(err);
  window.__bootStack = err && err.stack ? String(err.stack) : String(err);
  $('loadLabel').textContent = '出错了:' + err.message;
  $('loadLabel').style.color = '#ff8a8a';
});
