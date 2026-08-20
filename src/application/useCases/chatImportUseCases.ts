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
 * sessions 与 messages Store 在同一事务中写入，避免导入中断后留下空会话。
 */
export async function persistImportedChatSession(
  databaseService: ChatDatabaseService,
  session: ChatSession,
): Promise<void> {
  await databaseService.replaceCompleteSessions([session]);
}
