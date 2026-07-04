import { describe, it, expect, vi, beforeEach } from "vitest";
import { TtsService } from "../../src/kernel/services/TtsService";

describe("TtsService tests", () => {
  let service: TtsService;

  beforeEach(() => {
    service = new TtsService();
    vi.restoreAllMocks();

    // Mock SpeechSynthesis in global window
    const mockSpeechSynthesis = {
      speak: vi.fn((utterance) => {
        // Simulate end event asynchronously
        setTimeout(() => {
          if (utterance.onend) {
            utterance.onend({} as any);
          }
          const event = new Event("end");
          utterance.dispatchEvent(event);
        }, 10);
      }),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      speaking: false,
      getVoices: vi.fn().mockReturnValue([
        { name: "VoiceA", lang: "zh-CN" },
        { name: "VoiceB", lang: "en-US" }
      ])
    };

    const mockUtterance = function(this: any, text: string) {
      this.text = text;
      this.volume = 1;
      this.rate = 1;
      this.pitch = 1;
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
      this.dispatchEvent = (event: Event) => {
        if (this.listeners[event.type]) {
          this.listeners[event.type].forEach((cb: any) => cb(event));
        }
      };
    };

    global.window = {
      speechSynthesis: mockSpeechSynthesis,
    } as any;
    global.SpeechSynthesisUtterance = mockUtterance as any;

    // Mock HTMLAudioElement / Audio
    const mockAudio = function(this: any, url: string) {
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
        // Simulate audio ending
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

  it("should initialize and destroy successfully", async () => {
    await service.init({} as any);
    expect(service.name).toBe("tts");
    await service.destroy({} as any);
  });

  it("should successfully read aloud via browser SpeechSynthesis", async () => {
    await service.init({} as any);
    const speakPromise = service.speak("Hello test", {
      provider: "speech-synthesis",
      volume: 0.8,
      rate: 1.2,
      pitch: 0.9,
      voiceName: "VoiceB",
      messageId: "test-msg-1"
    });

    expect(service.isSpeaking()).toBe(true);
    expect(service.getSpeakingMessageId()).toBe("test-msg-1");

    await speakPromise;

    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });

  it("should successfully call OpenAI API and play audio element", async () => {
    const mockResponse = new Uint8Array([1, 2, 3]);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockResponse.buffer,
    });
    global.fetch = fetchSpy;

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
    
    // Trigger infinite/long speech mock (stub end simulation to happen only when cancelled)
    window.speechSynthesis.speak = vi.fn(); // Suppress auto end
    
    service.speak("Long text", {
      provider: "speech-synthesis",
      messageId: "long-msg"
    });

    service.setSpeakingMessageId("long-msg");
    expect(service.getSpeakingMessageId()).toBe("long-msg");

    service.stop();

    expect(service.isSpeaking()).toBe(false);
    expect(service.getSpeakingMessageId()).toBeNull();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });
});
