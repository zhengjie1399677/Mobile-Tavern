import type {
  IKernel,
  IVoiceCaptureService,
  VoiceCaptureOptions,
} from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import {
  MAX_RECORD_AMPLITUDE,
  resolveAndroidVoiceRecorder,
  type AndroidVoiceRecorderBridge,
} from "../../infrastructure/native/androidVoiceRecorder";

interface AudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const DEFAULT_MAX_DURATION_MS = 180_000;
const MIN_MAX_DURATION_MS = 1_000;
/** 与原生侧 `MIN_RECORD_MS..MAX_RECORD_MS` 对齐：越界会被原生静默夹紧，两侧计时就会失步。 */
const MAX_MAX_DURATION_MS = 600_000;
const PROCESSOR_BUFFER_SIZE = 4096;
const PERMISSION_POLL_INTERVAL_MS = 250;
const PERMISSION_POLL_TIMEOUT_MS = 20_000;
const WAV_HEADER_BYTES = 44;

/** 原生停止失败时的错误码 → 稳定的语音错误码。 */
const NATIVE_STOP_ERROR_CODES: Record<string, string> = {
  NOT_RECORDING: "VOICE_CAPTURE_NOT_ACTIVE",
  EMPTY_AUDIO: "VOICE_CAPTURE_EMPTY",
  AUDIO_TOO_LARGE: "VOICE_CAPTURE_TOO_LARGE",
};

/**
 * 采集语音（Android 走 Kotlin 原生 AudioRecord 直录 16 kHz 单声道 WAV，Web 端回退 Web Audio WAV）。
 *
 * 状态机：`idle → capturing → finalizing → completed → idle`。
 * `completedFile` 会保留到 `cancelCapture()` 或下一次 `startCapture()`，
 * 因此 `stopCapture()` 是幂等的 —— 上限自动发送与随后松手触发的停止会拿到同一个 File。
 */
export class VoiceCaptureService implements IVoiceCaptureService {
  readonly name = KernelServices.VoiceCapture;
  readonly isCritical = false;
  readonly dependencies = [] as const;

  private capturing = false;
  private mode: "native" | "web" | null = null;
  /** 取消/重启计数器：慢速收尾跨越了一次 cancel 时用它判废，避免复活已取消的录音。 */
  private epoch = 0;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private mutedGainNode: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private latestChunk: Float32Array | null = null;
  private sampleRate = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizePromise: Promise<File> | null = null;
  private completedFile: File | null = null;
  /** 上次等待授权超时：后续按住立即失败，不再白等一轮轮询。授权到位后自动解除。 */
  private permissionBlocked = false;
  private readonly resolveRecorder: () => AndroidVoiceRecorderBridge | null;

  constructor(resolveRecorder: () => AndroidVoiceRecorderBridge | null = resolveAndroidVoiceRecorder) {
    this.resolveRecorder = resolveRecorder;
  }

  init(_kernel: IKernel): void {}

