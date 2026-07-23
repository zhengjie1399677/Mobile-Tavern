# Mobile Tavern 第三方插件开发指南

> 本文档面向希望为 Mobile Tavern 开发全屏插件的第三方开发者。涵盖插件结构、API、构建打包与发布全流程。

---

## 目录

1. [概述](#1-概述)
2. [快速开始](#2-快速开始)
3. [项目结构](#3-项目结构)
4. [manifest.json 详解](#4-manifestjson-详解)
5. [入口 HTML](#5-入口-html)
6. [运行时 API](#6-运行时-api)
7. [LLM 集成](#7-llm-集成)
8. [存储系统](#8-存储系统)
9. [生命周期事件](#9-生命周期事件)
10. [CSP 限制与资源内联](#10-csp-限制与资源内联)
11. [构建与打包](#11-构建与打包)
12. [示例插件](#12-示例插件)
13. [调试技巧](#13-调试技巧)
14. [限制与注意事项](#14-限制与注意事项)
15. [导入格式约定](#15-导入格式约定)

---

## 1. 概述

Mobile Tavern 插件是一个 **全屏 HTML5 应用**，以 `.mtplugin` 格式打包（ZIP 压缩），运行在宿主 App 的沙盒 iframe 中。

**核心特性**：

- 纯前端运行（HTML + CSS + JS），无后端依赖
- 沙盒隔离，无法访问宿主数据
- 通过 `window.MobileTavernPlugin` API 调用宿主能力（LLM、存储、方向控制等）
- 支持横屏/竖屏/自动方向
- 支持沉浸式模式（隐藏系统栏）

**适用场景**：

- 小游戏（RPG、弹幕、解谜等）
- 互动小说
- 角色卡辅助工具（属性计算器、骰子器等）
- 可视化工具（关系图、时间线等）

---

## 2. 快速开始

最小可用插件只需 2 个文件：

**manifest.json**：
```json
{
  "format": "mobile-tavern.plugin",
  "manifestVersion": 1,
  "id": "com.example.hello",
  "name": "Hello Plugin",
  "version": "1.0.0",
  "type": "fullscreen",
  "entry": "index.html"
}
```

**index.html**：
```html
<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; background: #1a1a2e; color: #fff; font-family: sans-serif; }
    button { padding: 16px 32px; font-size: 18px; border: none; border-radius: 12px; background: #6c5ce7; color: #fff; }
  </style>
</head>
<body>
  <button id="exit">退出插件</button>
  <script>
    document.getElementById('exit').addEventListener('click', () => {
      window.MobileTavernPlugin.exit();
    });
  </script>
</body>
</html>
```

将这两个文件用 ZIP 工具压缩为 `.mtplugin` 文件，然后在 Mobile Tavern 的插件管理页安装即可。

---

## 3. 项目结构

一个完整的插件项目推荐如下结构：

```
my-plugin/
├── manifest.json       # 插件清单（必需）
├── index.html          # 入口页面（必需，路径由 manifest.entry 指定）
├── style.css           # 样式文件（可选）
├── game.js             # 主逻辑（可选，也可内联在 HTML 中）
├── assets/             # 图片/音频/字体资源（可选）
│   ├── bg.webp
│   └── click.mp3
└── build.mjs           # 构建脚本（可选，用于打包 .mtplugin）
```

**文件限制**：

| 限制项 | 上限 |
|--------|------|
| 压缩后包大小 | 25 MB |
| 解压后总大小 | 100 MB |
| 单个文件大小 | 32 MB |
| 入口 HTML 大小 | 2 MB |
| manifest.json 大小 | 64 KB |
| 文件数量 | 512 个 |

---

## 4. manifest.json 详解

`manifest.json` 是插件的清单文件，描述插件元数据和权限声明。

### 完整字段

```json
{
  "format": "mobile-tavern.plugin",
  "manifestVersion": 1,
  "id": "com.example.my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "type": "fullscreen",
  "entry": "index.html",
  "description": "插件描述文本",
  "author": "作者名称",
  "orientation": "landscape",
  "permissions": ["llm.chat", "llm.chatStream", "llm.preset.list"],
  "llm": { "syncPreset": true }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `format` | `"mobile-tavern.plugin"` | 是 | 固定值，标识包格式 |
| `manifestVersion` | `1` | 是 | 清单版本，当前固定为 1 |
| `id` | string | 是 | 插件唯一标识，格式 `^[a-z0-9]+(?:[.-][a-z0-9]+)+$`，最长 96 字符 |
| `name` | string | 是 | 显示名称，最长 80 字符 |
| `version` | string | 是 | 语义化版本号，格式 `\d+\.\d+\.\d+` |
| `type` | `"fullscreen"` | 是 | 插件类型，当前仅支持 `fullscreen` |
| `entry` | string | 是 | 入口 HTML 文件路径，以 `.html` 或 `.htm` 结尾 |
| `description` | string | 否 | 描述文本，最长 500 字符 |
| `author` | string | 否 | 作者名称，最长 120 字符 |
| `orientation` | string | 否 | 屏幕方向：`portrait`/`landscape`/`auto`（默认 `auto`） |
| `permissions` | string[] | 否 | 权限白名单，声明后才能调用对应 API |
| `llm` | object | 否 | LLM 配置 |

### id 命名规范

`id` 必须符合反向域名格式，至少包含一个 `.` 或 `-` 分隔符：

- ✅ `com.example.my-plugin`
- ✅ `dev.username.card-tool`
- ✅ `demo.astral-rift`
- ❌ `myplugin`（缺少分隔符）
- ❌ `MyPlugin`（大写字母不允许）

### permissions 权限声明

调用 LLM 相关 API 必须在 `permissions` 中声明对应权限：

| 权限 | 允许调用的方法 |
|------|----------------|
| `llm.chat` | `MobileTavernPlugin.llm.chat()` |
| `llm.chatStream` | `MobileTavernPlugin.llm.chatStream()` |
| `llm.preset.list` | `MobileTavernPlugin.llm.listPresets()` |

如果声明了 `llm` 配置，`permissions` 中必须至少包含一个 `llm.*` 权限。

### llm 配置

```json
"llm": { "syncPreset": true }
```

| 值 | 含义 |
|----|------|
| `true` | 同步宿主当前预设的采样参数（temperature、top_p 等），插件无需自行指定 |
| `false` | 插件自管采样参数，可在 `llm.chat()` / `llm.chatStream()` 的 `sampling` 字段中传入 |

---

## 5. 入口 HTML

入口 HTML 是插件的启动页面。宿主会对其进行以下处理：

1. **注入 CSP 头**：强制安全策略（见 [CSP 限制](#10-csp-限制与资源内联)）
2. **注入桥接脚本**：自动注入 `window.MobileTavernPlugin` API
3. **内联 CSS/JS 引用**：`<link rel="stylesheet">` 和 `<script src>` 会被替换为内联内容
4. **内联二进制资源**：`<img src>`、CSS `url()` 引用的图片/字体等被转为 `data:` URL

### 基本模板

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" />
  <title>我的插件</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app">加载中…</div>
  <script src="game.js"></script>
</body>
</html>
```

### 注意事项

- `<base>` 标签会被移除
- `<meta http-equiv="refresh">` 会被移除
- 所有资源引用必须是**相对路径**（如 `style.css`、`./assets/bg.png`），不能用绝对路径或外部 URL
- `<a>` 标签的点击和表单提交会被阻止（防止导航离开插件）

---

## 6. 运行时 API

宿主通过 `window.MobileTavernPlugin` 对象向插件提供 API。该对象在页面加载时自动注入，无需手动初始化。

### API 总览

```typescript
interface MobileTavernPlugin {
  version: 1;

  // 生命周期
  ready(): Promise<{ apiVersion: 1 }>;
  exit(): Promise<void>;

  // 屏幕方向
  setOrientation(orientation: "portrait" | "landscape" | "auto"): Promise<void>;

  // 存储
  save(slot: string, data: unknown): Promise<void>;
  load(slot: string): Promise<unknown>;
  deleteSave(slot: string): Promise<void>;

  // LLM
  llm: {
    chat(opts: ChatOptions): Promise<{ text: string }>;
    chatStream(opts: ChatOptions): StreamHandle;
    listPresets(): Promise<{ syncPreset: boolean }>;
  };
}
```

### host.ready()

握手方法，页面加载后自动调用。也可手动调用确认宿主可用。

```javascript
const info = await window.MobileTavernPlugin.ready();
console.log(info.apiVersion); // 1
```

### host.exit()

请求退出插件，返回宿主界面。

```javascript
document.getElementById('exit-btn').addEventListener('click', () => {
  window.MobileTavernPlugin.exit();
});
```

> **注意**：为防止启动时误触，插件启动后 2 秒内的退出请求会被忽略。

### setOrientation(orientation)

动态切换屏幕方向。`manifest.json` 中的 `orientation` 是初始方向，此方法可在运行时改变。

```javascript
// 切换到横屏
await window.MobileTavernPlugin.setOrientation('landscape');

// 切换到竖屏
await window.MobileTavernPlugin.setOrientation('portrait');

// 自动方向（跟随设备）
await window.MobileTavernPlugin.setOrientation('auto');
```

---

## 7. LLM 集成

Mobile Tavern 允许插件调用宿主配置的 LLM（大语言模型）API，实现 AI 驱动的游戏逻辑。

### 前置要求

1. 在 `manifest.json` 中声明权限：
   ```json
   "permissions": ["llm.chat", "llm.chatStream"]
   ```

2. 宿主 App 必须已配置 API Key（设置 → API 配置）

### llm.chat(opts) — 一次性请求

等待 LLM 完整生成后返回全部文本。超时时间 300 秒（5 分钟）。

```javascript
const result = await window.MobileTavernPlugin.llm.chat({
  messages: [
    { role: "system", content: "你是一个 RPG 旁白，用第二人称描述玩家的行动。" },
    { role: "user", content: "我走进了黑暗的洞穴。" }
  ],
  // 可选：当 syncPreset=false 时生效
  sampling: {
    temperature: 0.8,
    top_p: 0.9,
    max_tokens: 500
  }
});
console.log(result.text); // LLM 生成的文本
```

### llm.chatStream(opts) — 流式请求

实时返回生成内容，适合长文本生成或需要即时反馈的场景。

```javascript
const stream = window.MobileTavernPlugin.llm.chatStream({
  messages: [
    { role: "system", content: "你是故事讲述者。" },
    { role: "user", content: "开始一个奇幻冒险。" }
  ]
});

let fullText = "";

stream
  .onChunk((chunk) => {
    fullText += chunk;
    document.getElementById('story').textContent = fullText;
  })
  .onDone(() => {
    console.log('生成完成');
  })
  .onError((err) => {
    console.error('生成失败:', err.message);
  });

// 需要时取消生成
document.getElementById('cancel-btn').addEventListener('click', () => {
  stream.cancel();
});
```

### ChatOptions 参数

```typescript
interface ChatOptions {
  messages: Array<{ role: string; content: string }>;
  sampling?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    min_p?: number;
    max_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
  };
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages` | Array | 消息数组，每条含 `role`（如 `system`/`user`/`assistant`）和 `content` |
| `sampling` | object | 采样参数，仅当 `manifest.llm.syncPreset = false` 时生效 |

### llm.listPresets()

查询宿主的 LLM 预设同步配置。

```javascript
const { syncPreset } = await window.MobileTavernPlugin.llm.listPresets();
if (syncPreset) {
  console.log('宿主会自动同步预设参数，无需手动指定 sampling');
} else {
  console.log('插件需自管采样参数');
}
```

### 错误处理

| 错误码 | 含义 |
|--------|------|
| `PLUGIN_PERMISSION_DENIED` | 未声明对应权限 |
| `PLUGIN_LLM_NOT_CONFIGURED` | 宿主未配置 API Key |
| `PLUGIN_LLM_INVALID_MESSAGES` | messages 参数格式错误 |
| `HOST_TIMEOUT` | 请求超时（chat 300 秒，listPresets 10 秒） |
| `HOST_ERROR` | 宿主其他错误 |

---

## 8. 存储系统

插件可使用宿主提供的持久化存储，按 `slot`（存档槽）分隔数据。

### save(slot, data)

保存数据到指定存档槽。`data` 可以是任意可序列化的值（对象、数组、字符串、数字等）。

```javascript
await window.MobileTavernPlugin.save('progress', {
  level: 5,
  hp: 80,
  inventory: ['sword', 'potion'],
  position: { x: 120, y: 340 }
});
```

### load(slot)

读取存档槽数据。如果存档不存在，返回 `null`。

```javascript
const data = await window.MobileTavernPlugin.load('progress');
if (data) {
  console.log('恢复存档:', data);
} else {
  console.log('无存档，开始新游戏');
}
```

### deleteSave(slot)

删除指定存档槽。

```javascript
await window.MobileTavernPlugin.deleteSave('progress');
```

### 使用建议

- `slot` 是字符串，建议使用语义化名称：`"progress"`、`"settings"`、`"score"` 等
- 存储空间无明确限制，但建议单次保存数据不超过 1 MB
- 数据按插件 ID 隔离，不同插件的存档互不影响

---

## 9. 生命周期事件

宿主会在特定时机向插件发送生命周期事件，通过 `mobile-tavern:lifecycle` 自定义事件监听。

```javascript
addEventListener('mobile-tavern:lifecycle', (event) => {
  console.log('生命周期事件:', event.detail);
});
```

### 事件类型

| 事件 | 触发时机 | 建议处理 |
|------|----------|----------|
| `pause` | App 进入后台（如切到其他 App、按下 Home 键） | 暂停游戏循环、保存进度 |
| `resume` | App 回到前台 | 恢复游戏循环 |

### 示例：自动保存

```javascript
addEventListener('mobile-tavern:lifecycle', (event) => {
  if (event.detail === 'pause') {
    // App 进入后台，自动保存
    window.MobileTavernPlugin.save('autosave', gameState);
  }
});
```

---

## 10. CSP 限制与资源内联

插件运行在严格的 Content Security Policy 沙盒中：

```
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
img-src data:;
media-src data:;
font-src data:;
connect-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none'
```

### 能做与不能做

| 操作 | 是否允许 | 说明 |
|------|----------|------|
| 内联 `<script>` | ✅ | `<script>code</script>` |
| 内联 `<style>` | ✅ | `<style>code</style>` |
| 引用本地 CSS/JS | ✅ | 宿主自动内联 |
| 引用本地图片 | ✅ | 宿主自动转为 `data:` URL |
| `fetch()` / `XMLHttpRequest` | ❌ | `connect-src 'none'` |
| 加载外部 URL | ❌ | `default-src 'none'` |
| 使用 iframe | ❌ | `frame-src 'none'` |
| 使用 `<object>` / `<embed>` | ❌ | `object-src 'none'` |
| 提交表单 | ❌ | `form-action 'none'` |
| WebSocket | ❌ | `connect-src 'none'` |

### 资源引用方式

宿主会自动处理 HTML 和 CSS 中的资源引用：

**HTML 中的引用**（自动内联）：
```html
<link rel="stylesheet" href="style.css" />     <!-- → <style>内联</style> -->
<script src="game.js"></script>                 <!-- → <script>内联</script> -->
<img src="assets/bg.webp" />                    <!-- → <img src="data:image/webp;base64,..."> -->
```

**CSS 中的引用**（自动转 data URL）：
```css
body {
  background: url('assets/bg.webp');  /* → url('data:image/webp;base64,...') */
}
@import url('theme.css');             /* → 内联 */
```

**JS 中的引用**：不会自动处理。如果 JS 中需要引用图片，需在构建时用工具（如 esbuild 的 `dataurl` loader）将图片转为 `data:` URL。

---

## 11. 构建与打包

### 简单插件（无需构建）

直接用 ZIP 工具将文件压缩为 `.mtplugin`：

```bash
# 进入插件目录
cd my-plugin
# 压缩为 .mtplugin（注意：manifest.json 必须在根目录）
zip -r ../my-plugin.mtplugin manifest.json index.html style.css game.js assets/
```

### 复杂插件（使用构建工具）

推荐使用 esbuild + fflate 构建打包：

**build.mjs**：
```javascript
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { zipSync } from "fflate";

const root = resolve("my-plugin");
await mkdir(resolve(root, "dist"), { recursive: true });

// 1. 构建 JS（打包依赖 + 内联图片）
await build({
  entryPoints: [resolve(root, "src/game.ts")],
  outfile: resolve(root, "game.js"),
  bundle: true,           // 打包所有依赖
  format: "iife",         // 立即执行函数
  platform: "browser",
  target: ["chrome100", "safari15"],
  minify: true,           // 压缩
  loader: { ".webp": "dataurl" },  // 图片转 data URL
  legalComments: "none",
});

// 2. 打包为 .mtplugin
const names = ["manifest.json", "index.html", "style.css", "game.js"];
const files = Object.fromEntries(
  await Promise.all(names.map(async (name) => [
    name,
    new Uint8Array(await readFile(resolve(root, name)))
  ]))
);
await writeFile(
  resolve(root, "my-plugin.mtplugin"),
  zipSync(files, { level: 6 })
);
console.log("打包完成: my-plugin.mtplugin");
```

**package.json**：
```json
{
  "scripts": {
    "build": "node build.mjs"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "fflate": "^0.8.0"
  }
}
```

### 使用 PixiJS / Phaser 等游戏引擎

游戏引擎需要特殊处理以适配 CSP 限制：

- **PixiJS**：使用 `pixi.js/unsafe-eval` 入口（适配 `script-src 'unsafe-inline'`）
- **Phaser**：确认不使用 `eval` / `new Function`，或配置为不使用
- 所有引擎资源（图片、音频）必须在构建时内联为 `data:` URL

---

## 12. 示例插件

Mobile Tavern 内置两个示例插件，可作为开发参考：

### 星渊终焉（demo.astral-rift）

- 类型：横屏弹幕 Boss 战
- 引擎：PixiJS 8.x
- 特性：多阶段战斗、激光预警、相位闪避、终焉技
- 源码位置：`examples/astral-rift-plugin/`

### 夜雨试剑（demo.rain-sword-duel）

- 类型：横屏对战游戏
- 引擎：PixiJS 8.x
- 特性：回合制对战、技能系统
- 源码位置：`examples/pixi-arena-plugin/`

### 完整示例：带 LLM 的文字冒险

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>AI 冒险</title>
  <style>
    body { margin: 0; padding: 16px; background: #0f0f1e; color: #e0e0e0; font-family: sans-serif; }
    #story { white-space: pre-wrap; line-height: 1.6; min-height: 60vh; }
    #input-area { display: flex; gap: 8px; margin-top: 16px; }
    #input { flex: 1; padding: 12px; border: 1px solid #333; border-radius: 8px; background: #1a1a2e; color: #fff; }
    #send { padding: 12px 24px; border: none; border-radius: 8px; background: #6c5ce7; color: #fff; }
    #exit-btn { position: fixed; top: 8px; right: 8px; padding: 8px 12px; }
  </style>
</head>
<body>
  <button id="exit-btn" onclick="MobileTavernPlugin.exit()">退出</button>
  <div id="story">冒险即将开始…</div>
  <div id="input-area">
    <input id="input" placeholder="输入你的行动…" />
    <button id="send">发送</button>
  </div>
  <script>
    const story = document.getElementById('story');
    const input = document.getElementById('input');
    const send = document.getElementById('send');
    const history = [
      { role: 'system', content: '你是一个奇幻冒险的旁白。用第二人称描述玩家的行动和周围环境，每次回复不超过 200 字。' }
    ];

    async function sendAction() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      story.textContent += '\n\n你: ' + text;
      history.push({ role: 'user', content: text });

      send.disabled = true;
      send.textContent = '思考中…';

      try {
        const result = await MobileTavernPlugin.llm.chat({
          messages: history,
          sampling: { temperature: 0.9, max_tokens: 300 }
        });
        story.textContent += '\n\n' + result.text;
        history.push({ role: 'assistant', content: result.text });
      } catch (err) {
        story.textContent += '\n\n[错误: ' + err.message + ']';
      } finally {
        send.disabled = false;
        send.textContent = '发送';
      }
    }

    send.addEventListener('click', sendAction);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAction();
    });

    // 自动保存
    addEventListener('mobile-tavern:lifecycle', (e) => {
      if (e.detail === 'pause') {
        MobileTavernPlugin.save('autosave', history);
      }
    });

    // 恢复存档
    MobileTavernPlugin.load('autosave').then((data) => {
      if (data && Array.isArray(data) && data.length > 1) {
        history.length = 0;
        history.push(...data);
        story.textContent = history.slice(1).map(m => m.content).join('\n\n');
      } else {
        sendAction(); // 开始新游戏
      }
    });
  </script>
</body>
</html>
```

对应 `manifest.json`：
```json
{
  "format": "mobile-tavern.plugin",
  "manifestVersion": 1,
  "id": "com.example.ai-adventure",
  "name": "AI 冒险",
  "version": "1.0.0",
  "type": "fullscreen",
  "entry": "index.html",
  "description": "由 LLM 驱动的文字冒险游戏",
  "orientation": "portrait",
  "permissions": ["llm.chat"],
  "llm": { "syncPreset": false }
}
```

---

## 13. 调试技巧

### 在浏览器中调试

插件本质是 HTML 页面，可直接在浏览器中打开 `index.html` 调试。注意：

- `window.MobileTavernPlugin` 在浏览器中不存在，需 mock：
  ```javascript
  // debug-mock.js（仅开发环境引入）
  if (!window.MobileTavernPlugin) {
    window.MobileTavernPlugin = {
      version: 1,
      ready: () => Promise.resolve({ apiVersion: 1 }),
      exit: () => console.log('exit()'),
      setOrientation: (o) => console.log('setOrientation:', o),
      save: (s, d) => localStorage.setItem('plugin:' + s, JSON.stringify(d)),
      load: (s) => JSON.parse(localStorage.getItem('plugin:' + s) || 'null'),
      deleteSave: (s) => localStorage.removeItem('plugin:' + s),
      llm: {
        chat: async (opts) => {
          console.log('llm.chat:', opts);
          return { text: '（模拟回复）' };
        },
        chatStream: (opts) => ({
          onChunk: () => {}, onDone: () => {}, onError: () => {}, cancel: () => {}
        }),
        listPresets: () => Promise.resolve({ syncPreset: false })
      }
    };
  }
  ```

### 在 App 中调试

- 插件运行时，宿主会通过 Android logcat 输出诊断日志（tag: `PluginDiagnostic`）
- 日志包含：插件加载、方向切换、API 调用、退出等事件
- 可通过 `adb logcat | grep PluginDiagnostic` 查看

### 常见问题排查

| 问题 | 可能原因 |
|------|----------|
| 插件安装失败 | manifest.json 格式错误，或 id 不符合规范 |
| 白屏 | HTML 语法错误，或 JS 执行报错 |
| 资源不显示 | 资源路径错误（必须相对路径），或文件未包含在包内 |
| API 调用报 `PERMISSION_DENIED` | 未在 manifest.json 声明对应权限 |
| LLM 调用报 `NOT_CONFIGURED` | 宿主未配置 API Key |
| 插件启动后立即退出 | 误触退出按钮（启动后 2 秒内有退出保护） |

---

## 14. 限制与注意事项

### 安全限制

- **沙盒隔离**：插件运行在 `sandbox="allow-scripts"` 的 iframe 中，无法访问宿主 DOM、Cookie、localStorage
- **无网络访问**：CSP `connect-src 'none'` 禁止所有网络请求（fetch、XHR、WebSocket）
- **无外部资源**：不能加载任何外部 URL（CDN、图片、字体等）
- **无 iframe**：不能嵌套 iframe 或嵌入外部内容

### 性能注意

- 图片资源建议使用 WebP 格式（体积更小）
- 大文件构建时用 esbuild minify 压缩
- 避免单个 JS 文件超过 2MB（入口 HTML 限制 2MB，但内联 JS 无限制）
- 流式 LLM 生成时注意 UI 不阻塞（用 `requestAnimationFrame` 更新 DOM）

### 兼容性

- 目标平台：Android WebView（Chrome 内核 100+）
- 支持的浏览器 API：ES2022、CSS3、Canvas、WebGL、Web Audio API
- 不支持的 API：Service Worker、Web Worker（CSP 限制）、IndexedDB（沙盒限制）

### 版本兼容

- `manifestVersion` 当前为 1，未来版本可能引入新字段
- `MobileTavernPlugin.version` 为 1，未来可能推出 v2 API
- 建议在 `ready()` 后检查 `apiVersion` 确认兼容性

---

## 15. 导入格式约定

Mobile Tavern 对可导入的文件格式有严格约定，只支持以下固定格式，其他格式一律拒绝。

### 角色卡格式

| 扩展名 | 格式说明 | 导入入口 |
|--------|----------|----------|
| `.json` | SillyTavern 角色卡 JSON 格式（V1/V2/V3） | 角色卡页导入按钮 |
| `.png` | PNG 嵌入式角色卡（metadata 嵌入 tEXt chunk） | 角色卡页导入按钮 |

### 插件格式

| 扩展名 | 格式说明 | 导入入口 |
|--------|----------|----------|
| `.mtplugin` | ZIP 压缩包，根目录必须含 `manifest.json` 和 `game.js` | 设置 → 插件管理 → 导入 |

### 安全边界

- **角色卡**（`.json` / `.png`）：纯数据，不含可执行代码，安全风险低
- **插件**（`.mtplugin`）：含可执行 JavaScript，运行在沙盒 iframe 中，有 LLM API 访问权限，安全风险中
- **不支持远程导入**：当前版本只支持本地文件导入，不支持 URL/远程下载（避免供应链攻击）
- **不支持嵌套格式**：插件不能携带角色卡，角色卡不能携带插件

### 格式校验

导入时会进行以下校验：
1. **扩展名校验**：只接受上述四种扩展名
2. **结构校验**：
   - JSON 角色卡：必须含 `name` 字段
   - PNG 角色卡：必须含有效的 `chara` tEXt chunk
   - 插件包：必须含 `manifest.json`（含 `format: "mobile-tavern.plugin"`）和 `game.js`
3. **大小限制**：单个文件不超过 50MB

### 未来扩展

未来版本可能支持：
- 插件商店/社区分享（需安全审核机制）
- URL 导入（需白名单 + 签名验证）
- 角色卡携带插件引用（需用户确认）

当前版本不支持以上能力，避免在安全机制完善前引入风险。

---

## 附录：完整 manifest.json 模板

```json
{
  "format": "mobile-tavern.plugin",
  "manifestVersion": 1,
  "id": "com.yourname.plugin-name",
  "name": "插件名称",
  "version": "1.0.0",
  "type": "fullscreen",
  "entry": "index.html",
  "description": "一句话描述插件功能",
  "author": "你的名字",
  "orientation": "auto",
  "permissions": ["llm.chat", "llm.chatStream"],
  "llm": { "syncPreset": true }
}
```

---

*本文档适用于 Mobile Tavern 1.7.x 版本。如遇 API 行为与文档不符，以实际代码为准。*
