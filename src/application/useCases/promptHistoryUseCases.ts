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
    // 编排可以不发送聊天历史，但世界书触发扫描仍需要一个独立、受控的历史窗口。
    // 这些消息只进入 runtime 数据源；没有 chat_history 区块时编译器不会把它们发给模型。
    const lorebookScanLimit = resolveLegacyRecentTurns(settings);
    const composition = settings.promptConfig.composition;
    if (!composition) return { limit: lorebookScanLimit, preserveFirstAssistant: false };
    const resolved = applyPromptSceneProfile(composition, session.activePromptSceneProfileId);
    const historyBlocks = resolved.composition.blocks.filter(
      (block) => block.enabled && block.source.type === "chat_history",
    );
    if (historyBlocks.length === 0) return { limit: lorebookScanLimit, preserveFirstAssistant: false };
    if (historyBlocks.some((block) =>
      block.source.type === "chat_history"
      && (!block.source.selection || block.source.selection.mode === "all")
    )) {
      return { preserveFirstAssistant: false };
    }
    return {
      limit: Math.max(
        lorebookScanLimit,
        ...historyBlocks.map((block) =>
          block.source.type === "chat_history" && block.source.selection?.mode === "recent"
            ? Math.max(0, Math.floor(block.source.selection.count))
            : 0
        ),
      ),
      preserveFirstAssistant: historyBlocks.some((block) =>
        block.source.type === "chat_history"
        && block.source.selection?.mode === "recent"
        && block.source.selection.preserveFirstAssistant
      ),
    };
  }

  return {
    limit: resolveLegacyRecentTurns(settings),
    preserveFirstAssistant: true,
  };
}

function resolveLegacyRecentTurns(settings: UserSettings): number {
  const configured = settings.memory?.recentTurns;
  return typeof configured === "number" && Number.isFinite(configured)
    ? Math.max(1, Math.floor(configured))
    : 6;
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
