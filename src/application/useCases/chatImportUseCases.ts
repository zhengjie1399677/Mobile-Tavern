import type { IDatabaseService } from "../serviceContracts";
import type {
  CharacterCard,
  ChatSession,
  Message,
  SummaryCard,
} from "../../types";

type ChatDatabaseService = IDatabaseService<
  ChatSession,
  CharacterCard,
  SummaryCard,
  Message
>;

/**
 * 持久化外部导入的完整会话。
 *
 * sessions Store 只保存轻量元数据，消息正文必须显式同步到 messages Store。
 * 将这条不变量收口在用例层，避免导入界面只调用 saveSession 后产生重启空会话。
 */
export async function persistImportedChatSession(
  databaseService: ChatDatabaseService,
  session: ChatSession,
): Promise<void> {
  await databaseService.saveSession(session);
  await databaseService.syncSessionMessages(session.id, session.messages);
}
