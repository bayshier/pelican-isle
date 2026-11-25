# REBUILD_SPEC · 鹈鹕环岛记复刻规格书

> 目的:把「鹈鹕骑自行车环游程序化小岛」的完整做法沉淀成一份可交给任何模型/工程师从零复刻的规格。
> 参考实现:`pelican-isle/`(Three.js r160,约 2800 行,零美术资源,单页运行)。
> 复刻提示词(可直接投喂):见文末附录 A。

---

## 0. 一句话定义

一只戴水手帽的鹈鹕,骑一辆红色自行车,在半径约 1km 的程序化热带岛屿上自由骑行:
环岛公路、渔村、灯塔、风车、雪山主峰、跨海大桥与离岛,15 分钟一整天的昼夜循环,
收集金色小鱼,全程序化生成(无模型/贴图/音频文件),电影感后期。

## 1. 技术底盘

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 引擎 | Three.js r160(ES Modules + importmap) | Sky/PMREM/EffectComposer 现成 |
| 运行 | 任意静态服务器(附 40 行 node server.js) | ES module 不能 file:// 直开 |
| 依赖本地化 | 只拷 `build/three.module.js` + `examples/jsm/{objects,utils,postprocessing,shaders}` ≈ 1.8MB | 整包 32MB 没必要 |
| 后期 | RenderPass → UnrealBloom → 自定义调色 Pass → OutputPass | MSAA 用 `WebGLRenderTarget({type:HalfFloatType, samples:4})` |
| 音频 | WebAudio 全合成(噪声缓冲→滤波=风/浪,振荡器=车铃/收集音) | 零资源文件 |

## 2. 地形(核心中的核心)

一个纯函数 `terrainHeight(x, z)`,**网格、放置、骑行、AI 全部查它**,保证万物贴合:

```text
1) 域扭曲:d 用 (x,z) 加上 fbm(x*0.0008) * 150 的偏移后再算半径 → 海岸线不规则
2) 岛屿掩膜:m = smoothstep(R+300, R-140, d);y = -24 + (h+24) * m^1.28
   (指数 >1 让海岸坡度缓、出宽沙滩)
3) 丘陵:h = 7 + fbm(0.00115, 4oct) * 30 + fbm(0.006, 2oct) * 2.2
4) 主峰:h += exp(-d²/(2*205²)) * 66        ← 加在掩膜之前(在岛内,应被掩膜缩放)
5) 离岛:y += exp(-d²/(2*90²)) * 30         ← ⚠️ 必须加在掩膜之后(在海外,否则被 m≈0 乘没)
6) 台地:村庄/灯塔处 y = lerp(y, 目标高度, 平滑权重) → 建筑有平地
7) 桥/栈桥:线段走廊内 y = lerp(y, 甲板高度, w) → 桥面直接写进高度场,可骑行
```

坑位记录(复刻必看):
- **离岛高斯必须加在掩膜外面**,否则海上 m≈0 会把它整个乘没(表现为"离岛不存在")。
- 跨海桥找岸点:**从主岛内侧向外走,记录最后一个露出水面的点**;从外海往回找会先撞上离岛自己的山坡。
- 顶点色用 `Color.convertSRGBToLinear()` 后再写入 attribute(材质会自动转换,顶点色不会)。
- 道路:CatmullRom 闭环采样 ~760 点 → 空间哈希网格(48u 格)→ `roadDistance(x,z)` 供烤色 + 植被避让 + 路面抓地力。

## 3. 海面(自定义 ShaderMaterial,不用官方 Water)

- 平面 5000²,顶点做 3 组正弦涌浪;片元:
  - 两层滚动的程序化法线贴图(128~256 的 value-noise 差分,numpy 都不用,主线程几十 ms);
  - 菲涅尔混深水色/天空色;Blinn 高光画太阳/月亮 glitter;
  - **岸泡沫与浅滩透明全部来自一张烘焙高度图**(`DataTexture`, RedFormat/Float, 256², 存 terrainHeight):
    `depth = -terrainHeight`,泡沫带 `smoothstep(2.8, 0.5, depth) * 噪声闪动`,透明度 `clamp(depth/1.8, 0.14, 1)`;
  - **离岸渐隐**:`inland = smoothstep(1.6, 0.3, terrainH)`,alpha 与 foam 都乘它
    ← 不加的话,内陆 h≈0 的洼地上水+泡沫与地形互相干涉出同心圆莫尔波纹;
  - `depthWrite:false`(透明水体不写深度),fog 手工 include fog_chunks。

## 4. 天空与昼夜

