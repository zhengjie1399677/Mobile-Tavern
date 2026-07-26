// tavern-ar 插件前端 API 封装
//
// 通过 Tauri invoke 调用 Kotlin @Command 方法，桥接到全屏 ArActivity。
// 桌面环境（非 Android WebView）下 invoke 会失败，所有方法都做 try/catch 兜底。
//
// 命令路由：invoke("plugin:tavern-ar|<command>", args)
//   - "plugin:tavern-ar" 是 Tauri 的插件命令命名约定
//   - <command> 对应 ArPlugin.kt 中 @Command 注解的方法名（snake_case）
//
// 与 src-tauri/plugins/tavern-ar/guest-js/index.ts 的类型保持同步。

import { invoke } from "@tauri-apps/api/core";
import { Logger } from "../../utils/logger";

const logger = Logger.create("TavernAr");

/** ARCore 可用性状态，对齐 ArPlugin.kt checkArAvailability 返回值。 */
export type ArAvailability =
  | "supported-installed"
  | "supported-not-installed"
  | "unsupported"
  | "unknown";

/** updateCharacterTexture 命令参数。 */
export interface UpdateTextureArgs {
  base64: string;
  [key: string]: unknown;
}

/** updateRenderState 命令参数。 */
export interface UpdateRenderStateArgs {
  emotion: string;
  light1: string;
  light2: string;
  [key: string]: unknown;
}

/** updateChatBubble 命令参数。 */
export interface UpdateChatBubbleArgs {
  text: string;
  [key: string]: unknown;
}

/** setGestureRecognition 命令参数。 */
export interface SetGestureRecognitionArgs {
  enabled: boolean;
  [key: string]: unknown;
}

/** 手势类型，对齐 HandGestureDetector.kt GestureType 枚举。 */
export type GestureType = "NONE" | "PET" | "WAVE" | "TAP" | "PINCH";

/** 手势事件 payload，对齐 ArPlugin.emitGestureEvent。 */
export interface GestureEventPayload {
  gesture: GestureType;
  handCenterX: number;
  handCenterY: number;
  pinchDistance: number;
}

/** launchAr 命令可能的返回值。 */
export interface LaunchArResult {
  error?: string;
}

/**
 * 判断当前是否运行在 Tauri Android 环境。
 * 通过检测 AndroidThemeBridge 是否注入（由 android-bridge 插件在 WebView 创建时挂载）。
 * 桌面 dev server 下返回 false，AR 相关 UI 应隐藏或禁用。
 */
export function isArSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).AndroidThemeBridge !== "undefined" &&
    typeof (window as any).__TAURI_INTERNALS__ !== "undefined"
  );
}

/**
 * 检查 ARCore 是否已安装且可用。
 * 返回 "supported-installed" 时可调用 launchAr。
 * 桌面环境返回 "unsupported"。
 */
export async function checkArAvailability(): Promise<ArAvailability> {
  if (!isArSupported()) return "unsupported";
  try {
    const result = await invoke<{ availability: ArAvailability }>("plugin:tavern-ar|check_ar_availability");
    return result?.availability ?? "unknown";
  } catch (err) {
    logger.warn("checkArAvailability failed", { error: err });
    return "unknown";
  }
}

/**
 * 启动全屏 AR Activity。
 * 调用前应先通过 checkArAvailability 确认设备支持且 ARCore 已安装。
 * 调用此方法会切换到原生 Activity，WebView 退到后台。
 *
 * @returns 启动成功返回空对象；权限拒绝或启动失败返回 { error }。
 */
export async function launchAr(): Promise<LaunchArResult> {
  if (!isArSupported()) {
    return { error: "ar_not_supported_on_desktop" };
  }
  try {
    const result = await invoke<LaunchArResult | void>("plugin:tavern-ar|launch_ar");
    return (result as LaunchArResult | undefined) ?? {};
  } catch (err) {
    logger.warn("launchAr failed", { error: err });
    return { error: String(err) };
  }
}

