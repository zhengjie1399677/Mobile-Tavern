# Mobile Tavern 主题与界面扩展开发指南

> 本文是主题作者、插件作者和生成代码的 AI 的权威入口。开始工作前先判断目标属于“主题”“全屏插件”还是“应用内扩展”，不要混用三套边界。

## 一、先选择正确的交付物

| 目标 | 应使用 | 可以做什么 | 不能做什么 |
|---|---|---|---|
| 修改主应用颜色、圆角、间距、动效与局部显隐 | `.tavern-theme.json` 主题包 | CSS 变量、受限 `customCss`、本地图片、声明式状态与本地音视频 | JavaScript、网络请求、读写业务数据 |
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

- `schemaVersion` 可为 `"1.0"` 或 `"1.1"`。1.0 只包含样式；1.1 增加受限交互，旧 1.0 包无需迁移。
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

变量值不得包含 `url()`、`image-set()`、`@import`、`expression()`、`behavior:`、`-moz-binding`、
`http:` / `data:` / `blob:` / `file:` 等外部资源协议、花括号、分号或尖括号。这里限制的是会造成
CSS 声明逃逸、外部加载或 HTML 注入的具体内容，并不是笼统禁止所有 HTML 特殊字符。未在白名单中的变量会使主题包校验失败。

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

宿主会把普通规则递归限定到当前主题。非当前自定义主题的 `<style>` 会被禁用，以隔离不同自定义主题中的
`@keyframes` 等全局命名空间。宿主不会自动重命名动画；公开分发的主题必须为动画名称加入主题前缀，
例如 `twilight-tab-glow`，避免与主应用或其他启用中的样式冲突。

### 硬限制

以下内容会被移除、替换或拒绝：

- `<script>`、`</style>` 等 HTML 注入；
- `@import`；
- 任意直接 `url(...)`、`image-set(...)` 与外部资源协议，包括远程地址、`data:` 和手写 Blob URL；
- `expression()`、`behavior:`、`-moz-binding`；
- `position: fixed`，会降级为 `position: absolute`；降级后遵循普通 CSS 绝对定位规则，使用元素的 CSS 包含块
  （通常是最近的已定位祖先元素，没有相应祖先时通常是初始包含块）。主题作用域选择器本身不是定位容器，
  不得依赖视口固定效果；
- Safe Area 变量重新声明。

主题不能执行 JavaScript、读取 Cookie、调用 API、访问 IndexedDB、改变插件权限或直接修改用户设置。

## 五、稳定 UI 选择器

主题应优先使用语义属性，不要依赖 Tailwind class、React 组件层级或自动生成 class。

| 选择器 | 含义 |
|---|---|
| `[data-ui="main-tab-bar"]` | 主界面底栏容器 |
| `[data-ui="main-tab"]` | 单个底栏入口 |
| `[data-ui="main-tab"][data-tab-id="..."]` | 指定 Tab 入口 |
| `[data-ui="main-tab"][aria-selected="true"]` | 当前选中的底栏入口 |
| `[data-ui="main-tab-content"]` | 主页面内容容器 |
| `[data-ui="main-tab-content"][data-active-tab="..."]` | 指定当前页面状态 |
| `[data-ui="main-tab-visibility-settings"]` | Tab 显隐设置区 |
| `[data-ui="local-resource-manager"]` | 本地界面资源管理区 |
| `[data-ui="theme-media-permission"]` | 主题本地媒体授权设置区 |
| `[data-ui="theme-media-host"]` | 宿主管理的主题媒体背景层 |

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
主题引用当前未注册的 Tab ID 时，对应的 `tab.enter`、`tab.leave` 事件不会出现，`tab.is` 条件也不会成立；
主题不会因此报错。

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

从 CSS 能力上也可以隐藏整条底栏并清除内容预留：

```css
[data-ui="main-tab-bar"] {
  display: none;
}

[data-ui="main-tab-content"] {
  padding-bottom: 0 !important;
}
```

上述整栏隐藏只适合作者本人能够控制恢复路径的本机调试。公开分发的主题不得隐藏 `characters`、`settings`
或整条主导航，也不得通过 `visibility: hidden`、`opacity: 0`、移出可视区域等方式做等价隐藏，除非产品以后提供
明确的用户确认和独立恢复入口。导入器会识别稳定导航选择器上的直接 `display: none`、`visibility: hidden`
和 `opacity: 0` 并要求用户二次确认，但不能模拟任意 CSS 的最终布局与级联，因此主题作者不能依赖导入器代替这项检查。
视觉隐藏不等于禁用页面，已有路由和状态仍然存在。

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
| 音频/音乐 | 100 MiB | 预览、主题 1.1 受限播放、应用服务解析 |
| 视频 | 256 MiB | 预览、主题 1.1 背景 Surface、应用服务解析 |

