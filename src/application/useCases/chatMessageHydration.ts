import type { Message } from "../../types";
import type { MessageContentPart } from "../../domain/messages/messageContent";
import {
  fromStoredMessageRecord,
  type StoredMessageRole,
  type StoredChatMessageRecord,
} from "../../infrastructure/storage/messageRecord";

type HydratableStoredMessageBase = Partial<Omit<
  StoredChatMessageRecord,
  "id" | "content" | "contentVersion" | "createdAt" | "role"
>> & {
  id: string;
  createdAt: number;
  role?: string;
};

type HydratableStoredMessage = HydratableStoredMessageBase & (
  | { contentVersion?: 1; content: string }
  | { contentVersion: 2; content: MessageContentPart[] }
);

/** 将存储层“最新优先”的消息页投影成界面所需的时间正序。 */
export function hydrateNewestFirstMessagePage(
  records: HydratableStoredMessage[],
): Message[] {
  return records
    .slice()
    .reverse()
    .map((record) => {
      const role: StoredMessageRole = record.role === "user" || record.role === "system"
        ? record.role
        : "assistant";
      const {
        content: _content,
        contentVersion: _contentVersion,
        role: _role,
        ...recordBase
      } = record;
      const base = {
        sessionId: "",
        turnIndex: 0,
        tags: [],
        extractSource: "none" as const,
        ...recordBase,
        role,
      };
      return record.contentVersion === 2
        ? fromStoredMessageRecord({ ...base, contentVersion: 2, content: record.content })
        : fromStoredMessageRecord({ ...base, content: record.content });
    });
}
