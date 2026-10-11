import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AsrService } from "../../src/application/services/AsrService";
import type { AsrConfig, IKernel } from "@/src/application/serviceContracts";

/**
 * 构造最小 IKernel mock。
 * AsrService.init/destroy 仅持有引用而不调用任何 kernel 方法，
 * 故空对象足以满足接口契约；通过 `as unknown as IKernel` 完成精确类型断言。
 */
function createMockKernel(): IKernel {
  return {} as unknown as IKernel;
}

function createMockAsrConfig(
  provider: "web-speech" | "openai" = "openai",
  overrides: Partial<AsrConfig> = {},
): AsrConfig {
  return {
    enabled: true,
    provider,
    language: "zh-CN",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "whisper-1",
    ...overrides,
  };
}

function audioBlob(type = "audio/wav"): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])], { type });
}

describe("AsrService 文件转写", () => {
  let service: AsrService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new AsrService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("初始化成功", async () => {
    await service.init(createMockKernel());
    expect(service.name).toBe("asr");
  });

  it("销毁后状态正确", async () => {
    await service.init(createMockKernel());
    await service.destroy(createMockKernel());
    expect(service.isCritical).toBe(false);
  });

  it("init 时传入已 abort 的 signal 立即生效", async () => {
    const controller = new AbortController();
    controller.abort();
    await service.init(createMockKernel(), controller.signal);
    expect(controller.signal.aborted).toBe(true);
  });

  it("init 时传入 signal 后再 abort 不崩溃", async () => {
    const controller = new AbortController();
    await service.init(createMockKernel(), controller.signal);
    expect(() => controller.abort()).not.toThrow();
  });

  it("拒绝非 OpenAI provider（实时听写已下线，只有文件转写一条路）", async () => {
    await service.init(createMockKernel());
    await expect(
      service.transcribeFile(audioBlob(), "a.wav", createMockAsrConfig("web-speech")),
    ).rejects.toThrow("ASR_FILE_PROVIDER_UNSUPPORTED");
  });

  it("拒绝空音频或非音频类型", async () => {
    await service.init(createMockKernel());
    await expect(
      service.transcribeFile(new Blob([], { type: "audio/wav" }), "a.wav", createMockAsrConfig()),
    ).rejects.toThrow("ASR_FILE_INVALID");
    await expect(
      service.transcribeFile(new Blob([new Uint8Array([1])], { type: "text/plain" }), "a.txt", createMockAsrConfig()),
    ).rejects.toThrow("ASR_FILE_INVALID");
  });

  it("上传到 /audio/transcriptions 并返回转写文本", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "你好世界" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await service.init(createMockKernel());

    const transcript = await service.transcribeFile(
      audioBlob(),
      "voice-input.wav",
      createMockAsrConfig("openai", { openaiApiKey: "sk-test" }),
    );

    expect(transcript).toBe("你好世界");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = init.body as FormData;
    expect(body.get("model")).toBe("whisper-1");
    expect(body.get("language")).toBe("zh-CN");
  });

  it("服务端非 2xx 时抛出带状态码的错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    await service.init(createMockKernel());

    await expect(
      service.transcribeFile(audioBlob(), "a.wav", createMockAsrConfig()),
    ).rejects.toThrow(/status 400/);
  });

  it("响应缺少 text 字段时判定为响应无效", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    await service.init(createMockKernel());

    await expect(
      service.transcribeFile(audioBlob(), "a.wav", createMockAsrConfig()),
    ).rejects.toThrow("ASR_RESPONSE_INVALID");
  });
});