资源库总上限为 512 MiB。导入器按文件 MIME 类型接受除 SVG 外的 `image/*`，并接受 `audio/*` 与 `video/*`；
文件没有可识别 MIME 类型时，扩展名回退白名单为：图片 `png`、`jpg`、`jpeg`、`webp`、`gif`、`avif`，
音频 `mp3`、`m4a`、`aac`、`wav`、`ogg`、`flac`，视频 `mp4`、`webm`、`mov`、`m4v`。
文件能够导入不代表当前设备一定能够解码，实际播放与显示仍取决于系统 WebView 的格式支持。SVG 不开放；
资源元数据与文件字节位于独立 `MobileTavernResourceDB`，不会塞入 settings 大对象。

所有资源都有稳定引用：

```text
tavern-resource://<resource-id>
```

当前应用生成的 `<resource-id>` 是 `r_` 加 32 位小写十六进制字符，例如
`r_0123456789abcdef0123456789abcdef`。为兼容已有或后续来源，运行时接受总长度不超过 80 个字符的 ID：
必须以 `r_` 开头，其后为 1–78 个小写字母、数字、下划线或连字符。主题作者应始终复制资源库生成的引用，
不要自行构造 ID。

该引用不是网络 URL，也不能直接写进 CSS `url()`。受信运行时代码应通过 `LocalResourceService.resolveResourceReference()` 把它解析为当前会话 Blob URL，禁止持久化 Blob URL。

图片会额外得到宿主管理的 CSS 变量：

```css
.character-stage {
  background-image: var(--tavern-resource-r_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx, none);
  background-size: cover;
  background-position: center;
}
```

音频和视频不能由 CSS 播放。主题 1.1 可通过下一节的声明式动作请求宿主播放；用户必须先打开“允许主题播放本地媒体”。当前第三方 `.mtplugin` 尚未获得主应用资源库 RPC；插件需要把媒体放进自己的 `.mtplugin` 包。未来若开放资源权限，应通过版本化、可撤销的 Plugin Host RPC 解析稳定引用，不能直接开放 IndexedDB。

本地资源 ID 只在当前设备有效，也暂不包含在普通 JSON 备份中。公开分享主题时不要硬编码作者设备的资源 ID；应使用 `none` 等回退值，并在安装说明中让用户替换占位引用。

## 八、主题 1.1 受限交互

### 8.1 能力模型

受限交互不是“放开一部分 JavaScript”，而是由宿主解释的有限状态机。主题只能声明：

```text
白名单事件 → 白名单条件 → 白名单动作 → 宿主管理的媒体、Surface 与主题私有状态
```

主题不能获得函数、DOM 引用、Kernel、网络、文件系统、聊天内容、角色数据、API Key、设置写权限或 IndexedDB。规则只在当前主题激活期间存在；切换主题、停用主题或销毁运行时会取消全部延迟任务并清空状态。

用户侧的媒体权限默认关闭。关闭时样式与普通主题状态仍可工作，但 `media.play` 和 `surface.show` 不产生媒体输出；打开权限会重新激活当前主题。App 进入后台时，正在播放的主题媒体会暂停。

### 8.2 完整最小示例

下面示例假设用户已在本机资源库中导入对应文件，并把占位 ID 替换成资源库复制出的引用：

```json
{
  "schemaVersion": "1.1",
  "name": "雨夜车站",
  "version": "1.0.0",
  "isDark": true,
  "variables": {
    "--background": "222 28% 8%",
    "--foreground": "210 24% 96%",
    "--primary": "196 82% 64%",
    "--primary-foreground": "222 28% 8%"
  },
  "customCss": "[data-theme-state~=\"mood-dream\"] [data-ui=\"main-tab-bar\"] { box-shadow: 0 0 24px hsl(var(--primary) / .28); }",
  "media": {
    "rain": {
      "type": "audio",
      "src": "tavern-resource://r_replace_with_local_audio",
      "loop": true,
      "volume": 0.35,
      "preload": "metadata"
    },
    "station": {
      "type": "video",
      "src": "tavern-resource://r_replace_with_local_video",
      "loop": true,
      "volume": 1,
      "muted": true,
      "fit": "cover",
      "preload": "metadata"
    }
  },
  "state": {
    "mood": { "type": "enum", "values": ["calm", "dream"], "default": "calm" },
    "visited": { "type": "boolean", "default": false },
    "pulses": { "type": "counter", "default": 0, "min": 0, "max": 4 }
  },
  "interactions": [
    {
      "id": "start-ambience",
      "when": { "event": "theme.activate" },
      "do": [
        { "action": "media.play", "target": "rain" },
        { "action": "media.play", "target": "station" },
        { "action": "surface.show", "target": "main.background", "mediaId": "station" },
        { "action": "state.set", "key": "mood", "value": "dream" },
        { "action": "state.set", "key": "visited", "value": true }
      ]
    },
    {
      "id": "tab-pulse",
      "when": { "event": "ui.tap", "target": "main-tab" },
      "if": [
        { "condition": "orientation.is", "value": "portrait" },
        { "condition": "media.enabled", "value": true }
      ],
      "do": [
        { "action": "state.increment", "key": "pulses", "amount": 1 },
        { "action": "theme.state.add", "value": "tab-tapped", "delayMs": 120 }
      ],
      "cooldownMs": 300,
      "once": false
    }
  ]
}
```

