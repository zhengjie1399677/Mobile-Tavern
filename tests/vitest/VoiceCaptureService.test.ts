import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePcm16Wav, VoiceCaptureService } from "../../src/application/services/VoiceCaptureService";
import type {
  AndroidVoiceRecorderBridge,
  AndroidVoiceRecorderStopResult,
} from "../../src/infrastructure/native/androidVoiceRecorder";

function createRecorder(
  overrides: Partial<AndroidVoiceRecorderBridge> = {},
): AndroidVoiceRecorderBridge {
  return {
    hasPermission: () => true,
    requestPermission: vi.fn(),
    start: () => ({ status: "ok" }),
    stop: () => ({ status: "error", code: "NOT_RECORDING" }),
    cancel: vi.fn(),
    getAmplitude: () => 0,
    ...overrides,
  };
}

/** 构造一份与原生桥同形的 stop 结果（44 字节 RIFF 头 + 静音 PCM）。 */
function wavStopResult(dataBytes = 4): AndroidVoiceRecorderStopResult {
  const bytes = new Uint8Array(44 + dataBytes);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  write(0, "RIFF");
  write(8, "WAVE");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    status: "ok",
    base64: btoa(binary),
    mimeType: "audio/wav",
    format: "wav",
    sizeBytes: bytes.length,
    durationMs: 1_200,
  };
}

/** Web Audio 回退链路的桩：返回可手动触发 onaudioprocess 的处理器。 */
function stubWebAudio() {
  const processorHolder: { current: ScriptProcessorNode | null } = { current: null };
  const node = { connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    state: "running",
    sampleRate: 24_000,
    destination: node,
    createMediaStreamSource: vi.fn(() => node),
    createScriptProcessor: vi.fn(() => {
      processorHolder.current = { ...node, onaudioprocess: null } as unknown as ScriptProcessorNode;
      return processorHolder.current;
    }),
    createGain: vi.fn(() => ({ ...node, gain: { value: 1 } })),
    close: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
  };
  const stream = { getTracks: () => [{ stop: vi.fn() }] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("window", { AudioContext: vi.fn(function () { return context; }) });
  return { processorHolder, getUserMedia };
}

function emitWebAudioFrame(processorHolder: { current: ScriptProcessorNode | null }): void {
  processorHolder.current?.onaudioprocess?.({
    inputBuffer: {
      length: 2,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.1, -0.1]),
    },
  } as unknown as AudioProcessingEvent);
}

