import * as THREE from 'three';
import { uTime } from './shared.js';
import { TOON } from './style.js';

/* ============================================================
   天空系统(sky.js)
   ──────────────────────────────────────────────────────────
   v2:天空不再用 three 的 Sky 大气散射 + 多面体云团,而是一整块
   程序化穹顶着色器 —— 天顶/地平线渐变、朝阳侧染暖、积云、日轮、
   月亮、星空全部按「太阳高度」查同一张调色板。
   对外接口保持不变:SkySystem / update() / sunDir / moonDir /
   clockText() / cycleSpeed() / .time24 / .speedIdx / .state.pal
   ============================================================ */

/* 调色板关键帧:按 e = sin(太阳高度角) 插值。全部是 sRGB 十六进制,
   r160 的 Color() 会自动转到线性空间。
     · zenith / horizon  天顶色 / 地平线色
     · fog               雾色 = 穹顶贴着地平线的那一圈(两者必须相等,否则海天交界出一条缝)
     · sunTint           朝阳一侧地平线的染暖色
     · cloudLit / cloudShade / cloudK   云的受光色 / 背光色 / 覆盖量
     · sun / sunI        太阳光颜色 / 强度(强度 3 左右时受光面 ≈ 1×固有色)
     · hemiSky / hemiGnd / hemiI        半球光:卡通画面的"暗面"就是它
     · deep / shallow / waterSky        海面:深海 / 浅滩 / 反射的天色
     · sunDisc / sunDiscK               日轮颜色 / HDR 亮度(超过泛光阈值才会发光)
     · moonI / starI / exposure / rim / rimI   月光 / 星光 / 曝光 / 边缘光 */
const STOPS = [
  { e: -0.45,   // 深夜
    zenith: '#03061a', horizon: '#0f1a3e', fog: '#0b1330', sunTint: '#20305a',
    cloudLit: '#34406e', cloudShade: '#080c22', cloudK: 0.5,
    sun: '#000000', sunI: 0, hemiSky: '#2c3c72', hemiGnd: '#141a2c', hemiI: 1.5,
    deep: '#030a18', shallow: '#0c2240', waterSky: '#142448',
    sunDisc: '#9db8ff', sunDiscK: 0, moonI: 1.25, starI: 1, exposure: 1.15, rim: '#9db8ff', rimI: 0.16 },
  { e: -0.10,   // 暮色:太阳刚落,天顶蓝紫、地平线洋红
    zenith: '#141a4e', horizon: '#a8567e', fog: '#463c6c', sunTint: '#e06a80',
    cloudLit: '#9a6a98', cloudShade: '#2c2858', cloudK: 0.55,
    sun: '#ff8a60', sunI: 0.45, hemiSky: '#5a5490', hemiGnd: '#2a2840', hemiI: 1.2,
    deep: '#091834', shallow: '#1a3c5a', waterSky: '#58467a',
    sunDisc: '#ff8a60', sunDiscK: 2.5, moonI: 0.6, starI: 0.45, exposure: 1.08, rim: '#d080a0', rimI: 0.18 },
  { e: 0.05,    // 日落:天顶钴蓝、地平线橙
    zenith: '#3a4cb0', horizon: '#ff9a66', fog: '#e6a58a', sunTint: '#ff7a50',
    cloudLit: '#ffc59c', cloudShade: '#86608f', cloudK: 0.58,
    sun: '#ffa664', sunI: 1.75, hemiSky: '#c0b0d8', hemiGnd: '#6a5048', hemiI: 1.25,
    deep: '#153a6c', shallow: '#2a86a0', waterSky: '#e09a7c',
    sunDisc: '#ffb070', sunDiscK: 4.5, moonI: 0, starI: 0.04, exposure: 1.03, rim: '#ffb080', rimI: 0.2 },
  { e: 0.22,    // 黄金时刻
    zenith: '#3f7fd8', horizon: '#ffe2b0', fog: '#f3ddba', sunTint: '#ffd9a0',
    cloudLit: '#fff0d8', cloudShade: '#c4adc8', cloudK: 0.55,
    sun: '#ffd9a2', sunI: 2.0, hemiSky: '#d0dcf5', hemiGnd: '#8a7a52', hemiI: 1.3,
    deep: '#0d5f92', shallow: '#2abcb4', waterSky: '#7cc0e6',
    sunDisc: '#fff0c8', sunDiscK: 5, moonI: 0, starI: 0, exposure: 1.0, rim: '#ffe2b0', rimI: 0.16 },
  { e: 0.75,    // 正午:热带的蓝
    zenith: '#1f6fd0', horizon: '#b6e6f5', fog: '#cfeaf2', sunTint: '#fff2c8',
    cloudLit: '#ffffff', cloudShade: '#a8c4e0', cloudK: 0.55,
    sun: '#fff4e0', sunI: 2.0, hemiSky: '#cfe0ff', hemiGnd: '#8a8f78', hemiI: 1.3,
    deep: '#0a6a9e', shallow: '#2ccfc4', waterSky: '#4fb0e4',
    sunDisc: '#fff6e0', sunDiscK: 5, moonI: 0, starI: 0, exposure: 1.0, rim: '#ffffff', rimI: 0.1 },
];
const COLOR_KEYS = ['zenith', 'horizon', 'fog', 'sunTint', 'cloudLit', 'cloudShade', 'sun',
  'hemiSky', 'hemiGnd', 'deep', 'shallow', 'waterSky', 'sunDisc', 'rim'];
