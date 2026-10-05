import type { CustomPromptBlock } from "../../types";

/**
 * 传统 Prompt 区块与顶层字段的同源判定。
 *
 * SillyTavern 预设可能同时用根字段（`system_prompt` / `jailbreak_prompt`）和
 * `prompts[].content` 表达同一段核心提示词。应用的传统路径把根字段作为
 * `mainPrompt` / `jailbreakPrompt` 注入，如果再把同源的区块当普通模组注入一次，
 * 同一段文本就会在上下文里出现两遍。
 *
 * 判定收口在这里，供导入边界、运行期组装与设置界面共用，避免三处各自维护
 * 一份标识符清单而漂移。只有"标识符命中核心槽位"且"内容为空占位或与顶层字段
 * 完全同文"才算同源；内容不同的区块是用户/预设的真实模组，必须保留。
 */

const MAIN_IDENTIFIERS = new Set(["main", "mainprompt", "main_prompt", "systemprompt", "system_prompt"]);
const JAILBREAK_IDENTIFIERS = new Set(["jailbreak", "jailbreakprompt", "jailbreak_prompt"]);

export interface TopLevelPromptSources {
  mainPrompt?: string | undefined;
  jailbreakPrompt?: string | undefined;
}

/** 组装期需要同时知道"声明内容"与"是否启用"。 */
export interface TopLevelPromptSourceConfig extends TopLevelPromptSources {
  useMainPrompt?: boolean | undefined;
  useJailbreak?: boolean | undefined;
}

function blockIdentifier(block: Pick<CustomPromptBlock, "id" | "identifier">): string {
  return (block.identifier || block.id || "").trim().toLowerCase();
}

/** 区块是否与顶层核心字段属于同一来源（应当只保留顶层字段这一份）。 */
export function isSameSourcePromptBlock(
  block: Pick<CustomPromptBlock, "id" | "identifier" | "content">,
  target: "main" | "jailbreak",
  topLevelValue: string | undefined,
): boolean {
  const identifiers = target === "main" ? MAIN_IDENTIFIERS : JAILBREAK_IDENTIFIERS;
  if (!identifiers.has(blockIdentifier(block))) return false;
  const source = (topLevelValue ?? "").trim();
  if (!source) return false;
  const content = (block.content ?? "").trim();
  return content.length === 0 || content === source;
}

/** 剔除与顶层 `mainPrompt` / `jailbreakPrompt` 同源的重复区块。 */
export function dedupeTopLevelPromptBlocks<T extends CustomPromptBlock>(
  blocks: readonly T[],
  sources: TopLevelPromptSources,
): T[] {
  return blocks.filter((block) =>
    !isSameSourcePromptBlock(block, "main", sources.mainPrompt)
    && !isSameSourcePromptBlock(block, "jailbreak", sources.jailbreakPrompt));
}

/**
 * 选出真正注入的核心规则区块：只保留启用项、按注入顺序排序，并去掉与"生效中的"
 * 顶层 `mainPrompt` / `jailbreakPrompt` 同源的重复区块。
 *
 * 顶层字段被显式关闭（`useMainPrompt === false` / `useJailbreak === false`）时不去重：
 * 此时同源区块是该内容唯一的载体，去重会导致内容静默丢失。
 */
export function selectActivePromptBlocks(
  blocks: readonly CustomPromptBlock[],
  config: TopLevelPromptSourceConfig,
): CustomPromptBlock[] {
  return dedupeTopLevelPromptBlocks(
    [...blocks]
      .filter((block) => block.enabled)
      .sort((a, b) => (a.order ?? a.injection_order ?? 0) - (b.order ?? b.injection_order ?? 0)),
    {
      mainPrompt: config.useMainPrompt === false ? "" : config.mainPrompt,
      jailbreakPrompt: config.useJailbreak === false ? "" : config.jailbreakPrompt,
    },
  );
}
