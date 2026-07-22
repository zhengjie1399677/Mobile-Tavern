# 夜雨试剑 PixiJS 示例

这是一个可直接导入 Mobile Tavern 的横屏武侠即时战斗插件。它使用生成式 2D 背景与角色动作素材，并由 PixiJS 8 的 WebGL 渲染器实现虚拟摇杆移动、剑式连招、轻功突进、听雨弹反、雨幕、涟漪、粒子特效、镜头反馈和前后台暂停。

敌方会根据距离、玩家挥空次数和弹反倾向执行绕行、逼近、后撤、诱招与追击。普通重击伤害为 24%，强化重击伤害为 27%，配合受击保护可保证玩家至少完整承受三剑。战况气泡由战斗事件驱动，覆盖开场、挥空、受击、弹反与僵持等情境。

源码显式引入 `pixi.js/unsafe-eval` 兼容模块，让 PixiJS 改用静态同步实现；宿主 CSP 仍不开放 `unsafe-eval`。

## 构建

在仓库根目录执行：

```powershell
npm run build:example:pixi
```

命令会把 `src/game.ts`、PixiJS 和压缩后的 WebP 美术素材打成单个经典 JavaScript 文件，并生成 `rain-sword-duel.mtplugin`。插件不需要联网，也不依赖宿主预装 PixiJS。图片使用浏览器原生解码，避免在强 CSP 下创建 Worker。