- `Sky` 物理天空 + `PMREMGenerator.fromScene(独立天空场景, 0, 1, 20000)` 每 2.5s 重生成 environment(太阳挪过阈值才重算)。
- 时间 0~24h,一个 15 分钟循环;太阳高度角 `alt = asin(sin((t-6)/12·π))·0.72`。
- **整套配色 = 按太阳高度角 e 插值的 5 个关键帧**(夜/晨昏/金时/白天),一次 lerp 出:
  fog 色、水面三色、太阳色强、半球光天地色——所有系统只消费这一份调色板,风格天然统一。
- 星空 = 半球随机 Points(opacity=nightK);月亮 = -sunDir 方向 Basic 材质球;月光 = 反向平行光。
- 阴影:平行光 shadow camera ±120 **跟随玩家**(位置按 0.5u 取整防闪烁),远处才敢用大 mapSize。

## 5. 植被与建筑(全 InstancedMesh + 顶点色)

- 每个物种做 2~3 个变体几何(棕榈=弯曲管+8 片下垂叶+椰子;阔叶=干+球团;松=三层锥),
  顶点色 + `aSway` 属性(0 基部→1 梢部),merge 成一个 geometry → 一个 InstancedMesh。
- 风摆:`MeshStandardMaterial.onBeforeCompile` 注入,相位来自 `instanceMatrix[3].xyz` 的点积,
  `transformed.x += sin(uTime·1.9 + ph)·aSway²·0.4`。`customProgramCacheKey` 必须设置防程序缓存串味。
- 放置规则:海拔带 + 坡度(n.y 阈值)+ 距路 + 遮挡区(村庄/桥走廊)+ 噪声 patch 概率 → 天然成片。
- 建筑:同样 part()+merge()(统一转非索引、删 uv、写顶点色);窗户单独 InstancedMesh,
  夜晚 `emissiveIntensity = nightK * 2.8` 一行代码全村亮灯。

## 6. 鹈鹕与自行车

- 全基元拼装:车架 = `tubeBetween(a,b,r)`(两点定向圆柱);轮 = torus+12 辐条;
- **蹬踏 = 双骨 IK**:踏板位置由曲柄角解析算出,膝关节 = 平面圆交
  `a=(l1²-l2²+L²)/(2L), h=sqrt(l1²-a²), knee = hip + dir*a + perp*h`(perp 取朝前那支),
  骨骼 mesh 用 `setSegment(A,B)`(位置=中点、quaternion=Y→dir、scale.y=长度)摆放,零父子数学;
- 翅膀搭车把:每帧把手把局部坐标 localToWorld→父空间,同 setSegment;头随转向 look,身体随速度颠簸+压弯 roll;
- 车筐里放 5 条小鱼,`setBasketFish(n)` 按收集数点亮——收集反馈直接长在角色上。

## 7. 骑行手感

```text
速度: accel 15~19,摩擦 1.6 + 草地3.4 + 漂移5;坡度: speed -= grad*13.5*dt
路面对 maxSpeed 插值:草地 23 / 公路 32
转向: yawRate = steer · lerp(2.15, 1.05, speedK) · drift?1.5 —— 低速灵、高速稳
贴地: pos.y 向 ground 指数逼近(22/s),Space 起跳 vy=6.4,重力 19
姿态: 四元数 = yawHeading · (up→地形法线) ,再由角色组内部加 roll/bob
相机: 追尾位 = pos - fwd*8.0 + right*3.0 + up*3.4(侧偏 3/4 视角才看得见车身),
      指数追赶 5.2/s,FOV 55→71 随速度
```

## 8. 后期与氛围

- Bloom:**threshold 1.15 / strength 0.32 / radius 0.45**。⚠️ 线性 HDR 下白墙、白鹈鹕辐射度 >2,
  阈值放到 1 以下整屏泛光变"雾",这是本作调色第一坑。
- 调色 Pass:径向色差 0.0022r²、饱和 1.13、暗角 0.32、胶片颗粒 0.024(线性域做,OutputPass 最后 tonemap)。
- 氛围件:海鸥 3 群绕锚点、蝴蝶(白天)、萤火虫(夜间 Points 加性)、篝火(双锥加性+点光抖动)、
  灯塔光束(开口罩 Cone + AdditiveBlending,opacity=nightK·0.3)、串灯(悬链线点位+emissive 实例)。

## 9. 帧结构(主循环干什么)

```text
dt = clamp(clock.getDelta(), 0.05)
uTime.value = t                          ← 风摆/水波/粒子共用一个 uniform
sky.update(dt, playerPos)                → 产出 {dayK, nightK, palette}
player.update(dt)                        → 物理/相机/收集/播报/扬尘
buildings.update(dt, t, nightK)          → 转子/光束/船摇/灯强
water.uniforms ← palette + 太阳/月亮 glitter 方向
particles / ambient / minimap / HUD
composer.render()
```

