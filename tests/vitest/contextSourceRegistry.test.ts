/**
 * C0 回归：上下文来源契约与注册表。
 *
 * 本阶段刻意不接线：只验证读取语义（并行、超时、占位、稳定排序、单来源上限）
 * 与注册/注销行为，对现有提示词完全惰性。
 */
import { describe, expect, it } from "vitest";
import {
  createContextSourceDefinition,
  type ContextSourceDefinition,
} from "@/src/domain/contextSources/contracts";
import { createContextSourceRegistry } from "@/src/application/contextSources/contextSourceRegistry";

function source(overrides: Partial<ContextSourceDefinition> & { id: string }): ContextSourceDefinition {
  return {
    version: "1.0.0",
    macroName: `context.${overrides.id}`,
    determinism: "deterministic",
    maxCharacters: 100,
    timeoutMs: 50,
    read: async () => "",
    ...overrides,
  };
}

const request = () => ({ sessionId: "session", userInput: "输入" });

describe("上下文来源契约", () => {
  it("校验 id、宏名、上限与超时", () => {
    expect(() => createContextSourceDefinition(source({ id: "Bad Id" }))).toThrow(
      /CONTEXT_SOURCE_ID_INVALID/,
    );
    expect(() =>
      createContextSourceDefinition(source({ id: "kb", macroName: "1bad" })),
    ).toThrow(/CONTEXT_SOURCE_MACRO_NAME_INVALID/);
    expect(() => createContextSourceDefinition(source({ id: "kb", maxCharacters: 0 }))).toThrow(
      /CONTEXT_SOURCE_MAX_CHARACTERS_INVALID/,
    );
    expect(() => createContextSourceDefinition(source({ id: "kb", timeoutMs: 0 }))).toThrow(
      /CONTEXT_SOURCE_TIMEOUT_INVALID/,
    );
  });

  it("既有宏名必须继续合法（迁移兼容的前提）", () => {
    for (const macroName of ["memory.recalled", "worldbook.triggered", "char", "context.kb"]) {
      expect(() => createContextSourceDefinition(source({ id: "kb", macroName }))).not.toThrow();
    }
  });
});

