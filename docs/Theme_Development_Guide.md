# Mobile Tavern 主题与界面扩展开发指南

> 本文是主题作者、插件作者和生成代码的 AI 的权威入口。开始工作前先判断目标属于“主题”“全屏插件”还是“应用内扩展”，不要混用三套边界。

## 一、先选择正确的交付物

| 目标 | 应使用 | 可以做什么 | 不能做什么 |
|---|---|---|---|
| 修改主应用颜色、圆角、间距、动效与局部显隐 | `.tavern-theme.json` 主题包 | CSS 变量、受限 `customCss`、本地图片变量 | JavaScript、网络请求、读写业务数据 |
| 制作 Gal 游戏或独立交互页面 | `.mtplugin` 全屏插件 | 自带 HTML/CSS/JS/媒体、独立存档、受控宿主 API | 访问主应用 DOM、Kernel、凭证和任意网络 |
| 修改仓库内页面、注册新的主 Tab | 受信应用内扩展 | 使用 `main:tabs` 等扩展点和应用服务 | 伪装成可安装第三方插件绕过权限 |

主题不是脚本插件；`.mtplugin` 也不是主应用皮肤。当前尚未开放第三方插件替换聊天壳、设置页或全局导航的通用 UI Surface API。

## 二、主题包格式

文件扩展名建议使用 `.tavern-theme.json`。最小可用示例：

```json
{
  "schemaVersion": "1.0",
  "name": "暮色玻璃",
  "version": "1.0.0",
  "description": "适合深色环境的半透明主题",
  "isDark": true,
  "variables": {
    "--background": "222 24% 10%",
    "--foreground": "210 25% 96%",
    "--card": "222 20% 14%",
    "--card-foreground": "210 25% 96%",
    "--primary": "268 90% 72%",
    "--primary-foreground": "222 24% 10%",
    "--border": "215 20% 28%",
    "--radius": "0.9rem"
  },
  "customCss": "[data-ui=\"main-tab-bar\"] { backdrop-filter: blur(18px); }"
}
```

字段约束：

- `schemaVersion` 当前固定为 `"1.0"`。
- `name` 必填，最长 40 个字符；同名主题会生成同一稳定 ID 并覆盖旧版本。
- `version` 必填，建议使用语义版本。
- `isDark` 决定浏览器配色与原生状态栏图标明暗。
- `variables` 必须是对象，只允许下文白名单。
- `customCss` 可选；导入、预览和运行时都会再次清洗并限定到当前主题。
- 不要在可分发文件中写入运行时字段 `id`、`importedAt`；应用导入时会自行生成。

## 三、支持的主题变量

允许的变量如下：

```text
--background
--foreground
--card
--card-foreground
--popover
--popover-foreground
--primary
--primary-foreground
--secondary
--secondary-foreground
--muted
--muted-foreground
--accent
--accent-foreground
--destructive
--destructive-foreground
--border
--input
--ring
--radius
--dialogue-color
--prose-color
```

颜色变量通常使用 Tailwind/shadcn 风格的 HSL 通道，例如 `"268 90% 72%"`，不要包一层 `hsl()`；`--radius` 使用合法长度，例如 `"0.75rem"`。

变量值不得包含外部 `url()`、`@import`、动态表达式、花括号、分号或 HTML 逃逸字符。未在白名单中的变量会使主题包校验失败。

以下原生布局变量永远不可覆盖：

```text
--safe-area-*
--android-safe-area-*
```

## 四、`customCss` 能力与硬限制

### 支持

- 普通选择器、属性选择器、组合选择器；
- `:hover`、`:active`、`:focus-visible` 等伪类；
- `::before`、`::after` 等伪元素；
- `@media`、`@supports`、`@container` 等分组规则；
- `@keyframes` 与 animation；
- 通过宿主管理的 CSS 变量使用本地图片；
- 在当前 DOM 中命中任意组件，但只有下文的语义属性属于稳定契约。

### 自动作用域

作者直接编写组件选择器即可，不要自行添加生成后的 `[data-theme="custom_..."]`：

```css
[data-ui="main-tab-bar"] {
  border-color: hsl(var(--primary) / 0.35);
}

@media (min-width: 700px) {
  [data-ui="main-tab-bar"] {
    max-width: 42rem;
    margin-inline: auto;
  }
}
```

