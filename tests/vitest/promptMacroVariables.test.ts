import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createKernel } from "../../src/kernel/Kernel";
import { CompatibilityRuntimeService } from "../../src/application/services/CompatibilityRuntimeService";
import { PromptService } from "../../src/application/services/PromptService";
import {
  createPromptMacroVariableScope,
  replacePromptMacros,
  type PromptMacroParams,
} from "../../src/application/services/prompt/PromptMacroFormatter";
import {
  SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID,
} from "../../src/application/compatibility/contracts";
import {
  buildSillyTavernInjectionPromptSections,
  mountRuntimeProfile,
  sillyTavernCompatibilityRuntimePlugin,
  type RuntimePluginDefinition,
  type RuntimeProfileDefinition,
} from "../../src/application/runtimePlugins";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { CharacterCard, ChatSession, CustomPromptBlock, UserSettings } from "../../src/types";

/**
 * `{{setvar}}` / `{{getvar}}` 兼容宏。
 *
 * 语义依据：SillyTavern `public/scripts/variables.js` 的 `getVariableMacros()`
 * - `setvar`：`/{{setvar::([^:]+)::([^}]*)}}/gi`，名称 trim 后写入当前聊天变量，宏本身替换为空串；
 * - `getvar`：`/{{getvar::([^}]+)}}/gi`，名称 trim 后取当前聊天变量，**缺失时返回 `''`**；
 * - 变量宏在 ST 里属于 `preEnvMacros`，先于 `{{char}}` / `{{user}}` 等环境宏执行。
 *
 * 作用域边界（本实现）：这两个宏作用于「当前聊天变量」，权威位置仍是会话变量命名空间
 * `runtimePluginState["mobile-tavern.sillytavern-compat"]`（旧 `session.variables` 仅作读取降级）。
 * 组装期只创建一次性工作集并从中播种，不新增第二套变量存储、不写回会话。
 */

const BASE_PARAMS: PromptMacroParams = {
  char: "角色",
  user: "用户",
  description: "描述",
  personality: "性格",
  scenario: "场景",
  userPersona: "人设",
  mes_example: "",
};

function createCharacter(): CharacterCard {
  return {
    id: "character-macro",
    name: "角色",
    description: "描述",
    personality: "性格",
    scenario: "场景",
    first_mes: "开场",
    mes_example: "",
    extensions: {},
  } as CharacterCard;
}

function createChat(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-macro",
    characterId: "character-macro",
    title: "宏测试",
    createdAt: 1,
    messages: [],
    summaries: [],
    ...overrides,
  };
}

function createBlock(overrides: Partial<CustomPromptBlock> & Pick<CustomPromptBlock, "id">): CustomPromptBlock {
  return {
    name: overrides.id,
    role: "system",
    content: "",
    enabled: true,
    ...overrides,
  } as CustomPromptBlock;
}

/** 只注册兼容运行时服务（不装载插件），用于组装路径本身的行为断言。 */
async function createPromptService() {
  const kernel = createKernel();
  const runtime = new CompatibilityRuntimeService();
  await kernel.registerService(runtime.name, runtime);
  const prompt = new PromptService();
  prompt.init(kernel);
  return { kernel, runtime, prompt };
}

describe("变量宏：现状取证", () => {
  it("不提供作用域时，变量宏与未知宏一样原样保留（历史行为：注入宏字面量而非被丢弃）", () => {
    // 旧实现的兜底是 `macroMap[key] ?? match`，而 `{{setvar::a::b}}` 连词法都不命中
    // （[a-zA-Z0-9_]+ 不吃 `:`），所以整段宏原封不动留在提示词里。
    expect(replacePromptMacros("{{setvar::base_writing::冷峻}}", BASE_PARAMS))
      .toBe("{{setvar::base_writing::冷峻}}");
    expect(replacePromptMacros("{{getvar::base_writing}}", BASE_PARAMS))
      .toBe("{{getvar::base_writing}}");
  });

  it("环境宏不受影响，仍然正常替换", () => {
    expect(replacePromptMacros("{{char}}对{{user}}说", BASE_PARAMS)).toBe("角色对用户说");
  });
});

