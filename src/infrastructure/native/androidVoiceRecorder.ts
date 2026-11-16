import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

/**
 * Android 原生录音桥适配（Native Adapter 边界）。
 *
 * 启动/取消/振幅查询通过 `window.AndroidThemeBridge`（`@JavascriptInterface`）完成；
 * 停止录音优先走 Tauri 异步命令 `plugin:AndroidBridge|stop_record_native` + 原始二进制
 * `read_voice_capture_file`（零 Base64 / 零 `atob()` / 不阻塞 WebView JS 线程），
 * 若运行在无 Tauri IPC 的旧 WebView 环境则回退到同步 `stopRecordNative()`。
 * 本模块只做归一化，**自身不抛异常**：是否降级、是否报错由 `VoiceCaptureService` 决策。
 *
 * 全局对象在 `resolveAndroidVoiceRecorder()` 调用时读取，不在模块加载期缓存 —— 否则测试无法装桩，
 * 宿主也无法在 Activity 重建后换桥。方法查询仍是实时的（桥对象被就地扩展时同样生效）。
 */

const ERROR_PREFIX = "error:";

/** 振幅上限，与 MediaRecorder.maxAmplitude / AudioRecord 峰值域一致。 */
export const MAX_RECORD_AMPLITUDE = 32767;

const stopPayloadSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
  format: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().optional(),
});

const stopFilePayloadSchema = z.object({
  filePath: z.string().min(1),
  mimeType: z.string(),
  format: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().optional(),
});

export type AndroidVoiceRecorderStopPayload = {
  bytes?: Uint8Array<ArrayBuffer>;
  base64?: string;
  mimeType: string;
  format: string;
  sizeBytes: number;
  durationMs?: number;
};

export type AndroidVoiceRecorderStartResult =
  | { status: "ok" }
  | { status: "permission-denied" }
  | { status: "error"; code: string };

export type AndroidVoiceRecorderStopResult =
  | ({ status: "ok" } & AndroidVoiceRecorderStopPayload)
  | { status: "error"; code: string };

export interface AndroidVoiceRecorderBridge {
  hasPermission(): boolean;
  requestPermission(): void;
  start(maxDurationMs: number): AndroidVoiceRecorderStartResult;
  stop(): AndroidVoiceRecorderStopResult;
  stopAsync?(): Promise<AndroidVoiceRecorderStopResult>;
  cancel(): void;
  getAmplitude(): number;
}

export type TauriInvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export interface ResolveAndroidVoiceRecorderOptions {
  invoke?: TauriInvokeFn;
}

interface AndroidThemeBridgeWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
  AndroidThemeBridge?: {
    hasRecordAudioPermission?: () => boolean;
    requestRecordAudioPermission?: () => void;
    startRecordNative?: (maxDurationMs?: number) => string;
    stopRecordNative?: () => string;
    cancelRecordNative?: () => boolean;
    getRecordAmplitudeNative?: () => number;
  };
}

const KNOWN_NATIVE_RECORD_ERRORS = new Set([
  "NOT_RECORDING",
  "EMPTY_AUDIO",
  "AUDIO_TOO_LARGE",
  "STOP_INCOMPLETE",
  "SUPERSEDED",
  "BRIDGE_NOT_READY",
  "PAYLOAD_MALFORMED",
  "VOICE_CAPTURE_PATH_INVALID",
  "VOICE_CAPTURE_PATH_FORBIDDEN",
  "VOICE_CAPTURE_FILE_NOT_FOUND",
  "VOICE_CAPTURE_FILE_INVALID",
]);

function readNativeBridge() {
  if (typeof window === "undefined") return undefined;
  return (window as AndroidThemeBridgeWindow).AndroidThemeBridge;
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined"
    && typeof (window as AndroidThemeBridgeWindow).__TAURI_INTERNALS__ !== "undefined";
}

function readErrorCode(raw: unknown): string {
  if (typeof raw !== "string") return "UNKNOWN";
  if (!raw.startsWith(ERROR_PREFIX)) return raw.length > 0 ? raw : "UNKNOWN";
  const code = raw.slice(ERROR_PREFIX.length);
  return code.length > 0 ? code : "UNKNOWN";
}

function extractInvokeErrorCode(error: unknown): string {
  if (typeof error === "string") return readErrorCode(error);
  if (error instanceof Error) return readErrorCode(error.message);
  if (error && typeof error === "object" && "message" in error) {
    return readErrorCode((error as { message?: unknown }).message);
  }
  return "BRIDGE_EXCEPTION";
}

