# Android 原生桥接设计与 API 契约文档 (AndroidThemeBridge)

> **本文档详细记录了 Mobile Tavern 混合客户端（Tauri 2 Android APK）中 Android 原生桥接层与前端 WebView 的双向通信协议、核心 API 契约、Scoped Storage（分区存储）文件持久化设计、AudioRecord 原生录音链路、TTS 生命周期管理以及全盘角色卡安全扫描机制。**
>
> 遵循 `AGENTS.md` 的 `DOC-CHINESE`：全中文表述，技术名词保留英文。

---

## 一、架构定位与注入机制

在 Mobile Tavern Android 客户端中，原生层基于 Tauri 2 插件体系（`src-tauri/plugins/android-bridge`）与前端 WebView 通过 `@JavascriptInterface` 建立高效、低延迟的单向同步与事件双向通信通道。

* **注入入口**：Android 原生层将 Kotlin 实现的 `AndroidThemeBridge` 实例注入到 WebView 的 JavaScript 上下文中，暴露为全局对象 `window.AndroidThemeBridge`。
* **调用方式**：前端推荐使用 `@aitavern/plugin-android-bridge` 提供的类型定义与辅助函数 `getAndroidThemeBridge()`，或防御性同步检测 `(window as any).AndroidThemeBridge`。
* **平滑降级**：当运行在普通桌面浏览器或非 Android 原生环境时，前端所有调用均平滑降级为 Web 标准能力（如基于 `<a>` 标签与 Blob 的文件下载、Web Audio 录音合成、Web Speech TTS 等），确保无原生依赖时核心功能依然可用。

---

## 二、核心 API 契约

`AndroidThemeBridge` 通过 `@JavascriptInterface` 暴露了以下原生方法。前端调用必须保证参数顺序、类型与返回值与此一致：

### 1. 屏幕适配与显示控制

#### `getSafeAreas(): String`
* **职责**：获取设备当前屏幕的安全区域内边距（状态栏、导航栏、异形刘海屏、挖孔等），供前端动态适配界面避免遮挡。
* **返回值**：`String`，格式为 JSON 字符串，例如：
  ```json
  { "top": 24, "bottom": 48, "left": 0, "right": 0 }
  ```
  数值的单位均为 **DP**（设备独立像素），前端可直接注入 CSS 变量（`--safe-area-inset-*`）。
* **实现细节**：
  - 优先通过 `WindowInsetsCompat` 获取真实的 System Bars 和 Display Cutout 像素高度，并除以屏幕 `density` 转换为 DP。
  - **键盘防顶优化**：底部只采集真实导航栏高度；当软键盘弹出（IME 可见）时，底部安全边距强制设为 0，防止输入法将底部工具栏二次顶高。
  - 布局早期阶段（WindowInsets 尚未就绪时），通过显示器绝对像素与可用像素差值进行 Bottom 值的兜底计算。

#### 原生主动推送：`androidSafeAreasChanged` 事件
* **机制**：WebView 的 `OnApplyWindowInsetsListener` 在旋转屏幕、导航栏切出或异形屏区域变化时，原生层会通过 `evaluateJavascript` 异步派发事件：
  ```javascript
  window.dispatchEvent(new CustomEvent('androidSafeAreasChanged', {
    detail: { top, bottom, left, right }
  }));
  ```

#### `setStatusBarStyle(isDark: Boolean, colorHex: String): void`
* **职责**：根据前端切换的主题，实时改变系统状态栏与底部导航栏的背景颜色和图标明暗（亮/暗对齐）。
* **参数**：
  - `isDark`：当前前端主题是否为深色系。为 `true` 时，原生系统状态栏与导航栏图标调整为浅色（白色）；为 `false` 时调整为深色（黑色）。
  - `colorHex`：背景颜色的十六进制字符串，如 `"#1a2040"`。
* **实现细节**：使用 `WindowInsetsControllerCompat` 动态更新 `isAppearanceLightStatusBars` 与 `isAppearanceLightNavigationBars` 标志。