describe("变量宏：ST 语义", () => {
  it("setvar 渲染为空串并把值写入作用域", () => {
    const scope = createPromptMacroVariableScope();
    expect(replacePromptMacros("前{{setvar::base_writing::冷峻克制}}后", { ...BASE_PARAMS, variableScope: scope }))
      .toBe("前后");
    expect(scope.get("base_writing")).toBe("冷峻克制");
  });

  it("同一段文本内先 set 后 get 能读到（set 先于 get 执行）", () => {
    const scope = createPromptMacroVariableScope();
    expect(replacePromptMacros("{{setvar::k::值}}->{{getvar::k}}", { ...BASE_PARAMS, variableScope: scope }))
      .toBe("->值");
  });

  it("未设置的变量按 ST 语义渲染为空串（getLocalVariable 缺失返回 ''）", () => {
    const scope = createPromptMacroVariableScope();
    expect(replacePromptMacros("[{{getvar::never_set}}]", { ...BASE_PARAMS, variableScope: scope }))
      .toBe("[]");
  });

  it("变量名按 ST 语义 trim，变量值原样保留", () => {
    const scope = createPromptMacroVariableScope();
    replacePromptMacros("{{setvar::  base_writing  ::  冷峻  }}", { ...BASE_PARAMS, variableScope: scope });
    expect(scope.get("base_writing")).toBe("  冷峻  ");
    expect(replacePromptMacros("{{getvar::  base_writing  }}", { ...BASE_PARAMS, variableScope: scope }))
      .toBe("  冷峻  ");
  });

  it("值可跨行、可含冒号（预设的正文形态）", () => {
    const scope = createPromptMacroVariableScope();
    const body = "文风：冷峻\n- 短句\n- 少形容词";
    expect(replacePromptMacros(`{{setvar::base_writing::${body}}}`, { ...BASE_PARAMS, variableScope: scope }))
      .toBe("");
    expect(scope.get("base_writing")).toBe(body);
  });

  it("getvar 插入的正文仍会被随后的环境宏替换（变量宏先于环境宏）", () => {
    const scope = createPromptMacroVariableScope({ who: "{{char}}" });
    expect(replacePromptMacros("{{getvar::who}}", { ...BASE_PARAMS, variableScope: scope })).toBe("角色");
  });

  it("值里出现 `}` 时按 ST 原正则截断（与官方同形，不做更宽容的解析）", () => {
    // ST 的 setvar 正则值是 `[^}]*`，遇到第一个 `}` 就结束取值；
    // 记录这条是为了让「正文里不要出现右花括号，否则会被截断或整段不匹配」
    // 这一来源格式约束有据可查——它是 ST 本身的口径，不是宿主的解析缺陷。
    const scope = createPromptMacroVariableScope();
    const output = replacePromptMacros("{{setvar::who::{{char}}}}", { ...BASE_PARAMS, variableScope: scope });
    expect(scope.get("who")).toBe("{{char");
    // 宿主既有的花括号归一化层先把 `{{char}}}}` 收成 `{{char}}`，因此这里不留残渣；
    // 截断本身仍发生在第一个 `}` 处。
    expect(output).toBe("");
  });

  it("不误伤普通文本里的花括号与未知宏", () => {
    const scope = createPromptMacroVariableScope({ 已设置: "设置值" });
    const text = "代码示例：{单花括号} 与 {{unknown_macro}} 与 {{文风}} 与 ${ \"x\" }";
    expect(replacePromptMacros(text, { ...BASE_PARAMS, variableScope: scope })).toBe(text);
    expect(replacePromptMacros("{{getvar::已设置}}", { ...BASE_PARAMS, variableScope: scope })).toBe("设置值");
  });
});

describe("变量宏：工作集播种", () => {
  it("只播种可直接渲染的标量，结构化数据不进作用域", () => {
    const scope = createPromptMacroVariableScope({
      text: "文本",
      count: 2,
      flag: false,
      stat_data: { 好感: 8 },
    });
    expect(scope.get("text")).toBe("文本");
    expect(scope.get("count")).toBe("2");
    expect(scope.get("flag")).toBe("false");
    expect(scope.get("stat_data")).toBeUndefined();
  });
});

