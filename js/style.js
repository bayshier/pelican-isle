/* ============================================================
   鹈鹕环岛记 · 画面风格层(style.js)
   ──────────────────────────────────────────────────────────
   ① 卡通着色注入:给全场 MeshStandardMaterial 换成「三阶色阶 + 边缘光」。
      · 材质原有的 onBeforeCompile(风摆)照常执行 —— 是"串联"不是"覆盖";
      · 金属件(车架/镀铬/车铃/金色小鱼)保留 PBR 反射质感;
      · 关掉后原样还原成 PBR。
   ② 墨线描边通道(InkPass):把整个场景用「法线材质」再画一遍,
      拿屏幕空间的法线 + 深度做边缘检测,叠在渲染结果上。
      它是 EffectComposer 里的一个 Pass,插在 RenderPass 之后。

   ── three r160 改内置着色器的三个坑(症状都是"画面发白/物体消失",不报错)──
     1. onBeforeCompile 拿到的着色器里 #include 还没展开。要改某个 chunk 内部,
        必须手动展开 THREE.ShaderChunk.xxx、在展开后的文本上打补丁、再替换回原位。
     2. 挂进 shader.uniforms 的同时,GLSL 里必须有 uniform 声明,否则整个程序编译失败。
     3. 改完必须查编译结果:renderer.info.programs.filter(p => p.diagnostics).length === 0
   ============================================================ */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { injectWind } from './shared.js';

/* ═══════════════════════════════════════════════════════════
   一、卡通着色
   原理:three 的 PBR 片元里,每个光源都会调一次 RE_Direct_Physical()。
   我们在它的函数体开头插入「三阶色阶漫反射」然后直接 return,
   原来的高光路径成了死代码,由编译器消掉。
   阴影信息已经折进 directLight.color,所以投影边与色阶边天然一致。
   ═══════════════════════════════════════════════════════════ */
export const TOON = {
  on: false,
  count: 0,                                               // 当前转成卡通的材质数(自检用)
  uRimColor: { value: new THREE.Color(0xffffff) },        // 边缘光颜色:由天空调色板驱动
  uRimStrength: { value: 0.12 },
};

const DIRECT_HEAD = 'void RE_Direct_Physical(';
const TOON_DIRECT = `
		{
			/* —— 鹈鹕岛卡通着色:直接光分三阶,不算高光 —— */
			float toonNL = dot( geometryNormal, directLight.direction );
			float toonLit = smoothstep( -0.03, 0.09, toonNL );
			float toonMid = smoothstep( -0.40, -0.26, toonNL ) * 0.42;
			reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseColor ) * max( toonLit, toonMid );
			return;
		}
`;
const TOON_RIM = `
		{
			/* —— 边缘光:逆光轮廓提亮一笔 —— */
			float toonRim = 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) );
			reflectedLight.indirectDiffuse += uRimColor * pow( toonRim, 3.5 ) * uRimStrength;
		}
`;

function patchToon(shader) {
  shader.uniforms.uRimColor = TOON.uRimColor;             // 所有材质共用同一个 uniform 对象
  shader.uniforms.uRimStrength = TOON.uRimStrength;       // → 天空改一次,全场边缘光一起变

  const INC = '#include <lights_physical_pars_fragment>';
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  const head = chunk.indexOf(DIRECT_HEAD);
  if (head < 0 || shader.fragmentShader.indexOf(INC) < 0) return;   // three 版本对不上:静默退回 PBR
  const brace = chunk.indexOf('{', head);
  const patched = chunk.slice(0, brace + 1) + TOON_DIRECT + chunk.slice(brace + 1);

  let out = shader.fragmentShader.replace(INC, patched);
  out = out.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + TOON_RIM);
  shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRimStrength;\n' + out;
}

/**
 * 给场景里所有标准材质开关卡通着色。
 * on=false 时还原成 PBR(包括材质原有的风摆钩子与环境反射强度)。
 * 返回当前处于卡通模式的材质数。
 */
export function applyToon(root, on = true) {
  const seen = new Set();
  let n = 0;
  root.traverse((obj) => {
    const list = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of list) {
      if (seen.has(m) || !m.isMeshStandardMaterial) continue;
      seen.add(m);
      // 第一次见到这个材质:记住它原来的钩子 / 缓存键 / 环境强度,方便还原
      if (!m.userData.toonBase) {
        m.userData.toonBase = {
          obc: m.onBeforeCompile, key: m.customProgramCacheKey, env: m.envMapIntensity,
        };
        // 高金属度的材质靠环境反射才有"金属感",转卡通会变塑料 —— 留在 PBR
        if (m.metalness > 0.4) m.userData.keepPBR = true;
      }
      const base = m.userData.toonBase;
      if (on && !m.userData.keepPBR) {
        m.onBeforeCompile = (sh, r) => { base.obc.call(m, sh, r); patchToon(sh); };
        m.customProgramCacheKey = () => base.key.call(m) + '|toon';
        // 环境贴图的漫反射会把色阶冲淡;卡通材质的环境光交给半球光,环境反射只留给金属件
        m.envMapIntensity = 0;
        n++;
      } else {
        m.onBeforeCompile = base.obc;
        m.customProgramCacheKey = base.key;
        m.envMapIntensity = base.env;
      }
      m.needsUpdate = true;                               // 触发重编译
    }
  });
  TOON.on = on;
  TOON.count = n;
  return n;
}

