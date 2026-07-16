import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtsService } from "../../src/kernel/services/TtsService";
import type { IKernel } from "../../src/kernel/types";

/**
 * 测试专用 Mock 类型定义。
 * 这些类型仅在本测试文件内用于替代 `as any`，确保类型安全的同时保持运行时行为不变。
 */

/** Mock 的 Android 原生 TTS 桥接对象类型（仅本测试需要的方法子集）。 */
interface MockAndroidThemeBridge {
  speakNative: ReturnType<typeof vi.fn>;
  stopNative: ReturnType<typeof vi.fn>;
  isSpeakingNative: ReturnType<typeof vi.fn>;
}

/** 携带 Android 原生桥接的 window mock 类型。 */
interface MockWindowWithBridge extends Window {
  AndroidThemeBridge?: MockAndroidThemeBridge;
}

/** Mock Audio 实例的最小可观测结构（用于 OpenAI provider 路径）。 */
interface MockAudioInstance {
  src: string;
  volume: number;
  playbackRate: number;
  listeners: Record<string, Array<(...args: unknown[]) => void>>;
  addEventListener(event: string, callback: (...args: unknown[]) => void): void;
  removeEventListener(event: string, callback: (...args: unknown[]) => void): void;
  play(): Promise<void>;
  pause(): void;
}

/**
 * 用于访问 TtsService 私有 `currentAudio` 字段的最小内部视图。
 * 测试需要直接注入 mock audio 实例以验证 pause/resume 行为。
 */
interface TtsServiceInternals {
  currentAudio: MockAudioInstance | null;
}

/**
 * 构造最小 IKernel mock。
 * TtsService.init/destroy 仅持有引用而不调用任何 kernel 方法，
 * 故空对象足以满足接口契约；通过 `as unknown as IKernel` 完成精确类型断言。
 */
function createMockKernel(): IKernel {
  return {} as unknown as IKernel;
}

/** 获取 mock 桥接对象（已通过 beforeEach 注入到 global.window）。 */
function getMockBridge(): MockAndroidThemeBridge {
  const bridge = (global.window as MockWindowWithBridge).AndroidThemeBridge;
  if (!bridge) {
    throw new Error("AndroidThemeBridge is not initialized in global.window");
  }
  return bridge;
}

