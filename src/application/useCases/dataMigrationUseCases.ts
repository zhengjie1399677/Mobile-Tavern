import type {
  CharacterCard,
  ChatSession,
  CustomWorldbook,
  LorebookEntry,
  SavedPresetBundle,
  UserSettings,
} from "../../types";
import type {
  MemoryDictEntry,
  MemoryFragment,
  TemporalFact,
} from "../services/memory/types";
import type { AttachmentBackupRecord } from "../../domain/attachments/types";
import type {
  AgentCompositionSnapshot,
  AgentJournalEvent,
} from "../../domain/agents/contracts";

export const UNIFIED_BACKUP_MAGIC = "MOBILE_TAVERN_UNIFIED_BACKUP";
export const UNIFIED_BACKUP_VERSION = 6;

export interface UnifiedBackupPayload {
  magic: typeof UNIFIED_BACKUP_MAGIC;
  version: typeof UNIFIED_BACKUP_VERSION;
  characters: CharacterCard[];
  sessions: ChatSession[];
  memoryDictEntries: MemoryDictEntry[];
  memoryFragments: MemoryFragment[];
  memoryFacts: TemporalFact[];
  settings: UserSettings;
  savedPresets: SavedPresetBundle[];
  globalLorebook: LorebookEntry[];
  customWorldbooks: Record<string, CustomWorldbook>;
  attachments: AttachmentBackupRecord[];
  agentJournal: AgentJournalEvent[];
  backupDate: string;
  isEncrypted: boolean;
}

export type UnifiedBackupPayloadInput = Omit<
  UnifiedBackupPayload,
  "magic" | "version" | "memoryDictEntries" | "savedPresets" | "attachments" | "agentJournal"
> & {
  memoryDictEntries?: MemoryDictEntry[];
  savedPresets?: SavedPresetBundle[];
  attachments?: AttachmentBackupRecord[];
  agentJournal?: AgentJournalEvent[];
};

/** 创建明文备份专用设置副本，并清除所有可用 API 凭证。 */
export function redactSettingsForPlainBackup(settings: UserSettings): UserSettings {
  return {
    ...settings,
    api: {
      ...settings.api,
      apiKey: "",
    },
    savedApiProfiles: settings.savedApiProfiles
      ? settings.savedApiProfiles.map((profile) => ({ ...profile, apiKey: "" }))
      : [],
    imageGenApi: settings.imageGenApi
      ? { ...settings.imageGenApi, apiKey: "" }
      : settings.imageGenApi,
    ttsConfig: settings.ttsConfig
      ? { ...settings.ttsConfig, openaiApiKey: "" }
      : settings.ttsConfig,
    asrConfig: settings.asrConfig
      ? { ...settings.asrConfig, openaiApiKey: "" }
      : settings.asrConfig,
  };
}

/** 构造当前版本统一备份信封，隔离调用方后续对可变集合的修改。 */
export function buildUnifiedBackupPayload(
  input: UnifiedBackupPayloadInput,
): UnifiedBackupPayload {
  return structuredClone({
    ...input,
    magic: UNIFIED_BACKUP_MAGIC,
    version: UNIFIED_BACKUP_VERSION,
    memoryDictEntries: input.memoryDictEntries || [],
    savedPresets: input.savedPresets || [],
    attachments: input.attachments || [],
    agentJournal: input.agentJournal || [],
  });
}