## 10. 资产与体积

```text
index.html(HUD/CSS/importmap)   js/ 9 个模块 ~2800 行
libs/three 精简子集 1.8MB        docs/preview.mp4 2.8MB + 5 张截图
总仓库 ~5MB,git clone 即玩(node server.js)
```

---

## 附录 A · 复刻提示词(投喂给任何模型)

```text
用 Three.js(本地化 r160,importmap)从零写一个单页 3D 游戏《鹈鹕环岛记》,
禁止任何外部模型/贴图/音频文件,所有几何用基元+顶点色,分模块交付并可运行:

1. 地形:单一 terrainHeight(x,z) 纯函数(simplex fbm 域扭曲海岸 + 掩膜 pow1.28 +
   主峰高斯 + 台地 flatten + 桥面走廊),320² 网格顶点色(沙/草/岩/雪/路),
   道路 CatmullRom 闭环 + 空间哈希 roadDistance;
2. 海面:自定义 shader(双层滚动程序法线、菲涅尔、太阳 glitter、烘焙高度图驱动的
   岸泡沫/浅滩透明/离岸渐隐,depthWrite=false);
3. 天空:Sky+PMREM 环境光,15 分钟昼夜循环,按太阳高度角插值的 5 关键帧调色板
   统一驱动雾/水/光;星空、月亮、跟随玩家的阴影相机;
4. 植被:InstancedMesh + 顶点色 + aSway 风摆(onBeforeCompile),按海拔/坡度/噪声 patch 散布 6000+;
5. 建筑:渔村(窗火夜亮)、灯塔旋转光束、风车、风机、栈桥帆船、跨海大桥(写进高度场可骑)、
   热气球、篝火、串灯;
6. 角色:戴水手帽的鹈鹕骑红自行车,车架=定向圆柱,蹬踏=双骨 IK(setSegment),
   翅膀搭车把,压弯侧倾,车筐随收集点亮;
7. 玩法:WASD+Shift 漂移+Space 跳,路面/草地抓地差异,坡度物理,40 条收集鱼,
   地点播报,三种相机(3/4 追尾/电影低机位/环绕),小地图,拍照模式;
8. 后期:HalfFloat MSAA RT + UnrealBloom(threshold≥1.15)+ 暗角/色差/颗粒 + ACES 输出;
   WebAudio 合成风/浪/车铃。
交付顺序:noise→terrain→sky→vegetation→buildings→pelican→effects→player→main,
每步都要能在浏览器里跑起来看一眼。避开三个坑:离岛高斯要加在掩膜外;桥岸点从主岛
向外找"最后一块陆地";白材质 bloom 阈值必须 >1。
```

---

## 附录 B · v2 赛璐璐渲染(2026-11-25)

第一版偏写实(PBR + 物理天空 + 法线贴图海面)。v2 在**模块接口不变**的前提下把画面整体抬成
动画电影式的卡通风格,改动集中在四个文件:`js/style.js`(新增)、`js/sky.js`(重写)、
`js/terrain.js` 的海面着色器、`js/effects.js` 的后期管线;另外 `js/main.js` 把主循环改成了
固定步长。地形、植被、建筑、鹈鹕、玩家这几个模块只动了几行。

### B1. 改了什么

| 模块 | v1 | v2 |
| --- | --- | --- |
| 着色 | 全场 PBR | `style.js` 给标准材质注入三阶色阶 + 边缘光;金属度 > 0.4 的留在 PBR |
| 描边 | 无 | `InkPass`:场景用法线材质再画一遍,屏幕空间深度 / 法线边缘检测,80~230m 淡出 |
| 天空 | three 的 Sky 大气散射 + 多面体云团 | 一块程序化穹顶着色器(渐变 / 染暖 / fbm 积云 / 日轮 / 月亮 / 程序化星空) |
| 环境 | Sky → PMREM,每 2.5s 重烘 | 穹顶自身当环境源;太阳挪够才重烘,间隔按上次耗时自适应 |
| 海面 | 双层滚动法线贴图 | 四组解析正弦波,法线扰动按视距压平;浪线、泡沫带随天色 |
| 调色 | 颗粒 0.024、色差 0.0022 | 颗粒 0.010 且按亮度缩放、色差 0.0015、HDR 下安全的 S 曲线 |
| 主循环 | `THREE.Clock` 可变 dt | 固定 60Hz 累加器,最多补 5 步 |
| 画质 | 无 | 高 / 中 / 低 三档 + 开局自动降档 |

### B2. 调色板怎么定

