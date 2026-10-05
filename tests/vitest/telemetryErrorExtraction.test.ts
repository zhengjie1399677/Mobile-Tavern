import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getErrorMessage, getErrorDetail } from "../../src/utils/errorUtils";
import { TelemetryService } from "../../src/application/services/TelemetryService";
import { installGlobalErrorHandlers, reportImmediate } from "../../src/utils/telemetry";

describe("错误萃取与遥测 detail 完整性 (telemetryErrorExtraction)", () => {
  describe("getErrorMessage", () => {
    it("正确提取标准 Error 消息", () => {
      const err = new Error("数据库连接失败");
      expect(getErrorMessage(err)).toBe("数据库连接失败");
    });

    it("空 message 的 Error 自动回退为 error.name 避免返回空字符串", () => {
      const err = new TypeError("");
      expect(getErrorMessage(err)).toBe("TypeError");
    });

    it("直接支持字符串、null 和 undefined", () => {
      expect(getErrorMessage("直接抛出字符串")).toBe("直接抛出字符串");
      expect(getErrorMessage(null)).toBe("null");
      expect(getErrorMessage(undefined)).toBe("undefined");
    });

    it("提取普通对象中的 message 字段", () => {
      const obj = { message: "网络波动无法连通" };
      expect(getErrorMessage(obj)).toBe("网络波动无法连通");
    });

    it("提取普通对象中的 error 字段", () => {
      const obj = { error: "Insufficient Balance" };
      expect(getErrorMessage(obj)).toBe("Insufficient Balance");
    });

    it("提取嵌套 Provider 风格的 error.message", () => {
      const obj = {
        error: {
          message: "Prompt blocked by Gemini safety policy",
          code: 400,
        },
      };
      expect(getErrorMessage(obj)).toBe("Prompt blocked by Gemini safety policy");
    });

    it("提取 HTTP 状态与状态文本", () => {
      const httpErr = { status: 502, statusText: "Bad Gateway" };
      expect(getErrorMessage(httpErr)).toBe("HTTP 502 Bad Gateway");
    });

    it("普通复杂对象自动序列化为 JSON 摘要而非 [object Object]", () => {
      const unknownObj = { code: "ERR_CUSTOM", retryAfter: 30 };
      const msg = getErrorMessage(unknownObj);
      expect(msg).toContain("ERR_CUSTOM");
      expect(msg).not.toBe("[object Object]");
    });
  });

  describe("getErrorDetail", () => {
    it("组合 message 与 stack", () => {
      const err = new Error("测试异常");
      err.stack = "Error: 测试异常\n    at test.ts:10:5";
      const detail = getErrorDetail(err);
      expect(detail).toContain("测试异常");
      expect(detail).toContain("test.ts:10:5");
    });
  });

  describe("TelemetryService.buildLog 智能提取", () => {
    let service: TelemetryService;

    beforeEach(() => {
      service = new TelemetryService();
    });

    it("当未显式传递 detail 时，从 reason 与 stack 自动提取，杜绝空字符串", () => {
      const buildLogFn = (service as any).buildLog.bind(service);
      const log = buildLogFn("window_unhandled_rejection", {
        reason: "Promise rejected without reason",
        stack: "Error: at line 42",
      });
      expect(log.detail).toContain("Promise rejected without reason");
      expect(log.detail).toContain("Stack: Error: at line 42");
    });

    it("当传递 message、filename、lineno 时自动拼装结构化 detail", () => {
      const buildLogFn = (service as any).buildLog.bind(service);
      const log = buildLogFn("window_uncaught_error", {
        message: "Uncaught ReferenceError: foo is not defined",
        filename: "bundle.js",
        lineno: 100,
        colno: 12,
        stack: "ReferenceError: foo is not defined at bundle.js:100:12",
      });
      expect(log.detail).toContain("Uncaught ReferenceError");
      expect(log.detail).toContain("bundle.js:100:12");
      expect(log.detail).toContain("Stack: ReferenceError");
    });

    it("当显式传递 detail 时保留并可追加 stack", () => {
      const buildLogFn = (service as any).buildLog.bind(service);
      const log = buildLogFn("api_error", {
        detail: "HTTP 500 Internal Server Error",
        stack: "at fetch (apiClient.ts:40)",
      });
      expect(log.detail).toContain("HTTP 500 Internal Server Error");
      expect(log.detail).toContain("Stack: at fetch (apiClient.ts:40)");
    });
  });
});
