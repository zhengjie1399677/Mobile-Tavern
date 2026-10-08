/**
 * TelemetryService 遥测日志完整性单元测试。
 *
 * 覆盖：
 *   - 活跃归属上下文（玩家/角色/模型/会话）自动附加到所有事件
 *   - 事件显式传参优先于上下文，未设置上下文时保持既有兜底值
 *   - 诊断类事件的自定义字段（键盘视口尺寸等）完整送达 Rust 侧
 *   - 固定 schema 列不会被事件载荷覆盖
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock @tauri-apps/api/core 的 invoke，捕获前端最终上报的日志体
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { invoke } from "@tauri-apps/api/core";
import { TelemetryService } from "../../src/application/services/TelemetryService";

interface TauriTestWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

/** 打开 Tauri 分支，使 reportUsage 真正走到 invoke，而不是本地 debug 日志。 */
function enableTauriBridge(): void {
  (window as TauriTestWindow).__TAURI_INTERNALS__ = {};
}

/** 读取最近一次上报给 Rust 的日志体。 */
function lastReportedLog(): Record<string, unknown> {
  const calls = vi.mocked(invoke).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [command, payload] = calls[calls.length - 1] as [string, { log: Record<string, unknown> }];
  expect(command).toBe("report_telemetry");
  return payload.log;
}

describe("遥测日志完整性与归属上下文 (telemetryService)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    enableTauriBridge();
    // 归属上下文是模块级共享状态，逐用例重置，避免用例间串味。
    new TelemetryService().setContext({});
  });

  afterEach(() => {
    delete (window as TauriTestWindow).__TAURI_INTERNALS__;
  });

  it("setContext 后所有事件自动携带玩家、角色、模型与会话", () => {
    const service = new TelemetryService();
    service.setContext({
      playerName: "旅人",
      characterName: "阿尔法",
      modelName: "deepseek-chat",
      sessionId: "session-1",
    });

    service.reportUsage("keyboard_viewport_diagnostic", {
      vvp_height: 812.5,
      window_height: 900,
      height_diff: 87.5,
      is_keyboard_open: true,
    });

    const log = lastReportedLog();
    expect(log.action).toBe("keyboard_viewport_diagnostic");
    expect(log.player_name).toBe("旅人");
    expect(log.character_name).toBe("阿尔法");
    expect(log.model).toBe("deepseek-chat");
    expect(log.session_id).toBe("session-1");
    // 诊断现场字段必须一并到达 Rust，否则事件只剩空骨架。
    expect(log.vvp_height).toBe(812.5);
    expect(log.height_diff).toBe(87.5);
    expect(log.is_keyboard_open).toBe(true);
  });

  it("事件显式传参优先于活跃上下文", () => {
    const service = new TelemetryService();
    service.setContext({ playerName: "旅人", characterName: "旧角色", sessionId: "old" });

    service.reportUsage("send_message", {
      modelName: "gpt-x",
      characterName: "新角色",
      sessionId: "new",
      traceId: "trace-1",
    });

    const log = lastReportedLog();
    expect(log.player_name).toBe("旅人");
    expect(log.character_name).toBe("新角色");
    expect(log.model).toBe("gpt-x");
    expect(log.session_id).toBe("new");
    expect(log.trace_id).toBe("trace-1");
  });

  it("未设置上下文时保持既有兜底值，不出现字段缺失", () => {
    const service = new TelemetryService();

    service.reportUsage("app_launch");

    const log = lastReportedLog();
    expect(log.player_name).toBe("未知");
    expect(log.character_name).toBe("未知");
    expect(log.model).toBe("");
    expect(log.session_id).toBe("无");
  });

  it("setContext 为覆盖式写入，不残留已失效角色", () => {
    const service = new TelemetryService();
    service.setContext({ characterName: "旧角色", sessionId: "old" });
    service.setContext({ playerName: "旅人" });

    service.reportUsage("app_launch");

    const log = lastReportedLog();
    expect(log.character_name).toBe("未知");
    expect(log.session_id).toBe("无");
    expect(log.player_name).toBe("旅人");
  });

  it("固定 schema 列不会被事件载荷覆盖", () => {
    const service = new TelemetryService();

    service.reportUsage("send_message", {
      action: "伪造动作",
      platform: "伪造平台",
      detail: "真实详情",
    });

    const log = lastReportedLog();
    expect(log.action).toBe("send_message");
    expect(log.platform).toBe("Tauri");
    expect(log.detail).toBe("真实详情");
  });

  it("上报设备平台串与聊天会话起始时间，且与 App 进程会话字段区分开", () => {
    const service = new TelemetryService();
    service.setContext({
      characterName: "阿尔法",
      chatSessionStartedAt: Date.UTC(2026, 9, 8, 7, 55, 44),
    });

    service.reportUsage("send_message", { modelName: "gpt-x" });

    const log = lastReportedLog();
    expect(log.device_platform).toBe(window.navigator.platform);
    expect(log.chat_session_started_at).toBe("2026-10-08T07:55:44.000Z");
    expect(log.platform).toBe("Tauri");
  });

  it("上下文跨实例共享：启动早期的兜底实例不丢归属信息", () => {
    new TelemetryService().setContext({ playerName: "旅人", characterName: "阿尔法" });
    // 模拟 utils/telemetry 在 Kernel 尚未注册遥测服务时创建的独立兜底实例。
    const fallbackInstance = new TelemetryService();

    fallbackInstance.reportUsage("app_instant_launch");

    const log = lastReportedLog();
    expect(log.player_name).toBe("旅人");
    expect(log.character_name).toBe("阿尔法");
  });
});
