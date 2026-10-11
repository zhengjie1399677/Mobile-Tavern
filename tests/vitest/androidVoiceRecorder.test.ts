import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RECORD_AMPLITUDE,
  resolveAndroidVoiceRecorder,
} from "../../src/infrastructure/native/androidVoiceRecorder";

type BridgeWindow = Window & { AndroidThemeBridge?: unknown };

interface StubBridge {
  hasRecordAudioPermission?: () => boolean;
  requestRecordAudioPermission?: () => void;
  startRecordNative?: (maxDurationMs?: number) => string;
  stopRecordNative?: () => string;
  cancelRecordNative?: () => boolean;
  getRecordAmplitudeNative?: () => number;
}

function installBridge(bridge: StubBridge): void {
  (window as BridgeWindow).AndroidThemeBridge = bridge;
}

/** 录音入口存在是适配层生效的前提，除「桥不完整」用例外都用这个装桩。 */
function installRecorder(bridge: StubBridge = {}): void {
  installBridge({ startRecordNative: () => "OK", ...bridge });
}

function validStopJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    success: true,
    base64: "UklGRg==",
    mimeType: "audio/wav",
    format: "wav",
    durationMs: 1_200,
    sizeBytes: 4,
    ...overrides,
  });
}

describe("AndroidVoiceRecorder 适配层", () => {
  afterEach(() => {
    delete (window as BridgeWindow).AndroidThemeBridge;
    vi.restoreAllMocks();
  });

  it("桥缺失时返回 null", () => {
    expect(resolveAndroidVoiceRecorder()).toBeNull();
  });

  it("桥存在但未提供录音入口时返回 null", () => {
    installBridge({ hasRecordAudioPermission: () => true });
    expect(resolveAndroidVoiceRecorder()).toBeNull();
  });

  it("不在模块加载期缓存全局，resolve 读取当前实现", () => {
    expect(resolveAndroidVoiceRecorder()).toBeNull();
    const startRecordNative = vi.fn(() => "OK");
    installBridge({ startRecordNative });
    const recorder = resolveAndroidVoiceRecorder();
    expect(recorder).not.toBeNull();
    expect(recorder?.start(1_000)).toEqual({ status: "ok" });
    expect(startRecordNative).toHaveBeenCalledWith(1_000);

    // 换桥后重新 resolve 必须拿到新实现（Activity 重建 / 测试装桩）。
    const replacement = vi.fn(() => "error:REPLACED");
    (window as BridgeWindow).AndroidThemeBridge = { startRecordNative: replacement };
    expect(resolveAndroidVoiceRecorder()?.start(1_000)).toEqual({ status: "error", code: "REPLACED" });
    expect(replacement).toHaveBeenCalledTimes(1);

    // 方法查询是实时的：就地给同一个桥对象补方法无需重新 resolve。
    const bridge = { startRecordNative: () => "OK" } as StubBridge & { stopRecordNative?: () => string };
    bridge.stopRecordNative = () => "error:NOT_RECORDING";
    installBridge(bridge);
    const live = resolveAndroidVoiceRecorder();
    bridge.stopRecordNative = () => validStopJson({ sizeBytes: 8 });
    expect(live?.stop()).toMatchObject({ status: "ok", sizeBytes: 8 });
  });

  it("归一化 start 的三种结果", () => {
    installBridge({ startRecordNative: () => "OK" });
    expect(resolveAndroidVoiceRecorder()?.start(1_000)).toEqual({ status: "ok" });

    installBridge({ startRecordNative: () => "error:PERMISSION_DENIED" });
    expect(resolveAndroidVoiceRecorder()?.start(1_000)).toEqual({ status: "permission-denied" });

    installBridge({ startRecordNative: () => "error:AUDIO_RECORD_INIT_FAILED" });
    expect(resolveAndroidVoiceRecorder()?.start(1_000)).toEqual({
      status: "error",
      code: "AUDIO_RECORD_INIT_FAILED",
    });

    installBridge({ startRecordNative: () => "error:" });
    expect(resolveAndroidVoiceRecorder()?.start(1_000)).toEqual({ status: "error", code: "UNKNOWN" });
  });

  it("桥抛异常时吞掉并归一化为 BRIDGE_EXCEPTION", () => {
    installRecorder({
      startRecordNative: () => {
        throw new Error("JavaBridge down");
      },
      stopRecordNative: () => {
        throw new Error("JavaBridge down");
      },
    });
    const recorder = resolveAndroidVoiceRecorder();
    expect(recorder?.start(1_000)).toEqual({ status: "error", code: "BRIDGE_EXCEPTION" });
    expect(recorder?.stop()).toEqual({ status: "error", code: "BRIDGE_EXCEPTION" });
    expect(() => recorder?.cancel()).not.toThrow();
  });

  it("解析合法的 stop 载荷", () => {
    installRecorder({ stopRecordNative: () => validStopJson() });
    expect(resolveAndroidVoiceRecorder()?.stop()).toEqual({
      status: "ok",
      base64: "UklGRg==",
      mimeType: "audio/wav",
      format: "wav",
      durationMs: 1_200,
      sizeBytes: 4,
    });
  });

  it("忽略未知字段，但字段缺失或 JSON 畸形时判为 PAYLOAD_MALFORMED", () => {
    installRecorder({ stopRecordNative: () => validStopJson({ futureField: "x" }) });
    expect(resolveAndroidVoiceRecorder()?.stop()).toMatchObject({ status: "ok", sizeBytes: 4 });

    installRecorder({ stopRecordNative: () => JSON.stringify({ base64: "UklGRg==" }) });
    expect(resolveAndroidVoiceRecorder()?.stop()).toEqual({ status: "error", code: "PAYLOAD_MALFORMED" });

    installRecorder({ stopRecordNative: () => "{not json" });
    expect(resolveAndroidVoiceRecorder()?.stop()).toEqual({ status: "error", code: "PAYLOAD_MALFORMED" });

    installRecorder({ stopRecordNative: () => "" });
    expect(resolveAndroidVoiceRecorder()?.stop()).toEqual({ status: "error", code: "UNKNOWN" });
  });

  it("把 stop 的 error 串归一化为错误码", () => {
    installRecorder({ stopRecordNative: () => "error:NOT_RECORDING" });
    expect(resolveAndroidVoiceRecorder()?.stop()).toEqual({ status: "error", code: "NOT_RECORDING" });
  });

  it("振幅钳制到 0..MAX 并忽略非法值", () => {
    const amplitude = (value: unknown) => {
      installRecorder({ getRecordAmplitudeNative: () => value as number });
      return resolveAndroidVoiceRecorder()?.getAmplitude();
    };
    expect(amplitude(MAX_RECORD_AMPLITUDE)).toBe(MAX_RECORD_AMPLITUDE);
    expect(amplitude(16_384)).toBe(16_384);
    expect(amplitude(-5)).toBe(0);
    expect(amplitude(99_999)).toBe(MAX_RECORD_AMPLITUDE);
    expect(amplitude(Number.NaN)).toBe(0);
    expect(amplitude(undefined)).toBe(0);
  });

  it("权限查询与请求失败时降级而不是抛出", () => {
    installRecorder({
      hasRecordAudioPermission: () => {
        throw new Error("denied");
      },
      requestRecordAudioPermission: () => {
        throw new Error("no activity");
      },
    });
    const recorder = resolveAndroidVoiceRecorder();
    expect(recorder?.hasPermission()).toBe(false);
    expect(() => recorder?.requestPermission()).not.toThrow();
  });

  it("权限查询委托给桥", () => {
    const hasRecordAudioPermission = vi.fn(() => true);
    const requestRecordAudioPermission = vi.fn();
    installRecorder({ hasRecordAudioPermission, requestRecordAudioPermission });
    const recorder = resolveAndroidVoiceRecorder();
    expect(recorder?.hasPermission()).toBe(true);
    recorder?.requestPermission();
    expect(requestRecordAudioPermission).toHaveBeenCalledTimes(1);
  });
});
