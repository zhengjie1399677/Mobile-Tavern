import { z } from "zod";

/**
 * Android 原生录音桥适配（Native Adapter 边界）。
 *
 * 桥是挂在 `window.AndroidThemeBridge` 上的同步 `@JavascriptInterface` 对象，返回值约定为
 * `"OK"` / `"error:<code>"` / JSON 字符串。本模块只做归一化，**自身不抛异常**：是否降级、
 * 是否报错由 `VoiceCaptureService` 决策。
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

export type AndroidVoiceRecorderStopPayload = z.infer<typeof stopPayloadSchema>;

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
  cancel(): void;
  getAmplitude(): number;
}

interface AndroidThemeBridgeWindow extends Window {
  AndroidThemeBridge?: {
    hasRecordAudioPermission?: () => boolean;
    requestRecordAudioPermission?: () => void;
    startRecordNative?: (maxDurationMs?: number) => string;
    stopRecordNative?: () => string;
    cancelRecordNative?: () => boolean;
    getRecordAmplitudeNative?: () => number;
  };
}

function readNativeBridge() {
  if (typeof window === "undefined") return undefined;
  return (window as AndroidThemeBridgeWindow).AndroidThemeBridge;
}

function readErrorCode(raw: unknown): string {
  if (typeof raw !== "string") return "UNKNOWN";
  if (!raw.startsWith(ERROR_PREFIX)) return raw.length > 0 ? raw : "UNKNOWN";
  const code = raw.slice(ERROR_PREFIX.length);
  return code.length > 0 ? code : "UNKNOWN";
}

/** 桥不存在或未提供录音能力时返回 null（桌面 / 浏览器 / 旧安装包）。 */
export function resolveAndroidVoiceRecorder(): AndroidVoiceRecorderBridge | null {
  const bridge = readNativeBridge();
  if (!bridge || typeof bridge.startRecordNative !== "function") return null;

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
