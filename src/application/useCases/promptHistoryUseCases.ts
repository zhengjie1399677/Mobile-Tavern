import type { IDatabaseService } from "../serviceContracts";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
  UserSettings,
} from "../../types";
import { applyPromptSceneProfile } from "../../domain/prompt-composition";

interface PromptHistoryRequirement {
  limit?: number;
  preserveFirstAssistant: boolean;
}

export function resolvePromptHistoryRequirement(
  session: ChatSession,
  settings: UserSettings,
): PromptHistoryRequirement {
  if (settings.promptConfig?.usePromptComposition) {
    const composition = settings.promptConfig.composition;
    if (!composition) return { limit: 0, preserveFirstAssistant: false };
    const resolved = applyPromptSceneProfile(composition, session.activePromptSceneProfileId);
    const historyBlocks = resolved.composition.blocks.filter(
      (block) => block.enabled && block.source.type === "chat_history",
    );
    if (historyBlocks.length === 0) return { limit: 0, preserveFirstAssistant: false };
    if (historyBlocks.some((block) =>
      block.source.type === "chat_history"
      && (!block.source.selection || block.source.selection.mode === "all")
    )) {
      return { preserveFirstAssistant: false };
    }
    return {
      limit: Math.max(...historyBlocks.map((block) =>
        block.source.type === "chat_history" && block.source.selection?.mode === "recent"
          ? Math.max(0, Math.floor(block.source.selection.count))
          : 0
      )),
      preserveFirstAssistant: historyBlocks.some((block) =>
        block.source.type === "chat_history"
        && block.source.selection?.mode === "recent"
        && block.source.selection.preserveFirstAssistant
      ),
    };
  }

  const configured = settings.memory?.recentTurns;
  return {
    limit: typeof configured === "number" && Number.isFinite(configured)
      ? Math.max(1, Math.floor(configured))
      : 6,
    preserveFirstAssistant: true,
  };
}

export async function buildAuthoritativePromptSession(
  databaseService: IDatabaseService<
    ChatSession,
    CharacterCard,
    SummaryCard,
    Message,
    ChatSessionMetadataPatch
  >,
  session: ChatSession,
  settings: UserSettings,
  beforeMessageId?: string,
): Promise<ChatSession> {
  const requirement = resolvePromptHistoryRequirement(session, settings);
  const messages = requirement.limit === 0
    ? []
    : await databaseService.getSessionPromptMessages(session.id, {
        ...requirement,
        beforeMessageId,
      });
  return { ...session, messages };
}
