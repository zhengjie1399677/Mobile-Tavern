import type { IDatabaseService } from "../serviceContracts";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
  UserSettings,
} from "../../types";
interface PromptHistoryRequirement {
  limit?: number;
  preserveFirstAssistant: boolean;
}

/** 传统路径的历史窗口要求：窗口只由设置决定（会话参数随编排链路一并移除）。 */
function resolvePromptHistoryRequirement(settings: UserSettings): PromptHistoryRequirement {
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
  const requirement = resolvePromptHistoryRequirement(settings);
  const messages = requirement.limit === 0
    ? []
    : await databaseService.getSessionPromptMessages(session.id, {
        ...requirement,
        beforeMessageId,
      });
  return { ...session, messages };
}