function toUint8Array(raw: unknown): Uint8Array<ArrayBuffer> | null {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (raw instanceof Uint8Array) {
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    return copy;
  }
  return null;
}

/** 桥不存在或未提供录音能力时返回 null（桌面 / 浏览器 / 旧安装包）。 */
export function resolveAndroidVoiceRecorder(
  options: ResolveAndroidVoiceRecorderOptions = {},
): AndroidVoiceRecorderBridge | null {
  const bridge = readNativeBridge();
  if (!bridge || typeof bridge.startRecordNative !== "function") return null;

  const invokeFn: TauriInvokeFn | null = options.invoke
    ?? (hasTauriRuntime() ? (invoke as TauriInvokeFn) : null);

  const stopSync = (): AndroidVoiceRecorderStopResult => {
    let raw: unknown;
    try {
      raw = bridge.stopRecordNative?.();
    } catch {
      return { status: "error", code: "BRIDGE_EXCEPTION" };
    }
    if (typeof raw !== "string" || raw.length === 0) return { status: "error", code: "UNKNOWN" };
    if (raw.startsWith(ERROR_PREFIX)) return { status: "error", code: readErrorCode(raw) };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "error", code: "PAYLOAD_MALFORMED" };
    }
    const payload = stopPayloadSchema.safeParse(parsed);
    if (!payload.success) return { status: "error", code: "PAYLOAD_MALFORMED" };
    return { status: "ok", ...payload.data };
  };

  return {
    hasPermission(): boolean {
      try {
        return bridge.hasRecordAudioPermission?.() === true;
      } catch {
        return false;
      }
    },

    requestPermission(): void {
      try {
        bridge.requestRecordAudioPermission?.();
      } catch {
        // 请求失败按「未授权」处理，由调用方的轮询超时兜底。
      }
    },

    start(maxDurationMs: number): AndroidVoiceRecorderStartResult {
      let raw: unknown;
      try {
        raw = bridge.startRecordNative?.(maxDurationMs);
      } catch {
        return { status: "error", code: "BRIDGE_EXCEPTION" };
      }
      if (raw === "OK") return { status: "ok" };
      if (raw === `${ERROR_PREFIX}PERMISSION_DENIED`) return { status: "permission-denied" };
      return { status: "error", code: readErrorCode(raw) };
    },

    stop(): AndroidVoiceRecorderStopResult {
      return stopSync();
    },

    async stopAsync(): Promise<AndroidVoiceRecorderStopResult> {
      if (!invokeFn) {
        return stopSync();
      }

      let rawStop: unknown;
      try {
        rawStop = await invokeFn("plugin:AndroidBridge|stop_record_native");
      } catch (error) {
        const code = extractInvokeErrorCode(error);
        if (KNOWN_NATIVE_RECORD_ERRORS.has(code)) {
          return { status: "error", code };
        }
        // 旧安装包未注册 Tauri 异步命令时，安全回退到同步 @JavascriptInterface 路径。
        if (typeof bridge.stopRecordNative === "function") {
          return stopSync();
        }
        return { status: "error", code };
      }

      const payload = stopFilePayloadSchema.safeParse(rawStop);
      if (!payload.success) {
        return { status: "error", code: "PAYLOAD_MALFORMED" };
      }

      try {
        const rawBytes = await invokeFn("read_voice_capture_file", {
          path: payload.data.filePath,
        });
        const bytes = toUint8Array(rawBytes);
        if (!bytes) {
          return { status: "error", code: "PAYLOAD_MALFORMED" };
        }
        return {
          status: "ok",
          bytes,
          mimeType: payload.data.mimeType,
          format: payload.data.format,
          sizeBytes: payload.data.sizeBytes,
          durationMs: payload.data.durationMs,
        };
      } catch (error) {
        return { status: "error", code: extractInvokeErrorCode(error) };
      }
    },

    cancel(): void {
      try {
        bridge.cancelRecordNative?.();
      } catch {
        // 取消失败不改变调用方状态机：下一次 startCapture 会再次清理。
      }
    },

    getAmplitude(): number {
      let raw: unknown;
      try {
        raw = bridge.getRecordAmplitudeNative?.();
      } catch {
        return 0;
      }
      if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
      return Math.min(MAX_RECORD_AMPLITUDE, Math.max(0, Math.round(raw)));
    },
  };
}
