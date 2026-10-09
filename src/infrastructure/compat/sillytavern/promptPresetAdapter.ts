import type { CustomPromptBlock } from "../../../types";
import type { PromptMessageRole } from "../../../domain/prompts/promptAssemblyTypes";
import type { CompatibilityCodecDefinition } from "../../../application/compatibility/contracts";

/**
 * SillyTavern Prompt 预设 → 应用内部传统 Prompt 列表的解析。
 *
 * 这里只负责来源语义的收口：顺序容器（`prompt_order`）、候选库丢弃、角色别名、
 * 根字段补录与自包含字段（`marker` / `injection_*`）。通用用例只消费结果，
 * 不反向识别来源字段（见 `COMPAT-DATA` 与 sillytavern_compat.md）。
 */

interface SillyTavernPromptOrderEntry {
  identifier?: string;
  enabled?: boolean;
}

/**
 * 把来源预设的 Prompt 候选列表收口为应用内部传统 Prompt 块。
 *
 * 存在 `prompt_order` 时只保留排序条目（候选库 Prompt 不进入界面列表），
 * 完全缺失时按 `prompts` 原序降级保留。
 */
export function readSillyTavernPresetPrompts(input: unknown): CustomPromptBlock[] {
  const data = isRecord(input) ? input : {};
  const rawPrompts = Array.isArray(data.prompts)
    ? data.prompts
    : Array.isArray(data.customPrompts) ? data.customPrompts : [];
  const prompts = rawPrompts.filter(isRecord);
  const order = readPromptOrder(data.prompt_order ?? data.promptOrder);
  const orderByIdentifier = new Map(order.map((entry) => [entry.identifier, entry]));
  const promptByIdentifier = new Map(prompts.map((prompt, index) => [
    readLegacyPromptIdentifier(prompt, index),
    prompt,
  ]));

  // 若根字段声明了核心 Prompt 且 prompts 列表中未定义，则补充收录避免遗漏
  addRootPrompt(promptByIdentifier, "main", data.system_prompt ?? data.mainPrompt, "Main Prompt");
  addRootPrompt(promptByIdentifier, "jailbreak", data.jailbreak_prompt ?? data.jailbreakPrompt, "Jailbreak");
  addRootPrompt(promptByIdentifier, "postHistoryInstructions", data.post_history_instructions ?? data.postHistoryPrompt, "Post-History Instructions");
  addRootPrompt(promptByIdentifier, "storyString", data.story_string ?? data.storyString, "Story String");

  const identifiers = selectOrderedPromptEntries(
    order,
    [...promptByIdentifier.keys()].map((identifier) => ({ identifier })),
  )
    .map((entry) => entry.identifier)
    .filter((identifier): identifier is string => typeof identifier === "string");

  return identifiers.map((identifier) => {
    const prompt = promptByIdentifier.get(identifier) ?? {};
    const orderEntry = orderByIdentifier.get(identifier);
    const resolvedEnabled = typeof orderEntry?.enabled === "boolean"
      ? orderEntry.enabled
      : (typeof prompt.enabled === "boolean" ? prompt.enabled : true);

    return {
      id: readStringOrUndefined(prompt.id) ?? identifier,
      identifier,
      name: readStringOrUndefined(prompt.name) || identifier || "自定义模组",
      role: resolvePromptRole(readStringOrUndefined(prompt.role)),
      content: readStringOrUndefined(prompt.content ?? prompt.system_prompt) ?? "",
      enabled: resolvedEnabled,
      marker: prompt.marker === true || undefined,
      system_prompt: typeof prompt.system_prompt === "boolean" ? prompt.system_prompt : undefined,
      injection_position: readOptionalNumber(prompt.injection_position),
      injection_depth: readOptionalNumber(prompt.injection_depth),
      injection_order: readOptionalNumber(prompt.injection_order),
      forbid_overrides: typeof prompt.forbid_overrides === "boolean" ? prompt.forbid_overrides : undefined,
      injection_trigger: readOptionalStringArray(prompt.injection_trigger),
    };
  });
}

/**
 * SillyTavern Prompt 预设 Codec 的唯一定义。
 *
 * 受信 Runtime Plugin、预设样例验收工具与夹具都复用同一份来源语义，避免各处自行拼装
 * 导致顺序或字段收口漂移（见 `COMPAT-DATA`）。
 */
export const sillyTavernPromptPresetCodec: CompatibilityCodecDefinition = {
  id: "compat.sillytavern.codec.prompt-preset",
  version: "1.0.0",
  format: "sillytavern.prompt-preset",
  readPresetPrompts: readSillyTavernPresetPrompts,
};

function selectOrderedPromptEntries(
  order: readonly SillyTavernPromptOrderEntry[],
  fallback: readonly SillyTavernPromptOrderEntry[],
): readonly SillyTavernPromptOrderEntry[] {
  return order.length > 0 ? order : fallback;
}

/** ST 的 `model` 角色等价于 assistant；只识别 system/user/assistant，其余降级为 system。 */
function resolvePromptRole(rawRole: string | undefined): PromptMessageRole {
  if (rawRole === "model") return "assistant";
  return rawRole === "user" || rawRole === "assistant" || rawRole === "system" ? rawRole : "system";
}

function readPromptOrder(value: unknown): SillyTavernPromptOrderEntry[] {
  if (!Array.isArray(value)) return [];

  const containers = value.filter((item) => isRecord(item) && Array.isArray(item.order));
  if (containers.length > 0) {
    const container = containers.find((item) =>
      isRecord(item) && (item.character_id === 100001 || item.character_id === "100001") && Array.isArray(item.order) && item.order.length > 0
    ) ?? containers.find((item) =>
      isRecord(item) && (item.character_id === 100001 || item.character_id === "100001")
    ) ?? containers.find((item) =>
      isRecord(item) && Array.isArray(item.order) && item.order.length > 0
    ) ?? containers[0];

    if (!isRecord(container) || !Array.isArray(container.order)) return [];
    return normalizeOrderEntries(container.order);
  }

  return normalizeOrderEntries(value);
}

function normalizeOrderEntries(entries: unknown[]): SillyTavernPromptOrderEntry[] {
  return entries
    .filter(isRecord)
    .map((item) => ({
      identifier: readOptionalString(item.identifier),
      enabled: typeof item.enabled === "boolean" ? item.enabled : undefined,
    }))
    .filter((item) => item.identifier);
}

function addRootPrompt(
  prompts: Map<string, Record<string, unknown>>,
  identifier: string,
  value: unknown,
  name: string
): void {
  const content = readOptionalString(value);
  if (!content || prompts.has(identifier)) return;
  prompts.set(identifier, { identifier, name, role: "system", content, enabled: true });
}

/**
 * 传统 Prompt 列表的历史标识符推导：只接受字符串 `identifier`，其次字符串 `id`，
 * 最后按下标兜底。历史上空串被保留、非字符串回落到下标，单点化不得改变既有导入结果
 * （`CHANGE-SAFE`）。
 */
function readLegacyPromptIdentifier(prompt: Record<string, unknown>, index: number): string {
  return readStringOrUndefined(prompt.identifier)
    ?? readStringOrUndefined(prompt.id)
    ?? `prompt_${index + 1}`;
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 原样保留空字符串，只把非字符串视为未提供（与 `readOptionalString` 的空串兜底语义区分）。 */
function readStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
