import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 全局共享时间(风摆/水波/粒子都用这一个 uniform 对象)
export const uTime = { value: 0 };

// sRGB hex -> 线性 Color(用于顶点色)
export function C(hex, mul = 1) {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  if (mul !== 1) c.multiplyScalar(mul);
  return c;
}

function tempColor(hex, jitter, rnd) {
  const c = C(hex);
  if (jitter > 0) {
    const k = 1 + (rnd() * 2 - 1) * jitter;
    c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
  }
  return c;
}

// 几何部件:非索引化 + 删 uv + 变换 + 顶点色,保证可与其他部件 merge
export function part(geo, hex, opt = {}) {
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(opt.rx || 0, opt.ry || 0, opt.rz || 0));
  m.compose(
    new THREE.Vector3(opt.x || 0, opt.y || 0, opt.z || 0),
    q,
    new THREE.Vector3(opt.sx || opt.s || 1, opt.sy || opt.s || 1, opt.sz || opt.s || 1)
  );
  geo.applyMatrix4(m);
  geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const rnd = opt.rnd || Math.random;
  const jit = opt.jit || 0;
  const c = tempColor(hex, jit, rnd);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// 给几何按 y 高度写入 aSway(风摆权重)
export function addSway(geo, y0, y1, w0 = 0, w1 = 1) {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count);
  const span = Math.max(1e-5, y1 - y0);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - y0) / span, 0, 1);
    arr[i] = w0 + (w1 - w0) * t;
  }
  geo.setAttribute('aSway', new THREE.BufferAttribute(arr, 1));
  return geo;
}

export function merge(list) {
  const g = mergeGeometries(list, false);
  for (const x of list) x.dispose();
  return g;
}

// 标准 vertexColors 材质;wind=true 时注入风摆 shader
export function makeMat(wind = false, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: opts.roughness ?? 0.9, metalness: 0,
    envMapIntensity: opts.env ?? 0.4,
  });
  if (wind) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float wph = dot(ip, vec3(0.213, 0.417, 0.311)) * 6.2831;
        #else
          float wph = 0.0;
        #endif
        float wsw = aSway * aSway;
        transformed.x += (sin(uTime * 1.9 + wph) + sin(uTime * 3.3 + wph * 1.7) * 0.45) * wsw * 0.4;
        transformed.z += cos(uTime * 1.55 + wph * 1.3) * wsw * 0.28;`);
    };
    mat.customProgramCacheKey = () => 'windv1';
  }
  return mat;
}

export function smoothstep(e0, e1, x) {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;

// 小鱼轮廓(收集品 / 筐里的鱼)
export function fishGeo(len = 1) {
  const s = new THREE.Shape();
  s.moveTo(0.5, 0);
  s.quadraticCurveTo(0.15, 0.3, -0.28, 0.16);
  s.lineTo(-0.5, 0.34);
  s.quadraticCurveTo(-0.34, 0, -0.5, -0.34);
  s.lineTo(-0.28, -0.16);
  s.quadraticCurveTo(0.15, -0.3, 0.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false });
  g.center();
  g.scale(len, len, len);
  g.rotateY(Math.PI / 2);
  return g;
}
