# Android 原生桥接设计与 API 契约文档 (AndroidThemeBridge)

> **本文件详细记录了 Mobile Tavern 混合客户端（Android APK）中 Android 原生桥接层与前端 WebView 的双向通信协议、核心 API 契约、Scoped Storage（分区存储）文件持久化设计以及 TTS 生命周期管理。**
>
> 遵循 `AGENTS.md` 准则五：全中文表述，技术名词保留英文。

---

## 一、架构定位与注入机制

在 Android 客户端中，原生层与前端 WebView 通过 `JavascriptInterface` 建立单向同步通道。
* **注入入口**：Android 原生层将 `AndroidThemeBridge` 的实例注入到 WebView 的 JavaScript 上下文中，暴露为全局对象 `window.AndroidThemeBridge`。
* **调用方式**：前端通过同步检测 `(window as any).AndroidThemeBridge` 来按需调用原生能力；如果运行在普通 Web 浏览器中，则平滑降级为标准的 Web API（例如使用 `<a>` Blob 下载、Web Speech API 或在线 TTS 等）。

---

## 二、核心 API 契约

`AndroidThemeBridge` 暴露了以下 `@JavascriptInterface` 方法，前端必须保证参数顺序、类型与返回值与此一致：

### 1. TTS 语音朗读控制

#### `speakNative(text: String, rate: Float, pitch: Float): Boolean`
* **职责**：调用 Android 系统内置的 `TextToSpeech` 引擎进行中文/默认语言朗读。
* **参数**：
  - `text`：要朗读的文本内容。
  - `rate`：语速（例如 `1.0` 为正常速度）。
  - `pitch`：音调（例如 `1.0` 为正常音调）。
* **返回值**：`Boolean`，表示朗读任务是否成功提交到队列。
* **实现细节**：
  - 内部运行在 UI 线程上，调用时会首先中断（`stop()`）当前正在进行的朗读，并使用 `QUEUE_FLUSH` 立即排队播放。
  - 自动绑定 Utterance ID `"tavern_tts_utterance"`，用于状态跟踪。

#### `stopNative()`
* **职责**：立即停止当前正在进行的朗读任务，清空 TTS 队列。
* **返回值**：`void`

#### `isSpeakingNative(): Boolean`
* **职责**：查询 TTS 引擎当前是否正在发声。
* **返回值**：`Boolean`

---

### 2. 安全区域（Safe Area）适配

#### `getSafeAreas(): String`
* **职责**：获取设备当前屏幕的安全区域（状态栏、导航栏、异形刘海屏、折叠缝等），以便前端动态计算 UI 遮挡。
* **返回值**：`String`，格式为 JSON 字符串，例如：
  ```json
  { "top": 24, "bottom": 48, "left": 0, "right": 0 }
  ```
  数值的单位均为 **DP**（设备独立像素），前端可直接用于 CSS 计算。
* **实现细节**：
  - 优先通过 `WindowInsetsCompat` 获取真实的 System Bars 和 Display Cutout 像素高度，并除以屏幕 `density` 转换为 DP。
  - 在布局初始化极早期（WindowInsets 尚未就绪时），通过显示器绝对像素与可用像素差值进行 Bottom 值的兜底计算。

---

### 3. 系统状态栏与导航栏变色

#### `setStatusBarStyle(isDark: Boolean, colorHex: String)`
* **职责**：根据前端切换的主题，实时改变手机系统状态栏和底部导航栏的背景颜色与图标颜色（亮/暗对齐）。
* **参数**：
  - `isDark`：当前前端主题是否为暗色系（如 `ocean` / `obsidian`）。当为 `true` 时，原生系统状态栏的图标将调整为白色；当为 `false` 时，状态栏图标调整为黑色，以确保图标在彩色或亮色背景下清晰可见。
  - `colorHex`：颜色的十六进制字符串，如 `"#1a2040"`。
* **实现细节**：
  - 使用 `WindowInsetsControllerCompat` 动态更新 `isAppearanceLightStatusBars` 与 `isAppearanceLightNavigationBars` 标志。

---

### 4. 外部浏览器导航

#### `openUrl(url: String)`
* **职责**：通过发送 `ACTION_VIEW` 隐式 Intent，调用手机系统默认浏览器打开指定的外部链接。
* **参数**：
  - `url`：完整的 http/https 链接地址。
* **返回值**：`void`

---

### 5. 安全文件持久化（下载保存）

