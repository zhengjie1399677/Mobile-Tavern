import type { Message } from "../../types";
import {
  fromStoredMessageRecord,
  type StoredChatMessageRecord,
} from "../../infrastructure/storage/messageRecord";

type HydratableStoredMessage = Pick<
  StoredChatMessageRecord,
  "id" | "content" | "createdAt"
> & Partial<Omit<StoredChatMessageRecord, "id" | "content" | "createdAt" | "role">> & {
  role?: string;
};

/** 将存储层“最新优先”的消息页投影成界面所需的时间正序。 */
export function hydrateNewestFirstMessagePage(
  records: HydratableStoredMessage[],
): Message[] {
  return records
    .slice()
    .reverse()
    .map((record) => fromStoredMessageRecord({
      sessionId: "",
      turnIndex: 0,
      tags: [],
      extractSource: "none",
      ...record,
      role: record.role === "user" || record.role === "system" ? record.role : "assistant",
    }));
}