describe("变量宏：预设区块端到端", () => {
  it("同一份组装内前一个模块 set、后一个模块 get（社区预设的「选文风」结构）", async () => {
    const { kernel, prompt } = await createPromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.roleplayMode = true;
    settings.promptConfig.customPrompts = [
      createBlock({
        id: "style-writer",
        identifier: "style-writer",
        name: "🔒丨文风",
        order: 10,
        content: "写作要求：\n{{setvar::base_writing::文风：冷峻克制，多用短句，少用形容词。}}",
      }),
      createBlock({
        id: "style-reader",
        identifier: "style-reader",
        name: "🔒丨Core",
        order: 20,
        content: "【当前生效文风】\n{{getvar::base_writing}}",
      }),
    ];

    const result = prompt.assemblePrompt({
      character: createCharacter(),
      chat: createChat(),
      settings,
      userInput: "继续",
    });

    // 读取模块拿到的是前面模块写入的正文，而不是宏字面量——这正是"选了等于没选"的缺陷点。
    expect(result.systemInstruction).toContain("【当前生效文风】\n文风：冷峻克制，多用短句，少用形容词。");
    expect(result.systemInstruction).not.toContain("setvar");
    expect(result.systemInstruction).not.toContain("getvar");
    await kernel.destroy();
  });

  it("读取模块排在写入模块之前时读到空串（与 ST 一致：同一次替换按顺序生效）", async () => {
    const { kernel, prompt } = await createPromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.roleplayMode = true;
    settings.promptConfig.customPrompts = [
      createBlock({
        id: "style-reader",
        identifier: "style-reader",
        order: 10,
        content: "【当前生效文风】\n{{getvar::base_writing}}",
      }),
      createBlock({
        id: "style-writer",
        identifier: "style-writer",
        order: 20,
        content: "{{setvar::base_writing::顺序反转的文风}}",
      }),
    ];

    const result = prompt.assemblePrompt({
      character: createCharacter(),
      chat: createChat(),
      settings,
      userInput: "继续",
    });

    // 顺序是预设自身的契约：读取模块必须在写入模块之后，否则和 ST 一样读不到值。
    expect(result.systemInstruction).not.toContain("顺序反转的文风");
    expect(result.systemInstruction).not.toContain("getvar");
    await kernel.destroy();
  });

  it("写模块未启用时读取模块渲染为空串，不留宏字面量", async () => {
    const { kernel, prompt } = await createPromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.roleplayMode = true;
    settings.promptConfig.customPrompts = [
      createBlock({
        id: "style-writer",
        identifier: "style-writer",
        order: 10,
        enabled: false,
        content: "{{setvar::base_writing::不该生效的文风}}",
      }),
      createBlock({
        id: "style-reader",
        identifier: "style-reader",
        order: 20,
        content: "【当前生效文风】\n{{getvar::base_writing}}",
      }),
    ];

    const result = prompt.assemblePrompt({
      character: createCharacter(),
      chat: createChat(),
      settings,
      userInput: "继续",
    });

    expect(result.systemInstruction).not.toContain("不该生效的文风");
    expect(result.systemInstruction).not.toContain("getvar");
    await kernel.destroy();
  });

  it("组装不把变量写回会话（工作集不持久化，权威位置不变）", async () => {
    const { kernel, prompt } = await createPromptService();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.roleplayMode = true;
    settings.promptConfig.customPrompts = [
      createBlock({
        id: "style-writer",
        identifier: "style-writer",
        order: 10,
        content: "{{setvar::base_writing::冷峻}}",
      }),
    ];
    const chat = createChat({
      variables: { legacyOnly: "旧值" },
      runtimePluginState: { [SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID]: { namespacedOnly: "新值" } },
    });
    const before = structuredClone(chat);

    prompt.assemblePrompt({ character: createCharacter(), chat, settings, userInput: "继续" });

    // 跨轮保留是待定产品决策：当前实现不写回，也不新增第二套变量存储。
    expect(chat).toEqual(before);
    expect(chat.runtimePluginState?.[SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID]).toEqual({ namespacedOnly: "新值" });
    expect((chat.variables as Record<string, unknown> | undefined)?.base_writing).toBeUndefined();
    await kernel.destroy();
  });
});

