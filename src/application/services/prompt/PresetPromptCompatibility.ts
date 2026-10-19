import type { CustomPromptBlock, PromptConfig } from "../../../types";
import {
  selectActivePromptBlocks,
  selectInChatPromptBlocks,
} from "../../../domain/prompts/promptSourceBlocks";
import type { PromptMessage } from "../../../domain/prompts/promptAssemblyTypes";
import type { PromptMacroParams } from "./PromptMacroFormatter";

type MacroReplacer = (text: string, params: PromptMacroParams) => string;

export interface PresetInChatNode {
  content: string;
  metadata: {
    position: "in_chat";
    depth: number;
    role: CustomPromptBlock["role"];
    order: number;
  };
}

export interface PresetPromptPlan {
  systemPrompt: string;
  roleMessages: Array<{ role: "user" | "assistant"; content: string }>;
  inChatNodes: PresetInChatNode[];
}

/**
 * SillyTavern 预设的 Prompt 结构语义收口。
 *
 * 所有启用条目必须按来源顺序**整体求值一次**，再按用途分流：绝对位置条目进入
 * 聊天历史注入，相对位置的 user/assistant 条目保留角色放在历史之前，system 条目
 * 才并入核心规则。先分流再求值会让后面的 `setvar` 早于前面的 `getvar` 生效，
 * 破坏「选文风」这类社区预设依赖的同一次替换顺序。
 */
export function buildPresetPromptPlan(
  promptConfig: PromptConfig | undefined,
  generationType: string,
  replaceMacros: MacroReplacer,
  macroParams: PromptMacroParams,
): PresetPromptPlan {
  const sourceBlocks = promptConfig?.customPrompts ?? [];
  const mainPrompt = promptConfig?.useMainPrompt !== false && promptConfig?.mainPrompt
    ? replaceMacros(promptConfig.mainPrompt, macroParams)
    : "";

  const relativeBlocks = promptConfig?.customPrompts?.length
    ? selectActivePromptBlocks(promptConfig.customPrompts, promptConfig)
    : [];
  const absoluteBlocks = selectInChatPromptBlocks(sourceBlocks, generationType);
  const activeBlocks = [...relativeBlocks, ...absoluteBlocks];

  // 以来源数组下标恢复 prompt_order 的先后，避免两个选择器各自的排序改变宏求值顺序。
  const sourceIndex = new Map(sourceBlocks.map((block, index) => [block, index] as const));
  const compiled = activeBlocks
    .map((block) => ({ block, index: sourceIndex.get(block) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.index - right.index)
    .map(({ block }) => ({ block, content: replaceMacros(block.content, macroParams) }));

  const systemContents: string[] = [];
  const roleMessages: PresetPromptPlan["roleMessages"] = [];
  const inChatNodes: PresetInChatNode[] = [];
  for (const { block, content } of compiled) {
    if (block.injection_position === 1) {
      inChatNodes.push({
        content,
        metadata: {
          position: "in_chat",
          depth: block.injection_depth ?? 4,
          role: block.role,
          // applyInChatPromptNodes 按 order 升序插入；取负值还原 ST「高 order 优先」。
          order: -(block.injection_order ?? 100),
        },
      });
    } else if (block.role === "user" || block.role === "assistant") {
      roleMessages.push({ role: block.role, content });
    } else {
      systemContents.push(content);
    }
  }

  const compiledBlocks = systemContents.join("\n\n");
  return {
    systemPrompt: mainPrompt && compiledBlocks ? `${mainPrompt}\n\n${compiledBlocks}` : (mainPrompt || compiledBlocks),
    roleMessages,
    inChatNodes,
  };
}

/** 把非 system 模块插到 system 之后、聊天历史之前。 */
export function insertPresetRoleMessages(
  messages: readonly PromptMessage[],
  roleMessages: PresetPromptPlan["roleMessages"],
): PromptMessage[] {
  if (roleMessages.length === 0 || messages.length === 0) return [...messages];
  return [messages[0], ...roleMessages, ...messages.slice(1)];
}

/** 应用 ST 的 `scenario_format` / `personality_format`；未声明或原值为空时保持原文。 */
export function applyPresetFieldFormat(
  value: string,
  format: string | undefined,
  replaceMacros: MacroReplacer,
  macroParams: PromptMacroParams,
): string {
  return format && value
    ? replaceMacros(format, macroParams)
    : replaceMacros(value, macroParams);
}