宿主会把普通规则递归限定到当前主题。非当前自定义主题的 `<style>` 会被禁用，以隔离 `@keyframes` 等全局命名空间。动画名称仍建议加入主题前缀，例如 `twilight-tab-glow`。

### 硬限制

以下内容会被移除、替换或拒绝：

- `<script>`、`</style>` 等 HTML 注入；
- `@import`；
- 任意直接 `url(...)`、`image-set(...)` 与外部资源协议，包括远程地址、`data:` 和手写 Blob URL；
- `expression()`、`behavior:`、`-moz-binding`；
- `position: fixed`，会降级为 `position: absolute`；
- Safe Area 变量重新声明。

主题不能执行 JavaScript、读取 Cookie、调用 API、访问 IndexedDB、改变插件权限或直接修改用户设置。

## 五、稳定 UI 选择器

主题应优先使用语义属性，不要依赖 Tailwind class、React 组件层级或自动生成 class。

| 选择器 | 含义 |
|---|---|
| `[data-ui="main-tab-bar"]` | 主界面底栏容器 |
| `[data-ui="main-tab"]` | 单个底栏入口 |
| `[data-ui="main-tab"][data-tab-id="..."]` | 指定 Tab 入口 |
| `[data-ui="main-tab-content"]` | 主页面内容容器 |
| `[data-ui="main-tab-content"][data-active-tab="..."]` | 指定当前页面状态 |
| `[data-ui="main-tab-visibility-settings"]` | Tab 显隐设置区 |
| `[data-ui="local-resource-manager"]` | 本地界面资源管理区 |

当前内置 Tab ID：

```text
characters
community
chat-history
chat
global-worldbook
settings
playground
```

`community` 可能受产品策略影响而不注册；`chat` 与 `playground` 默认不显示在底栏。未来应用内扩展可以注册其他 ID，因此不要假设列表永远固定。

## 六、隐藏 Tab 与插件入口

### 用户级正式隐藏

首选方式是“设置 → 外观 → 底栏入口”。设置只保存可选 Tab ID，不卸载页面、不删除数据，也不改变扩展注册。

`characters` 和 `settings` 是恢复入口，正式设置不会允许隐藏。主题包格式本身没有 `hiddenMainTabs` 字段，主题不得静默修改用户的导航偏好。

### 主题内视觉隐藏

主题可以使用稳定选择器隐藏可选入口：

```css
[data-ui="main-tab"][data-tab-id="community"],
[data-ui="main-tab"][data-tab-id="global-worldbook"] {
  display: none;
}
```

也可以隐藏整条底栏并清除内容预留：

```css
[data-ui="main-tab-bar"] {
  display: none;
}

[data-ui="main-tab-content"] {
  padding-bottom: 0 !important;
}
```

分发主题时不要隐藏 `characters`、`settings` 或全部导航入口，否则用户可能无法恢复。视觉隐藏不等于禁用页面，已有路由和状态仍然存在。

### 应用内扩展控制

只有仓库内受信扩展可以决定自己是否进入底栏：

```ts
kernel.registerExtension({
  id: "example-tools",
  targetPoint: "main:tabs",
  priority: 40,
  value: ExampleToolsTab,
  meta: {
    name: "示例工具",
    icon: "Settings",
    showInBottomBar: false
  }
});
```

`showInBottomBar: false` 表示注册页面但不生成底栏入口。第三方 `.mtplugin` 不能调用 `registerExtension`，也不会注册主 Tab；它从插件管理入口启动，在自己的全屏沙箱中运行。

## 七、本地图片、视频与音乐

用户可在“设置 → 外观 → 本地界面资源”导入文件：

| 类型 | 单文件上限 | 当前用途 |
|---|---:|---|
| 图片 | 20 MiB | 预览、主题 CSS、应用服务解析 |
| 音频/音乐 | 100 MiB | 预览、稳定资源引用、应用服务解析 |
| 视频 | 256 MiB | 预览、稳定资源引用、应用服务解析 |

资源库总上限为 512 MiB。SVG 不开放；资源元数据与文件字节位于独立 `MobileTavernResourceDB`，不会塞入 settings 大对象。

所有资源都有稳定引用：

