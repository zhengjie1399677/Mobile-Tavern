import { describe, expect, it } from "vitest";
import { applyInChatPromptNodes } from "../../src/application/services/prompt/PromptRequestShaper";

describe("PromptRequestShaper in-chat prompt nodes", () => {
  it("按 depth 从聊天历史末端插入并保留 role 与 order", () => {
    const result = applyInChatPromptNodes(
      [
        { role: "system", content: "system" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
      ],
      [
        {
          content: "depth0",
          metadata: { position: "in_chat", depth: 0, role: "system", order: 20 },
        },
        {
          content: "depth2",
          metadata: { position: "in_chat", depth: 2, role: "assistant", order: 10 },
        },
      ],
    );

    expect(result.map((message) => message.content)).toEqual([
      "system",
      "u1",
      "depth2",
      "a1",
      "u2",
      "depth0",
    ]);
    expect(result[2].role).toBe("assistant");
  });

  it("忽略非 in-chat 节点且不修改原消息数组", () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const result = applyInChatPromptNodes(messages, [
      { content: "system-only", metadata: { position: "system", depth: 0 } },
    ]);

    expect(result).toEqual(messages);
    expect(result).not.toBe(messages);
  });
});
