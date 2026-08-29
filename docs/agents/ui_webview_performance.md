# WebView 界面与性能验收规范

> 本文是 Mobile Tavern 的移动界面权威规范。适用于桌面 Web 回归和 Android/iOS WebView，
> 但不改变 `PLATFORM-MOBILE`：生产目标仍是原生混合 App，浏览器结果不能替代真机结果。

## 一、分阶段目标

### P0：可访问与无明显闪烁

- Android 系统 Splash、WebView 空白首帧与 Web Splash 使用固定品牌底色和同一透明前景；Web Splash 只能有一个挂载来源，不得在 Provider 就绪后重新播放入场动画。用户主题只在进入主界面后接管。
- 品牌源图更新后通过 `scripts/process_icon.py 2` 重新生成 `public/splash-logo.png` 与 Android adaptive foreground；生成物不得手工涂底色。
- 历史会话首批加载不得成为数据可见上限；分页入口必须可键盘操作，并明确显示已加载数量、总数和加载状态。
- 进入聊天前并行准备角色、会话和最近消息；页面只在首屏数据可用后切换，加载失败必须可重试。
- 长消息使用虚拟列表并保持底部锚定，不得依赖多轮定时器、强制布局或全局 DOM 观察器纠正滚动。
- 键盘导致的 `window.resize` / `visualViewport.resize` 必须合并到一帧内处理，不得通过 React 顶层状态让整棵主布局连续重渲染；聊天页键盘状态与诊断只在开合状态真正变化时更新，旋转后必须重建高度基准。

### P1：移动交互与渲染成本

- 交互触控与视觉尺寸解耦：主要操作建议触控热区为 44 CSS px（可通过外层内边距、间距或外围容器提供命中支持）；控件视觉尺寸采用精致紧凑规范（24～36 CSS px），且相邻目标留有合理间距。
- 默认使用紧凑高密度：正文和主要状态信息使用标准 `text-xs`，互动控件文字不得低于 10 CSS px；`text-[8px]`～`text-[9px]` 只允许装饰性角标或低优先级元数据。易读密度为用户可选偏好，开启时将辅助微小文字提升至 12 CSS px；触控、焦点与读屏语义在两种密度下均保持完整。
- 控件与表单统一遵循精致紧凑规范：文本输入框、选择器和文本域默认高度为 32 CSS px（`h-8`，字号 `text-xs`），彻底移除强制 44px 视觉膨胀和 16px 字号硬性限制。
- Button 统一使用 `components/ui/button.tsx`，默认紧凑高度为 32 CSS px（`h-8`），次级紧凑尺寸为 24 CSS px（`xs`）/ 28 CSS px（`sm`），图标按钮为 `size-6` / `size-7` / `size-8`。需要阻塞背景的弹窗或 BottomSheet 使用 Base UI Dialog 基元，必须具备标题、焦点圈定、焦点恢复、Escape 和 TalkBack 语义，禁止用可点击的空白 `div` 充当遮罩关闭入口。
- Android 返回键按优先级关闭最上层 Dialog/BottomSheet，再返回上级 Tab；只在角色主页保留“双击退出”。
- 触屏设备默认禁用大面积 `backdrop-filter` 和聊天背景循环平移动画；系统启用“减少动态效果”时，停止循环动画并缩短过渡。
- 长列表使用离屏渲染跳过或虚拟化。首屏头像可提前请求，其余图片必须 `loading="lazy"` 与 `decoding="async"`，避免集中解码。

### P2：平台一致性与持续治理

- Safe Area 必须来自 CSS `env()` 与 Native Adapter 的组合；旋转、系统栏变化和 App 恢复前台时重新同步。
- 横竖屏切换不得丢失当前 Tab、会话、输入草稿或滚动锚点；键盘开合不得产生可见的全页跳动。
- 低频复杂页面继续按 Tab 分包；不得为消除加载态把全部页面重新并入首屏包。
- 新增全屏遮罩、无限动画、毛玻璃或低于最小触控目标的控件时，代码审查必须说明必要性和降级路径。

## 二、自动化验收

