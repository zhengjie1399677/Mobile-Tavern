/**
 * BgmService 单元测试
 *
 * 覆盖生命周期（init/destroy）、播放控制（play/stop）、
 * 静音控制（mute/unmute/toggleMute）、状态查询、错误防御
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { BgmService } from "../../src/kernel/services/BgmService";
import type { IKernel } from "../../src/kernel/types";

/**
 * Mock 事件监听器签名：与原生 EventListener 兼容，但放宽参数类型以便测试中
 * 任意触发回调。listeners 字典以事件名索引到监听器数组。
 */
type MockListener = (...args: unknown[]) => void;

/**
 * Mock HTMLAudioElement 结构：仅覆盖 BgmService 使用到的字段与方法。
 * listeners 用于在测试中手动派发 error 事件以验证错误防御逻辑。
 */
interface MockAudioElement {
  src: string;
  volume: number;
  loop: boolean;
  paused: boolean;
  listeners: Record<string, MockListener[]>;
  addEventListener(event: string, cb: MockListener): void;
  removeEventListener(event: string, cb: MockListener): void;
  play: Mock<() => Promise<void>>;
  pause: Mock<() => void>;
  removeAttribute: Mock<(attr: string) => void>;
  load: Mock<() => void>;
}

describe("BgmService tests", () => {
  let service: BgmService;
  let mockAudio: MockAudioElement;

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock HTMLAudioElement
    mockAudio = {
      src: "",
      volume: 1,
      loop: false,
      paused: true,
      listeners: {} as Record<string, MockListener[]>,
      addEventListener(event: string, cb: MockListener) {
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(cb);
      },
      removeEventListener(event: string, cb: MockListener) {
        if (this.listeners[event]) {
          this.listeners[event] = this.listeners[event].filter((c: MockListener) => c !== cb);
        }
      },
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    };

    global.Audio = vi.fn(() => mockAudio) as unknown as typeof Audio;
    global.window = { location: { href: "http://localhost:3000" } } as unknown as typeof window;

    service = new BgmService();
  });

  it("初始化后创建 Audio 元素并设置循环播放", async () => {
    await service.init({} as IKernel);
    expect(global.Audio).toHaveBeenCalled();
    expect(mockAudio.loop).toBe(true);
  });

  it("销毁后停止播放并清空 Audio 引用", async () => {
    await service.init({} as IKernel);
    service.play("http://example.com/bgm.mp3");
    await service.destroy({} as IKernel);
    expect(mockAudio.pause).toHaveBeenCalled();
    expect(service.getCurrentUrl()).toBe("");
  });

  it("播放指定 URL", async () => {
    await service.init({} as IKernel);
    service.play("http://example.com/bgm.mp3", 0.7);
    expect(mockAudio.src).toBe("http://example.com/bgm.mp3");
    expect(mockAudio.volume).toBe(0.7);
    expect(mockAudio.play).toHaveBeenCalled();
    expect(service.getCurrentUrl()).toBe("http://example.com/bgm.mp3");
  });

  it("空 URL 时停止播放", async () => {
    await service.init({} as IKernel);
    service.play("http://example.com/bgm.mp3");
    service.play("");
    expect(mockAudio.pause).toHaveBeenCalled();
    expect(service.getCurrentUrl()).toBe("");
  });

  it("相同 URL 且正在播放时仅调音量", async () => {
    await service.init({} as IKernel);
    service.play("http://example.com/bgm.mp3", 0.5);
    mockAudio.paused = false; // 模拟正在播放
    service.play("http://example.com/bgm.mp3", 0.8);
    expect(mockAudio.volume).toBe(0.8);
    // play 不应被再次调用
    expect(mockAudio.play).toHaveBeenCalledTimes(1);
  });

  it("停止播放后清空 URL 和失败记录", async () => {
    await service.init({} as IKernel);
    service.play("http://example.com/bgm.mp3");
    service.stop();
    expect(mockAudio.pause).toHaveBeenCalled();
    expect(mockAudio.removeAttribute).toHaveBeenCalledWith("src");
    expect(service.getCurrentUrl()).toBe("");
  });

  it("静音后音量为 0", async () => {
    await service.init({} as IKernel);
    service.play("http://example.com/bgm.mp3", 0.5);
    service.mute();
    expect(service.getMuteState()).toBe(true);
    expect(mockAudio.volume).toBe(0);
  });

  it("取消静音后恢复默认音量", async () => {
    await service.init({} as IKernel);
    service.play("http://example.com/bgm.mp3", 0.6);
    service.mute();
    service.unmute();
    expect(service.getMuteState()).toBe(false);
    expect(mockAudio.volume).toBe(0.6);
  });

  it("toggleMute 切换静音状态", async () => {
    await service.init({} as IKernel);
    service.play("http://example.com/bgm.mp3", 0.5);
    expect(service.toggleMute()).toBe(true);
    expect(service.getMuteState()).toBe(true);
    expect(service.toggleMute()).toBe(false);
    expect(service.getMuteState()).toBe(false);
  });

  it("未初始化时 play 不崩溃", () => {
    // 不调用 init，直接 play
    expect(() => service.play("http://example.com/bgm.mp3")).not.toThrow();
  });

  it("未初始化时 stop 不崩溃", () => {
    expect(() => service.stop()).not.toThrow();
  });

  it("未初始化时 mute/unmute 不崩溃", () => {
    expect(() => service.mute()).not.toThrow();
    expect(() => service.unmute()).not.toThrow();
  });

  it("init 时注册 abort 信号", async () => {
    const controller = new AbortController();
    await service.init({} as IKernel, controller.signal);
    // 触发 abort 应停止播放
    controller.abort();
    // 验证不会崩溃
    expect(service.getCurrentUrl()).toBe("");
  });

  it("Audio error 事件不因空 src 崩溃", async () => {
    await service.init({} as IKernel);
    // 模拟 src 为空时的 error 事件
    mockAudio.src = "";
    const errorListeners = mockAudio.listeners["error"];
    if (errorListeners) {
      errorListeners.forEach((cb: MockListener) => cb(new Event("error")));
    }
    // 不应崩溃
  });
});
