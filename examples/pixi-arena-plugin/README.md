# 夜雨试剑 PixiJS 示例

这是一个可直接导入 Mobile Tavern 的横屏武侠即时战斗插件。它使用 PixiJS 8 的 WebGL 渲染器，演示虚拟摇杆移动、剑式连招、轻功突进、听雨弹反、敌方蓄力追击、粒子特效、镜头反馈和前后台暂停。角色、竹林与雨幕均由引擎即时绘制，不依赖外部图片资源。

源码显式引入 `pixi.js/unsafe-eval` 兼容模块，让 PixiJS 改用静态同步实现；宿主 CSP 仍不开放 `unsafe-eval`。

## 构建

在仓库根目录执行：

```powershell
npm run build:example:pixi
```

命令会把 `src/game.ts` 与 PixiJS 打成单个经典 JavaScript 文件，并生成 `rain-sword-duel.mtplugin`。插件不需要联网，也不依赖宿主预装 PixiJS。
