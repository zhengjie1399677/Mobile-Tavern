# 星渊终焉 PixiJS 示例

这是一个用于展示 Mobile Tavern 第三方全屏插件视觉与交互上限的横屏科幻弹幕 Boss 战。游戏使用 PixiJS 8 WebGL 渲染，并将生成式背景、玩家战机和 Boss 美术压缩为包内 WebP；运行时完全离线，不请求外部资源。

战斗包含三阶段 Boss 行为、瞄准弹幕、旋转弹幕、环形弹幕、激光预警、相位闪避、近失奖励、连击倍率、脉冲超载、奇点终结技、粒子爆炸、残影、冲击波、镜头震动、阶段转场与独立最高分存档。所有输入均针对手机横屏触控设计。

源码显式引入 `pixi.js/unsafe-eval` 兼容模块，让 PixiJS 在宿主不开放 `unsafe-eval` 的强 CSP 环境中改用静态同步实现。插件仅使用宿主提供的存档、退出、方向控制和生命周期接口。

## 构建

在仓库根目录执行：

```powershell
npm run build:example:astral
```

命令会生成 `astral-rift.mtplugin`。该文件可独立导入，也会由 Mobile Tavern 作为只读内置插件打进正式安装包。
