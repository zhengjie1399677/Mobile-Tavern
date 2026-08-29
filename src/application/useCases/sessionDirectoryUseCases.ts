import type { ISessionManagementService } from "../serviceContracts";
import type { SessionDirectoryCursor } from "../../domain/session-management";
import type { ChatSession } from "../../types";

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
