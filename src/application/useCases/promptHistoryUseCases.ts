import type { IDatabaseService } from "../serviceContracts";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
  UserSettings,
} from "../../types";
import {
  collectMessageAssetIds,
  getMessageContentText,
} from "../../domain/messages/messageContent";

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

/**
 * 是否为"空产出"助手消息：正文、思维链、附件字节三者皆空。
 *
 * 刻意不把"正文为空但带思维链"算作空产出：那是模型把全部产出放进思考链的正常结果，
 * 在界面上可见、可重发，属于有意保留的语义。
 */
function isBlankAssistantMessage(message: Message): boolean {
  if (message.sender !== "assistant") return false;
  if (message.content?.trim()) return false;
  if (message.reasoningContent?.trim()) return false;
  const parts = message.parts;
  if (parts && parts.length > 0) {
    if (getMessageContentText(parts).trim()) return false;
    if (collectMessageAssetIds(parts).length > 0) return false;
  }
  return true;
}

/**
 * 剔除历史窗口末尾连续的"空产出"助手消息。
 *
 * 未产出内容的失败/中断不能作为请求的最后一条消息参与后续组装：模型会把它当成待续写的
 * 空回复，而要求"最后一条必须是 user"的中转站会直接判为非法请求。这里只裁掉末尾连续的
 * 空白助手消息；历史中段的空助手消息不动，避免把一条有意保留的轮次从中间抽走。
 */
function stripTrailingBlankAssistantMessages(messages: readonly Message[]): Message[] {
  let end = messages.length;
  while (end > 0 && isBlankAssistantMessage(messages[end - 1])) end -= 1;
  return end === messages.length ? [...messages] : messages.slice(0, end);
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
  return { ...session, messages: stripTrailingBlankAssistantMessages(messages) };
}