#### `setScreenOrientation(mode: String): Boolean`
* **职责**：控制屏幕方向，锁定为横屏或恢复自动旋转。
* **参数**：`mode` 仅支持 `"landscape"`（锁定为传感器横屏，`SCREEN_ORIENTATION_SENSOR_LANDSCAPE`）或 `"auto"`（恢复系统自动旋转，`SCREEN_ORIENTATION_UNSPECIFIED`）。
* **返回值**：`Boolean`，表示请求是否成功投递到 Android UI 线程。

#### `setImmersiveMode(enabled: Boolean): Boolean`
* **职责**：进入或退出全屏沉浸模式（隐藏系统状态栏与导航栏）。主要用于第三方全屏插件（Gal 游戏等）。
* **参数**：`enabled` 为 `true` 进入沉浸模式，`false` 恢复系统栏。
* **实现细节**：配置 `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`，支持用户从屏幕边缘内滑短暂唤出系统控制栏。

---

### 2. 原生语音录制链路（AudioRecord WAV）

> **设计决策**：实时听写（Web Speech API）由于各厂商 WebView 支持极不稳定且容易断流，已彻底下线。聊天输入统一采用「按住 说话」原生直录机制。

#### `hasRecordAudioPermission(): Boolean`
* **职责**：检查应用是否已获得麦克风录音权限（`android.permission.RECORD_AUDIO`）。
* **返回值**：`Boolean`。

#### `requestRecordAudioPermission(): void`
* **职责**：动态申请麦克风录音权限。

#### `startRecordNative(maxDurationMs: Long): String`
* **职责**：启动原生麦克风录音，采集 16 kHz 16-bit 单声道 PCM 数据并边录边写为标准 WAV 格式文件。
* **参数**：`maxDurationMs` 最长录音毫秒数（范围 1,000 ~ 600,000 ms，默认 180,000 ms 即 3 分钟）。
* **返回值**：`String`，成功返回 `"OK"`，权限不足返回 `"error:PERMISSION_DENIED"`，其他错误返回 `"error:..."`。
* **实现细节**：
  - 启动独立的录音工作线程 `TavernVoiceRecord`，设置音频级线程优先级。
  - 启动时自动触发一次 35ms 的短促触觉微振动（`triggerHapticFeedback`），给用户带来物理确认感。
  - 直接写入 App 内部缓存目录 `tavern_voice_*.wav`。输出 `audio/wav` 既能通过前端附件签名检测，又落在主流大模型厂商（如 OpenAI、GLM、DeepSeek 等）的 `input_audio.format` 枚举内。

#### `stopRecordNative(): String`
* **职责**：停止当前录音，回填 WAV 文件头，将录音结果编码为 JSON 返回。
* **返回值**：`String`，成功返回如下结构的 JSON 字符串：
  ```json
  {
    "base64": "UklGR...",
    "mimeType": "audio/wav",
    "format": "wav",
    "durationMs": 5230,
    "sizeBytes": 167404
  }
  ```
  失败或未在录音状态返回以 `"error:"` 开头的字符串。
* **关键特性**：
  - **幂等设计**：结果生成后会在原生层保留缓存，重复调用 `stopRecordNative()` 会安全返回同一份录音结果，直到下一次 `startRecordNative` 或 `cancelRecordNative`。
  - **防死锁三段式退出**：锁内置位停止标志 → 解锁等待录音线程退出 → 锁内读取打包结果。
  - 完成时同样触发触觉微振动。

#### `cancelRecordNative(): Boolean`
* **职责**：作废本次录音采集，安全中断后台线程，并即时删除临时缓存文件，不产生任何副作用。
* **返回值**：`Boolean`，固定返回 `true`。

#### `getRecordAmplitudeNative(): Int`
* **职责**：获取当前 PCM 采集帧的最大绝对振幅（数值范围 `0` ~ `32767`）。
* **返回值**：`Int`，前端定时轮询（每 80~100ms）该数值驱动录音浮层的波形跳动动效。

---

### 3. TTS 语音朗读控制

#### `speakNative(text: String, rate: Float, pitch: Float): Boolean`
* **职责**：调用 Android 系统内置的 `TextToSpeech` 引擎进行中文/默认语言朗诵。
* **参数**：
  - `text`：要朗读的文本。
  - `rate`：语速（`1.0` 为基准速度）。
  - `pitch`：音调（`1.0` 为标准音调）。
