<div align="center">

# 鹈鹕环岛记 · Pelican Isle

**一只戴水手帽的鹈鹕，骑一辆红色自行车，环游一座程序化生成的热带大岛。**

去年大家让 AI "画鹈鹕骑自行车"，比的是谁画得对。这里换了个问法：
**能不能造一个世界，让那只鹈鹕真的骑上去？**

[![Three.js](https://img.shields.io/badge/Three.js-r160-049EF4?style=flat-square)](https://threejs.org)
[![美术资源文件](https://img.shields.io/badge/美术资源-0%20个-3DDC84?style=flat-square)](#技术)
[![代码量](https://img.shields.io/badge/约%202800%20行-手写-blue?style=flat-square)](js/)
[![复刻规格书](https://img.shields.io/badge/复刻指南-REBUILD_SPEC-ffdd44?style=flat-square)](REBUILD_SPEC.md)

> 🎮 **实机视频与游戏截图**：[配套文章《鹈鹕环岛记》](https://bayshier.github.io/GYZApp/blog-pelican-isle.html)（含 15 分钟昼夜循环实机演示）

</div>

---

## 这是什么

一座半径约一公里的程序化热带岛屿：环岛公路串起渔火村、灯塔海角、雪山主峰、跨海大桥与离岛「鹈鹕岩」；**15 分钟一整天的昼夜循环**，入夜渔火村的窗火渐亮、灯塔光束开始旋转；沿途 40 条金色小鱼等它收集（车筐真的会装满）。

整个世界——几何、颜色、水面、天空、乃至风声浪声车铃声——**全部由代码实时生成，没有任何模型、贴图或音频文件**。

## 运行

```bash
git clone https://github.com/bayshier/pelican-isle.git
cd pelican-isle
node server.js        # 或任意静态服务器，如 python3 -m http.server
# 打开 http://localhost:8642
```

ES Modules 不能 `file://` 直开，需要任意静态服务器。

## 操作

| 按键 | 功能 |
| --- | --- |
| W / ↑ | 骑行 |
| S / ↓ | 刹车 / 倒退 |
| A D / ← → | 转向 |
| Shift | 漂移（扬尘） |
| Space | 小跳 |
| C | 视角：追尾 / 电影低机位 / 环绕（拖拽+滚轮） |
| T | 时间流速：1× / 40× / 暂停（看日落与星空） |
| F | 车铃 |
| M | 小地图 |
| P | 拍照模式（隐藏 HUD + 电影黑边） |
| R | 回到渔火村 |
| N | 静音 |

## 岛上有什么

| | |
|---|---|
| 🏘️ **渔火村** | 10 栋小屋、水井、市集摊、串灯路灯，入夜窗火渐亮 |
| 🗼 **灯塔海角** | 红白灯塔，夜间旋转光束 |
| 🏔️ **主峰观景台** | 雪山之巅 + 山岗三台风力发电机 |
| 🌊 **观海栈桥** | 帆船随浪摇，沙滩篝火 |
| 🌉 **跨海大桥** | 317 米，骑去离岛「鹈鹕岩」 |
| 🎈 **天空与生灵** | 两只热气球、海鸥编队、蝴蝶、夜间萤火虫 |

## 技术一览

全部代码手写于 Three.js r160 之上，约 2800 行：

- **地形**：2D simplex 噪声高度场——域扭曲海岸线 + 主峰/离岛高斯隆起 + 村庄/海角台地，320×320 网格顶点色。一个纯函数 `terrainHeight(x, z)` 供网格、建筑放置、骑行、AI 全局查询，保证万物贴合
- **海面**：自定义 shader——双层滚动程序法线、菲涅尔反射天空、太阳/月亮高光；岸泡沫与浅滩透明来自一张烘焙高度图（`DataTexture`）
- **天空**：三牛 Sky 物理天空 + PMREM 环境光照，昼夜配色关键帧插值，玩家跟随式阴影相机
- **植被**：约 6000+ 实例全部 InstancedMesh，顶点色 + `onBeforeCompile` 注入风摆
- **后期**：MSAA HDR 合成 → UnrealBloom → 电影调色（暗角/色差/颗粒/饱和）→ ACES 输出
- **音频**：WebAudio 全程序化合成——噪声缓冲滤波成风浪，振荡器合成车铃与收集音

## 想自己造一座岛？

[REBUILD_SPEC.md](REBUILD_SPEC.md) 是一份完整复刻规格书：技术选型理由、地形函数逐层拆解（含**离岛高斯必须加在掩膜之后**这类"不做就凭空消失"的坑位记录）、海面 shader 的莫尔波纹陷阱、昼夜系统参数，以及一份可直接投喂给任意模型的复刻提示词（附录 A）。

配套文章：**《鹈鹕环岛记：把一道 AI 考题造成一个世界》**（设计决策背后的故事，含实机视频与全岛截图）——[bayshier.github.io/GYZApp/blog-pelican-isle.html](https://bayshier.github.io/GYZApp/blog-pelican-isle.html)

## 已知限制

- 需要桌面浏览器最新版（Chrome / Safari / Edge）；移动端未适配
- 集成显卡白天满帧骑行有一定压力，建议用 `T` 键 40× 直奔夜景（性能友好且更好看）

## 许可证

[MIT](LICENSE) © [Easin](https://github.com/bayshier)