/* ═══════════════════════════════════════════════════════════
   二、墨线描边通道
   ═══════════════════════════════════════════════════════════ */
const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const INK_FRAG = /* glsl */`
uniform sampler2D tDiffuse, tNormal, tDepth;
uniform vec2 uPx;                 // 预通道图的一个像素(UV)
uniform vec2 uFade;               // 超过这个视距不再描边(远处描边只会糊成噪点)
uniform float uNear, uFar, uW, uStrength, uDebug;
uniform vec3 uInk;
varying vec2 vUv;

/* 透视深度 → 视线距离 */
float viewDist(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  vec2 dx = vec2(uPx.x * uW, 0.0), dy = vec2(0.0, uPx.y * uW);
  float dC = viewDist(vUv);
  float dR = viewDist(vUv + dx), dL = viewDist(vUv - dx);
  float dU = viewDist(vUv + dy), dD = viewDist(vUv - dy);
  float mn = min(min(dR, dL), min(dU, dD));
  float mx = max(max(dR, dL), max(dU, dD));

  /* 轮廓:深度不连续。我比邻居近 / 我比邻居远,都算 */
  float dEdge = max((mx - dC) / max(dC, 1e-3), (dC - mn) / max(dC, 1e-3));
  float e = smoothstep(0.05, 0.16, dEdge);

  /* 折痕:法线突变。只在近处的实体表面上画,避免天空边缘与远山出噪边 */
  if (dC < uFade.y && mx < uFade.y * 1.5) {
    vec3 nC = nrm(vUv);
    float nEdge = 1.0 - min(min(dot(nC, nrm(vUv + dx)), dot(nC, nrm(vUv - dx))),
                             min(dot(nC, nrm(vUv + dy)), dot(nC, nrm(vUv - dy))));
    e = max(e, smoothstep(0.30, 0.55, nEdge) * 0.72);
  }
  e *= 1.0 - smoothstep(uFade.x, uFade.y, dC);
  /* 调试:1=边缘掩码 2=预通道法线 3=预通道深度(50m 一圈) */
  if (uDebug > 1.5) { gl_FragColor = vec4(uDebug < 2.5 ? nrm(vUv) * 0.5 + 0.5 : vec3(fract(viewDist(vUv) / 50.0)), 1.0); return; }
  if (uDebug > 0.5) { gl_FragColor = vec4(vec3(e), 1.0); return; }
  gl_FragColor = vec4(mix(c, uInk, e * uStrength), 1.0);
}
`;

/* 这些对象不参与描边:精灵/点/线没有稳定面法线;半透明与自发光面片描了会脏。
   ⚠ 只判断"会往屏幕上画东西"的对象。Scene / Group / 灯光没有 material ——
   如果把"没有材质"也当成跳过,整个场景会连子节点一起被藏掉,预通道画出一张空图。 */
function skipInk(o) {
  if (!(o.isMesh || o.isPoints || o.isLine || o.isLineSegments || o.isSprite)) return false;
  if (o.userData.noInk) return true;
  if (o.isPoints || o.isLine || o.isLineSegments || o.isSprite) return true;
  const m = o.material;
  if (!m) return true;
  const soft = (x) => x.transparent || x.isShaderMaterial || x.isBasicMaterial;
  return Array.isArray(m) ? m.some(soft) : soft(m);
}

export class InkPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = true;
    this.widthCss = 1.5;                                   // 线宽(按 CSS 像素计)

    // 预通道用的法线材质:同样注入风摆,否则树冠的描边和本体错位
    this.normalMat = new THREE.MeshNormalMaterial();
    this.normalMat.onBeforeCompile = injectWind;
    this.normalMat.customProgramCacheKey = () => 'ink-wind';

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tNormal: { value: null }, tDepth: { value: null },
        uPx: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uFade: { value: new THREE.Vector2(80, 230) },
        uNear: { value: camera.near }, uFar: { value: camera.far },
        uW: { value: 1.5 }, uStrength: { value: 0.8 }, uDebug: { value: 0 },
        uInk: { value: new THREE.Color('#1c1826') },  // r160 的 Color(hex) 已自动转线性空间
      },
      vertexShader: FS_VERT, fragmentShader: INK_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.rt = null;
    this.fsQuad = new FullScreenQuad(this.mat);
    this.hidden = [];
  }

  setSize(w, h) {
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    this.rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
      depthTexture: new THREE.DepthTexture(Math.max(1, w), Math.max(1, h)),
    });
    this.mat.uniforms.uPx.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.mat.uniforms;
    /* 1) 预通道:整个场景用「法线材质」再画一遍(不重复更新阴影贴图) */
    const hidden = this.hidden;
    hidden.length = 0;
    this.scene.traverse((o) => {
      if (o.visible && skipInk(o)) { o.visible = false; hidden.push(o); }
    });
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevOverride = this.scene.overrideMaterial;
    renderer.shadowMap.autoUpdate = false;
    this.scene.overrideMaterial = this.normalMat;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = prevOverride;
    renderer.shadowMap.autoUpdate = prevAuto;
    for (const o of hidden) o.visible = true;

    /* 2) 边缘检测,叠到上一通道的结果上 */
    u.tDiffuse.value = readBuffer.texture;
    u.tNormal.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.uW.value = this.widthCss * renderer.getPixelRatio();
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose() {
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    this.mat.dispose();
    this.normalMat.dispose();
    this.fsQuad.dispose();
  }
}