  async destroy(): Promise<void> {
    await this.cancelCapture();
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  getAmplitude(): number {
    if (!this.capturing) return 0;
    if (this.mode === "native") {
      const recorder = this.resolveRecorder();
      if (!recorder) return 0;
      return Math.min(1, recorder.getAmplitude() / MAX_RECORD_AMPLITUDE);
    }
    // Web Audio 回退链路的振幅估算
    if (this.latestChunk && this.latestChunk.length > 0) {
      let sum = 0;
      for (let i = 0; i < this.latestChunk.length; i++) {
        sum += Math.abs(this.latestChunk[i]);
      }
      return Math.min(1, (sum / this.latestChunk.length) * 4);
    }
    return 0;
  }

  async startCapture(options: VoiceCaptureOptions = {}): Promise<void> {
    await this.cancelCapture();

    const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    if (
      !Number.isFinite(maxDurationMs)
      || maxDurationMs < MIN_MAX_DURATION_MS
      || maxDurationMs > MAX_MAX_DURATION_MS
    ) {
      throw new Error("VOICE_CAPTURE_DURATION_INVALID");
    }

    const recorder = this.resolveRecorder();
    if (recorder) {
      const started = await this.tryStartNative(recorder, maxDurationMs, options);
      if (started) return;
    }
    await this.startWeb(maxDurationMs, options);
  }

  async stopCapture(): Promise<File> {
    if (this.completedFile) return this.completedFile;
    if (this.finalizePromise) return this.finalizePromise;
    if (!this.capturing) throw new Error("VOICE_CAPTURE_NOT_ACTIVE");

    this.clearLimitTimer();
    const epoch = this.epoch;
    const promise = (this.mode === "native" ? this.finalizeNative() : this.finalizeWeb())
      .then((file) => {
        if (epoch !== this.epoch) throw new Error("VOICE_CAPTURE_SUPERSEDED");
        this.completedFile = file;
        return file;
      })
      .finally(() => {
        if (this.finalizePromise === promise) this.finalizePromise = null;
      });
    this.finalizePromise = promise;
    return promise;
  }

  async cancelCapture(): Promise<void> {
    this.epoch += 1;
    this.resolveRecorder()?.cancel();
    this.capturing = false;
    this.mode = null;
    this.completedFile = null;
    this.finalizePromise = null;
    this.chunks = [];
    this.latestChunk = null;
    this.clearLimitTimer();
    await this.releaseAudioResources();
  }

  /** 返回 true 表示原生链路已开始采集；false 表示按调用方约定回退 Web Audio。 */
  private async tryStartNative(
    recorder: AndroidVoiceRecorderBridge,
    maxDurationMs: number,
    options: VoiceCaptureOptions,
  ): Promise<boolean> {
    if (recorder.hasPermission()) {
      this.permissionBlocked = false;
    } else {
      if (this.permissionBlocked) throw new Error("VOICE_CAPTURE_PERMISSION_BLOCKED");
      recorder.requestPermission();
      await this.waitForPermission(recorder);
    }

    const result = recorder.start(maxDurationMs);
    if (result.status === "permission-denied") {
      throw new Error("VOICE_CAPTURE_PERMISSION_DENIED");
    }
    if (result.status !== "ok") return false;

    this.capturing = true;
    this.mode = "native";
    this.armLimitTimer(maxDurationMs, options);
    return true;
  }

  /**
   * 等待用户在系统弹窗里授权。这个桥没有 `onRequestPermissionsResult` 接线，只能轮询。
   * 超时按「已拒绝」处理并置粘滞标记：Android 11+ 永久拒绝后不会再弹窗，否则每次按住都要白等 20 秒。
   */
  private async waitForPermission(recorder: AndroidVoiceRecorderBridge): Promise<void> {
    const epoch = this.epoch;
    const deadline = Date.now() + PERMISSION_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(PERMISSION_POLL_INTERVAL_MS);
      if (epoch !== this.epoch) throw new Error("VOICE_CAPTURE_SUPERSEDED");
      if (recorder.hasPermission()) return;
    }
    this.permissionBlocked = true;
    throw new Error("VOICE_CAPTURE_PERMISSION_DENIED");
  }

  private async startWeb(maxDurationMs: number, options: VoiceCaptureOptions): Promise<void> {
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
        this.latestChunk = mono;
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
      this.latestChunk = null;
      this.capturing = true;
      this.mode = "web";
      this.armLimitTimer(maxDurationMs, options);
    } catch (error) {
      await this.cancelCapture();
      throw error;
    }
  }

  /** 上限到点先收尾再回调，且回调永不因收尾失败而消失。 */
  private armLimitTimer(maxDurationMs: number, options: VoiceCaptureOptions): void {
    this.clearLimitTimer();
    this.limitTimer = setTimeout(() => {
      void this.stopCapture()
        .catch(() => undefined)
        .then(() => options.onLimitReached?.());
    }, maxDurationMs);
  }

  private async finalizeNative(): Promise<File> {
    const recorder = this.resolveRecorder();
    this.capturing = false;
    this.mode = null;

    const stop = recorder?.stop() ?? { status: "error" as const, code: "NOT_AVAILABLE" };
    if (stop.status !== "ok") {
      throw new Error(NATIVE_STOP_ERROR_CODES[stop.code] ?? `VOICE_CAPTURE_NATIVE_ERROR:${stop.code}`);
    }
    if (stop.mimeType !== "audio/wav" || stop.format !== "wav") {
      throw new Error("VOICE_CAPTURE_FORMAT_UNSUPPORTED");
    }

    const bytes = decodeBase64(stop.base64);
    if (bytes.length !== stop.sizeBytes || bytes.length < WAV_HEADER_BYTES) {
      throw new Error("VOICE_CAPTURE_PARSE_ERROR");
    }
    // 本地魔数断言：原生侧再改容器格式，会在语音层以语音错误码失败，
    // 而不是到 AttachmentService 才变成看不懂的 ATTACHMENT_SIGNATURE_INVALID。
    if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
      throw new Error("VOICE_CAPTURE_PARSE_ERROR");
    }
    return new File([bytes], `voice-input-${timestampSuffix()}.wav`, { type: "audio/wav" });
  }

  private async finalizeWeb(): Promise<File> {
    this.capturing = false;
    this.mode = null;
    const chunks = this.chunks;
    const sampleRate = this.sampleRate;
    this.chunks = [];
    this.latestChunk = null;
    await this.releaseAudioResources();
    const blob = encodePcm16Wav(chunks, sampleRate);
    return new File([blob], `voice-input-${timestampSuffix()}.wav`, { type: "audio/wav" });
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

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function timestampSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function decodeBase64(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("VOICE_CAPTURE_PARSE_ERROR");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
