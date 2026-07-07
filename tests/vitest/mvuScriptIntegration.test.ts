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
// 导入 bridge 的纯函数用于 mock 桥接与直接测试
import {
  initializeMvuFromCharacter,
  extractMvuCommands,
  extractXmlMvuCommands,
  detectJsonPatch,
  parseMvuMessage,
  parseNestedYaml,
  deepMerge,
} from "../../src/utils/tavernHelper";

// 构建最小 Kernel 实例用于服务注册
async function createTestKernel(): Promise<IKernel> {
  const kernel = new Kernel();
  const mockDb = {
    name: "database",
    init: () => {},
    getCharacterById: async () => null,
  };
  await kernel.registerService("database", mockDb as any);
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
      const vars = service.initializeMvuFromCharacter(char as any);
      expect(vars.schema).toEqual({ type: "object", properties: { hp: "number" } });
      expect(vars.stat_data).toEqual({ hp: 100, mp: 50 });
      expect(vars.display_data).toEqual({ layout: "compact" });
    });

    it("角色卡无 extensions 时安全降级返回默认空变量", () => {
      const char = { name: "无扩展角色" };
      const vars = service.initializeMvuFromCharacter(char as any);
      expect(vars.stat_data).toEqual({});
      expect(vars.schema).toBeDefined();
    });

    it("角色卡为 null/undefined 时安全降级", () => {
      const vars = service.initializeMvuFromCharacter(null as any);
      expect(vars.stat_data).toEqual({});

      const vars2 = service.initializeMvuFromCharacter(undefined as any);
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
      const vars = service.initializeMvuFromCharacter(char as any);
      expect(vars.stat_data).toEqual({ strength: 10, agility: 8 });
    });

    it("extensions 中 mvu / MVU 别名也被识别", () => {
      const char1 = { extensions: { mvu: { stat_data: { x: 1 } } } };
      expect(service.initializeMvuFromCharacter(char1 as any).stat_data).toEqual({ x: 1 });

      const char2 = { extensions: { MVU: { stat_data: { y: 2 } } } };
      expect(service.initializeMvuFromCharacter(char2 as any).stat_data).toEqual({ y: 2 });
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
      expect(updated.variables?.stat_data).toEqual({ hp: 80, mp: 20 });
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

// ------------------------------------------------------------------
// extractMvuCommands（纯函数单元测试）
// ------------------------------------------------------------------

describe("extractMvuCommands", () => {
  it("解析单个 _.set 命令", () => {
    const cmds = extractMvuCommands('_.set("hp", 80);');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe("set");
    expect(cmds[0].args).toEqual(["hp", 80]);
  });

  it("解析多个命令", () => {
    const cmds = extractMvuCommands('_.set("hp", 80); _.add("mp", -10);');
    expect(cmds).toHaveLength(2);
    expect(cmds[0].type).toBe("set");
    expect(cmds[1].type).toBe("add");
  });

  it("解析 _.insert 命令", () => {
    const cmds = extractMvuCommands('_.insert("inventory", 0, "长剑");');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe("insert");
    expect(cmds[0].args).toEqual(["inventory", 0, "长剑"]);
  });

  it("解析 _.delete 命令", () => {
    const cmds = extractMvuCommands('_.delete("temp_key");');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe("delete");
  });

  it("解析 _.move 命令", () => {
    const cmds = extractMvuCommands('_.move("temp", "permanent");');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe("move");
    expect(cmds[0].args).toEqual(["temp", "permanent"]);
  });

  it("空字符串返回空数组", () => {
    expect(extractMvuCommands("")).toEqual([]);
    expect(extractMvuCommands(null as any)).toEqual([]);
  });

  it("不含 MVU 命令的普通文本返回空数组", () => {
    expect(extractMvuCommands("你好，这是一条普通消息。")).toEqual([]);
  });
});

// ------------------------------------------------------------------
// extractXmlMvuCommands（XML 标签兼容测试）
// ------------------------------------------------------------------

describe("extractXmlMvuCommands", () => {
  it("从 <UpdateVariable> 标签中提取 _.set 命令", () => {
    const text = '角色受到了伤害。<UpdateVariable>_.set("hp", 70);</UpdateVariable>';
    const cmds = extractXmlMvuCommands(text);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe("set");
    expect(cmds[0].args).toEqual(["hp", 70]);
  });

  it("从 <initvar> 标签中提取初始化命令", () => {
    const text = '<initvar>_.set("hp", 100); _.set("mp", 50);</initvar>';
    const cmds = extractXmlMvuCommands(text);
    expect(cmds).toHaveLength(2);
    expect(cmds[0].args).toEqual(["hp", 100]);
    expect(cmds[1].args).toEqual(["mp", 50]);
  });

  it("多个 XML 标签混合提取", () => {
    const text = `
      <initvar>_.set("hp", 100);</initvar>
      一些剧情文本...
      <UpdateVariable>_.add("hp", -20);</UpdateVariable>
    `;
    const cmds = extractXmlMvuCommands(text);
    expect(cmds).toHaveLength(2);
    // UpdateVariable 先处理，initvar 后处理
    expect(cmds[0].type).toBe("add");
    expect(cmds[1].type).toBe("set");
  });

  it("XML 标签内含 JSON Patch 时不重复提取", () => {
    const text = '<UpdateVariable>[{"op":"replace","path":"/hp","value":80}]</UpdateVariable>';
    const cmds = extractXmlMvuCommands(text);
    // JSON Patch 内容由 parseMvuMessage 的 JSON Patch 分支处理
    expect(cmds).toHaveLength(0);
  });

  it("空标签和空内容安全处理", () => {
    expect(extractXmlMvuCommands("<UpdateVariable></UpdateVariable>")).toEqual([]);
    expect(extractXmlMvuCommands("<initvar>   </initvar>")).toEqual([]);
    expect(extractXmlMvuCommands("")).toEqual([]);
  });
});

// ------------------------------------------------------------------
// detectJsonPatch（JSON Patch 检测测试）
// ------------------------------------------------------------------

describe("detectJsonPatch", () => {
  it("检测 <UpdateVariable> 中的 JSON Patch 数组", () => {
    const text = '<UpdateVariable>[{"op":"replace","path":"/hp","value":80}]</UpdateVariable>';
    const patches = detectJsonPatch(text);
    expect(patches).not.toBeNull();
    expect(patches).toHaveLength(1);
    expect(patches![0]).toEqual({ op: "replace", path: "/hp", value: 80 });
  });

  it("检测 <initvar> 中的多操作 JSON Patch", () => {
    const text = `<initvar>[
      {"op":"add","path":"/inventory/-","value":"长剑"},
      {"op":"replace","path":"/hp","value":90}
    ]</initvar>`;
    const patches = detectJsonPatch(text);
    expect(patches).toHaveLength(2);
    expect(patches![0].op).toBe("add");
    expect(patches![1].op).toBe("replace");
  });

  it("检测裸 JSON Patch 数组（无 XML 标签）", () => {
    const text = '[{"op":"replace","path":"/hp","value":80}]';
    const patches = detectJsonPatch(text);
    expect(patches).not.toBeNull();
    expect(patches).toHaveLength(1);
  });

  it("非 JSON Patch 文本返回 null", () => {
    expect(detectJsonPatch("_.set('hp', 80);")).toBeNull();
    expect(detectJsonPatch("普通消息文本")).toBeNull();
    expect(detectJsonPatch("")).toBeNull();
  });

  it("普通 JSON 数组（无 op 字段）不匹配", () => {
    expect(detectJsonPatch('[1, 2, 3]')).toBeNull();
    expect(detectJsonPatch('[{"name":"test"}]')).toBeNull();
  });
});

// ------------------------------------------------------------------
// parseMvuMessage（增强版端到端测试）
// ------------------------------------------------------------------

describe("parseMvuMessage (enhanced)", () => {
  const baseData = {
    stat_data: { hp: 100, mp: 50, inventory: ["盾"] },
    schema: { type: "object" },
  };

  it("标准 _.set 命令正常解析", () => {
    const result = parseMvuMessage('_.set("hp", 80);', baseData);
    expect(result.stat_data.hp).toBe(80);
  });

  it("<UpdateVariable> 标签中的命令正常解析", () => {
    const msg = '角色受伤了。<UpdateVariable>_.set("hp", 70);</UpdateVariable>';
    const result = parseMvuMessage(msg, baseData);
    expect(result.stat_data.hp).toBe(70);
  });

  it("<initvar> 标签中的初始化命令正常解析", () => {
    const msg = '<initvar>_.set("hp", 200); _.set("mp", 100);</initvar>';
    const result = parseMvuMessage(msg, baseData);
    expect(result.stat_data.hp).toBe(200);
    expect(result.stat_data.mp).toBe(100);
  });

  it("JSON Patch replace 操作正常解析", () => {
    const msg = '<UpdateVariable>[{"op":"replace","path":"/hp","value":60}]</UpdateVariable>';
    const result = parseMvuMessage(msg, baseData);
    expect(result.stat_data.hp).toBe(60);
  });

  it("JSON Patch add 操作正常解析", () => {
    const msg = '[{"op":"add","path":"/strength","value":15}]';
    const result = parseMvuMessage(msg, baseData);
    expect(result.stat_data.strength).toBe(15);
  });

  it("JSON Patch remove 操作正常解析", () => {
    const msg = '[{"op":"remove","path":"/mp"}]';
    const result = parseMvuMessage(msg, baseData);
    expect(result.stat_data.mp).toBeUndefined();
  });

  it("JSON Patch move 操作正常解析", () => {
    const data = { stat_data: { temp: "value", other: 1 } };
    const msg = '[{"op":"move","from":"/temp","path":"/permanent"}]';
    const result = parseMvuMessage(msg, data);
    expect(result.stat_data.temp).toBeUndefined();
    expect(result.stat_data.permanent).toBe("value");
  });

  it("JSON Patch copy 操作正常解析", () => {
    const data = { stat_data: { source: "hello" } };
    const msg = '[{"op":"copy","from":"/source","path":"/dest"}]';
    const result = parseMvuMessage(msg, data);
    expect(result.stat_data.source).toBe("hello");
    expect(result.stat_data.dest).toBe("hello");
  });

  it("oldData 为 null 时安全返回", () => {
    expect(parseMvuMessage("test", null)).toBeNull();
    expect(parseMvuMessage("test", undefined)).toBeUndefined();
  });

  it("不修改原始数据（深拷贝保护）", () => {
    const original = { stat_data: { hp: 100 } };
    parseMvuMessage('_.set("hp", 50);', original);
    expect(original.stat_data.hp).toBe(100);
  });
});

describe("parseNestedYaml & deepMerge & XML YAML fallbacks", () => {
  it("parseNestedYaml 应该正确解析缩进式 YAML", () => {
    const yamlStr = `
stat_data:
  好感度: 80
  _依存度: 0
  角色名册:
    萧曦月:
      好感度: 95
      _关系: 师徒
    叶书篱:
      好感度: 60
`;
    const parsed = parseNestedYaml(yamlStr);
    expect(parsed.stat_data.好感度).toBe(80);
    expect(parsed.stat_data._依存度).toBe(0);
    expect(parsed.stat_data.角色名册.萧曦月.好感度).toBe(95);
    expect(parsed.stat_data.角色名册.萧曦月._关系).toBe("师徒");
    expect(parsed.stat_data.角色名册.叶书篱.好感度).toBe(60);
  });

  it("deepMerge 应该正确深度合并对象", () => {
    const target = {
      hp: 100,
      sub: {
        x: 1,
        y: 2,
      }
    };
    const source = {
      mp: 50,
      sub: {
        y: 20,
        z: 3,
      }
    };
    const result = deepMerge(target, source);
    expect(result.hp).toBe(100);
    expect(result.mp).toBe(50);
    expect(result.sub.x).toBe(1);
    expect(result.sub.y).toBe(20);
    expect(result.sub.z).toBe(3);
  });

  it("parseMvuMessage 应该正确解析消息中的 XML 嵌套 YAML", () => {
    const msg = `<initvar>
好感度: 80
_依存度: 10
sub:
  val: true
</initvar>`;
    const oldData = {
      stat_data: {
        好感度: 50,
        other: "keep"
      }
    };
    const result = parseMvuMessage(msg, oldData);
    expect(result.stat_data.好感度).toBe(80);
    expect(result.stat_data._依存度).toBe(10);
    expect(result.stat_data.other).toBe("keep");
    expect(result.stat_data.sub.val).toBe(true);
  });

  it("initializeMvuFromCharacter 应该在 extensions 无配置时 fallback 解析 first_mes 中的 initvar", () => {
    const char = {
      name: "叶家",
      first_mes: `<initvar>
好感度: 85
_依存度: 15
</initvar>`
    };
    const result = initializeMvuFromCharacter(char as any);
    expect(result.stat_data.好感度).toBe(85);
    expect(result.stat_data._依存度).toBe(15);
  });
});
