import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatSession, Message } from "../../src/types";
import { MultiMessageService } from "../../src/application/services/MultiMessageService";
import {
  MAX_SWIPE_CANDIDATES,
  appendSwipeCandidate,
  readSwipeCandidates,
  stripSwipeCandidates,
} from "../../src/domain/chat/messageSwipes";
import {
  fromStoredMessageRecord,
  toStoredMessageRecord,
} from "../../src/infrastructure/storage/messageRecord";

describe("末尾消息候选分支（Message Swipes）", () => {
  describe("容量上限与先进先出淘汰（直接验证生产实现）", () => {
    it("超过 5 条时淘汰最老版本，推理内容同步淘汰", () => {
      let candidates = { swipes: ["版本1"], reasonings: ["思考1"] };

      for (let i = 2; i <= 6; i++) {
        const appended = appendSwipeCandidate(candidates, `版本${i}`, `思考${i}`);
        expect(appended.index).toBe(appended.swipes.length - 1);
        expect(appended.reasonings).toHaveLength(appended.swipes.length);
        candidates = { swipes: appended.swipes, reasonings: appended.reasonings };
      }

      expect(candidates.swipes).toHaveLength(MAX_SWIPE_CANDIDATES);
      // 版本1 已被淘汰，保留 版本2 ~ 版本6。
      expect(candidates.swipes[0]).toBe("版本2");
      expect(candidates.swipes[4]).toBe("版本6");
      expect(candidates.reasonings[0]).toBe("思考2");
      expect(candidates.reasonings[4]).toBe("思考6");
    });

    it("推理与候选严格对齐：历史记录缺少逐条推理时只把当前推理归位到激活下标", () => {
      const legacy: Message = {
        id: "msg_ai_legacy",
        sender: "assistant",
        content: "当前版本",
        timestamp: 1,
        reasoningContent: "当前推理",
        swipes: ["版本1", "当前版本"],
        swipe_id: 1,
      };

      const candidates = readSwipeCandidates(legacy);
      expect(candidates.reasonings).toEqual(["", "当前推理"]);

      const appended = appendSwipeCandidate(candidates, "新版本", "新推理");
      expect(appended.swipes).toEqual(["版本1", "当前版本", "新版本"]);
      expect(appended.reasonings).toEqual(["", "当前推理", "新推理"]);
      expect(appended.index).toBe(2);
    });
  });

  describe("持久化与固化（防止重启后丢失候选推理）", () => {
    it("toStoredMessageRecord / fromStoredMessageRecord 往返保留 swipes、swipeIndex 与 swipeReasonings", () => {
      const message: Message = {
        id: "msg_ai_1",
        sender: "assistant",
        content: "版本2",
        timestamp: 123,
        swipes: ["版本1", "版本2"],
        swipe_id: 1,
        swipeIndex: 1,
        swipeReasonings: ["思考1", "思考2"],
        reasoningContent: "思考2",
      };

      const roundTripped = fromStoredMessageRecord(toStoredMessageRecord("session_1", message, 1));
      expect(roundTripped.swipes).toEqual(["版本1", "版本2"]);
      expect(roundTripped.swipeIndex).toBe(1);
      expect(roundTripped.swipeReasonings).toEqual(["思考1", "思考2"]);
      expect(roundTripped.reasoningContent).toBe("思考2");
    });

    it("固化只剥离候选字段，正文与推理保持为当前激活版本", () => {
      const message: Message = {
        id: "msg_ai_1",
        sender: "assistant",
        content: "当前版本",
        timestamp: 1,
        reasoningContent: "当前推理",
        swipes: ["旧版本", "当前版本"],
        swipe_id: 1,
        swipeIndex: 1,
        swipeReasonings: ["旧推理", "当前推理"],
      };

      const solidified = stripSwipeCandidates(message);
      expect(solidified.content).toBe("当前版本");
      expect(solidified.reasoningContent).toBe("当前推理");
      expect("swipes" in solidified).toBe(false);
      expect("swipe_id" in solidified).toBe(false);
      expect("swipeIndex" in solidified).toBe(false);
      expect("swipeReasonings" in solidified).toBe(false);
      // 原对象不被修改。
      expect(message.swipes).toEqual(["旧版本", "当前版本"]);
    });
  });

  describe("下一轮对话发送时自动固化并释放空间（queueUserMessage）", () => {
    let mockDatabaseService: {
      appendSessionMessage: ReturnType<typeof vi.fn>;
      updateSessionMessage: ReturnType<typeof vi.fn>;
    };
    let mockKernel: {
      getService: ReturnType<typeof vi.fn>;
    };
    let multiMessageService: MultiMessageService;

    beforeEach(() => {
      mockDatabaseService = {
        appendSessionMessage: vi.fn().mockResolvedValue(undefined),
        updateSessionMessage: vi.fn().mockResolvedValue(undefined),
      };
      mockKernel = {
        getService: vi.fn((name: string) => {
          if (name === "database") return mockDatabaseService;
          return null;
        }),
      };

      multiMessageService = new MultiMessageService();
      multiMessageService.init(mockKernel as never);
    });

    it("发送新消息时，上一条 assistant 消息的 swipes 临时字段必须被彻底清除，只保留选中文本", async () => {
      const initialAssistantMsg: Message = {
        id: "msg_ai_1",
        sender: "assistant",
        content: "这是选中的版本3",
        timestamp: Date.now() - 5000,
        swipes: ["版本1", "版本2", "这是选中的版本3", "版本4"],
        swipeIndex: 2,
        swipe_id: 2,
        swipeReasonings: ["思考1", "思考2", "思考3", "思考4"],
      };

      const session: ChatSession = {
        id: "session_123",
        characterId: "char_1",
        title: "测试会话",
        createdAt: Date.now() - 10000,
        messages: [
          { id: "msg_user_0", sender: "user", content: "上一句", timestamp: Date.now() - 8000 },
          initialAssistantMsg,
        ],
        summaries: [],
      };

      const updatedSession = await multiMessageService.queueUserMessage(session, "用户发送的新消息");

      // 验证返回会话中的上一条 AI 消息已固化
      const solidifiedMsg = updatedSession.messages[1];
      expect(solidifiedMsg.id).toBe("msg_ai_1");
      expect(solidifiedMsg.content).toBe("这是选中的版本3");
      expect(solidifiedMsg.swipes).toBeUndefined();
      expect(solidifiedMsg.swipeIndex).toBeUndefined();
      expect(solidifiedMsg.swipe_id).toBeUndefined();
      expect(solidifiedMsg.swipeReasonings).toBeUndefined();

      // 验证调用了 updateSessionMessage 同步从数据库释放空间
      expect(mockDatabaseService.updateSessionMessage).toHaveBeenCalledWith(
        "session_123",
        expect.objectContaining({
          id: "msg_ai_1",
          content: "这是选中的版本3",
        }),
        {}
      );

      // 验证调用参数中的消息对象也不含 swipes
      const callArgs = mockDatabaseService.updateSessionMessage.mock.calls[0][1];
      expect(callArgs.swipes).toBeUndefined();

      // 验证新用户消息正确追加在末尾
      expect(updatedSession.messages.length).toBe(3);
      expect(updatedSession.messages[2].sender).toBe("user");
      expect(updatedSession.messages[2].content).toBe("用户发送的新消息");
    });
  });
});