### Web / 移动尺寸基线

运行：

```powershell
npm run test:e2e -- tests/e2e/ui-performance.spec.ts
```

测试同时覆盖桌面 Chromium 与 Pixel 5 尺寸，采集应用冷启动、首次懒加载 Tab、缓存后 Tab、
键盘式 viewport resize、CLS 与 Long Animation Frame，并验证底栏触控目标/字号/方向键、横竖屏草稿、
焦点、Safe Area 和前后台恢复。测试会先预热 Vite 转译缓存，正式指标仍来自全新浏览器上下文，避免把开发服务器编译时间误算为 APK 启动。阈值以该测试文件中的常量和断言为单一来源；
阈值调整必须附带同环境前后数据，禁止用放宽阈值掩盖回归。

移动尺寸项目还会逐页检查角色、历史、世界书和设置页的所有可见互动控件及表单尺寸；
紧凑密度互动文字下限为 10 CSS px，易读密度为 12 CSS px，任一控件低于当前密度下限都会直接使 E2E 失败。互动 Dialog 源文件另由 `tests/vitest/uiOverlayStandards.test.ts`
守卫统一 Dialog 标题、Android 返回键栈及禁止手工全屏遮罩。

Base UI Dialog 的真实键盘行为由 `tests/vitest/DialogAccessibility.test.tsx` 验证：打开后焦点必须进入
弹窗，Tab 不得越出焦点圈，Escape 必须关闭弹窗并把焦点恢复到触发器。触屏去模糊、减少动态效果、
图片显式解码/非首屏懒加载和主 Tab 动态分包由 `tests/vitest/uiRenderingStandards.test.ts` 作为静态回归守卫。

长会话的 heap、DOM 节点、响应延迟和虚拟列表往返滚动帧间隔由以下测试负责：

```powershell
npm run test:e2e -- tests/e2e/stress-long-session.spec.ts
```

### Android WebView 基线

连接并授权一台设备后运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/measure-android-webview-ui.ps1
```

若 Android SDK 位于自定义目录，可显式传入：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/measure-android-webview-ui.ps1 `
  -AdbPath "D:\Android\Sdk\platform-tools\adb.exe"
```

脚本执行三次冷启动，逐次记录 Android/WebView 版本、`am start -W`、进程存活、结构化 `gfxinfo`
慢帧指标与 PSS，并执行一次 Home → 前台恢复检查；完整原始 `gfxinfo`、`meminfo` 和 Activity 状态仍保留在
报告中。报告写入被 Git 忽略的 `tmp/android-ui-performance/`。最低验收条件：三次冷启动均成功、
进程无崩溃，慢帧与 PSS 不出现持续恶化，前后台恢复后主 Activity 和 WebView 所在进程仍存活。

真机测试应至少覆盖一台中低端 Android 设备；Pixel 5 浏览器项目只负责布局与 Chromium 回归，不能作为真机通过证据。

## 三、变更验证矩阵

| 改动 | 最低验证 |
|---|---|
| 列表、分页、图片加载 | 命中 Vitest + UI 性能 E2E |
| Dialog、BottomSheet、焦点或返回键 | 组件测试 + 返回栈测试 + Android Kotlin 编译 |
| 模糊、动画、图片解码或 Tab 分包 | 渲染规范守卫 + UI 性能 E2E |
| 键盘、Safe Area、横竖屏或生命周期 | 视口纯函数测试 + UI 性能 E2E + Android 编译；有设备时补真机报告 |
| 聊天虚拟列表或长会话 | 命中 Vitest + `stress-long-session.spec.ts` |
| 发布安装包 | `npm run lint` + `npm test` + `npm run build:mobile` + Android 构建 |

## 四、边界

- UI 不得直接访问 IndexedDB 或 Repository；分页仍通过 Chat 应用用例和 Context 暴露的能力完成。
- WebView 返回键、Safe Area 和生命周期事件属于 Native Adapter 边界，不得进入 Kernel。
- 性能降级不得静默丢失动画以外的用户数据、角色卡兼容行为、MVU/Regex/iframe 能力或会话状态。
