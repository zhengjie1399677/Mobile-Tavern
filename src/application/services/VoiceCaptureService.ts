import type {
  IKernel,
  IVoiceCaptureService,
  VoiceCaptureOptions,
} from "../serviceContracts";
import { KernelServices } from "../serviceContracts";

interface AudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const DEFAULT_MAX_DURATION_MS = 60_000;
const PROCESSOR_BUFFER_SIZE = 4096;

/**
 * 采集单声道 PCM 并封装为 WAV，保证可直接投影到 OpenAI-compatible input_audio。
 * 这条链路不做语音转写，也不复用普通音频附件入口。
 */
export class VoiceCaptureService implements IVoiceCaptureService {
  readonly name = KernelServices.VoiceCapture;
  readonly isCritical = false;
  readonly dependencies = [] as const;

  private capturing = false;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private mutedGainNode: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizePromise: Promise<File> | null = null;
  private completedFile: File | null = null;
  private stopClaimed = false;

  init(_kernel: IKernel): void {}

  async destroy(): Promise<void> {
    await this.cancelCapture();
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  async startCapture(options: VoiceCaptureOptions = {}): Promise<void> {
    await this.cancelCapture();
    if (
      typeof navigator === "undefined"
      || !navigator.mediaDevices?.getUserMedia
      || typeof window === "undefined"
    ) {
      throw new Error("VOICE_CAPTURE_UNAVAILABLE");
    }
    const AudioContextConstructor = window.AudioContext
      ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("VOICE_CAPTURE_UNAVAILABLE");

    const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    if (!Number.isFinite(maxDurationMs) || maxDurationMs < 1_000) {
      throw new Error("VOICE_CAPTURE_DURATION_INVALID");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const context = new AudioContextConstructor();
      if (context.state === "suspended") await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      const mutedGain = context.createGain();
      mutedGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer;
        const frameCount = input.length;
        const mono = new Float32Array(frameCount);
        for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
          const samples = input.getChannelData(channel);
          for (let index = 0; index < frameCount; index += 1) {
            mono[index] += samples[index] / input.numberOfChannels;
          }
        }
        this.chunks.push(mono);
      };
      source.connect(processor);
      processor.connect(mutedGain);
      mutedGain.connect(context.destination);

      this.stream = stream;
      this.audioContext = context;
      this.sourceNode = source;
      this.processorNode = processor;
      this.mutedGainNode = mutedGain;
      this.sampleRate = context.sampleRate;
      this.chunks = [];
      this.capturing = true;
      this.limitTimer = setTimeout(() => {
        void this.beginFinalize().then(() => options.onLimitReached?.());
      }, maxDurationMs);
    } catch (error) {
      await this.cancelCapture();
      throw error;
    }
  }

  async stopCapture(): Promise<File> {
    if (this.stopClaimed || (!this.completedFile && !this.capturing && !this.finalizePromise)) {
      throw new Error("VOICE_CAPTURE_NOT_ACTIVE");
    }
    this.stopClaimed = true;
    try {
      return this.completedFile ?? await this.beginFinalize();
    } finally {
      this.completedFile = null;
      this.stopClaimed = false;
    }
  }

  async cancelCapture(): Promise<void> {
    this.capturing = false;
    this.completedFile = null;
    this.stopClaimed = false;
    this.chunks = [];
    this.clearLimitTimer();
    await this.releaseAudioResources();
  }

  private beginFinalize(): Promise<File> {
    if (this.finalizePromise) return this.finalizePromise;
    this.finalizePromise = this.finalizeCapture()
      .then((file) => {
        this.completedFile = file;
        return file;
      })
      .finally(() => {
        this.finalizePromise = null;
      });
    return this.finalizePromise;
  }

  private async finalizeCapture(): Promise<File> {
    this.capturing = false;
    this.clearLimitTimer();
    const chunks = this.chunks;
    const sampleRate = this.sampleRate;
    this.chunks = [];
    await this.releaseAudioResources();
    const blob = encodePcm16Wav(chunks, sampleRate);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new File([blob], `voice-input-${stamp}.wav`, { type: "audio/wav" });
  }

  private clearLimitTimer(): void {
    if (this.limitTimer !== null) clearTimeout(this.limitTimer);
    this.limitTimer = null;
  }

  private async releaseAudioResources(): Promise<void> {
    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.mutedGainNode?.disconnect();
    this.mutedGainNode = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== "closed") await context.close();
  }
}

export function encodePcm16Wav(
  chunks: readonly Float32Array[],
  sampleRate: number,
): Blob {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("VOICE_CAPTURE_SAMPLE_RATE_INVALID");
  }
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (sampleCount === 0) throw new Error("VOICE_CAPTURE_EMPTY");

  const bytesPerSample = 2;
  const dataBytes = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
