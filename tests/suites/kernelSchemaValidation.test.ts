/**
 * Kernel zod L2 Phase B：Schema 单元测试
 *
 * 验证 validateService / validateMessage / validateServiceRetrieval 三个纯函数
 * 在真实形状与伪造（缺字段/错类型）输入下的行为正确性。
 *
 * 设计原则：
 *   - 不实例化 Kernel，直接调用 validate* 函数（Phase B 未接入 Kernel.ts）
 *   - 10 项主断言覆盖所有 schema 分支：P0 通过/失败、P1 通过/失败、静态 topic 通过/失败、
 *     动态 topic skip、缺顶层字段失败、SafeProxy skip、真实 P0 服务通过
 *   - 2 项边界断言验证 null / undefined 输入不抛错
 *
 * Phase C 落地后可在同文件追加 8 项集成测试（Kernel 真实接入后的三态行为）。
 */

import {
  validateService,
  validateMessage,
  validateServiceRetrieval,
  SAFE_PROXY_SYMBOL,
  type ValidationResult,
} from "../../src/kernel/schemas";
import { assert } from "./testUtils";

/**
 * 校验失败的窄化类型，便于直接访问 error / summary 字段。
 */
type ValidationFailure = Extract<ValidationResult, { success: false }>;

/**
 * 断言校验结果为失败，并返回窄化后的 failure 对象供后续检查。
 */
const expectFailure = (r: ValidationResult, label: string): ValidationFailure => {
  assert(r.success === false, `${label}: 期望校验失败但成功了`);
  return r as ValidationFailure;
};

export async function testKernelSchemaValidation() {
  console.log("\n--- Running Kernel Schema Validation (Phase B unit tests) ---");

  // === 用例 1：validateService P0 ChatStream 合法 → success ===
  {
    const validChatStream = {
      name: "chatStream",
      init() {},
      streamLlmResponse: async function* () {
        yield { content: "" };
      },
    };
    const r = validateService("chatStream", validChatStream);
    assert(r.success === true, "用例1: P0 ChatStream 合法服务应通过校验");
  }

  // === 用例 2：validateService P0 缺方法 → failure，error 含方法名 ===
  {
    const missingMethod = {
      name: "chatStream",
      init() {},
      // 缺 streamLlmResponse
    };
    const r = expectFailure(validateService("chatStream", missingMethod), "用例2");
    assert(
      r.summary.includes("chatStream"),
      "用例2: 失败摘要应包含服务名 chatStream"
    );
    const errStr = JSON.stringify(r.error.issues);
    assert(
      errStr.includes("streamLlmResponse"),
      "用例2: 错误信息应包含缺失方法名 streamLlmResponse"
    );
  }

  // === 用例 3：validateService P1 合法（仅基础结构）→ success ===
  {
    const validP1 = {
      name: "prompt",
      init() {},
    };
    const r = validateService("prompt", validP1);
    assert(r.success === true, "用例3: P1 服务（仅 name+init）应通过基础结构校验");
  }

  // === 用例 4：validateService 缺 init → failure ===
  {
    const missingInit = {
      name: "prompt",
      // 缺 init
    };
    const r = expectFailure(validateService("prompt", missingInit), "用例4");
    assert(
      r.summary.includes("prompt"),
      "用例4: 失败摘要应包含服务名 prompt"
    );
  }

  // === 用例 5：validateMessage 静态 topic 合法 payload → success ===
  {
    const validMsg = {
      topic: "script:destroyed",
      payload: { reason: "shutdown" },
    };
    const r = validateMessage(validMsg);
    assert(r.success === true, "用例5: 静态 topic script:destroyed 合法 payload 应通过");
  }

  // === 用例 6：validateMessage 静态 topic payload 类型错 → failure ===
  {
    const wrongPayload = {
      topic: "script:destroyed",
      payload: { reason: 123 }, // reason 应为 string
    };
    const r = expectFailure(validateMessage(wrongPayload), "用例6");
    assert(
      r.summary.includes("script:destroyed"),
      "用例6: 失败摘要应包含 topic 名 script:destroyed"
    );
  }

  // === 用例 7：validateMessage 动态 topic tavern_helper:* → 跳过 payload 校验 ===
  {
    const dynamicMsg = {
      topic: "tavern_helper:foo",
      payload: { anything: 123, any: "shape", even: null }, // 任意形状都应通过
    };
    const r = validateMessage(dynamicMsg);
    assert(
      r.success === true,
      "用例7: 动态 topic tavern_helper:* 应跳过 payload 校验（任意 payload 通过）"
    );
  }

  // === 用例 8：validateMessage 缺 topic → failure ===
  {
    const noTopic = { payload: "x" };
    const r = expectFailure(validateMessage(noTopic), "用例8");
    assert(
      r.summary.includes("top-level"),
      "用例8: 失败摘要应说明顶层结构不合法"
    );
  }

  // === 用例 9：validateServiceRetrieval SafeProxy 标记 → 跳过 P0 schema ===
  {
    // 此对象缺 streamLlmResponse，按 P0 schema 应失败；
    // 但带 SAFE_PROXY_SYMBOL 标记，应被识别为 SafeProxy 降级返回，跳过 P0 校验
    const safeProxyObj = {
      name: "chatStream",
      init() {},
      [SAFE_PROXY_SYMBOL]: true,
    };
    const r = validateServiceRetrieval("chatStream", safeProxyObj);
    assert(
      r.success === true,
      "用例9: 带 SAFE_PROXY_SYMBOL 标记的对象应跳过 P0 schema 校验"
    );

    // 交叉验证：同样的对象用 validateService（不识别 SafeProxy）应失败
    const r2 = validateService("chatStream", safeProxyObj);
    assert(
      r2.success === false,
      "用例9 交叉验证: 同对象用 validateService（不识别 SafeProxy）应失败，证明是 symbol 标记生效"
    );
  }

  // === 用例 10：validateServiceRetrieval 真实 P0 服务 → 通过 P0 schema ===
  {
    const realP0 = {
      name: "chatStream",
      init() {},
      streamLlmResponse: async function* () {
        yield { content: "" };
      },
    };
    const r = validateServiceRetrieval("chatStream", realP0);
    assert(
      r.success === true,
      "用例10: 真实 P0 服务（无 SafeProxy 标记）应通过 validateServiceRetrieval 的 P0 schema 校验"
    );
  }

  // === 边界：null / undefined 输入不抛错，返回 failure ===
  {
    const r = validateService("prompt", null);
    assert(r.success === false, "边界1: null service 应返回 failure 而非抛错");
    const r2 = validateServiceRetrieval("chatStream", undefined);
    assert(r2.success === false, "边界2: undefined service 应返回 failure 而非抛错");
  }

  console.log("✔ Kernel Schema Validation (Phase B) verified — 10 主用例 + 2 边界全过！");
}