由于 WebView 容器的安全沙盒限制，前端无法直接触发 Blob 对象的本地下载保存。本桥接实现了安全的文件写入。

#### `saveFile(fileName: String, content: String): String`
* **职责**：保存 UTF-8 编码的文本文件（如备份 JSON、聊天记录、世界书预设等）到外部公共 Download 目录。
* **参数**：
  - `fileName`：建议的文件名，如 `"Tavern_Backup.json"`。
  - `content`：文本文件内容。
* **返回值**：`String`，保存成功时返回相对于公共 Download 目录的展示路径（如 `"Download/Mobile Tavern/Tavern_Backup.json"`）；失败时返回带 `"error:"` 前缀的错误信息。

#### `saveFileBase64(fileName: String, base64Data: String, mimeType: String): String`
* **职责**：保存二进制文件（如导出的 PNG 格式角色卡、图片消息等）到外部公共 Download 目录。
* **参数**：
  - `fileName`：建议的文件名，如 `"Character_ST_Card.png"`。
  - `base64Data`：二进制数据的 Base64 编码字符串（支持携带并自动剥离 `data:image/png;base64,` 头部）。
  - `mimeType`：媒体类型，如 `"image/png"`，用于 MediaStore 注册。
* **返回值**：`String`，保存成功时返回展示路径；失败时返回带 `"error:"` 前缀的错误信息。

---

## 三、底层实现原理与优化设计

### 1. Scoped Storage (分区存储) 与 MediaStore.Downloads API (CR-01)
* **Android 10+ (API 29+)**：采用最新的 `MediaStore.Downloads` 写入 `/Download/Mobile Tavern/` 目录。
  - **核心优势**：不需要申请任何外部读写存储权限（如 `WRITE_EXTERNAL_STORAGE`），完全符合 Android 现代安全沙盒规范，避免因为运行时权限缺失而导致崩溃。
  - **安全性**：在写入字节流期间，将 `IS_PENDING` 设为 `1`，确保在文件未完全写入前，其他应用或系统相册无法读取该残缺文件；写入完毕后再将 `IS_PENDING` 恢复为 `0` 并释放。
* **Android 9 及以下**：提供 Legacy Fallback。直接将文件写入 `Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)` 下的子目录。

### 2. 异形屏安全区域实时推送机制
* 原生层在 `WebView` 上注册了 `OnApplyWindowInsetsListener`。
* 当系统导航栏弹出、转屏、刘海遮挡区域发生变化时，会触发原生方法 `dispatchSafeAreasChanged`。
* 原生方法利用 `evaluateJavascript` 异步在前端 `window` 上抛出一个自定义事件：
  ```javascript
  window.dispatchEvent(new CustomEvent('androidSafeAreasChanged', { detail: { top, bottom, left, right } }));
  ```
* 前端 `AppContext.tsx` 会订阅该事件，接收 DP 参数并映射到 CSS 变量中，极大地保证了响应式体验。

### 3. 原生 TTS 自动资源回收
* 原生 TTS 引擎持有了 `Context` 句柄，如果不及时销毁，在 App 强杀或 Activity 重建时会引发严重的内存泄漏。
* 桥接类内部注册了 Application 的 `ActivityLifecycleCallbacks` 监听器，并在其 `onActivityDestroyed` 触发时，自动关闭并销毁 `TextToSpeech` 实例，释放所有的底层语音合成引擎资源。

---

## 四、前端降级与整合方案

前端通过判断 `(window as any).AndroidThemeBridge` 的可用性，在原生环境与 Web 浏览器环境间实现无缝的“渐进式增强”体验。例如在 `characterPngExporter.ts` 中：

```typescript
export function saveBlobViaBridgeOrDownload(
  blob: Blob,
  fileName: string,
  mimeType: string,
  onSuccess: (path: string) => void,
  onError: (msg: string) => void
): void {
  // 原生安卓环境
  if ((window as any).AndroidThemeBridge && typeof (window as any).AndroidThemeBridge.saveFileBase64 === "function") {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = (reader.result as string).split(",")[1];
      const path = (window as any).AndroidThemeBridge.saveFileBase64(fileName, base64data, mimeType);
      if (path && !path.startsWith("error:")) {
        onSuccess(path);
      } else {
        onError(path || "未知错误");
      }
    };
    return;
  }

  // 普通浏览器环境降级
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
  onSuccess("");
}
```
