import { describe, expect, it, vi } from "vitest";
import { dispatchPluginHostRequest } from "../../src/domain/plugins/hostBridgeV2";

const context = {
  activeCharacter: {
    id: "char-1", name: "角色", description: "描述", personality: "性格",
    scenario: "场景", first_mes: "你好", mes_example: "", tags: ["测试"],
    avatar: "data:image/png;base64,secret", variables: { secret: true },
  },
  activeSession: {
    id: "session-1", title: "主线", characterId: "char-1", createdAt: 1, summaries: [] as never[], messages: [
      { id: "m1", sender: "user" as const, content: "私密消息", timestamp: 1 },
    ],
    variables: { secret: true },
  },
};

describe("Plugin Host Bridge V2", () => {
  it("只返回脱敏后的活跃角色与会话摘要", async () => {
    const result = await dispatchPluginHostRequest(
      ["context.read"], "context.get", {}, context,
      { injectAction: vi.fn(), sendMessage: vi.fn() },
    );
    expect(result).toEqual({
      character: {
        id: "char-1", name: "角色", description: "描述", personality: "性格",
        scenario: "场景", tags: ["测试"],
      },
      session: {
        id: "session-1", title: "主线", characterId: "char-1",
        messageCount: 1, parentSessionId: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain("私密消息");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("按权限分别执行动作注入与 AI 发送", async () => {
    const injectAction = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const actions = { injectAction, sendMessage };
    await dispatchPluginHostRequest(["chat.action"], "chat.injectAction", { text: " 观察四周 " }, context, actions);
    await dispatchPluginHostRequest(["chat.send"], "chat.send", { text: "继续前进" }, context, actions);
    expect(injectAction).toHaveBeenCalledWith("观察四周");
    expect(sendMessage).toHaveBeenCalledWith("继续前进");
  });

  it("拒绝未声明权限、空文本和超长文本", async () => {
    const actions = { injectAction: vi.fn(), sendMessage: vi.fn() };
    await expect(dispatchPluginHostRequest([], "context.get", {}, context, actions))
      .rejects.toThrow("PLUGIN_PERMISSION_DENIED");
    await expect(dispatchPluginHostRequest(["chat.action"], "chat.injectAction", { text: " " }, context, actions))
      .rejects.toThrow("PLUGIN_CHAT_INVALID_TEXT");
    await expect(dispatchPluginHostRequest(["chat.send"], "chat.send", { text: "x".repeat(4_001) }, context, actions))
      .rejects.toThrow("PLUGIN_CHAT_INVALID_TEXT");
  });
});
