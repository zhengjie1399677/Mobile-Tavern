import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtsService } from "../../src/kernel/services/TtsService";

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
    } as any;

    // Mock HTMLAudioElement / Audio (used by OpenAI provider path)
    const mockAudio = function (this: any, url: string) {
      this.src = url;
      this.volume = 1;
      this.playbackRate = 1;
      this.listeners = {} as Record<string, Function[]>;
      this.addEventListener = (event: string, callback: Function) => {
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(callback);
      };
      this.removeEventListener = (event: string, callback: Function) => {
        if (this.listeners[event]) {
          this.listeners[event] = this.listeners[event].filter((cb: any) => cb !== callback);
        }
      };
      this.play = vi.fn().mockImplementation(() => {
        setTimeout(() => {
          if (this.listeners["ended"]) {
            this.listeners["ended"].forEach((cb: any) => cb());
          }
        }, 10);
        return Promise.resolve();
      });
      this.pause = vi.fn();
    };

    global.Audio = mockAudio as any;
    global.URL = {
      createObjectURL: vi.fn().mockReturnValue("blob:mock-audio-url"),
      revokeObjectURL: vi.fn()
    } as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize and destroy successfully", async () => {
    await service.init({} as any);
    expect(service.name).toBe("tts");
    await service.destroy({} as any);
  });

  it("should successfully read aloud via Android native TTS bridge", async () => {
    await service.init({} as any);

    // 第一次 isSpeakingNative 返回 true（开始播放），之后返回 false（结束）
    let pollCount = 0;
    (global.window as any).AndroidThemeBridge.isSpeakingNative = vi.fn(() => {
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
    expect((window as any).AndroidThemeBridge.speakNative).toHaveBeenCalledWith("Hello test", 1.2, 0.9);
  });

  it("should throw when Android native TTS bridge is not available", async () => {
    await service.init({} as any);

    // 移除桥，模拟非安卓环境
    delete (global.window as any).AndroidThemeBridge;

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
    await service.init({} as any);
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
    await service.init({} as any);

    // 一直返回 true，避免 setInterval 自动触发完成
    (global.window as any).AndroidThemeBridge.isSpeakingNative = vi.fn().mockReturnValue(true);
    // stopNative 调用后，同步让 isSpeakingNative 返回 false（模拟真实 Android 行为）
    (global.window as any).AndroidThemeBridge.stopNative = vi.fn(() => {
      (global.window as any).AndroidThemeBridge.isSpeakingNative = vi.fn().mockReturnValue(false);
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
    expect((window as any).AndroidThemeBridge.stopNative).toHaveBeenCalled();
  });
});
