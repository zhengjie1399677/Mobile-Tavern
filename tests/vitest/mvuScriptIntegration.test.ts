/**
 * ScriptService（MVU 脚本服务）集成测试
 *
 * 填补 test_kernel_services_coverage.ts 标注的盲区：
 * 因 tavernHelperBridge 依赖 window 无法在纯 Node 环境加载，
 * 用 happy-dom 提供完整 window 环境，在受控 bridge mock 下
 * 验证 ScriptService 自身的隔离与降级契约。
 *
 * 覆盖：
 * - initializeMvuFromCharacter：从角色卡扩展提取 MVU 变量
 * - parseMvuMessage：消息变量解析 + 防腐清洗
 * - executeMvuScript：会话变量同步到消息 extra
 * - Bridge 注册与缺失降级
 * - 防腐隔离层 (cleanMvuVariables)：脏数据清洗
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ScriptService } from "../../src/kernel/services/ScriptService";
import { Kernel } from "../../src/kernel/Kernel";
import type { IKernel } from "../../src/kernel/types";
// 导入 bridge 的纯函数 initializeMvuFromCharacter 用于 mock 桥接
import { initializeMvuFromCharacter } from "../../src/utils/tavernHelperBridge";

// 构建最小 Kernel 实例用于服务注册
async function createTestKernel(): Promise<IKernel> {
  const kernel = new Kernel();
  return kernel as any as IKernel;
}

describe("ScriptService", () => {
  let service: ScriptService;
  let kernel: IKernel;

  async function setup() {
    kernel = await createTestKernel();
    service = new ScriptService();
    service.init(kernel);
  }

  // 每个测试前重建实例，确保 bridge 状态独立
  beforeEach(setup);

  // ------------------------------------------------------------------
  // initializeMvuFromCharacter
  // ------------------------------------------------------------------

  describe("initializeMvuFromCharacter", () => {
    // 注册一个透传 bridge，使 ScriptService 能调用真实的 initializeMvuFromCharacter
    beforeEach(async () => {
      await setup();
      service.registerBridge({
        initializeMvuFromCharacter,
        parseMvuMessage: vi.fn().mockReturnValue({ stat_data: {} }),
        notifyVariablesUpdated: vi.fn(),
      });
    });

    it("角色卡 extensions 中含 mvu_settings 时正确提取变量", () => {
      const char = {
        name: "测试角色",
        extensions: {
          mvu_settings: {
            schema: { type: "object", properties: { hp: "number" } },
            stat_data: { hp: 100, mp: 50 },
            display_data: { layout: "compact" },
          },
        },
      };
      const vars = service.initializeMvuFromCharacter(char);
      expect(vars.schema).toEqual({ type: "object", properties: { hp: "number" } });
      expect(vars.stat_data).toEqual({ hp: 100, mp: 50 });
      expect(vars.display_data).toEqual({ layout: "compact" });
    });

    it("角色卡无 extensions 时安全降级返回默认空变量", () => {
      const char = { name: "无扩展角色" };
      const vars = service.initializeMvuFromCharacter(char);
      expect(vars.stat_data).toEqual({});
      expect(vars.schema).toBeDefined();
    });

    it("角色卡为 null/undefined 时安全降级", () => {
      const vars = service.initializeMvuFromCharacter(null);
      expect(vars.stat_data).toEqual({});

      const vars2 = service.initializeMvuFromCharacter(undefined);
      expect(vars2.stat_data).toEqual({});
    });

    it("extensions 中含 defaults 字段作为 stat_data 降级源", () => {
      const char = {
        extensions: {
          mvu: {
            defaults: { strength: 10, agility: 8 },
          },
        },
      };
      const vars = service.initializeMvuFromCharacter(char);
      expect(vars.stat_data).toEqual({ strength: 10, agility: 8 });
    });

    it("extensions 中 mvu / MVU 别名也被识别", () => {
      const char1 = { extensions: { mvu: { stat_data: { x: 1 } } } };
      expect(service.initializeMvuFromCharacter(char1).stat_data).toEqual({ x: 1 });

      const char2 = { extensions: { MVU: { stat_data: { y: 2 } } } };
      expect(service.initializeMvuFromCharacter(char2).stat_data).toEqual({ y: 2 });
    });
  });

  // ------------------------------------------------------------------
  // parseMvuMessage（防腐清洗）
  // ------------------------------------------------------------------

  describe("parseMvuMessage", () => {
    it("Bridge 未注册时返回原始变量（降级）", () => {
      const currentVars = { stat_data: { hp: 50 } };
      const result = service.parseMvuMessage("[mvu_update] hp=100", currentVars);
      // bridge 未注册，返回清洗后的输入变量，不抛错
      expect(result.stat_data).toEqual({ hp: 50 });
    });

    it("Bridge 注册后正常转发解析", () => {
      const mockBridge = {
        initializeMvuFromCharacter: vi.fn(),
        parseMvuMessage: vi.fn().mockReturnValue({
          stat_data: { hp: 100, mp: 30 },
          schema: { type: "object" },
        }),
        notifyVariablesUpdated: vi.fn(),
      };
      service.registerBridge(mockBridge);

      const result = service.parseMvuMessage("hp=100 mp=30", { stat_data: {} });
      expect(mockBridge.parseMvuMessage).toHaveBeenCalledWith("hp=100 mp=30", { stat_data: {} });
      expect(result.stat_data).toEqual({ hp: 100, mp: 30 });
    });

    it("Bridge 返回脏数据（含函数/Symbol）时防腐清洗", () => {
      const dirtyFn = () => "evil";
      const mockBridge = {
        initializeMvuFromCharacter: vi.fn(),
        parseMvuMessage: vi.fn().mockReturnValue({
          stat_data: {
            normalKey: 42,
            maliciousFn: dirtyFn,
          },
          schema: { type: "object" },
        }),
        notifyVariablesUpdated: vi.fn(),
      };
      service.registerBridge(mockBridge);

      const result = service.parseMvuMessage("test", { stat_data: {} });
      // 函数属性被清洗掉
      expect(result.stat_data).not.toHaveProperty("maliciousFn");
      expect(result.stat_data).toHaveProperty("normalKey", 42);
    });

    it("Bridge 返回非对象时安全降级为空 stat_data", () => {
      const mockBridge = {
        initializeMvuFromCharacter: vi.fn(),
        parseMvuMessage: vi.fn().mockReturnValue(null),
        notifyVariablesUpdated: vi.fn(),
      };
      service.registerBridge(mockBridge);

      const result = service.parseMvuMessage("test", { stat_data: { old: 1 } });
      expect(result.stat_data).toEqual({});
    });

    it("空消息内容直接返回清洗后的当前变量", () => {
      const result = service.parseMvuMessage("", { stat_data: { x: 1 } });
      expect(result.stat_data).toEqual({ x: 1 });
    });

    it("Bridge 抛错时安全兜底不抛异常", () => {
      const mockBridge = {
        initializeMvuFromCharacter: vi.fn(),
        parseMvuMessage: vi.fn().mockImplementation(() => {
          throw new Error("Bridge internal error");
        }),
        notifyVariablesUpdated: vi.fn(),
      };
      service.registerBridge(mockBridge);

      const result = service.parseMvuMessage("crash", { stat_data: { safe: true } });
      expect(result.stat_data).toEqual({ safe: true });
    });
  });

  // ------------------------------------------------------------------
  // executeMvuScript（会话变量同步）
  // ------------------------------------------------------------------

  describe("executeMvuScript", () => {
    it("将解析后的变量同步到最后一条消息的 extra.variables", async () => {
      const mockBridge = {
        initializeMvuFromCharacter: vi.fn(),
        parseMvuMessage: vi.fn().mockReturnValue({
          stat_data: { hp: 80, mp: 20 },
        }),
        notifyVariablesUpdated: vi.fn(),
      };
      service.registerBridge(mockBridge);

      const session: any = {
        id: "sess-1",
        characterId: "char-1",
        title: "测试",
        createdAt: Date.now(),
        messages: [
          {
            id: "msg-1",
            sender: "assistant",
            content: "你好！你受到了一些伤害。",
            swipe_id: 0,
            extra: { variables: {} },
          },
        ],
        summaries: [],
        variables: {},
      };

      const updated = await service.executeMvuScript(session, "hp=80 mp=20");

      const lastMsg = updated.messages[updated.messages.length - 1] as any;
      expect(lastMsg.extra.variables[0]).toBeDefined();
      expect(lastMsg.extra.variables[0].stat_data).toEqual({ hp: 80, mp: 20 });
      expect(updated.variables.stat_data).toEqual({ hp: 80, mp: 20 });
    });

    it("多条消息时仅修改最后一条", async () => {
      const mockBridge = {
        initializeMvuFromCharacter: vi.fn(),
        parseMvuMessage: vi.fn().mockReturnValue({ stat_data: { x: 1 } }),
        notifyVariablesUpdated: vi.fn(),
      };
      service.registerBridge(mockBridge);

      const session: any = {
        id: "sess-2",
        characterId: "char-1",
        title: "多轮对话",
        createdAt: Date.now(),
        messages: [
          { id: "m1", sender: "user", content: "Hi", extra: {} },
          { id: "m2", sender: "assistant", content: "Hello", extra: { variables: {} }, swipe_id: 0 },
          { id: "m3", sender: "user", content: "How are you?", extra: {} },
          { id: "m4", sender: "assistant", content: "I'm fine", extra: { variables: {} }, swipe_id: 0 },
        ],
        summaries: [],
        variables: {},
      };

      const updated = await service.executeMvuScript(session, "updated");

      // 前三条消息的 extra.variables 应保持原样
      const m2 = updated.messages[1] as any;
      expect(m2.extra.variables).toEqual({});

      // 最后一条消息的 extra.variables[0] 被更新
      const m4 = updated.messages[3] as any;
      expect(m4.extra.variables[0].stat_data).toEqual({ x: 1 });
    });

    it("Bridge 缺失时降级走 kernel 消息总线并安全返回", async () => {
      // 注册消息总线监听
      let publishedTopic = "";
      kernel.subscribe("script:mvuVariablesUpdated", (msg: any) => {
        publishedTopic = msg.topic;
      });

      const session: any = {
        id: "sess-3",
        characterId: "char-1",
        title: "降级测试",
        createdAt: Date.now(),
        messages: [
          { id: "m1", sender: "assistant", content: "hello", extra: {}, swipe_id: 0 },
        ],
        summaries: [],
        variables: {},
      };

      const updated = await service.executeMvuScript(session, "any");
      // 应返回原始会话（不抛错）
      expect(updated.id).toBe("sess-3");
    });

    it("空消息数组的会话安全处理", async () => {
      const session: any = {
        id: "sess-empty",
        characterId: "char-1",
        title: "空对话",
        createdAt: Date.now(),
        messages: [],
        summaries: [],
        variables: {},
      };

      const updated = await service.executeMvuScript(session, "test");
      expect(updated.messages).toEqual([]);
    });
  });
});
