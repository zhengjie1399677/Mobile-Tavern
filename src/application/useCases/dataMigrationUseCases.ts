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

export const UNIFIED_BACKUP_MAGIC = "MOBILE_TAVERN_UNIFIED_BACKUP";
export const UNIFIED_BACKUP_VERSION = 4;

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
  backupDate: string;
  isEncrypted: boolean;
}

export type UnifiedBackupPayloadInput = Omit<
  UnifiedBackupPayload,
  "magic" | "version" | "memoryDictEntries" | "savedPresets"
> & {
  memoryDictEntries?: MemoryDictEntry[];
  savedPresets?: SavedPresetBundle[];
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
  });
}
