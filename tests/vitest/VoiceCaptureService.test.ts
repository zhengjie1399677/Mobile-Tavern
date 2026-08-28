import { describe, expect, it } from "vitest";
import { encodePcm16Wav } from "../../src/application/services/VoiceCaptureService";

describe("VoiceCaptureService", () => {
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
});
