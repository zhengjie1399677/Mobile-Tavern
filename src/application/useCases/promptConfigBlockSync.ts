import type { PromptBlock } from "../../domain/prompt-composition";

export interface PromptBlockReference {
  id: string;
  identifier?: string;
}

const MAIN_PROMPT_BLOCK_IDS = new Set(["built-in-main-prompt", "example_main"]);
const JAILBREAK_PROMPT_BLOCK_IDS = new Set(["built-in-jailbreak-prompt"]);

function templateUsesMacro(block: PromptBlock, macro: string): boolean {
  return block.source.type === "template" && block.template.includes(`{{${macro}}}`);
}

/** 识别消费通用主 Prompt 数据源的区块，不解释外部兼容 identifier。 */
export function isMainPromptBlock(block: PromptBlock): boolean {
  return MAIN_PROMPT_BLOCK_IDS.has(block.id) || templateUsesMacro(block, "prompt.main");
}

/** 识别消费通用规则 Prompt 数据源的区块，不解释外部兼容 identifier。 */
export function isJailbreakPromptBlock(block: PromptBlock): boolean {
  return JAILBREAK_PROMPT_BLOCK_IDS.has(block.id) || templateUsesMacro(block, "prompt.jailbreak");
}

/** 通过内部 ID 或不透明兼容 identifier 关联自定义词条与编排区块。 */
export function matchesPromptBlockReference(
  block: PromptBlock,
  reference: PromptBlockReference,
): boolean {
  if (block.id === reference.id) return true;
  const originalIdentifier = block.compatibility?.originalIdentifier;
  return originalIdentifier === reference.id
    || (reference.identifier !== undefined && originalIdentifier === reference.identifier);
}
