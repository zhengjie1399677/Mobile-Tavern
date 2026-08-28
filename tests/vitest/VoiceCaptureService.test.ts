import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePcm16Wav, VoiceCaptureService } from "../../src/application/services/VoiceCaptureService";

describe("VoiceCaptureService", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("并发结束录音时只允许一次消费完成文件", async () => {
    const processorHolder: { current: ScriptProcessorNode | null } = { current: null };
    const node = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
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
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal("window", {
      AudioContext: vi.fn(() => context),
    });

    const service = new VoiceCaptureService();
    await service.startCapture();
    processorHolder.current?.onaudioprocess?.({
      inputBuffer: {
        length: 2,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array([0.1, -0.1]),
      },
    } as unknown as AudioProcessingEvent);

    const firstStop = service.stopCapture();
    const duplicateStop = service.stopCapture();
    await expect(duplicateStop).rejects.toThrow("VOICE_CAPTURE_NOT_ACTIVE");
    await expect(firstStop).resolves.toMatchObject({ type: "audio/wav" });
  });
});