```text
tavern-resource://r_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

该引用不是网络 URL，也不能直接写进 CSS `url()`。受信运行时代码应通过 `LocalResourceService.resolveResourceReference()` 把它解析为当前会话 Blob URL，禁止持久化 Blob URL。

图片会额外得到宿主管理的 CSS 变量：

```css
.character-stage {
  background-image: var(--tavern-resource-r_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx, none);
  background-size: cover;
  background-position: center;
}
```

音频和视频不能由 CSS 播放。当前第三方 `.mtplugin` 尚未获得主应用资源库 RPC；插件需要把媒体放进自己的 `.mtplugin` 包。未来若开放资源权限，应通过版本化、可撤销的 Plugin Host RPC 解析稳定引用，不能直接开放 IndexedDB。

本地资源 ID 只在当前设备有效，也暂不包含在普通 JSON 备份中。公开分享主题时不要硬编码作者设备的资源 ID；应使用 `none` 等回退值，并在安装说明中让用户替换占位引用。

## 八、完整主题示例

```json
{
  "schemaVersion": "1.0",
  "name": "霓虹终端",
  "version": "1.0.0",
  "description": "紧凑的深色霓虹主题",
  "isDark": true,
  "variables": {
    "--background": "225 28% 8%",
    "--foreground": "210 30% 96%",
    "--card": "225 24% 12%",
    "--card-foreground": "210 30% 96%",
    "--popover": "225 24% 11%",
    "--popover-foreground": "210 30% 96%",
    "--primary": "174 84% 52%",
    "--primary-foreground": "225 28% 8%",
    "--secondary": "264 55% 24%",
    "--secondary-foreground": "210 30% 96%",
    "--muted": "225 18% 18%",
    "--muted-foreground": "215 15% 68%",
    "--accent": "292 76% 58%",
    "--accent-foreground": "225 28% 8%",
    "--destructive": "0 72% 56%",
    "--destructive-foreground": "0 0% 100%",
    "--border": "174 42% 28%",
    "--input": "225 18% 18%",
    "--ring": "174 84% 52%",
    "--radius": "0.7rem",
    "--dialogue-color": "210 30% 96%",
    "--prose-color": "210 24% 90%"
  },
  "customCss": "[data-ui=\"main-tab-bar\"] { box-shadow: 0 0 22px hsl(var(--primary) / .18); }\n[data-ui=\"main-tab\"][aria-selected=\"true\"] { text-shadow: 0 0 12px hsl(var(--primary) / .65); }\n@media (prefers-reduced-motion: no-preference) { [data-ui=\"main-tab\"][aria-selected=\"true\"] { animation: neon-tab-pulse 2.4s ease-in-out infinite; } }\n@keyframes neon-tab-pulse { 50% { opacity: .78; } }"
}
```

## 九、给生成主题的 AI 的强制检查表

AI 输出前必须逐项确认：

1. 先判断需求是主题、`.mtplugin` 还是仓库内受信扩展。
2. 主题只输出合法 JSON，不附 Markdown 代码围栏，除非用户明确要求解释。
3. 使用 `schemaVersion: "1.0"`，不输出 `id` 和 `importedAt`。
4. `variables` 只使用本文白名单；颜色值优先使用 HSL 通道。
5. 不生成外部 URL、`@import`、`data:` URL、手写 Blob URL、JavaScript 或 HTML。
6. `customCss` 优先使用 `data-ui`、`data-tab-id` 和 `data-active-tab`，不要依赖内部 class 名。
7. 不主动隐藏 `characters`、`settings` 或全部导航。
8. 本地图片使用用户提供的 `var(--tavern-resource-..., none)`；音视频不写进 CSS。
9. 为窄屏、横屏、Safe Area 和 `prefers-reduced-motion` 保留可用降级。
10. 共享主题不得硬编码仅作者设备存在的资源 ID，必须提供回退值或安装替换说明。

## 十、验证与排错

- 最稳妥的开发方式是使用应用内主题编辑器实时预览，再导出 `.tavern-theme.json`。
- 导入失败时先检查字段类型、变量白名单、名称长度和变量值中的禁止内容。
- 样式未生效时确认选择器使用稳定属性、目标元素确实存在，并检查规则是否被内联 style 覆盖；必要时对纯视觉覆盖使用有限的 `!important`。
- 图片不显示时确认使用的是资源库复制的 CSS 变量，而不是 `tavern-resource://` 或 `url(...)`。
- 第三方全屏插件的包结构、CSP、权限与媒体打包规则见 [第三方全屏插件规范](Plugin_System_v1.md)。