describe("VoiceCaptureService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("把单声道浮点采样编码为可识别的 PCM16 WAV", async () => {
    const blob = encodePcm16Wav([
      new Float32Array([-1, -0.5, 0, 0.5, 1]),
    ], 24_000);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe("audio/wav");
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(24_000);
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(10);
  });

  it("拒绝空采样和无效采样率", () => {
    expect(() => encodePcm16Wav([], 24_000)).toThrow("VOICE_CAPTURE_EMPTY");
    expect(() => encodePcm16Wav([new Float32Array([0])], 0)).toThrow("VOICE_CAPTURE_SAMPLE_RATE_INVALID");
  });

  it("没有采集过内容时停止会报 NOT_ACTIVE", async () => {
    const service = new VoiceCaptureService(() => null);
    await expect(service.stopCapture()).rejects.toThrow("VOICE_CAPTURE_NOT_ACTIVE");
  });

  it("停止是幂等的：并发与后续调用都拿到同一个 File", async () => {
    const { processorHolder } = stubWebAudio();
    const service = new VoiceCaptureService(() => null);
    await service.startCapture();
    emitWebAudioFrame(processorHolder);

    const firstStop = service.stopCapture();
    const duplicateStop = service.stopCapture();
    const [firstFile, duplicateFile] = await Promise.all([firstStop, duplicateStop]);

    expect(firstFile).toBe(duplicateFile);
    expect(firstFile).toMatchObject({ type: "audio/wav" });
    // 完成文件保留到 cancel 或下一次 start：上限自动发送后松手再停一次也拿同一份。
    await expect(service.stopCapture()).resolves.toBe(firstFile);

    await service.cancelCapture();
    await expect(service.stopCapture()).rejects.toThrow("VOICE_CAPTURE_NOT_ACTIVE");
  });

  it("原生链路产出 audio/wav，并校验 RIFF 魔数", async () => {
    const recorder = createRecorder({ stop: () => wavStopResult() });
    const service = new VoiceCaptureService(() => recorder);

    await service.startCapture({ maxDurationMs: 180_000 });
    expect(service.isCapturing()).toBe(true);

    const file = await service.stopCapture();
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(file.type).toBe("audio/wav");
    expect(file.name).toMatch(/^voice-input-.*\.wav$/);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(service.isCapturing()).toBe(false);
  });

  it("原生非 WAV 载荷被语音层拦下（不再流到附件签名检测）", async () => {
    const recorder = createRecorder({
      stop: () => ({ ...wavStopResult(), mimeType: "audio/mp4", format: "m4a" }),
    });
    const service = new VoiceCaptureService(() => recorder);
    await service.startCapture({ maxDurationMs: 180_000 });
    await expect(service.stopCapture()).rejects.toThrow("VOICE_CAPTURE_FORMAT_UNSUPPORTED");
  });

  it("原生魔数不符或长度不符时判为 PARSE_ERROR", async () => {
    const badMagic = createRecorder({
      stop: () => ({ ...wavStopResult(), base64: btoa("XXXXXXXXXXXX") , sizeBytes: 12 }),
    });
    const service = new VoiceCaptureService(() => badMagic);
    await service.startCapture({ maxDurationMs: 180_000 });
    await expect(service.stopCapture()).rejects.toThrow("VOICE_CAPTURE_PARSE_ERROR");

    const badLength = createRecorder({ stop: () => ({ ...wavStopResult(), sizeBytes: 999 }) });
    const service2 = new VoiceCaptureService(() => badLength);
    await service2.startCapture({ maxDurationMs: 180_000 });
    await expect(service2.stopCapture()).rejects.toThrow("VOICE_CAPTURE_PARSE_ERROR");
  });

  it("原生停止失败时映射为稳定错误码，且不复活旧文件", async () => {
    const recorder = createRecorder({ stop: () => ({ status: "error", code: "EMPTY_AUDIO" }) });
    const service = new VoiceCaptureService(() => recorder);
    await service.startCapture({ maxDurationMs: 180_000 });

    await expect(service.stopCapture()).rejects.toThrow("VOICE_CAPTURE_EMPTY");
    await expect(service.stopCapture()).rejects.toThrow("VOICE_CAPTURE_NOT_ACTIVE");
  });

  it("未知原生错误码保留诊断信息", async () => {
    const recorder = createRecorder({ stop: () => ({ status: "error", code: "AUDIO_RECORD_INIT_FAILED" }) });
    const service = new VoiceCaptureService(() => recorder);
    await service.startCapture({ maxDurationMs: 180_000 });
    await expect(service.stopCapture()).rejects.toThrow(
      "VOICE_CAPTURE_NATIVE_ERROR:AUDIO_RECORD_INIT_FAILED",
    );
  });

  it("非权限类原生启动失败回退到 Web Audio", async () => {
    const { getUserMedia } = stubWebAudio();
    const recorder = createRecorder({
      start: () => ({ status: "error", code: "AUDIO_RECORD_INIT_FAILED" }),
    });
    const service = new VoiceCaptureService(() => recorder);

    await service.startCapture({ maxDurationMs: 180_000 });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(service.isCapturing()).toBe(true);
  });

  it("原生直接报权限拒绝时抛出权限错误，不回退", async () => {
    const { getUserMedia } = stubWebAudio();
    const recorder = createRecorder({
      hasPermission: () => true,
      start: () => ({ status: "permission-denied" }),
    });
    const service = new VoiceCaptureService(() => recorder);

    await expect(service.startCapture({ maxDurationMs: 180_000 })).rejects.toThrow(
      "VOICE_CAPTURE_PERMISSION_DENIED",
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("等待授权：授权到位后才启动原生录音", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const hasPermission = vi.fn(() => {
      polls += 1;
      return polls >= 3;
    });
    const requestPermission = vi.fn();
    const start = vi.fn(() => ({ status: "ok" as const }));
    const recorder = createRecorder({ hasPermission, requestPermission, start });
    const service = new VoiceCaptureService(() => recorder);

    const started = service.startCapture({ maxDurationMs: 180_000 });
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await started;

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(hasPermission.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("等待授权超时后按拒绝处理，且后续按住立即失败不再白等", async () => {
    vi.useFakeTimers();
    const hasPermission = vi.fn(() => false);
    const requestPermission = vi.fn();
    const start = vi.fn(() => ({ status: "ok" as const }));
    const recorder = createRecorder({ hasPermission, requestPermission, start });
    const service = new VoiceCaptureService(() => recorder);

    const pending = service.startCapture({ maxDurationMs: 180_000 });
    const rejection = expect(pending).rejects.toThrow("VOICE_CAPTURE_PERMISSION_DENIED");
    await vi.advanceTimersByTimeAsync(20_000 + 1_000);
    await rejection;

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();

    await expect(service.startCapture({ maxDurationMs: 180_000 })).rejects.toThrow(
      "VOICE_CAPTURE_PERMISSION_BLOCKED",
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("等待授权期间被取消时判废，不启动原生录音", async () => {
    vi.useFakeTimers();
    const start = vi.fn(() => ({ status: "ok" as const }));
    const cancel = vi.fn();
    const recorder = createRecorder({ hasPermission: () => false, start, cancel });
    const service = new VoiceCaptureService(() => recorder);

    const pending = service.startCapture({ maxDurationMs: 180_000 });
    const rejection = expect(pending).rejects.toThrow("VOICE_CAPTURE_SUPERSEDED");
    await vi.advanceTimersByTimeAsync(300);
    await service.cancelCapture();
    await vi.advanceTimersByTimeAsync(500);
    await rejection;

    expect(start).not.toHaveBeenCalled();
  });

  it("到达上限时先收尾再回调，随后的停止复用同一份录音", async () => {
    vi.useFakeTimers();
    const onLimitReached = vi.fn();
    const stopRecord = vi.fn(() => wavStopResult());
    const recorder = createRecorder({ stop: stopRecord });
    const service = new VoiceCaptureService(() => recorder);

    await service.startCapture({ maxDurationMs: 180_000, onLimitReached });
    await vi.advanceTimersByTimeAsync(180_000);

    expect(onLimitReached).toHaveBeenCalledTimes(1);
    expect(stopRecord).toHaveBeenCalledTimes(1);

    const file = await service.stopCapture();
    expect(stopRecord).toHaveBeenCalledTimes(1);
    expect(file.type).toBe("audio/wav");
    expect(service.isCapturing()).toBe(false);
  });

  it("上限收尾失败时回调仍然触发", async () => {
    vi.useFakeTimers();
    const onLimitReached = vi.fn();
    const recorder = createRecorder({ stop: () => ({ status: "error", code: "EMPTY_AUDIO" }) });
    const service = new VoiceCaptureService(() => recorder);

    await service.startCapture({ maxDurationMs: 180_000, onLimitReached });
    await vi.advanceTimersByTimeAsync(180_000);

    expect(onLimitReached).toHaveBeenCalledTimes(1);
  });

  it("原生振幅按 0..32767 归一化，未采集时为 0", async () => {
    const recorder = createRecorder({ getAmplitude: () => 32_767 });
    const service = new VoiceCaptureService(() => recorder);
    expect(service.getAmplitude()).toBe(0);

    await service.startCapture({ maxDurationMs: 180_000 });
    expect(service.getAmplitude()).toBe(1);

    const half = createRecorder({ getAmplitude: () => 16_384 });
    const service2 = new VoiceCaptureService(() => half);
    await service2.startCapture({ maxDurationMs: 180_000 });
    expect(service2.getAmplitude()).toBeCloseTo(0.5, 3);
  });

  it("拒绝无效时长（含原生会静默夹紧的越界值）", async () => {
    const service = new VoiceCaptureService(() => null);
    await expect(service.startCapture({ maxDurationMs: 500 })).rejects.toThrow(
      "VOICE_CAPTURE_DURATION_INVALID",
    );
    await expect(service.startCapture({ maxDurationMs: 600_001 })).rejects.toThrow(
      "VOICE_CAPTURE_DURATION_INVALID",
    );
  });
});