describe("变量宏：兼容区块共享同一份组装变量", () => {
  it("深度提示词能读到同一组装里预设区块写入的变量；未传作用域时保持原样保留", () => {
    const character = {
      ...createCharacter(),
      extensions: {
        depth_prompt: { prompt: "文风：{{getvar::base_writing}}", depth: 2, role: "assistant" },
      },
    } as CharacterCard;
    const request = {
      character,
      chat: createChat(),
      settings: { userName: "用户" } as UserSettings,
      hasVariableListEntry: false,
    };

    const scope = createPromptMacroVariableScope({ base_writing: "冷峻克制" });
    const nodes = buildSillyTavernInjectionPromptSections({ ...request, variableScope: scope });
    expect(nodes[0]?.content).toBe("文风：冷峻克制");

    const withoutScope = buildSillyTavernInjectionPromptSections(request);
    expect(withoutScope[0]?.content).toBe("文风：{{getvar::base_writing}}");
  });
});

describe("变量宏：作用域与既有会话变量权威一致", () => {
  it("播种自插件命名空间，缺命名空间时降级读旧 session.variables", async () => {
    const kernel = createKernel();
    const service = new CompatibilityRuntimeService();
    const disposeService = await kernel.registerService(service.name, service);
    const corePlugin: RuntimePluginDefinition = {
      id: "mobile-tavern.legacy-runtime",
      version: "1.0.0",
      configSchema: z.undefined(),
      setup: () => undefined,
    };
    const tavernProfile: RuntimeProfileDefinition = {
      id: "test.tavern.macro",
      version: 1,
      plugins: [
        { id: corePlugin.id, version: corePlugin.version },
        { id: SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID, version: sillyTavernCompatibilityRuntimePlugin.version },
      ],
      contributions: {
        "compat.codec": ["compat.sillytavern.codec.prompt-preset"],
        "compat.prompt-section": [
          "compat.sillytavern.prompt.mvu-state",
          "compat.sillytavern.prompt.world-info",
          "compat.sillytavern.prompt.injection-prompts",
        ],
        "compat.context-source": ["compat.sillytavern.context.mvu-state"],
        "compat.transform": ["compat.sillytavern.transform.regex"],
        "compat.state-reducer": ["compat.sillytavern.state.mvu"],
        "compat.world-info-resolver": ["compat.sillytavern.world-info"],
        "compat.renderer": ["compat.sillytavern.renderer"],
      },
    };
    const mounted = await mountRuntimeProfile({
      kernel,
      profile: tavernProfile,
      plugins: [corePlugin, sillyTavernCompatibilityRuntimePlugin],
    });
    const prompt = new PromptService();
    prompt.init(kernel);

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.roleplayMode = true;
    settings.promptConfig.customPrompts = [
      createBlock({
        id: "style-reader",
        identifier: "style-reader",
        order: 10,
        content: "【当前生效文风】{{getvar::base_writing}}",
      }),
    ];
    const assemble = (chat: ChatSession) => prompt.assemblePrompt({
      character: createCharacter(),
      chat,
      settings,
      userInput: "继续",
    }).systemInstruction;

    // 命名空间是权威位置。
    expect(assemble(createChat({
      runtimePluginState: { [SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID]: { base_writing: "命名空间文风" } },
    }))).toContain("【当前生效文风】命名空间文风");

    // 缺命名空间时降级读旧字段。
    expect(assemble(createChat({ variables: { base_writing: "旧字段文风" } })))
      .toContain("【当前生效文风】旧字段文风");

    // 两者同时存在时命名空间优先，旧字段不参与。
    expect(assemble(createChat({
      variables: { base_writing: "旧字段文风" },
      runtimePluginState: { [SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID]: { base_writing: "命名空间文风" } },
    }))).toContain("【当前生效文风】命名空间文风");

    await mounted.dispose();
    await disposeService();
    await kernel.destroy();
  });
});