卡通着色下,**受光面 ≈ 固有色 × 0.9,暗面 ≈ 固有色 × 0.3(偏蓝)**。所以:
- `sunI ≈ 2.0`(three 的漫反射会除以 π,2.0 刚好让受光面贴着 1 倍固有色);`hemiI ≈ 1.3` 提供暗面。
- 如果受光面被太阳 + 半球光叠到 1.5 倍固有色,亮色会全部漂白,画面像蒙了一层粉。
- r160 开着色彩管理,`new Color('#hex')` **本身就已经是线性空间**。旧代码再调一次
  `convertSRGBToLinear()` 等于转了两次,顶点色的地形 / 植被比设计值又暗又脏。

### B3. 这一版新踩的坑

1. **按材质过滤场景时,别把"没有材质"当成跳过。** `scene.traverse` 会走过 Scene、Group、
   灯光——它们都没有 `material`。把它们设成不可见,整个场景连子节点一起消失,描边预通道
   画出一张空图(症状是"描边完全不出现",不报错)。只判断真正会往屏幕上画东西的对象。
2. **卡通注入要"串联"而不是"覆盖"。** 植被材质已经有自己的 `onBeforeCompile`(风摆),
   直接赋值会把风摆冲掉。要记住原钩子、新钩子里先调它再打补丁,缓存键也要拼上原来的。
3. **描边预通道要用同一份风摆。** 否则树冠本体在摇、描边不摇,线条和本体错位。
4. **细物体的影子会被 `normalBias` 推没。** 0.6 米的偏置比车架和辐条还粗,鹈鹕脚下只剩
   一团模糊的椭圆;降到 0.2 才有清晰的剪影。
5. **海面远处闪成一片 / 出条纹**:滚动法线贴图的频率太高,远处一个像素里挤了好几个波。
   改成解析波,并把**整组**法线扰动按视距压平(只压高频那两组还不够,菲涅尔反射帧帧不同)。
6. **海面平面必须比雾的远裁剪面大**,边缘才一定被雾化成雾色,和穹顶贴着地平线的那一圈接上。
7. **固定幅度的颗粒在夜景暗部会被相对放大成噪点**,要按亮度缩放。
8. **合集的守卫要用 `typeof Nikki`,不能写 `window.Nikki`**:顶层 `const` 是词法绑定,
   不是 window 的属性。

### B4. v2 补充提示词(接在附录 A 的提示词后面)

```text
画面升级(模块接口保持不变):
A. 新增 style.js:
   · applyToon(scene):给所有 MeshStandardMaterial 的 onBeforeCompile 串上卡通补丁 ——
     手动展开 ShaderChunk.lights_physical_pars_fragment,在 RE_Direct_Physical 开头插入
     "三阶色阶漫反射 + return",在 lights_fragment_end 后加边缘光;uniform 必须同时在 GLSL 里声明;
     金属度 > 0.4 的材质跳过;卡通材质 envMapIntensity = 0;
   · InkPass(EffectComposer 的 Pass):MeshNormalMaterial 预通道(同样注入风摆)→
     深度不连续 + 法线突变的边缘检测 → 叠墨线;只跳过点 / 线 / 精灵 / 半透明 / Shader / Basic
     这些"会往屏幕上画东西"的对象,绝不隐藏 Scene / Group / 灯光;草丛、花标 noInk;
B. sky.js 重写:SphereGeometry(9000, 64, 40) BackSide 穹顶 + 程序化片元
   (天顶→地平线渐变 pow(smoothstep(0,.42,h),.75)、朝阳侧染暖、贴地平线切雾色、
   日轮 smoothstep(.99925,.99965) × HDR 5、月亮、格子哈希星空、投影平面 fbm 积云);
   同一材质放进一个环境场景给 PMREM,只给金属件用;贴地平线的颜色必须等于 scene.fog.color;
C. 海面:4 组解析正弦波(波长 18m→1.2m),nk = 1-smoothstep(60,420,视距) 压平法线,
   shin = mix(48,340,lod) 的高光,噪声等值线浪线,depth 0.9~4m 的泡沫带,
   泡沫白 × clamp(luma(天色)×2.5, .08, 1);平面半宽 > 雾 far;末尾加 tonemapping/colorspace;
D. 调色板 5 关键帧 (e=-0.45/-0.10/0.05/0.22/0.75),sunI≤2.0、hemiI≈1.3;
E. 主循环固定 1/60 累加器,最多补 5 步;画质三档 + 开局 3 秒测帧自动降档。
验证:programs.filter(p=>p.diagnostics).length 必须为 0;分别截 10:00 / 17:30 / 22:00 三个时刻。
```