const NUM_KEYS = ['sunI', 'hemiI', 'cloudK', 'sunDiscK', 'moonI', 'starI', 'exposure', 'rimI'];
for (const s of STOPS) for (const k of COLOR_KEYS) s[k] = new THREE.Color(s[k]);

/* 复用同一组 Color 对象做插值(每帧调用,不分配新对象) */
const _pal = {};
for (const k of COLOR_KEYS) _pal[k] = new THREE.Color();
export function palette(e, out = _pal) {
  let i = 0;
  while (i < STOPS.length - 2 && e > STOPS[i + 1].e) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const t = THREE.MathUtils.clamp((e - a.e) / (b.e - a.e), 0, 1);
  for (const k of COLOR_KEYS) out[k].copy(a[k]).lerp(b[k], t);
  for (const k of NUM_KEYS) out[k] = THREE.MathUtils.lerp(a[k], b[k], t);
  return out;
}

const DOME_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;          // 像素相对相机的方向(穹顶会跟着玩家走)
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const DOME_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform float uTime, uStarI, uCloudK, uSunDiscK, uMoonK;
  uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uHaze, uSunTint, uCloudLit, uCloudShade, uSunDisc;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  /* fbm:detail 控制高倍频的占比(远处/贴地平线处压掉高频,免得闪烁) */
  float fbm(vec2 p, float detail) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p) * (i < 2 ? 1.0 : detail);
      p = p * 2.03 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sunK = smoothstep(-0.08, 0.03, uSunDir.y);     // 太阳落山后日轮与光晕一起熄灭
    float moonK = smoothstep(-0.04, 0.06, uMoonDir.y) * uMoonK;

    /* 天顶 → 地平线 */
    vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.42, h), 0.75));   // 追尾镜头只看得见低空,天顶色要尽快压下来

    /* 朝阳一侧的地平线染暖 */
    vec2 hs = normalize(uSunDir.xz + vec2(1e-5, 0.0));
    float sa = max(dot(normalize(d.xz + vec2(1e-5, 0.0)), hs), 0.0);
    col = mix(col, uSunTint, pow(sa, 3.0) * (1.0 - smoothstep(0.0, 0.5, h)) * 0.55 * sunK);

    /* 紧贴地平线切成雾色:远处的海面雾化后就是它,接缝才不会成一条线 */
    col = mix(col, uHaze, smoothstep(0.05, -0.01, h));

    /* 太阳:宽晕 + 日轮,直接写进 HDR,交给后期泛光 */
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunDisc * (pow(sd, 10.0) * 0.20 + pow(sd, 120.0) * 0.55) * sunK * 0.9;
    col += uSunDisc * smoothstep(0.99925, 0.99965, sd) * uSunDiscK;

    /* 月亮:清冷的圆盘 + 一圈光晕 */
    float md = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.62, 0.72, 1.0) * pow(md, 80.0) * 0.5 * moonK;
    col += vec3(1.0, 0.98, 0.92) * smoothstep(0.99960, 0.99978, md) * 1.5 * moonK;

    /* 星空:按格子哈希撒点,逐颗闪烁 */
    if (uStarI > 0.001 && h > 0.0) {
      vec2 sp = d.xz / (h + 0.25) * 38.0;
      vec2 cell = floor(sp), f = fract(sp);
      float rnd = hash(cell);
      vec2 off = vec2(hash(cell + 7.3), hash(cell + 3.1));
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + rnd * 2.0) + rnd * 40.0);
      float star = smoothstep(0.07, 0.0, length(f - off)) * step(0.9, rnd) * tw;
      col += vec3(0.85, 0.92, 1.0) * star * 1.3 * uStarI * smoothstep(0.0, 0.25, h);
    }

    /* 云:视线投影到高空平面取 fbm,横向拉长 → 成层的积云 */
    if (h > 0.0) {
      vec2 cp = d.xz / (h + 0.10);
      cp.x *= 0.62;
      cp += vec2(uTime * 0.0045, uTime * 0.0018);
      float detail = 1.0 - smoothstep(2.5, 9.0, length(cp));
      float n = fbm(cp * 0.9 + 3.1, mix(0.25, 1.0, detail));
      float lo = 0.60 - uCloudK * 0.16;
      float cov = smoothstep(lo, lo + 0.12, n);
      /* 云顶亮部:朝太阳方向偏移再采一次,亮面落在受光的一侧(体积感) */
      float nLit = fbm(cp * 0.9 + 3.1 + hs * 0.16 + vec2(0.0, -0.12), mix(0.25, 1.0, detail));
      float top = smoothstep(-0.02, 0.10, nLit - n);
      vec3 cloud = mix(uCloudShade, uCloudLit, top);
      cloud += uSunDisc * pow(sd, 10.0) * 0.30 * sunK;      // 朝太阳一侧的云被染暖
      float fade = smoothstep(0.012, 0.13, h) * (1.0 - smoothstep(0.72, 0.97, h));
      col = mix(col, cloud, cov * fade);
    }

    gl_FragColor = vec4(col, 1.0);
    /* 收尾:渲染进 HDR 缓冲 / 环境贴图时这两步是空操作,交给后期统一处理 */
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time24 = 8.3;          // 起始:上午
    this.cycleSec = 900;        // 一整天 = 15 分钟
    this.speedModes = [1, 40, 0];
    this.speedIdx = 0;

    /* ── 天空穹顶 ── */
    const U = this.U = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uHaze: { value: new THREE.Color() }, uSunTint: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
      uCloudK: { value: 0.55 },
      uSunDisc: { value: new THREE.Color() }, uSunDiscK: { value: 5 },
      uMoonK: { value: 0 }, uStarI: { value: 0 },
    };
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: U, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 64, 40), this.domeMat);
    // 64×40 细分不是为了圆滑:日轮/月亮是 1.5° 的硬边圆盘,三角形太大会被插值掰成多边形
    this.dome.renderOrder = -10;                 // 最先画,别的东西盖在上面
    this.dome.frustumCulled = false;
    this.dome.userData.noInk = true;              // 不描边
    scene.add(this.dome);

    /* ── 灯光 ── */
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110;    // 跟随玩家的阴影盒
    sc.near = 20; sc.far = 620;
    // normalBias 是沿法线推采样点的距离(米)。设成 0.6 的话,比它细的东西
    // (车架/辐条/树干)影子会被整个推没,鹈鹕脚下只剩一团模糊的椭圆
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.2;
    scene.add(this.sun, this.sun.target);

    this.moonLight = new THREE.DirectionalLight(0x9db8ff, 0);
    scene.add(this.moonLight, this.moonLight.target);

    this.hemi = new THREE.HemisphereLight(0x8ac2ff, 0x7c8c5c, 2);
    scene.add(this.hemi);

    /* ── 环境反射:只给金属件(车架/镀铬/金鱼)用。
         用同一块穹顶着色器当环境源 → 反射里的天色和头顶的天永远一致 ── */
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.domeMat));
    this.envRT = null;
    this._envTimer = 99;
    this._envGap = 2;                             // 重烘间隔(秒),按上次耗时自适应
    this._envSun = new THREE.Vector3(9, 9, 9);

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.state = { nightK: 0, dayK: 1, e: 1, pal: palette(1) };
    // 先跑一帧:把灯光/雾/调色板初始化好,第一次环境烘焙也留在加载画面里
    this.update(0, new THREE.Vector3());
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
    const alt = Math.asin(THREE.MathUtils.clamp(Math.sin(ang), -1, 1)) * 0.72;
    const az = (this.time24 / 24) * Math.PI * 2 + 1.2;
    const e = Math.sin(alt);
    this.sunDir.set(Math.cos(alt) * Math.sin(az), Math.sin(alt), Math.cos(alt) * Math.cos(az)).normalize();
    this.moonDir.copy(this.sunDir).negate();

    const pal = palette(e);
    const dayK = THREE.MathUtils.smoothstep(e, -0.06, 0.25);
    const nightK = 1 - THREE.MathUtils.smoothstep(e, -0.14, 0.03);
    this.state = { nightK, dayK, e, pal };

    /* 太阳/阴影跟随玩家,保证近处影子清晰 */
    const anchorX = Math.round(playerPos.x / 0.5) * 0.5;
    const anchorZ = Math.round(playerPos.z / 0.5) * 0.5;
    this.sun.position.set(anchorX + this.sunDir.x * 260, this.sunDir.y * 260, anchorZ + this.sunDir.z * 260);
    this.sun.target.position.set(anchorX, 0, anchorZ);
    this.sun.intensity = pal.sunI;
    this.sun.color.copy(pal.sun);
    this.sun.castShadow = e > 0.02;

    this.moonLight.position.set(anchorX + this.moonDir.x * 260, Math.abs(this.moonDir.y) * 260, anchorZ + this.moonDir.z * 260);
    this.moonLight.target.position.set(anchorX, 0, anchorZ);
    this.moonLight.intensity = pal.moonI * nightK;

    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGnd);
    this.hemi.intensity = pal.hemiI;

    if (this.fog) {
      this.fog.color.copy(pal.fog);
      this.fog.near = THREE.MathUtils.lerp(380, 600, dayK);
      this.fog.far = THREE.MathUtils.lerp(1700, 2700, dayK);
    }
    this.renderer.toneMappingExposure = pal.exposure;
    TOON.uRimColor.value.copy(pal.rim);
    TOON.uRimStrength.value = pal.rimI;

    /* 穹顶:跟着玩家走,贴着海平面 */
    this.dome.position.set(playerPos.x, 0, playerPos.z);
    const U = this.U;
    U.uSunDir.value.copy(this.sunDir);
    U.uMoonDir.value.copy(this.moonDir);
    U.uZenith.value.copy(pal.zenith);
    U.uHorizon.value.copy(pal.horizon);
    U.uHaze.value.copy(pal.fog);
    U.uSunTint.value.copy(pal.sunTint);
    U.uCloudLit.value.copy(pal.cloudLit);
    U.uCloudShade.value.copy(pal.cloudShade);
    U.uCloudK.value = pal.cloudK;
    U.uSunDisc.value.copy(pal.sunDisc);
    U.uSunDiscK.value = pal.sunDiscK;
    U.uMoonK.value = nightK;
    U.uStarI.value = pal.starI;

    /* 环境反射:太阳挪够了才重烘。间隔按上次耗时自适应 —— 固定 2.5s 重烘一次
       会在骑行时留下"每隔一会儿顿一下"的节奏感 */
    this._envTimer += dt;
    if (this._envTimer > this._envGap && this._envSun.distanceToSquared(this.sunDir) > 0.0036) {
      this._envTimer = 0;
      this._envSun.copy(this.sunDir);
      const t0 = performance.now();
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      // 烘一次 5ms → 2.75s 后再烘;20ms → 6.5s
      this._envGap = THREE.MathUtils.clamp(1.5 + (performance.now() - t0) * 0.25, 2, 8);
    }
    return this.state;
  }

  clockText() {
    const h = Math.floor(this.time24), m = Math.floor((this.time24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
