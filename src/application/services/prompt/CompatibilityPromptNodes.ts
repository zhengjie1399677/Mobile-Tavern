import type {
  CompatibilityPromptSectionRequest,
  ICompatibilityRuntimeService,
} from "../../compatibility/contracts";
import type { PromptNode } from "./types";
import type { CharacterCard, Message, UserSettings } from "../../../types";

export interface CompatibilityInChatPromptNodes {
  readonly nodes: PromptNode[];
  readonly handlesLorebook: boolean;
}

/** 读取 Runtime Plugin 的通用历史深度注入贡献。 */
export function buildCompatibilityInChatPromptNodes(
  runtime: ICompatibilityRuntimeService | null,
  request: CompatibilityPromptSectionRequest,
): CompatibilityInChatPromptNodes {
  const nodes = (runtime?.buildPromptSections(request) ?? []).filter((node) =>
    node.metadata?.position === "in_chat");
  return {
    nodes,
    handlesLorebook: nodes.some((node) =>
      node.id.startsWith("sillytavern_world_info_in_chat_")),
  };
}

export function createCompatibilityHistoryCleaner(params: {
  readonly runtime: ICompatibilityRuntimeService | null;
  readonly character: CharacterCard;
  readonly settings: UserSettings;
  readonly signal?: AbortSignal;
}): (message: Message, depth: number) => string {
  return (message, depth) => params.runtime?.transformText({
    text: message.content,
    character: params.character,
    isAiMessage: message.sender === "assistant",
    charName: params.character.name,
    userName: params.settings.userName,
    mode: "prompt",
    depth,
    signal: params.signal,
    globalRegexScripts: params.settings.globalRegexScripts,
    presetRegexScripts: params.settings.presetRegexScripts,
  }) ?? message.content;
}