describe("TtsService tests", () => {
  let service: TtsService;

  beforeEach(() => {
    service = new TtsService();
    vi.restoreAllMocks();
    vi.useFakeTimers();

    // Mock Android native TTS bridge (replaces the old SpeechSynthesis mock)
    global.window = {
      AndroidThemeBridge: {
        speakNative: vi.fn().mockReturnValue(true),
        stopNative: vi.fn(),
        // 默认返回 false，speak 测试会按需覆盖
        isSpeakingNative: vi.fn().mockReturnValue(false),
      },
    } as unknown as typeof window & MockWindowWithBridge;

    // Mock HTMLAudioElement / Audio (used by OpenAI provider path)
    const mockAudio = function (this: MockAudioInstance, url: string) {
      this.src = url;
      this.volume = 1;
      this.playbackRate = 1;
      this.listeners = {} as Record<string, Array<(...args: unknown[]) => void>>;
      this.addEventListener = (event: string, callback: (...args: unknown[]) => void) => {
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(callback);
      };
      this.removeEventListener = (event: string, callback: (...args: unknown[]) => void) => {
        if (this.listeners[event]) {
          this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
        }
      };
      this.play = vi.fn().mockImplementation(() => {
        setTimeout(() => {
          if (this.listeners["ended"]) {
            this.listeners["ended"].forEach((cb) => cb());
          }
        }, 10);
        return Promise.resolve();
      });
      this.pause = vi.fn();
    };

    global.Audio = mockAudio as unknown as typeof Audio;
    global.URL = {
      createObjectURL: vi.fn().mockReturnValue("blob:mock-audio-url"),
      revokeObjectURL: vi.fn()
    } as unknown as typeof URL;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize and destroy successfully", async () => {
    await service.init(createMockKernel());
    expect(service.name).toBe("tts");
    await service.destroy(createMockKernel());
  });

  it("should successfully read aloud via Android native TTS bridge", async () => {
    await service.init(createMockKernel());

    // 第一次 isSpeakingNative 返回 true（开始播放），之后返回 false（结束）
    let pollCount = 0;
    getMockBridge().isSpeakingNative = vi.fn(() => {
      pollCount++;
      return pollCount === 1;
    });

    const speakPromise = service.speak("Hello test", {
      provider: "speech-synthesis",
      volume: 0.8,
      rate: 1.2,
      pitch: 0.9,
      messageId: "test-msg-1"
    });

    // 推进到第一次轮询：isSpeakingNative 返回 true，标记开始播放
    await vi.advanceTimersByTimeAsync(100);
    expect(service.isSpeaking()).toBe(true);
    expect(service.getSpeakingMessageId()).toBe("test-msg-1");

    // 推进到第二次轮询：isSpeakingNative 返回 false，触发 resolve
    await vi.advanceTimersByTimeAsync(100);

    await speakPromise;

    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
    expect(getMockBridge().speakNative).toHaveBeenCalledWith("Hello test", 1.2, 0.9);
  });

  it("should throw when Android native TTS bridge is not available", async () => {
    await service.init(createMockKernel());

    // 移除桥，模拟非安卓环境
    delete (global.window as MockWindowWithBridge).AndroidThemeBridge;

    await expect(
      service.speak("Hello", {
        provider: "speech-synthesis",
        messageId: "test-no-bridge"
      })
    ).rejects.toThrow(/Android native TTS bridge is not available/);
  });

  it("should successfully call OpenAI API and play audio element", async () => {
    const mockResponse = new Uint8Array([1, 2, 3]);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockResponse.buffer,
    });
    global.fetch = fetchSpy;

    // OpenAI 路径不依赖 __TAURI_INTERNALS__
    await service.init(createMockKernel());
    const speakPromise = service.speak("Hello OpenAI", {
      provider: "openai",
      volume: 0.6,
      rate: 1.1,
      openaiApiKey: "test-api-key",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "tts-1",
      openaiVoice: "alloy",
      messageId: "test-msg-2"
    });

    expect(service.isSpeaking()).toBe(true);
    expect(service.getSpeakingMessageId()).toBe("test-msg-2");

    // 推进 setTimeout(10ms) 触发 audio "ended" 事件
    await vi.advanceTimersByTimeAsync(20);

    await speakPromise;

    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer test-api-key",
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({
          model: "tts-1",
          input: "Hello OpenAI",
          voice: "alloy",
          response_format: "mp3"
        })
      })
    );
  });

  it("should stop speaking and clear speakingMessageId upon cancel", async () => {
    await service.init(createMockKernel());

    // 一直返回 true，避免 setInterval 自动触发完成
    getMockBridge().isSpeakingNative = vi.fn().mockReturnValue(true);
    // stopNative 调用后，同步让 isSpeakingNative 返回 false（模拟真实 Android 行为）
    getMockBridge().stopNative = vi.fn(() => {
      getMockBridge().isSpeakingNative = vi.fn().mockReturnValue(false);
    });

    service.speak("Long text", {
      provider: "speech-synthesis",
      messageId: "long-msg"
    });

    service.setSpeakingMessageId("long-msg");
    expect(service.getSpeakingMessageId()).toBe("long-msg");

    service.stop();

    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
    expect(getMockBridge().stopNative).toHaveBeenCalled();
  });

  // ----- 文本清洗 -----

  it("should return early when text is empty or only markdown symbols", async () => {
    await service.init(createMockKernel());
    await service.speak("*** ___ \"\"", {
      provider: "speech-synthesis",
      messageId: "empty-text"
    });
    // speakNative 不应被调用
    expect(getMockBridge().speakNative).not.toHaveBeenCalled();
    // 状态不应被设置为 speaking
    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
  });

  // ----- AbortSignal 处理 -----

  it("should throw immediately when AbortSignal is already aborted", async () => {
    await service.init(createMockKernel());
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.speak("Hello", { provider: "speech-synthesis" }, controller.signal)
    ).rejects.toThrow("Speech aborted before request started");
    expect(getMockBridge().speakNative).not.toHaveBeenCalled();
  });

  // ----- 原生 TTS 错误路径 -----

  it("should throw when speakNative returns false", async () => {
    await service.init(createMockKernel());
    getMockBridge().speakNative = vi.fn().mockReturnValue(false);
    await expect(
      service.speak("Hello", { provider: "speech-synthesis", messageId: "fail-init" })
    ).rejects.toThrow("Failed to initialize Android Native TTS");
    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
  });

  it("should resolve via silence timeout when TTS never starts speaking", async () => {
    await service.init(createMockKernel());
    // isSpeakingNative 一直返回 false，模拟 TTS 引擎未启动
    getMockBridge().isSpeakingNative = vi.fn().mockReturnValue(false);

    const speakPromise = service.speak("Hello", {
      provider: "speech-synthesis",
      messageId: "silent-timeout"
    });

    // 推进 31 次 setInterval（3100ms）触发 silenceTicks > 30 超时退出
    await vi.advanceTimersByTimeAsync(3100);

    await speakPromise;

    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
  });

  // ----- OpenAI 错误路径 -----

  it("should propagate network error from OpenAI fetch", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("Network failure"));
    global.fetch = fetchSpy;
    await service.init(createMockKernel());

    await expect(
      service.speak("Hello", {
        provider: "openai",
        openaiApiKey: "k",
        openaiBaseUrl: "https://api.openai.com/v1",
        messageId: "net-err"
      })
    ).rejects.toThrow("Network failure");
    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
  });

  it("should throw when OpenAI returns non-ok response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    global.fetch = fetchSpy;
    await service.init(createMockKernel());

    await expect(
      service.speak("Hello", {
        provider: "openai",
        openaiApiKey: "bad-key",
        openaiBaseUrl: "https://api.openai.com/v1",
        messageId: "http-err"
      })
    ).rejects.toThrow("OpenAI TTS request failed with status 401");
    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
  });

  // ----- pause / resume -----

  it("pause() should pause current audio when OpenAI audio is playing", async () => {
    await service.init(createMockKernel());
    const fakeAudio: MockAudioInstance = {
      src: "",
      volume: 1,
      playbackRate: 1,
      listeners: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
    };
    (service as unknown as TtsServiceInternals).currentAudio = fakeAudio;

    service.pause();

    expect(fakeAudio.pause).toHaveBeenCalled();
    // 不应调用 stopNative（因为有 currentAudio）
    expect(getMockBridge().stopNative).not.toHaveBeenCalled();
  });

  it("pause() should call stopNative when no current audio (native TTS path)", async () => {
    await service.init(createMockKernel());
    // currentAudio 为 null
    service.pause();
    expect(getMockBridge().stopNative).toHaveBeenCalled();
  });

  it("resume() should play current audio when set", async () => {
    await service.init(createMockKernel());
    const fakeAudio: MockAudioInstance = {
      src: "",
      volume: 1,
      playbackRate: 1,
      listeners: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    };
    (service as unknown as TtsServiceInternals).currentAudio = fakeAudio;

    service.resume();

    expect(fakeAudio.play).toHaveBeenCalled();
  });

  it("resume() should be a no-op when no current audio (native TTS path)", async () => {
    await service.init(createMockKernel());
    // currentAudio 为 null，原生 TTS 已被 stop 无法恢复
    expect(() => service.resume()).not.toThrow();
  });
});
