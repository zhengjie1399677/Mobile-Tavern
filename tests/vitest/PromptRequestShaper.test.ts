import { describe, expect, it } from "vitest";
import { shapePromptRequest } from "../../src/application/services/prompt/PromptRequestShaper";

describe("PromptRequestShaper", () => {
  it("关闭时保持消息内容和顺序不变", () => {
    const input = [
      { role: "system" as const, content: "system" },
      { role: "user" as const, content: "hello", name: "user" },
    ];
    const result = shapePromptRequest(input, { enabled: false });
    expect(result.messages).toEqual(input);
    expect(result.messages).not.toBe(input);
    expect(result.stopSequences).toBeUndefined();
    expect(result.report.enabled).toBe(false);
  });

  it("按类型化配置合并、包装并加入 prefill 与停止字符串", () => {
    const result = shapePromptRequest([
      { role: "system", content: "A" },
      { role: "user", content: "one", name: "u" },
      { role: "system", content: "B" },
      { role: "user", content: "two", name: "u" },
      { role: "user", content: "three", name: "u" },
    ], {
      enabled: true,
      squashSystemMessages: true,
      mergeAdjacentMessages: true,
      roleWrappers: {
        system: { prefix: "<s>", suffix: "</s>" },
        user: { prefix: "U:" },
      },
      assistantPrefill: "继续：",
      stopSequences: ["User:", "User:", ""],
    });
    expect(result.messages).toEqual([
      { role: "system", content: "<s>A</s>\n\n<s>B</s>" },
      { role: "user", content: "U:one\n\nU:two\n\nU:three", name: "u" },
      { role: "assistant", content: "继续：" },
    ]);
    expect(result.stopSequences).toEqual(["User:"]);
    expect(result.report).toMatchObject({
      originalMessageCount: 5,
      finalMessageCount: 3,
      mergedMessageCount: 2,
      squashedSystemMessageCount: 1,
      assistantPrefillAdded: true,
    });
  });

  it("不同 name 的同角色消息不会合并", () => {
    const result = shapePromptRequest([
      { role: "user", content: "A", name: "one" },
      { role: "user", content: "B", name: "two" },
    ], { enabled: true, mergeAdjacentMessages: true });
    expect(result.messages).toHaveLength(2);
    expect(result.report.mergedMessageCount).toBe(0);
  });
});