### 8.3 `media` 与 Surface

媒体只能引用 `tavern-resource://r_...`，不接受 HTTP、`data:`、`file:` 或 Blob URL。宿主还会核对资源库中的真实类型；把图片或音频伪装成视频不会播放。

| 媒体类型 | 字段 | 默认与范围 |
|---|---|---|
| `audio` | `src`、`loop`、`volume`、`preload` | `loop=false`；`volume=0.5`，范围 0–1；`preload` 为 `none`、`metadata` 或 `auto`，默认 `metadata` |
| `video` | 以上字段及 `muted`、`fit` | `volume=1`；`muted=true`；`fit` 为 `cover`、`contain` 或 `fill` |

`auto` 可能让移动端预先加载更多数据；没有明确需要时使用 `metadata` 或 `none`。视频可在媒体定义中设置初始
`muted`，也可通过 `media.setMuted` 在用户交互后修改；`media.setVolume` 不会自动解除静音。

可显示视频的宿主 Surface 只有：

| Surface | 可见范围 |
|---|---|
| `main.background` | 主应用容器背景，所有 Tab |
| `characters.background` | 仅角色页 |
| `chat.background` | 仅聊天页 |

`surface.show` 只负责把视频放入槽位；需要运动和声音时仍应对同一媒体执行 `media.play`。Surface 位于内容下方、不可点击，不会覆盖导航或获得交互焦点。音频没有 Surface。

### 8.4 状态与 CSS 联动

`state` 支持三种非持久化类型：

- `boolean`：声明 `default`；
- `enum`：声明 1–16 个 `values` 和其中一个 `default`；每个值最长 48 个字符，必须以小写字母开头，
  后续只允许小写字母、数字和连字符，即满足 `^[a-z][a-z0-9-]*$`；
- `counter`：声明整数 `default`、`min`、`max`，增减会自动钳制在边界内。

每个状态自动生成 `<key>-<value>` token，宿主把全部 token 写入根节点的 `data-theme-state`。`counter` 也遵循
同一规则并使用当前整数值，例如 `pulses` 为 0 和 3 时分别生成 `pulses-0` 和 `pulses-3`。CSS 应使用 token 匹配：

```css
[data-theme-state~="visited-true"] [data-ui="main-tab-bar"] {
  border-color: hsl(var(--primary) / .65);
}
```

`theme.state.add/remove/replace` 可额外维护纯样式 token。token 最长 48 个字符，必须以小写字母开头，后续只允许
小写字母、数字和连字符，不得当作任意属性或选择器注入。

### 8.5 事件

| 事件 | 可用限定字段 | 说明 |
|---|---|---|
| `theme.activate`、`theme.deactivate` | 无 | 主题生命周期 |
| `tab.enter`、`tab.leave` | `tabId` | 主 Tab 切入与离开 |
| `app.pause`、`app.resume` | 无 | 前后台可见性 |
| `orientation.change` | `orientation` | `portrait` 或 `landscape` |
| `ui.tap` | 必填 `target` | 只响应宿主公开的 `data-ui` 语义目标，例如 `main-tab` |
| `media.ended` | `mediaId` | 非循环媒体自然播放结束 |

`ui.tap` 不接受 CSS 选择器，也不能监听任意 DOM。当前稳定交互 target 以“稳定 UI 选择器”一节的 `data-ui` 值为准；若元素没有 `data-ui`，主题看不到该点击。

### 8.6 条件与动作

条件全部为 AND：

| 条件 | 参数 |
|---|---|
| `state.equals` | `key`、`value` |
| `tab.is` | `value` 为 Tab ID |
| `orientation.is` | `portrait` 或 `landscape` |
| `media.enabled` | 布尔值；表示用户是否打开“允许主题播放本地媒体”，不表示资源存在或正在播放 |
| `accessibility.reducedMotion` | 布尔值 |

白名单动作：

