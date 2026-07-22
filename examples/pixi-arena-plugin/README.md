# 霓虹围城 PixiJS 示例

这是一个可直接导入 Mobile Tavern 的实时横屏对战插件。它使用 PixiJS 8 的 WebGL 渲染器，演示触控移动、自动射击、弹幕、粒子效果、独立最高分存档和前后台暂停。

## 构建

在仓库根目录执行：

```powershell
npm run build:example:pixi
```

命令会把 `src/game.ts` 与 PixiJS 打成单个经典 JavaScript 文件，并生成 `pixi-neon-siege.mtplugin`。插件不需要联网，也不依赖宿主预装 PixiJS。
