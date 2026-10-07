import type { ISessionManagementService } from "../serviceContracts";
import type { SessionDirectoryCursor } from "../../domain/session-management";
import type { ChatSession, Message } from "../../types";

/**
 * 平行宇宙视图需要的消息读取端口。
 *
 * 会话主记录（sessions Store）只保存目录元数据，消息物理分轨在 messages Store。
 * 视图不得直连存储实现，因此这里以最小结构端口注入 `DatabaseService`。
 */
export interface SessionMessageWindowReader {
  getSessionPromptMessages(
    sessionId: string,
    options: { limit?: number; preserveFirstAssistant: boolean; beforeMessageId?: string },
  ): Promise<Message[]>;
}

/**
 * 平行宇宙视图每个会话最多水合多少条消息。
 *
 * 视图要为每条消息画一个轮次节点，长会话全量水合会让 SVG 节点数失控；
 * 这里只取最近一窗，`message.turnIndex` 仍是绝对轮次，记忆晶体匹配不受窗口影响。
 */
export const UNIVERSE_SESSION_MESSAGE_WINDOW = 160;
/** 平行宇宙视图最多水合多少个会话，避免一次进入就读取全部历史。 */
export const UNIVERSE_SESSION_LIMIT = 40;

export async function loadActiveSessionsForCharacter(
  service: ISessionManagementService<ChatSession>,
  characterId: string,
  limit?: number,
): Promise<ChatSession[]> {
  const sessions: ChatSession[] = [];
  let cursor: SessionDirectoryCursor | undefined;

  do {
    const remaining = limit === undefined ? 100 : Math.max(1, limit - sessions.length);
    const snapshot = await service.queryDirectory({
      category: "active",
      characterId,
      sort: "updated_desc",
      pageSize: Math.min(100, remaining),
      cursor,
    });
    sessions.push(...snapshot.active.map((entry) => entry.session));
    if (!snapshot.pageInfo.active.hasMore || sessions.length >= (limit ?? Number.POSITIVE_INFINITY)) break;
    if (!snapshot.pageInfo.active.cursor) throw new Error("SESSION_DIRECTORY_CURSOR_MISSING");
    cursor = snapshot.pageInfo.active.cursor;
  } while (true);

  return limit === undefined ? sessions : sessions.slice(0, limit);
}

/**
 * 加载某个角色的平行宇宙会话树：目录元数据 + 最近消息窗口。
 *
 * 修复历史缺陷：会话目录拆分出独立 messages Store 后，`queryDirectory` 返回的
 * `session.messages` 恒为空数组，平行宇宙图因此只有空柱子、没有轮次节点与记忆晶体。
 */
export async function loadUniverseSessionsForCharacter(
  service: ISessionManagementService<ChatSession>,
  messages: SessionMessageWindowReader,
  characterId: string,
  options: { sessionLimit?: number; messageLimit?: number } = {},
): Promise<ChatSession[]> {
  const sessionLimit = Math.max(1, Math.floor(options.sessionLimit ?? UNIVERSE_SESSION_LIMIT));
  const messageLimit = Math.max(1, Math.floor(options.messageLimit ?? UNIVERSE_SESSION_MESSAGE_WINDOW));
  const sessions = await loadActiveSessionsForCharacter(service, characterId, sessionLimit);
  return Promise.all(sessions.map(async (session) => {
    if (session.messages.length > 0) return session;
    try {
      const window = await messages.getSessionPromptMessages(session.id, {
        limit: messageLimit,
        preserveFirstAssistant: false,
      });
      return { ...session, messages: window };
    } catch (error: unknown) {
      console.warn("[sessionDirectoryUseCases] 平行宇宙视图水合会话消息失败", session.id, error);
      return session;
    }
  }));
}
