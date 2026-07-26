/**
 * TavernArBridge 前端 API 封装单元测试。
 *
 * 覆盖：
 *   - isArSupported 桌面/Android 环境检测
 *   - 桌面环境降级（所有方法不调用 invoke，返回安全默认值）
 *   - Android 环境下 invoke 命令路由正确
 *   - 手势识别 API 路由
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock @tauri-apps/api/core 的 invoke，避免桌面环境导入失败
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// 在导入被测模块前先拿到 mock 引用
import { invoke } from "@tauri-apps/api/core";
import {
  isArSupported,
  checkArAvailability,
  launchAr,
  closeAr,
  updateCharacterTexture,
  updateRenderState,
  updateChatBubble,
  setGestureRecognition,
  checkGestureRecognitionReady,
} from "../../src/services/ar/TavernArBridge";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

/** 模拟 Android WebView 环境：注入 AndroidThemeBridge + __TAURI_INTERNALS__ */
function setAndroidEnv() {
  (window as any).AndroidThemeBridge = { getSafeAreas: () => "{}" };
  (window as any).__TAURI_INTERNALS__ = {};
}

/** 清除 Android 环境标记 */
function clearAndroidEnv() {
  delete (window as any).AndroidThemeBridge;
  delete (window as any).__TAURI_INTERNALS__;
}

describe("TavernArBridge — isArSupported", () => {
  beforeEach(() => clearAndroidEnv());

  it("桌面环境（无 AndroidThemeBridge）返回 false", () => {
    expect(isArSupported()).toBe(false);
  });

  it("有 AndroidThemeBridge 但无 __TAURI_INTERNALS__ 返回 false", () => {
    (window as any).AndroidThemeBridge = {};
    expect(isArSupported()).toBe(false);
  });

  it("Android 环境（两者都有）返回 true", () => {
    setAndroidEnv();
    expect(isArSupported()).toBe(true);
  });
});

describe("TavernArBridge — 桌面环境降级", () => {
  beforeEach(() => {
    clearAndroidEnv();
    mockInvoke.mockClear();
  });

  it("checkArAvailability 桌面返回 unsupported，不调用 invoke", async () => {
    const result = await checkArAvailability();
    expect(result).toBe("unsupported");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("launchAr 桌面返回 error，不调用 invoke", async () => {
    const result = await launchAr();
    expect(result.error).toBe("ar_not_supported_on_desktop");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("closeAr 桌面静默返回，不调用 invoke", async () => {
    await closeAr();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("updateCharacterTexture 桌面静默返回，不调用 invoke", async () => {
    await updateCharacterTexture("base64data");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("updateRenderState 桌面静默返回，不调用 invoke", async () => {
    await updateRenderState("joy", "light1", "light2");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("updateChatBubble 桌面静默返回，不调用 invoke", async () => {
    await updateChatBubble("hello");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("setGestureRecognition 桌面静默返回，不调用 invoke", async () => {
    await setGestureRecognition(true);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("checkGestureRecognitionReady 桌面返回 false，不调用 invoke", async () => {
    const result = await checkGestureRecognitionReady();
    expect(result).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("TavernArBridge — Android 环境 invoke 路由", () => {
  beforeEach(() => {
    setAndroidEnv();
    mockInvoke.mockClear();
  });

  afterEach(() => clearAndroidEnv());

  it("checkArAvailability 调用 plugin:TavernAr|check_ar_availability", async () => {
    mockInvoke.mockResolvedValueOnce({ availability: "supported-installed" });
    const result = await checkArAvailability();
    expect(result).toBe("supported-installed");
    expect(mockInvoke).toHaveBeenCalledWith("plugin:TavernAr|check_ar_availability");
  });

  it("launchAr 调用 plugin:TavernAr|launch_ar 并返回空对象", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const result = await launchAr();
    expect(result).toEqual({});
    expect(mockInvoke).toHaveBeenCalledWith("plugin:TavernAr|launch_ar");
  });

  it("launchAr invoke 抛错时返回 error 字符串", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    const result = await launchAr();
    expect(result.error).toBeTruthy();
  });

  it("closeAr 调用 plugin:TavernAr|close_ar", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await closeAr();
    expect(mockInvoke).toHaveBeenCalledWith("plugin:TavernAr|close_ar");
  });

  it("updateCharacterTexture 传递 base64 参数", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await updateCharacterTexture("data:image/png;base64,xxx");
    expect(mockInvoke).toHaveBeenCalledWith(
      "plugin:TavernAr|update_character_texture",
      { base64: "data:image/png;base64,xxx" }
    );
  });

  it("updateRenderState 传递 emotion + light 参数", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await updateRenderState("joy", "rgba(1,2,3,0.5)", "rgba(4,5,6,0.3)");
    expect(mockInvoke).toHaveBeenCalledWith(
      "plugin:TavernAr|update_render_state",
      { emotion: "joy", light1: "rgba(1,2,3,0.5)", light2: "rgba(4,5,6,0.3)" }
    );
  });

  it("updateChatBubble 传递 text 参数", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await updateChatBubble("你好");
    expect(mockInvoke).toHaveBeenCalledWith(
      "plugin:TavernAr|update_chat_bubble",
      { text: "你好" }
    );
  });

  it("setGestureRecognition 传递 enabled 参数", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await setGestureRecognition(true);
    expect(mockInvoke).toHaveBeenCalledWith(
      "plugin:TavernAr|set_gesture_recognition",
      { enabled: true }
    );
  });

  it("checkGestureRecognitionReady 返回 ready 字段", async () => {
    mockInvoke.mockResolvedValueOnce({ ready: true });
    const result = await checkGestureRecognitionReady();
    expect(result).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("plugin:TavernAr|check_gesture_recognition_ready");
  });

  it("checkGestureRecognitionReady 返回 false 时降级", async () => {
    mockInvoke.mockResolvedValueOnce({ ready: false });
    const result = await checkGestureRecognitionReady();
    expect(result).toBe(false);
  });
});