| 动作 | 参数与效果 |
|---|---|
| `media.play/pause/stop` | `target` 为媒体 ID；`stop` 同时回到起点 |
| `media.setVolume` | `target`、0–1 的 `volume` |
| `media.setMuted` | `target` 为视频媒体 ID；`muted` 为布尔值 |
| `surface.show` | `target` 为 Surface、`mediaId` 为视频 ID |
| `surface.hide` | `target` 为 Surface |
| `state.set` | `key`、类型匹配的 `value` |
| `state.toggle` | `key` 必须是 boolean |
| `state.increment` | `key` 必须是 counter；`amount` 为 -100 至 100 的整数 |
| `theme.state.add/remove` | 必填 `value`；添加或移除一个显式样式 token。重复添加或移除不存在的显式 token 均为幂等操作 |
| `theme.state.replace` | 必填 `group`、`value`；移除显式集合中的 `group` 及 `group-*` token，再添加 `value`。`value` 必须以 `group-` 开头，否则导入/保存失败 |

所有动作可选 `delayMs`。规则可选 `cooldownMs` 和 `once`；默认冷却 100ms，`once` 默认为 false。
`once=true` 只在当前主题激活期间生效；主题停用、切换、重新激活或运行时销毁后会清空记录，规则下次激活时可再次触发一次。

### 8.7 硬上限与失败方式

| 项目 | 上限 |
|---|---:|
| 媒体定义 | 16 |
| 状态字段 | 32 |
| 规则 | 100 |
| 每条规则条件 / 动作 | 各 8 |
| 同时等待的延迟任务 | 10 |
| 单动作延迟 | 60,000ms |

规则 ID、引用、状态类型、资源协议或数量不合法时，整个主题包导入/保存失败，不会只跳过危险片段。
同时等待的延迟任务已达到 10 个时，新产生的延迟动作会被丢弃；同一规则中的即时动作和其他规则仍继续工作，
不会导致运行时崩溃。

运行时资源已被删除、不可读或类型不符时，该媒体不播放也不渲染，引用它的 Surface 不显示；对应图片 CSS 变量不存在时
使用作者提供的 fallback（例如 `none`）。主题的其他样式、状态和规则继续降级工作，不因单个资源缺失导致整个运行时失败。

## 九、完整主题示例

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

## 十、给生成主题的 AI 的强制检查表

AI 输出前必须逐项确认：

1. 先判断需求是主题、`.mtplugin` 还是仓库内受信扩展。
2. 主题只输出合法 JSON，不附 Markdown 代码围栏，除非用户明确要求解释。
3. JSON 字符串不能包含未转义的实际换行；多行 `customCss` 必须在 JSON 中使用 `\n`。
4. 纯样式使用 `schemaVersion: "1.0"`；需要声明式状态或音视频才使用 `"1.1"`；不输出 `id` 和 `importedAt`。
5. `variables` 只使用本文白名单；颜色值优先使用 HSL 通道。
6. 不生成外部 URL、`@import`、`data:` URL、手写 Blob URL、JavaScript 或 HTML。
7. `customCss` 优先使用本文列出的稳定选择器，包括选中态的 `[aria-selected="true"]`；不要依赖内部 class 名。
8. 不隐藏 `characters`、`settings` 或全部导航，也不生成视觉等价的隐藏方式。
9. 本地图片在 CSS 中使用用户提供的 `var(--tavern-resource-..., none)`；音视频只放入 1.1 的 `media`，并假设用户会替换本机资源 ID。
10. 1.1 的枚举值必须满足 `^[a-z][a-z0-9-]*$`；`counter` 状态按 `<key>-<整数>` 生成 CSS token。
11. `theme.state.replace` 的 `value` 必须以 `group-` 开头；`media.preload` 只使用 `none`、`metadata` 或 `auto`。
12. 视频运行时静音只使用 `media.setMuted`；不要生成 `media.toggleMuted` 或借 `media.setVolume` 解除静音。
13. 为窄屏、横屏、Safe Area 和 `prefers-reduced-motion` 保留可用降级。
14. 1.1 只使用本文事件、条件、动作和 Surface；不要生成 JavaScript、CSS 选择器点击监听或未公开的宿主能力。
15. 共享主题不得硬编码仅作者设备存在的资源 ID，必须提供回退值或安装替换说明。

## 十一、验证与排错

- 最稳妥的开发方式是使用应用内主题编辑器实时预览，再导出 `.tavern-theme.json`。
- 导入失败时先检查字段类型、变量白名单、名称长度和变量值中的禁止内容。
- 样式未生效时确认选择器使用稳定属性、目标元素确实存在，并检查规则是否被内联 style 覆盖；必要时对纯视觉覆盖使用有限的 `!important`。
- 图片不显示时确认使用的是资源库复制的 CSS 变量，而不是 `tavern-resource://` 或 `url(...)`。
- 音视频不播放时确认主题为 1.1、引用类型正确，并让用户打开“允许主题播放本地媒体”；移动端自动播放被拦截时，宿主会在下一次用户触摸后重试。
- 第三方全屏插件的包结构、CSP、权限与媒体打包规则见 [第三方全屏插件规范](Plugin_System.md)。
