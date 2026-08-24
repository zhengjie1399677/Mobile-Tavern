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

export const UNIFIED_BACKUP_MAGIC = "MOBILE_TAVERN_UNIFIED_BACKUP";
export const UNIFIED_BACKUP_VERSION = 5;

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
  backupDate: string;
  isEncrypted: boolean;
}

export type UnifiedBackupPayloadInput = Omit<
  UnifiedBackupPayload,
  "magic" | "version" | "memoryDictEntries" | "savedPresets" | "attachments"
> & {
  memoryDictEntries?: MemoryDictEntry[];
  savedPresets?: SavedPresetBundle[];
  attachments?: AttachmentBackupRecord[];
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
  });
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
