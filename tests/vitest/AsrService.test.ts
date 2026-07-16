/**
 * AsrService 单元测试
 *
 * 覆盖生命周期（init/destroy）、状态查询（isListening）、
 * web-speech provider 路径、stopListening/cancelListening
 * OpenAI Whisper 路径因依赖 MediaRecorder 仅测试错误降级
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsrService } from "../../src/kernel/services/AsrService";
import type { AsrConfig, IKernel } from "../../src/kernel/types";

/**
 * 测试专用 Mock 类型定义。
 * 这些类型仅在本测试文件内用于替代 `as any`，确保类型安全的同时保持运行时行为不变。
 */

/** Mock 的 SpeechRecognition 实例类型（与 AsrService 内部 SpeechRecognitionLike 接口对齐）。 */
interface MockSpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

/** Mock 的 SpeechRecognition 构造函数签名。 */
interface MockSpeechRecognitionConstructor {
  new (): MockSpeechRecognitionInstance;
}

/** 携带 SpeechRecognition 构造器的 window mock 类型。 */
interface MockWindowWithSpeechRecognition extends Window {
  SpeechRecognition?: MockSpeechRecognitionConstructor;
  webkitSpeechRecognition?: MockSpeechRecognitionConstructor;
}

/**
 * 构造最小 IKernel mock。
 * AsrService.init/destroy 仅持有引用而不调用任何 kernel 方法，
 * 故空对象足以满足接口契约；通过 `as unknown as IKernel` 完成精确类型断言。
 */
function createMockKernel(): IKernel {
  return {} as unknown as IKernel;
}

/**
 * 构造测试用 AsrConfig。
 * `enabled` 字段在 AsrService.startListening 实现中未被读取，
 * 此处补全为 false 仅用于满足 AsrConfig 接口契约，不改变运行时行为。
 */
function createMockAsrConfig(
  provider: "web-speech" | "openai" = "web-speech",
  language = "zh-CN"
): AsrConfig {
  return {
    enabled: false,
    provider,
    language,
  };
}

/** 构造并返回 Mock SpeechRecognition 实例工厂（vi.fn 包装的构造器）。 */
function createMockSpeechRecognitionConstructor(): ReturnType<typeof vi.fn> {
  return vi.fn(() => ({
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
}

describe("AsrService tests", () => {
  let service: AsrService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new AsrService();
    // 确保 AsrService 中的 tauriFetch 检测不会出错
    global.window = {} as unknown as typeof window;
  });

  it("初始化成功", async () => {
    await service.init(createMockKernel());
    expect(service.isListening()).toBe(false);
  });

  it("销毁后状态正确", async () => {
    await service.init(createMockKernel());
    await service.destroy(createMockKernel());
    expect(service.isListening()).toBe(false);
  });

  it("init 时传入已 abort 的 signal 立即生效", async () => {
    const controller = new AbortController();
    controller.abort();
    await service.init(createMockKernel(), controller.signal);
    // 不应崩溃
  });

  it("init 时传入 signal 后再 abort 不崩溃", async () => {
    const controller = new AbortController();
    await service.init(createMockKernel(), controller.signal);
    controller.abort();
    // 不应崩溃
  });

  it("cancelListening 重置状态", async () => {
    await service.init(createMockKernel());
    service.cancelListening();
    expect(service.isListening()).toBe(false);
  });

  it("stopListening 未开始时不崩溃", async () => {
    await service.init(createMockKernel());
    service.stopListening();
    expect(service.isListening()).toBe(false);
  });

  it("web-speech provider 不支持时抛出错误", async () => {
    await service.init(createMockKernel());
    // 不提供 SpeechRecognition / webkitSpeechRecognition
    await expect(
      service.startListening(
        createMockAsrConfig("web-speech"),
        vi.fn(),
        vi.fn(),
        vi.fn()
      )
    ).rejects.toThrow("Speech recognition is not supported");
  });

  it("web-speech provider 支持时正确启动", async () => {
    const mockRecognition = createMockSpeechRecognitionConstructor();

    global.window = {
      SpeechRecognition: mockRecognition as unknown as MockSpeechRecognitionConstructor,
    } as unknown as typeof window & MockWindowWithSpeechRecognition;

    await service.init(createMockKernel());
    const onResult = vi.fn();
    await service.startListening(
      createMockAsrConfig("web-speech"),
      onResult,
      vi.fn(),
      vi.fn()
    );
    expect(service.isListening()).toBe(true);

    // 模拟识别结果
    const instance = mockRecognition.mock.results[0].value as MockSpeechRecognitionInstance;
    instance.onresult!({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "你好世界" } }],
    });
    expect(onResult).toHaveBeenCalledWith("你好世界", true);
  });

  it("web-speech 识别错误触发 onError", async () => {
    const mockRecognition = createMockSpeechRecognitionConstructor();

    global.window = {
      SpeechRecognition: mockRecognition as unknown as MockSpeechRecognitionConstructor,
    } as unknown as typeof window & MockWindowWithSpeechRecognition;

    await service.init(createMockKernel());
    const onError = vi.fn();
    const onEnd = vi.fn();
    await service.startListening(
      createMockAsrConfig("web-speech"),
      vi.fn(),
      onError,
      onEnd
    );

    const instance = mockRecognition.mock.results[0].value as MockSpeechRecognitionInstance;
    instance.onerror!({ error: "network" });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onEnd).toHaveBeenCalled();
  });

  it("startListening 时若已在监听则先取消", async () => {
    const mockRecognition = createMockSpeechRecognitionConstructor();

    global.window = {
      SpeechRecognition: mockRecognition as unknown as MockSpeechRecognitionConstructor,
    } as unknown as typeof window & MockWindowWithSpeechRecognition;

    await service.init(createMockKernel());
    await service.startListening(
      createMockAsrConfig("web-speech"),
      vi.fn(),
      vi.fn(),
      vi.fn()
    );
    // 再次启动应先取消旧的
    await service.startListening(
      createMockAsrConfig("web-speech"),
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
      SpeechRecognition: mockRecognition as unknown as MockSpeechRecognitionConstructor,
    } as unknown as typeof window & MockWindowWithSpeechRecognition;

    await service.init(createMockKernel());
    await service.startListening(
      createMockAsrConfig("web-speech"),
      vi.fn(),
      vi.fn(),
      vi.fn()
    );
    service.stopListening();
    expect(mockStop).toHaveBeenCalled();
  });

  it("openai provider 在无 mediaDevices 时抛出错误", async () => {
    await service.init(createMockKernel());
    global.navigator = {} as unknown as Navigator;
    await expect(
      service.startListening(
        createMockAsrConfig("openai"),
        vi.fn(),
        vi.fn(),
        vi.fn()
      )
    ).rejects.toThrow("Microphone recording is not supported");
  });
});