describe("上下文来源注册表", () => {
  it("空注册时返回空列表", async () => {
    const registry = createContextSourceRegistry();
    expect(await registry.readAll(request())).toEqual([]);
  });

  it("并行读取并按 id 稳定排序", async () => {
    const registry = createContextSourceRegistry();
    registry.register(source({ id: "zeta", macroName: "context.zeta", read: async () => "Z" }));
    registry.register(source({ id: "alpha", macroName: "context.alpha", read: async () => "A" }));

    const contributions = await registry.readAll(request());
    expect(contributions.map((item) => item.sourceId)).toEqual(["alpha", "zeta"]);
    expect(contributions.map((item) => item.content)).toEqual(["A", "Z"]);
    expect(contributions.every((item) => item.status === "ok")).toBe(true);
  });

  it("空白内容产出 empty 占位，保证宏被解析为空串而不是漏字面量", async () => {
    const registry = createContextSourceRegistry();
    registry.register(source({ id: "kb", macroName: "context.kb", read: async () => "   \n " }));

    const [contribution] = await registry.readAll(request());
    expect(contribution).toMatchObject({
      sourceId: "kb",
      macroName: "context.kb",
      content: "",
      status: "empty",
      characters: 0,
    });
  });

  it("超过单来源上限时截断并记录原始长度", async () => {
    const registry = createContextSourceRegistry();
    registry.register(
      source({ id: "kb", macroName: "context.kb", maxCharacters: 4, read: async () => "0123456789" }),
    );

    const [contribution] = await registry.readAll(request());
    expect(contribution.status).toBe("truncated");
    expect(contribution.content).toBe("0123");
    expect(contribution.characters).toBe(4);
    expect(contribution.detail).toBe("truncated:10->4");
  });

  it("单来源抛错只影响自己，不影响其它来源", async () => {
    const registry = createContextSourceRegistry();
    registry.register(
      source({
        id: "broken",
        macroName: "context.broken",
        read: async () => {
          throw new Error("boom");
        },
      }),
    );
    registry.register(source({ id: "good", macroName: "context.good", read: async () => "ok" }));

    const contributions = await registry.readAll(request());
    expect(contributions.map((item) => item.sourceId)).toEqual(["broken", "good"]);
    expect(contributions[0]).toMatchObject({ status: "failed", content: "", detail: "boom" });
    expect(contributions[1]).toMatchObject({ status: "ok", content: "ok" });
  });

  it("超时来源判为 timeout，不阻塞本轮", async () => {
    const registry = createContextSourceRegistry();
    registry.register(
      source({
        id: "slow",
        macroName: "context.slow",
        timeoutMs: 20,
        read: () => new Promise<string>(() => {}),
      }),
    );

    const [contribution] = await registry.readAll(request());
    expect(contribution).toMatchObject({ status: "timeout", content: "", detail: "timeout:20" });
  });

  it("调用方取消时同样给出结论而非抛出", async () => {
    const registry = createContextSourceRegistry();
    registry.register(source({ id: "kb", macroName: "context.kb" }));

    const controller = new AbortController();
    controller.abort();
    const contributions = await registry.readAll({ ...request(), signal: controller.signal });
    expect(contributions).toHaveLength(1);
    expect(contributions[0].status).toBe("failed");
  });

  it("重复注册抛错，注销后不再产出贡献", async () => {
    const registry = createContextSourceRegistry();
    const dispose = registry.register(source({ id: "kb", macroName: "context.kb" }));
    expect(() => registry.register(source({ id: "kb", macroName: "context.kb" }))).toThrow(
      /CONTEXT_SOURCE_ALREADY_REGISTERED/,
    );
    expect(registry.list().map((item) => item.id)).toEqual(["kb"]);

    dispose();
    expect(registry.resolve("kb")).toBeUndefined();
    expect(await registry.readAll(request())).toEqual([]);
  });

  it("来源可附带审计数据，且审计不进入内容", async () => {
    const registry = createContextSourceRegistry();
    registry.register(
      source({
        id: "kb",
        macroName: "context.kb",
        read: async () => ({
          content: "命中的正文",
          audit: { hitIds: ["a", "b"], dropped: 1 },
        }),
      }),
    );

    const [contribution] = await registry.readAll(request());
    expect(contribution.content).toBe("命中的正文");
    expect(contribution.audit).toEqual({ hitIds: ["a", "b"], dropped: 1 });
  });

  it("直接返回字符串的来源不产生审计数据（向后兼容）", async () => {
    const registry = createContextSourceRegistry();
    registry.register(source({ id: "kb", macroName: "context.kb", read: async () => "纯文本" }));

    const [contribution] = await registry.readAll(request());
    expect(contribution.content).toBe("纯文本");
    expect(contribution.audit).toBeUndefined();
  });

  it("截断只作用于内容，审计数据保留", async () => {
    const registry = createContextSourceRegistry();
    registry.register(
      source({
        id: "kb",
        macroName: "context.kb",
        maxCharacters: 2,
        read: async () => ({ content: "0123456789", audit: { total: 10 } }),
      }),
    );

    const [contribution] = await registry.readAll(request());
    expect(contribution).toMatchObject({ status: "truncated", content: "01" });
    expect(contribution.audit).toEqual({ total: 10 });
  });

  it("轮次信息透传给来源", async () => {
    const registry = createContextSourceRegistry();
    let seenTurnIndex: number | undefined;
    registry.register(
      source({
        id: "kb",
        macroName: "context.kb",
        read: async (readRequest) => {
          seenTurnIndex = readRequest.turnIndex;
          return "";
        },
      }),
    );

    await registry.readAll({ ...request(), turnIndex: 7 });
    expect(seenTurnIndex).toBe(7);
  });
});