* **返回值**：`Boolean`，表示朗读任务是否成功提交到队列。
* **实现细节**：运行在主线程，调用时先中断正在播放的内容，使用 `QUEUE_FLUSH` 立即排队播放，绑定 Utterance ID `"tavern_tts_utterance"`。

#### `stopNative(): void`
* **职责**：立即停止当前朗读任务，清空 TTS 队列。

#### `isSpeakingNative(): Boolean`
* **职责**：查询 TTS 引擎当前是否正在发声。未初始化完成时安全返回 `false`，杜绝系统未绑定日志刷屏。

---

### 4. 安全文件持久化（下载保存与 IO 诊断）

由于 WebView 安全沙盒限制，前端无法直接触发 Blob 对象的本地下载保存。本桥接实现了符合现代 Android 规范的安全写入。

#### `saveFile(fileName: String, content: String): String`
* **职责**：保存 UTF-8 编码文本（JSON 角色卡、Prompt 预设包、备份文件、聊天记录等）到外部公共 Download 目录。
* **参数**：
  - `fileName`：建议的文件名，如 `"Tavern_Backup.json"`。
  - `content`：文本文件内容。
* **返回值**：`String`，成功返回相对于 Download 的相对展示路径（如 `"Download/Mobile Tavern/Tavern_Backup.json"`）；失败返回以 `"error:"` 开头的错误信息。

#### `saveFileBase64(fileName: String, base64Data: String, mimeType: String): String`
* **职责**：保存二进制文件（导出的 PNG 格式角色卡、媒体附件等）到外部公共 Download 目录。
* **参数**：
  - `fileName`：文件名，如 `"Character_Card.png"`。
  - `base64Data`：二进制数据的 Base64 编码（自动支持并剥离 `data:image/png;base64,` 前缀）。
  - `mimeType`：MIME 类型，如 `"image/png"`。
* **返回值**：`String`，成功返回展示路径，失败返回错误信息。

#### `verifyFileIo(): String`
* **职责**：诊断测试导出 IO 链路的读写与校验能力。写入探针临时文件后读取比对校验并自动清理删除。
* **返回值**：`String`，成功返回 `"OK"`，失败返回以 `"error:"` 开头的错误详情。

---

### 5. 全盘角色卡扫描与安全读取

#### `hasStoragePermission(): Boolean`
* **职责**：检查应用是否已获得 Android 11+ 全盘外部存储访问权限（`MANAGE_EXTERNAL_STORAGE`）。
* **返回值**：`Boolean`（Android 11+ 检查 `Environment.isExternalStorageManager()`）。

#### `requestStoragePermission(): void`
* **职责**：调起系统专属设置页申请全盘文件管理权限（`Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`）。
* **回调机制**：原生层在 `MainActivity.onResume` 捕获用户返回，通过 `CustomEvent('androidStoragePermissionResult', { detail: { granted } })` 将最终授权状态回传给前端。

#### `scanGlobalCards(): String`
* **职责**：全盘扫描设备所有存储卷（内置存储与 SD 卡）中可导入的角色卡（`.json` 与 `.png`）。
* **返回值**：`String`，格式为 JSON 数组，每项包含：
  ```json
  [
    {
      "name": "character.png",
      "path": "/storage/emulated/0/Download/character.png",
      "size": 1048576,
      "lastModified": 1712345678000
    }
  ]
  ```
* **安全沙盒与预算保护**：
  - 递归深度上限 `MAX_SCAN_DEPTH = 12`；
  - 扫描文件上限 `MAX_SCANNED_FILES = 5000`；
  - 目录预算上限 `MAX_SCANNED_DIRECTORIES = 20000`；
  - 严格跳过 `.` 隐藏目录、`LOST.DIR` 以及系统隐私敏感目录 `Android/data` 和 `Android/obb`。

#### `readLocalFile(path: String): String`
* **职责**：安全读取指定路径的卡片文件。
* **安全限制**：
  - 必须处于已授权存储卷范围内；
  - 路径不能命中被阻止的 `Android/data` / `Android/obb` 私有目录；
  - 扩展名仅限 `.json` 与 `.png`；
  - 单文件体积不得超过 64MB（`MAX_IMPORT_BYTES`）。
