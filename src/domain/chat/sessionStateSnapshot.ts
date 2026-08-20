import type { ChatSession, Message, TableMemorySheet } from "../../types";

export const SESSION_STATE_SNAPSHOT_KEY = "mobileTavernSessionState";

export interface SessionStateSnapshot {
  version: 1;
  variables?: Record<string, unknown>;
  tableMemory?: TableMemorySheet[];
}

function cloneValue<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTableMemorySheet(value: unknown): value is TableMemorySheet {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.enable === "boolean"
    && Array.isArray(value.columns)
    && value.columns.every((column) => typeof column === "string")
    && Array.isArray(value.rows)
    && value.rows.every((row) =>
      Array.isArray(row) && row.every((cell) => typeof cell === "string")
    );
}

/** 把一次输出完成后的状态绑定到对应助手消息，供重启和分支恢复。 */
export function attachSessionStateSnapshot(
  message: Message,
  session: Pick<ChatSession, "variables" | "tableMemory">,
): Message {
  const snapshot: SessionStateSnapshot = {
    version: 1,
    variables: session.variables ? cloneValue(session.variables) : undefined,
    tableMemory: session.tableMemory ? cloneValue(session.tableMemory) : undefined,
  };
  return {
    ...message,
    extra: {
      ...message.extra,
      [SESSION_STATE_SNAPSHOT_KEY]: snapshot,
    },
  };
}

export function readSessionStateSnapshot(message: Message): SessionStateSnapshot | undefined {
  const candidate = message.extra?.[SESSION_STATE_SNAPSHOT_KEY];
  if (!isRecord(candidate)) return undefined;
  const record = candidate;
  if (record.version !== 1) return undefined;
  if (record.variables !== undefined && !isRecord(record.variables)) return undefined;
  if (
    record.tableMemory !== undefined
    && (!Array.isArray(record.tableMemory) || !record.tableMemory.every(isTableMemorySheet))
  ) return undefined;
  return cloneValue({
    version: 1,
    variables: record.variables as Record<string, unknown> | undefined,
    tableMemory: record.tableMemory as TableMemorySheet[] | undefined,
  });
}

/** 读取目标边界之前最近的完整状态快照。 */
export function findSessionStateSnapshot(messages: readonly Message[]): SessionStateSnapshot | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const snapshot = readSessionStateSnapshot(messages[index]);
    if (snapshot) return snapshot;
  }
  return undefined;
}

/** 兼容旧 MVU 消息按 swipe 保存的变量快照。 */
export function findLegacyMvuVariables(messages: readonly Message[]): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const snapshots = message.extra?.variables;
    if (!snapshots || typeof snapshots !== "object") continue;
    const swipeId = message.swipe_id ?? 0;
    const selected = (snapshots as Record<string, unknown>)[String(swipeId)];
    if (selected && typeof selected === "object") return cloneValue(selected as Record<string, unknown>);
    const keys = Object.keys(snapshots);
    if (keys.length > 0 && !keys.every((key) => /^\d+$/.test(key))) {
      return cloneValue(snapshots as Record<string, unknown>);
    }
  }
  return undefined;
}
