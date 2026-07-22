# Mobile Tavern 第三方全屏插件规范 v1

## 1. 能力边界

第一版插件是安装在本地、运行于隔离全屏 `iframe` 的 HTML/CSS/JS 微应用，适合 Gal 游戏和独立交互内容。

插件不能访问主应用 DOM、Kernel、API 凭证、网络、Tauri、任意文件系统或 Mobile Tavern 主数据库。插件和现有 TavernHelper/MVU iframe 使用不同运行容器，不继承其父页面桥接能力。

宿主只开放：

- 独立存档的保存、读取和删除；
- 请求退出插件；
- 请求切换横屏、竖屏或自动旋转；
- 前后台暂停与恢复事件。

## 2. 安装包结构

`.mtplugin` 是标准 ZIP 文件，根目录必须包含 `manifest.json`。示例：

```text
example.mtplugin
├── manifest.json
├── index.html
├── game.js
├── style.css
└── assets
    ├── background.webp
    └── theme.ogg
```

包限制：

- 压缩包不超过 25 MiB；
- 解压后总大小不超过 100 MiB；
- 单文件不超过 32 MiB；
- HTML 入口不超过 2 MiB；
- 文件总数不超过 512；
- 禁止加密 ZIP、分卷 ZIP、绝对路径、反斜杠和 `..` 路径；
- 只支持 ZIP 的 Store 和 Deflate 压缩方法。

## 3. 清单格式

```json
{
  "format": "mobile-tavern.plugin",
  "manifestVersion": 1,
  "id": "example.gal.demo",
  "name": "最小 Gal 示例",
  "version": "1.0.0",
  "type": "fullscreen",
  "entry": "index.html",
  "description": "演示全屏运行、独立存档和方向控制。",
  "author": "作者名称",
  "orientation": "landscape"
}
```

`id` 必须采用小写反向域名式标识；`version` 必须是语义版本；`orientation` 可选值为 `portrait`、`landscape` 或 `auto`。

使用相同 `id` 再次安装会覆盖旧包，但保留独立存档。卸载插件会同时删除它的全部存档。

## 4. 运行沙箱

运行容器固定使用：

```html
<iframe sandbox="allow-scripts">
```

不授予 `allow-same-origin`、表单、弹窗、下载和导航权限。宿主还会注入独立 CSP，禁止网络连接、子框架、对象、表单和外部资源。为兼容 Android WebView 的不透明来源限制，包内 CSS 与经典 JavaScript 在校验后内联到入口文档，图片、音频、视频和字体转换为自包含 `data:` URL；入口本身仍使用临时 Blob URL，并在关闭插件后立即回收。

第一版支持普通外部 CSS、经典 JavaScript 和直接引用的包内媒体；暂不支持 ES Module 依赖图、动态 `import()`、Web Worker、Service Worker 或运行时拼接的包内相对路径。复杂游戏建议构建为单个 JavaScript 包后再制作 `.mtplugin`。

## 5. 宿主 API

插件启动后可通过 `window.MobileTavernPlugin` 使用宿主 API：

```ts
interface MobileTavernPluginApiV1 {
  readonly version: 1;
  ready(): Promise<{ apiVersion: 1 }>;
  exit(): Promise<void>;
  setOrientation(value: "portrait" | "landscape" | "auto"): Promise<void>;
  save(slot: string, data: unknown): Promise<void>;
  load(slot: string): Promise<unknown | null>;
  deleteSave(slot: string): Promise<void>;
}
```

存档槽位只能包含英文字母、数字、下划线和连字符，长度为 1–64；每个槽位的 JSON 数据不超过 1 MiB。插件存档位于独立 `MobileTavernPluginDB`，不会写入主 settings 或 session。

插件可监听生命周期：

```js
window.addEventListener("mobile-tavern:lifecycle", (event) => {
  if (event.detail === "pause") {
    // 暂停音频、动画和计时器，并保存检查点。
  }
  if (event.detail === "resume") {
    // 恢复前台运行。
  }
});
```

## 6. 本地打包

Windows PowerShell 示例：

```powershell
tar.exe -a -c -f example.zip manifest.json index.html game.js style.css assets
Rename-Item example.zip example.mtplugin
```

必须让 `manifest.json` 和入口 HTML 位于 ZIP 根目录，不能把它们额外包在同名文件夹中。
不要使用 Windows PowerShell 的 `Compress-Archive` 打包包含子目录的插件；它可能在 ZIP 中写入反斜杠路径，安全解析器会拒绝该包。

## 7. PixiJS 与游戏引擎依赖

第一版不由宿主注入 PixiJS。插件应把实际使用的 PixiJS 模块通过 tree-shaking 打成单个经典 JavaScript 文件，以换取版本隔离、离线运行和可移植安装包；`examples/pixi-arena-plugin` 提供了 WebGL 实时对战示例和构建脚本。

多个插件分别携带 PixiJS 会重复占用安装存储，但不会因“已安装插件数量”线性占用运行内存，因为宿主同一时刻只运行一个全屏插件。宿主内置共享引擎主要节省磁盘、解压、解析和缓存成本，不会天然提高帧率，还会引入版本协商与兼容风险。只有在出现多个实际插件、重复引擎体积成为可测量问题后，才考虑增加可选且版本化的共享运行时；插件仍需保留自带回退能力。
