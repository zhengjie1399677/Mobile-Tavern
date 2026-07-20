import { assert } from "./testUtils";
import {
  compilePromptComposition,
  parsePromptComposition,
  type PromptComposition,
  type PromptCompositionRuntimeData,
} from "../../src/domain/prompt-composition";
import {
  importSillyTavernPreset,
  exportSillyTavernComposition,
} from "../../src/infrastructure/compat/sillytavern/promptPresetAdapter";

export async function testPromptComposition(): Promise<void> {
  console.log("\n--- Running PromptComposition Verification ---");

  const composition: PromptComposition = {
    id: "composition_test",
    name: "自由编排测试",
    version: 1,
    blocks: [
      {
        id: "system_a",
        name: "系统一",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "A={{character.description}}",
        order: 10,
        placement: { type: "ordered" },
      },
      {
        id: "history",
        name: "聊天历史",
        enabled: true,
        role: "system",
        source: { type: "chat_history" },
        template: "",
        order: 20,
        placement: { type: "ordered" },
      },
      {
        id: "system_b",
        name: "系统二",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "B={{worldbook.triggered}}",
        order: 30,
        placement: { type: "ordered" },
      },
      {
        id: "depth_note",
        name: "历史注入",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "DEPTH",
        order: 40,
        placement: { type: "in_chat", depth: 1, order: 0 },
      },
    ],
  };
  const runtime: PromptCompositionRuntimeData = {
    values: {
      "character.description": "角色描述",
      "worldbook.triggered": "世界书",
    },
    history: [
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
    ],
  };
  const compiled = compilePromptComposition(composition, runtime);
  assert(compiled.messages.length === 5, "编排应产生两个 system、历史和深度注入消息");
  assert(compiled.messages[0].role === "system" && compiled.messages[0].content === "A=角色描述", "首个 system 应保持独立");
  assert(compiled.messages[2].content === "DEPTH", "depth=1 应插入最后一条历史消息之前");
  assert(compiled.messages[4].role === "system" && compiled.messages[4].content === "B=世界书", "末尾 system 应保持独立且不合并");

  const selectedHistory = compilePromptComposition({
    ...composition,
    blocks: [{
      ...composition.blocks[1],
      source: {
        type: "chat_history",
        selection: { mode: "recent", count: 2, preserveFirstAssistant: true },
      },
    }],
  }, {
    ...runtime,
    history: [
      { role: "assistant", content: "WELCOME" },
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "U2" },
    ],
  });
  assert(selectedHistory.messages.map((message) => message.content).join("|") === "WELCOME|U2", "历史裁剪和欢迎消息保留必须由区块显式控制");

  const targetedInjection = compilePromptComposition({
    ...composition,
    blocks: [
      { ...composition.blocks[1], id: "history_a", order: 10 },
      { ...composition.blocks[1], id: "history_b", order: 20 },
      {
        ...composition.blocks[3],
        placement: { type: "in_chat", depth: 0, historyBlockId: "history_b" },
      },
    ],
  }, runtime);
  assert(targetedInjection.messages.filter((message) => message.content === "DEPTH").length === 1, "目标化深度注入不得污染其他历史区块");
  assert(targetedInjection.messages[4].content === "DEPTH", "目标化深度注入应进入用户指定的历史区块");

  const empty = compilePromptComposition({ ...composition, blocks: [] }, runtime);
  assert(empty.messages.length === 0, "空编排必须合法且不得隐式注入任何消息");

  const unknownMacro = compilePromptComposition({
    ...composition,
    blocks: [{
      ...composition.blocks[0],
      template: "{{future.source}}",
    }],
  }, runtime);
  assert(unknownMacro.messages[0].content === "{{future.source}}", "未知宏必须原样保留，避免静默丢失");
  assert(unknownMacro.diagnostics.some((item) => item.code === "UNKNOWN_MACRO"), "未知宏必须生成诊断");

  const imported = importSillyTavernPreset({
    name: "ST 测试",
    future_root: { enabled: true },
    prompts: [
      { identifier: "main", name: "Main Prompt", role: "system", content: "MAIN", enabled: true },
      { identifier: "charDescription", name: "Character Description", role: "system", content: "", enabled: true },
      { identifier: "chatHistory", name: "Chat History", role: "system", content: "", enabled: true },
      { identifier: "custom-x", name: "自定义", role: "user", content: "CUSTOM", enabled: true, future_field: 42 },
    ],
    prompt_order: [{
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "charDescription", enabled: true },
        { identifier: "chatHistory", enabled: true },
        { identifier: "custom-x", enabled: true },
      ],
    }],
  });
  assert(imported.composition.blocks.length === 4, "ST Prompt Manager 顺序应转换为四个普通区块");
  assert(imported.composition.blocks[1].template === "{{character.description}}", "角色描述应转换为中立数据源宏");
  assert(imported.composition.blocks[2].source.type === "chat_history", "Chat History 应转换为历史数据源");
  assert(imported.report.warnings.some((warning) => warning.code === "PRESERVED_UNKNOWN_FIELDS"), "未知 ST 字段必须报告并隔离保留");
  assert(imported.report.warnings.some((warning) => warning.code === "PRESERVED_UNKNOWN_ROOT_FIELDS"), "未知 ST 根字段必须报告并隔离保留");

  const exported = exportSillyTavernComposition(imported.composition);
  assert(Array.isArray(exported.data.prompts) && exported.data.prompts.length === 4, "兼容编排应能导回 ST prompts");
  assert(exported.report.errors.length === 0, "基础兼容区块导出不应报错");
  assert((exported.data.future_root as { enabled?: boolean })?.enabled === true, "未知 ST 根字段必须支持兼容往返");

  const parsedSelection = parsePromptComposition(JSON.stringify({
    ...composition,
    blocks: [{
      ...composition.blocks[1],
      source: { type: "chat_history", selection: { mode: "recent", count: 3, preserveFirstAssistant: false } },
    }],
  }));
  assert(parsedSelection.blocks[0].source.type === "chat_history" && parsedSelection.blocks[0].source.selection?.mode === "recent", "原生编排必须持久化历史选择策略");

  let rejected = false;
  try {
    parsePromptComposition({ id: "bad", name: "bad", version: 1, blocks: [{ role: "root" }] });
  } catch {
    rejected = true;
  }
  assert(rejected, "原生编排外部输入必须经过严格防腐校验");

  console.log("✔ PromptComposition verified successfully!");
}
