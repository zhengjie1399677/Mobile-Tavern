/**
 * AsrService 单元测试
 *
 * 覆盖生命周期（init/destroy）、状态查询（isListening）、
 * web-speech provider 路径、stopListening/cancelListening
 * OpenAI Whisper 路径因依赖 MediaRecorder 仅测试错误降级
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsrService } from "../../src/kernel/services/AsrService";

describe("AsrService tests", () => {
  let service: AsrService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new AsrService();
    // 确保 AsrService 中的 tauriFetch 检测不会出错
    global.window = {} as any;
  });

  it("初始化成功", async () => {
    await service.init({} as any);
    expect(service.isListening()).toBe(false);
  });

  it("销毁后状态正确", async () => {
    await service.init({} as any);
    await service.destroy({} as any);
    expect(service.isListening()).toBe(false);
  });

  it("init 时传入已 abort 的 signal 立即生效", async () => {
    const controller = new AbortController();
    controller.abort();
    await service.init({} as any, controller.signal);
    // 不应崩溃
  });

  it("init 时传入 signal 后再 abort 不崩溃", async () => {
    const controller = new AbortController();
    await service.init({} as any, controller.signal);
    controller.abort();
    // 不应崩溃
  });

  it("cancelListening 重置状态", async () => {
    await service.init({} as any);
    service.cancelListening();
    expect(service.isListening()).toBe(false);
  });

  it("stopListening 未开始时不崩溃", async () => {
    await service.init({} as any);
    service.stopListening();
    expect(service.isListening()).toBe(false);
  });

  it("web-speech provider 不支持时抛出错误", async () => {
    await service.init({} as any);
    // 不提供 SpeechRecognition / webkitSpeechRecognition
    await expect(
      service.startListening(
        { provider: "web-speech", language: "zh-CN" } as any,
        vi.fn(),
        vi.fn(),
        vi.fn()
      )
    ).rejects.toThrow("Speech recognition is not supported");
  });

  it("web-speech provider 支持时正确启动", async () => {
    const mockRecognition = vi.fn(() => ({
      lang: "",
      interimResults: false,
      continuous: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    }));

    global.window = {
      SpeechRecognition: mockRecognition,
    } as any;

    await service.init({} as any);
    const onResult = vi.fn();
    await service.startListening(
      { provider: "web-speech", language: "zh-CN" } as any,
      onResult,
      vi.fn(),
      vi.fn()
    );
    expect(service.isListening()).toBe(true);

    // 模拟识别结果
    const instance = mockRecognition.mock.results[0].value;
    instance.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "你好世界" } }],
    });
    expect(onResult).toHaveBeenCalledWith("你好世界", true);
  });

  it("web-speech 识别错误触发 onError", async () => {
    const mockRecognition = vi.fn(() => ({
      lang: "",
      interimResults: false,
      continuous: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    }));

    global.window = {
      SpeechRecognition: mockRecognition,
    } as any;

    await service.init({} as any);
    const onError = vi.fn();
    const onEnd = vi.fn();
    await service.startListening(
      { provider: "web-speech", language: "zh-CN" } as any,
      vi.fn(),
      onError,
      onEnd
    );

    const instance = mockRecognition.mock.results[0].value;
    instance.onerror({ error: "network" });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onEnd).toHaveBeenCalled();
  });

  it("startListening 时若已在监听则先取消", async () => {
    const mockRecognition = vi.fn(() => ({
      lang: "",
      interimResults: false,
      continuous: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    }));

    global.window = {
      SpeechRecognition: mockRecognition,
    } as any;

    await service.init({} as any);
    await service.startListening(
      { provider: "web-speech", language: "zh-CN" } as any,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );
    // 再次启动应先取消旧的
    await service.startListening(
      { provider: "web-speech", language: "zh-CN" } as any,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );
    expect(mockRecognition).toHaveBeenCalledTimes(2);
    expect(service.isListening()).toBe(true);
  });

  it("stopListening 停止活跃的识别", async () => {
    const mockStop = vi.fn();
    const mockRecognition = vi.fn(() => ({
      lang: "",
      interimResults: false,
      continuous: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: mockStop,
      abort: vi.fn(),
    }));

    global.window = {
      SpeechRecognition: mockRecognition,
    } as any;

    await service.init({} as any);
    await service.startListening(
      { provider: "web-speech", language: "zh-CN" } as any,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );
    service.stopListening();
    expect(mockStop).toHaveBeenCalled();
  });

  it("openai provider 在无 mediaDevices 时抛出错误", async () => {
    await service.init({} as any);
    global.navigator = {} as any;
    await expect(
      service.startListening(
        { provider: "openai", language: "zh-CN" } as any,
        vi.fn(),
        vi.fn(),
        vi.fn()
      )
    ).rejects.toThrow("Microphone recording is not supported");
  });
});