/** 从不可信备份边界收口可重放 Agent Journal。 */
export function parseAgentJournalEvents(value: unknown): AgentJournalEvent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("备份文件损坏：agentJournal 必须是数组。");
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Agent Journal ${index} 格式无效。`);
    }
    const event = item as Record<string, unknown>;
    if (
      typeof event.id !== "string"
      || typeof event.sessionId !== "string"
      || typeof event.turnId !== "string"
      || typeof event.sequence !== "number"
      || !Number.isInteger(event.sequence)
      || event.sequence <= 0
      || typeof event.createdAt !== "number"
      || !isAgentJournalEventType(event.type)
    ) {
      throw new Error(`Agent Journal ${index} 基础字段无效。`);
    }
    if (ids.has(event.id)) throw new Error(`Agent Journal ${index} ID 重复。`);
    ids.add(event.id);
    assertAgentJournalPayload(event, index);
    return structuredClone(event) as unknown as AgentJournalEvent;
  });
}

export function parseAgentCompositionSnapshot(value: unknown): AgentCompositionSnapshot | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("备份文件损坏：compositionSnapshot 格式无效。");
  }
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.profileId !== "string"
    || typeof snapshot.profileVersion !== "number"
    || !Number.isInteger(snapshot.profileVersion)
    || snapshot.profileVersion <= 0
  ) {
    throw new Error("备份文件损坏：compositionSnapshot 身份无效。");
  }
  return {
    profileId: snapshot.profileId,
    profileVersion: snapshot.profileVersion,
    pluginVersions: parseStringRecord(snapshot.pluginVersions, "pluginVersions"),
    providerBindings: parseStringRecord(snapshot.providerBindings, "providerBindings"),
    contributionOrder: parseStringArrayRecord(snapshot.contributionOrder, "contributionOrder"),
    capabilityDecisions: parseUnknownRecord(snapshot.capabilityDecisions, "capabilityDecisions"),
  };
}

/** 从不可信备份边界收口 Runtime Plugin 私有状态命名空间。 */
export function parseRuntimePluginState(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const state = parseUnknownRecord(value, "runtimePluginState");
  const parsed: Record<string, unknown> = {};
  for (const [pluginId, pluginState] of Object.entries(state)) {
    if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(pluginId)) {
      throw new Error("备份文件损坏：runtimePluginState 插件 ID 无效。");
    }
    parsed[pluginId] = structuredClone(pluginState);
  }
  return parsed;
}

function isAgentJournalEventType(value: unknown): value is AgentJournalEvent["type"] {
  return value === "turn.started"
    || value === "turn.decision"
    || value === "tool.called"
    || value === "tool.result"
    || value === "tool.failed"
    || value === "tool.approval.requested"
    || value === "tool.approval.resolved"
    || value === "media.processed"
    || value === "turn.completed"
    || value === "turn.cancelled"
    || value === "turn.failed";
}

function assertAgentJournalPayload(event: Record<string, unknown>, index: number): void {
  const requireStrings = (...keys: string[]) => {
    if (keys.some((key) => typeof event[key] !== "string")) {
      throw new Error(`Agent Journal ${index} 事件字段无效。`);
    }
  };
  switch (event.type) {
    case "turn.started": {
      requireStrings("driverId", "driverVersion", "providerId", "providerVersion");
      const input = event.input;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error(`Agent Journal ${index} 输入字段无效。`);
      }
      const inputRecord = input as Record<string, unknown>;
      if (
        typeof inputRecord.text !== "string"
        || !Array.isArray(inputRecord.attachmentIds)
        || inputRecord.attachmentIds.some((id) => typeof id !== "string")
      ) {
        throw new Error(`Agent Journal ${index} 输入字段无效。`);
      }
      break;
    }
    case "turn.decision":
      requireStrings("decisionType");
      break;
    case "tool.called":
      requireStrings("callId", "toolName", "toolVersion");
      break;
    case "tool.result":
      requireStrings("callId", "toolName");
      break;
    case "tool.failed":
      requireStrings("callId", "toolName", "errorCode", "errorMessage");
      break;
    case "tool.approval.requested":
      requireStrings(
        "approvalId",
        "callId",
        "toolName",
        "description",
        "riskLevel",
        "sideEffect",
        "executionScope",
      );
      if (
        !["low", "medium", "high"].includes(String(event.riskLevel))
        || !["none", "local-write", "external", "irreversible"].includes(String(event.sideEffect))
        || !["turn", "session", "memory", "character", "external"].includes(String(event.executionScope))
        || typeof event.expiresAt !== "number"
      ) {
        throw new Error(`Agent Journal ${index} 审批请求字段无效。`);
      }
      break;
    case "tool.approval.resolved":
      requireStrings("approvalId", "callId", "toolName", "decision", "reason");
      if (
        !["allow", "deny"].includes(String(event.decision))
        || !["user", "policy", "cancelled", "timeout", "host-unavailable"].includes(String(event.reason))
      ) {
        throw new Error(`Agent Journal ${index} 审批结果字段无效。`);
      }
      break;
    case "media.processed":
      requireStrings("processorId", "processorVersion");
      if (!event.result || typeof event.result !== "object" || Array.isArray(event.result)) {
        throw new Error(`Agent Journal ${index} 媒体处理结果无效。`);
      }
      break;
    case "turn.cancelled":
      requireStrings("reason");
      break;
    case "turn.failed":
      requireStrings("errorCode", "errorMessage");
      break;
    case "turn.completed":
      break;
  }
}

function parseStringRecord(value: unknown, field: string): Record<string, string> {
  const source = parseUnknownRecord(value, field);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item !== "string") throw new Error(`备份文件损坏：${field} 字段无效。`);
    result[key] = item;
  }
  return result;
}

function parseStringArrayRecord(value: unknown, field: string): Record<string, string[]> {
  const source = parseUnknownRecord(value, field);
  const result: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(source)) {
    if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string")) {
      throw new Error(`备份文件损坏：${field} 字段无效。`);
    }
    result[key] = [...item];
  }
  return result;
}

function parseUnknownRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`备份文件损坏：${field} 字段无效。`);
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`备份文件损坏：${field} 包含危险键名。`);
    }
    result[key] = structuredClone(item);
  }
  return result;
}

/** 从不可信 JSON 边界验证附件备份目录；V5 不允许静默跳过损坏字节。 */
export function parseAttachmentBackupRecords(value: unknown): AttachmentBackupRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("备份文件损坏：attachments 必须是数组。");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`备份附件 ${index} 格式无效。`);
    const record = item as Record<string, unknown>;
    const kind = record.kind;
    if (kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "file") {
      throw new Error(`备份附件 ${index} 类型无效。`);
    }
    if (
      typeof record.id !== "string"
      || typeof record.mimeType !== "string"
      || typeof record.originalName !== "string"
      || typeof record.size !== "number"
      || typeof record.createdAt !== "number"
      || typeof record.updatedAt !== "number"
      || typeof record.dataBase64 !== "string"
    ) {
      throw new Error(`备份附件 ${index} 字段不完整。`);
    }
    return {
      id: record.id,
      kind,
      mimeType: record.mimeType,
      originalName: record.originalName,
      size: record.size,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      dataBase64: record.dataBase64,
    };
  });
}
