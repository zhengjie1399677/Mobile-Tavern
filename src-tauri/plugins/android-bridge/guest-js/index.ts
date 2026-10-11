/**
 * Tauri Android Bridge 原生桥接类型契约。
 *
 * 声明注入到 `window.AndroidThemeBridge` 上的原生方法类型定义，
 * 供前端安全调用原生能力（安全区、状态栏、TTS、AAC 原生录音、文件读写等）。
 */

/** `getSafeAreas()` 返回的安全区域内边距结构。 */
export interface AndroidSafeAreas {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * 注入到 `window.AndroidThemeBridge` 的原生方法接口契约。
 * 通过 `@JavascriptInterface` 运行在 WebView 的 JS 线程中。
 */
export interface AndroidThemeBridge {
  /** 返回当前系统栏（状态栏与导航栏）安全区内边距 JSON 串（单位：dp）。 */
  getSafeAreas(): string;
  /** 更新系统状态栏与导航栏背景色及图标明暗。 */
  setStatusBarStyle(isDark: boolean, colorHex: string): void;
  /** 锁定屏幕为传感器横屏或恢复为系统自动旋转。 */
  setScreenOrientation(mode: "landscape" | "auto"): boolean;
  /** 进入或退出全屏沉浸模式（隐藏系统栏）。 */
  setImmersiveMode(enabled: boolean): boolean;
  /** 向 Android Logcat 输出全屏插件诊断日志。 */
  logPluginDiagnostic(message: string): void;
  /** 调用原生系统分享面板分享文本或 JSON 内容。 */
  shareText(title: string, text: string, mimeType: string): boolean;
  /**
   * 将 UTF-8 文本内容保存到公共 Download 目录。
   * @returns 成功返回保存路径，失败返回以 `error:` 开头的错误信息。
   */
  saveFile(fileName: string, content: string): string;
  /**
   * 将 Base64 编码的二进制文件保存到公共 Download 目录。
   * @returns 成功返回保存路径，失败返回以 `error:` 开头的错误信息。
   */
  saveFileBase64(fileName: string, base64Data: string, mimeType: string): string;
  /**
   * 诊断测试导出 IO 链路的读写与校验能力。
   * @returns 成功返回 `"OK"`，失败返回以 `error:` 开头的错误信息。
   */
  verifyFileIo(): string;
  /** 在系统默认浏览器中打开指定链接。 */
  openUrl(url: string): void;
  /** 调用系统原生 TTS 语音合成朗读文本。 */
  speakNative(text: string, rate: number, pitch: number): boolean;
  /** 停止当前正在播放的原生 TTS 朗读。 */
  stopNative(): void;
  /** 查询原生 TTS 当前是否正在朗诵。 */
  isSpeakingNative(): boolean;
  /** 检查是否已授予全盘外部存储访问权限。 */
  hasStoragePermission(): boolean;
  /** 调起系统设置页面申请全盘外部存储访问权限。 */
  requestStoragePermission(): void;
  /** 全盘扫描角色卡文件（.json 与 .png），返回 JSON 数组字符串。 */
  scanGlobalCards(): string;
  /** 读取指定路径的本地角色卡文件内容（PNG 文件返回 Base64 Data URL）。 */
  readLocalFile(path: string): string;
  /** 检查是否已授予麦克风录音权限。 */
  hasRecordAudioPermission(): boolean;
  /** 动态申请麦克风录音权限。 */
  requestRecordAudioPermission(): void;
  /** 启动原生麦克风录音（16 kHz 单声道 PCM16 WAV），返回 "OK" 或 "error:..."。 */
  startRecordNative(maxDurationMs?: number): string;
  /** 停止原生麦克风录音，返回 `{base64, mimeType:"audio/wav", format:"wav", durationMs, sizeBytes}` 的 JSON 字符串或 "error:..."。幂等：重复调用返回同一份结果，直到下一次 start / cancel。 */
  stopRecordNative(): string;
  /** 取消原生麦克风录音并安全删除临时缓存文件。 */
  cancelRecordNative(): boolean;
  /** 获取当前录音的最大振幅（0..32767），用于驱动波形跳动动效。 */
  getRecordAmplitudeNative(): number;
}

declare global {
  interface Window {
    AndroidThemeBridge?: AndroidThemeBridge;
  }
}

/**
 * 获取注入的原生桥接对象实例。非 Android WebView 环境返回 null。
 */
export function getAndroidThemeBridge(): AndroidThemeBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window).AndroidThemeBridge;
  return bridge ?? null;
}

export default getAndroidThemeBridge;