/**
 * 关闭 AR Activity，返回聊天页。
 */
export async function closeAr(): Promise<void> {
  if (!isArSupported()) return;
  try {
    await invoke("plugin:tavern-ar|close_ar");
  } catch (err) {
    logger.warn("closeAr failed", { error: err });
  }
}

/**
 * 推送角色立绘纹理到 AR Activity。
 * @param base64 base64 PNG（可带 data: 前缀），通常来自 character.avatar 或 expressions[i].image
 */
export async function updateCharacterTexture(base64: string): Promise<void> {
  if (!isArSupported()) return;
  try {
    const args: UpdateTextureArgs = { base64 };
    await invoke("plugin:tavern-ar|update_character_texture", args);
  } catch (err) {
    logger.warn("updateCharacterTexture failed", { error: err });
  }
}

/**
 * 推送渲染状态（情绪 + 光晕色）到 AR Activity。
 * @param emotion 情绪名（如 "joy"、"默认"）
 * @param light1 反应性光源色（RGBA 字符串）
 * @param light2 环境氛围光源色（RGBA 字符串）
 */
export async function updateRenderState(
  emotion: string,
  light1: string,
  light2: string
): Promise<void> {
  if (!isArSupported()) return;
  try {
    const args: UpdateRenderStateArgs = { emotion, light1, light2 };
    await invoke("plugin:tavern-ar|update_render_state", args);
  } catch (err) {
    logger.warn("updateRenderState failed", { error: err });
  }
}

/**
 * 推送聊天气泡文本到 AR Activity。
 * 空字符串会隐藏气泡。
 */
export async function updateChatBubble(text: string): Promise<void> {
  if (!isArSupported()) return;
  try {
    const args: UpdateChatBubbleArgs = { text };
    await invoke("plugin:tavern-ar|update_chat_bubble", args);
  } catch (err) {
    logger.warn("updateChatBubble failed", { error: err });
  }
}

/**
 * 启用/禁用摄像头视觉手势识别（MediaPipe Hands）。
 * 启用后，AR Activity 从相机帧检测手部关键点，识别抚摸/挥手/点击/捏合手势。
 * 手势事件通过 `listenArGestureEvent` 监听。
 *
 * 注意：首次启用时会异步下载 MediaPipe 模型文件（~5MB），需联网。
 * 模型加载完成后手势识别才真正生效。
 */
export async function setGestureRecognition(enabled: boolean): Promise<void> {
  if (!isArSupported()) return;
  try {
    const args: SetGestureRecognitionArgs = { enabled };
    await invoke("plugin:tavern-ar|set_gesture_recognition", args);
  } catch (err) {
    logger.warn("setGestureRecognition failed", { error: err });
  }
}

/**
 * 检查手势识别是否就绪（模型加载完成）。
 * @returns {ready: boolean}
 */
export async function checkGestureRecognitionReady(): Promise<boolean> {
  if (!isArSupported()) return false;
  try {
    const result = await invoke<{ ready: boolean }>("plugin:tavern-ar|check_gesture_recognition_ready");
    return result?.ready ?? false;
  } catch (err) {
    logger.warn("checkGestureRecognitionReady failed", { error: err });
    return false;
  }
}

/**
 * 监听 AR 手势事件。
 *
 * Tauri plugin event 命名规则：`plugin:<plugin-name>://<event-name>`
 * ArPlugin.emit("ar-gesture", data) 会在前端产生 `plugin:tavern-ar://ar-gesture` 事件。
 *
 * @param callback 手势事件回调
 * @returns 取消监听的函数
 */
export function listenArGestureEvent(
  callback: (event: GestureEventPayload) => void
): () => void {
  if (!isArSupported()) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      unlisten = await listen<GestureEventPayload>("plugin:tavern-ar://ar-gesture", (e) => {
        callback(e.payload);
      });
    } catch (err) {
      logger.warn("listenArGestureEvent failed", { error: err });
    }
  })();

  return () => {
    cancelled = true;
    if (unlisten) unlisten();
  };
}