* **返回值**：`String`，`.json` 文件返回 UTF-8 文本；`.png` 文件返回 `data:image/png;base64,...` 格式的 Data URL。

---

### 6. 系统交互与诊断能力

#### `openUrl(url: String): void`
* **职责**：通过发送 `ACTION_VIEW` 隐式 Intent，调用手机系统默认外部浏览器打开指定链接。

#### `shareText(title: String, text: String, mimeType: String): Boolean`
* **职责**：调起 Android 系统原生分享面板分享文本或 JSON 内容。

#### `logPluginDiagnostic(message: String): void`
* **职责**：输出全屏插件宿主侧诊断日志到 Android Logcat（TAG: `TavernPlugin`）。

#### `getActiveInputMethod(): String`
* **职责**：返回当前系统默认输入法的诊断信息（包名、中文名称、是否系统输入法等），辅助排查输入法遮挡或软键盘兼容性问题。

---

## 三、底层实现原理与资源安全保障

### 1. Scoped Storage (分区存储) 与 MediaStore.Downloads API
* **Android 10+ (API 29+)**：采用 `MediaStore.Downloads` 写入 `/Download/Mobile Tavern/` 目录。
  - **无需存储权限**：不需要申请任何外部读写存储权限（如 `WRITE_EXTERNAL_STORAGE`），完全符合 Android 现代安全沙盒规范。
  - **写入完整性保护**：在写入字节流期间将 `IS_PENDING` 设为 `1`，写入完毕并刷盘后再恢复为 `0`，避免其他应用或文件管理器读到损坏的半成品文件。
* **Android 9 及以下**：提供 Legacy Fallback，写入公共 Downloads 目录。

### 2. 生命周期感知与内存泄漏防治
* 桥接类内部注册了 Application 的 `ActivityLifecycleCallbacks`：
  - 当 Activity 销毁（`onActivityDestroyed`）时，自动触发 `discardPreviousRecord(joinWorker = false)` 中断后台录音线程并释放 AudioRecord 硬件句柄；
  - 自动调用 `TextToSpeech.shutdown()` 并置空，彻底杜绝 Activity 重建引起的 Context 泄漏。

### 3. 多线程录音安全与幂等模型
* 录音工作线程、前端 UI 线程、音频采集线程之间采用细粒度 `recordLock` 同步。
* 引入 `recordGeneration` 代际自增机制：每一次启动新录音都会递增代数，任何由于超时或残余唤醒的旧循环即便写入数据也会被立即废弃，绝不污染新录音。

---

## 四、前端 TypeScript 契约与调用范例

前端在 `src-tauri/plugins/android-bridge/guest-js/index.ts` 维护官方 TypeScript 声明，推荐使用 `getAndroidThemeBridge()` 进行防御性调用：

```typescript
import { getAndroidThemeBridge } from "@aitavern/plugin-android-bridge";

// 1. 检查并保存文件
export function exportFileNativeOrFallback(fileName: string, content: string): void {
  const bridge = getAndroidThemeBridge();
  if (bridge && typeof bridge.saveFile === "function") {
    const result = bridge.saveFile(fileName, content);
    if (!result.startsWith("error:")) {
      console.log("文件已保存至原生目录:", result);
      return;
    }
  }

  // Web 浏览器环境平滑降级
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// 2. 原生录音调用示例
export async function recordVoiceSample(): Promise<string | null> {
  const bridge = getAndroidThemeBridge();
  if (!bridge) return null;

  if (!bridge.hasRecordAudioPermission()) {
    bridge.requestRecordAudioPermission();
    return null;
  }

  const startRes = bridge.startRecordNative(60000); // 录制最多 60 秒
  if (startRes !== "OK") {
    console.error("启动原生录音失败:", startRes);
    return null;
  }

  // 模拟录制 3 秒后停止
  await new Promise((r) => setTimeout(r, 3000));
  const stopResJson = bridge.stopRecordNative();
  if (stopResJson.startsWith("error:")) {
    console.error("停止录音异常:", stopResJson);
    return null;
  }

  const payload = JSON.parse(stopResJson);
  return payload.base64; // 返回录音的 base64 字符串
}
```
