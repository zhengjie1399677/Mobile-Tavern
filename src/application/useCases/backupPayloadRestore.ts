/**
 * 统一备份载荷的不可信边界收口。
 *
 * 备份文本可能来自本地文件、跨设备宿主（/api/host/backup/export）或历史版本，
 * 因此这里集中完成：解密 → 结构校验 → 逐项清洗 → 归一化为当前版本信封。
 * 文件导入与宿主拉取两条路径共用同一入口，避免「一处收紧了、另一处还松着」。
 *
 * 本模块不依赖 React、Hook 或 UI，默认设置由调用方注入（体现 application 层不反向依赖界面层）。
 */
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
import { decryptBackupData } from "../../utils/cardParser";
import { getErrorMessage } from "../../utils/errorUtils";
import {
  buildUnifiedBackupPayload,
  parseAgentCompositionSnapshot,
  parseAgentJournalEvents,
  parseAttachmentBackupRecords,
  parseRuntimePluginState,
  parseSyncTombstones,
  UNIFIED_BACKUP_MAGIC,
  type UnifiedBackupPayload,
} from "./dataMigrationUseCases";
import type { SyncTombstone } from "../../domain/sync/tombstones";

/** 备份解析失败的可区分原因，供界面给出可解释提示。 */
export type BackupPayloadIssueCode =
  | "malformed_json"
  | "encrypted_password_required"
  | "decrypt_failed"
  | "magic_mismatch"
  | "invalid_characters"
  | "invalid_sessions"
  | "invalid_tombstones";

/** 备份边界错误：message 保持人类可读，code 供调用方分支处理。 */
export class BackupPayloadError extends Error {
  readonly code: BackupPayloadIssueCode;

  constructor(code: BackupPayloadIssueCode, message: string) {
    super(message);
    this.name = "BackupPayloadError";
    this.code = code;
  }
}

/** 备份版本与当前能力之间的差距，调用方据此组织提示文案。 */
export interface BackupVersionGap {
  code: "legacy_v3" | "legacy_v4" | "legacy_v5" | "legacy_v6" | "current";
  /** 该版本备份无法承载的数据能力，仅用于文案与诊断。 */
  missing: readonly string[];
}

/** 备份规模摘要，用于覆盖式操作的双方数据量确认。 */
export interface BackupPayloadSummary {
  characters: number;
  sessions: number;
  messages: number;
  memoryFragments: number;
  memoryFacts: number;
  memoryDictEntries: number;
  globalLorebook: number;
  customWorldbooks: number;
  savedPresets: number;
  attachments: number;
  agentJournal: number;
  tombstones: number;
  backupDate: string | null;
}

export interface NormalizedBackupPayload {
  /** 已归一化到当前版本的信封，可直接交给 replaceFromBackup 或宿主导入接口。 */
  payload: UnifiedBackupPayload;
  /** 备份文本声明的原始版本号。 */
  parsedVersion: number;
  versionGap: BackupVersionGap;
  summary: BackupPayloadSummary;
  /** 清洗阶段丢弃的损坏条目数量，仅用于诊断。 */
  dropped: {
    characters: number;
    sessions: number;
  };
}

export interface NormalizeBackupPayloadInput {
  /** 备份文本：明文 JSON 或加密载荷。 */
  text: string;
  /** 解密口令；加密载荷缺失时抛 encrypted_password_required。 */
  passphrase?: string;
  /** 默认设置，用于旧备份缺失字段回落。 */
  defaultSettings: UserSettings;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : Boolean(value);
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function asOptionalNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/** 移除 UTF-8 BOM 与前置空白，避免把合法明文误判为加密载荷。 */
function stripLeadingNoise(text: string): string {
  return text.replace(/^\uFEFF/, "").trimStart();
}

/**
 * 将备份文本解析为归一化信封。
 *
 * 任何结构缺陷都以 BackupPayloadError 抛出，调用方可按 code 分支；
 * 逐项损坏的条目（缺 id/name 的角色、缺 id/characterId 的会话）按现状静默丢弃并计数。
 */
export async function normalizeBackupPayload(
  input: NormalizeBackupPayloadInput,
): Promise<NormalizedBackupPayload> {
  const { text, passphrase, defaultSettings } = input;

  const parsed = await parseBackupText(text, passphrase);
  const envelope = isPlainRecord(parsed) ? parsed : {};

  // 1. Magic 签名校验（向后兼容：无 magic 的历史备份放行）
  const magic = envelope.magic;
  if (magic !== undefined && magic !== UNIFIED_BACKUP_MAGIC) {
    throw new BackupPayloadError(
      "magic_mismatch",
      "备份文件签名不匹配，非此程序导出的有效备份数据。",
    );
  }

  // 2. 顶层数组结构校验
  if (!Array.isArray(envelope.characters)) {
    throw new BackupPayloadError(
      "invalid_characters",
      "备份文件损坏：characters 列表必须是合规数组。",
    );
  }
  if (!Array.isArray(envelope.sessions)) {
    throw new BackupPayloadError(
      "invalid_sessions",
      "备份文件损坏：sessions 列表必须是合规数组。",
    );
  }

  // 3. 逐项清洗
  const characters = sanitizeCharacters(envelope.characters);
  const sessions = sanitizeSessions(envelope.sessions);
  const memoryFragments = sanitizeMemoryFragments(envelope.memoryFragments);
  const memoryFacts = sanitizeMemoryFacts(envelope.memoryFacts);
  const memoryDictEntries = sanitizeMemoryDictEntries(envelope.memoryDictEntries);
  const globalLorebook = Array.isArray(envelope.globalLorebook)
    ? (envelope.globalLorebook as LorebookEntry[])
    : [];
  const customWorldbooks: Record<string, CustomWorldbook> =
    isPlainRecord(envelope.customWorldbooks)
      ? (envelope.customWorldbooks as Record<string, CustomWorldbook>)
      : {};
  const savedPresets = Array.isArray(envelope.savedPresets)
    ? (envelope.savedPresets as SavedPresetBundle[])
    : [];
  const attachments = parseAttachmentBackupRecords(envelope.attachments);
  const agentJournal = parseAgentJournalEvents(envelope.agentJournal);
  const tombstones = readTombstones(envelope.tombstones);

  const parsedVersion = Number(envelope.version || 0);
  const payload = buildUnifiedBackupPayload({
    characters: characters.items,
    sessions: sessions.items,
    memoryDictEntries,
    memoryFragments,
    memoryFacts,
    settings: mergeImportedSettings(envelope.settings, defaultSettings),
    savedPresets,
    globalLorebook,
    customWorldbooks,
    backupDate: asString(envelope.backupDate, new Date().toISOString()),
    isEncrypted: false,
    attachments,
    agentJournal,
    tombstones,
  });

  return {
    payload,
    parsedVersion,
    versionGap: describeBackupVersionGap(parsedVersion),
    summary: summarizeBackupPayload(payload),
    dropped: {
      characters: characters.dropped,
      sessions: sessions.dropped,
    },
  };
}

/**
 * 解析备份文本为未知结构；加密载荷需要口令。
 *
 * 走加解密工具时保留原始错误信息，便于界面提示「密码拼写不一致」。
 */
export async function parseBackupText(
  text: string,
  passphrase?: string,
): Promise<unknown> {
  const normalized = stripLeadingNoise(text);
  // 加密载荷签名（Base64 字符集）不会以 { 开头，与现状判定保持一致。
  if (!normalized.startsWith("{")) {
    const secret = (passphrase || "").trim();
    if (!secret) {
      throw new BackupPayloadError(
        "encrypted_password_required",
        "备份可能是加密文件，请先输入对应密码。",
      );
    }
    let decrypted: string;
    try {
      decrypted = await decryptBackupData(normalized, secret);
    } catch (err: unknown) {
      throw new BackupPayloadError(
        "decrypt_failed",
        getErrorMessage(err) || "备份解密失败。",
      );
    }
    return parseJsonStrict(decrypted);
  }
  return parseJsonStrict(normalized);
}

function parseJsonStrict(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err: unknown) {
    throw new BackupPayloadError(
      "malformed_json",
      getErrorMessage(err) || "备份文件无法解析为有效 JSON。",
    );
  }
}

/**
 * 墓碑决定"哪些数据会被删除"，损坏或被篡改的墓碑会造成静默数据丢失，
 * 因此把结构错误统一收敛为可区分的边界错误码，而不是放行部分条目。
 */
function readTombstones(value: unknown): SyncTombstone[] {
  try {
    return parseSyncTombstones(value);
  } catch (err: unknown) {
    throw new BackupPayloadError(
      "invalid_tombstones",
      getErrorMessage(err) || "备份文件损坏：删除记录非法。",
    );
  }
}

function sanitizeCharacters(value: unknown[]): {
  items: CharacterCard[];
  dropped: number;
} {
  const items: CharacterCard[] = [];
  let dropped = 0;
  for (const raw of value) {
    if (
      isPlainRecord(raw) &&
      typeof raw.id === "string" &&
      typeof raw.name === "string"
    ) {
      // 不可信边界收口：只保证关键字段的形状，其余扩展字段原样透传。
      items.push({
        ...raw,
        id: raw.id,
        name: raw.name,
        avatar: asString(raw.avatar),
        description: asString(raw.description),
        personality: asString(raw.personality),
        scenario: asString(raw.scenario),
        first_mes: asString(raw.first_mes),
        mes_example: asString(raw.mes_example),
        system_prompt: asString(raw.system_prompt),
        post_history_instructions: asString(raw.post_history_instructions),
        alternate_greetings: Array.isArray(raw.alternate_greetings)
          ? raw.alternate_greetings
          : [],
        lorebookEntries: Array.isArray(raw.lorebookEntries)
          ? raw.lorebookEntries
          : [],
        isWorldbookGlobal: asOptionalBoolean(raw.isWorldbookGlobal),
        visualSettings: asOptionalRecord(raw.visualSettings),
        extensions: asOptionalRecord(raw.extensions),
        variables: asOptionalRecord(raw.variables),
      } as unknown as CharacterCard);
    } else {
      dropped += 1;
      console.warn("Filtered out corrupted character entry during import:", raw);
    }
  }
  return { items, dropped };
}

function sanitizeSessions(value: unknown[]): {
  items: ChatSession[];
  dropped: number;
} {
  const items: ChatSession[] = [];
  let dropped = 0;
  for (const raw of value) {
    if (
      isPlainRecord(raw) &&
      typeof raw.id === "string" &&
      typeof raw.characterId === "string" &&
      Array.isArray(raw.messages)
    ) {
      const messages = raw.messages.filter(
        (message: unknown) =>
          isPlainRecord(message) &&
          typeof message.id === "string" &&
          typeof message.sender === "string" &&
          typeof message.content === "string",
      );
      items.push({
        ...raw,
        id: raw.id,
        characterId: raw.characterId,
        title: asString(raw.title, "无标题对话"),
        createdAt: asOptionalNumber(raw.createdAt, Date.now()),
        messages,
        summaries: Array.isArray(raw.summaries) ? raw.summaries : [],
        lastSummarizedMessageId: asOptionalString(raw.lastSummarizedMessageId),
        variables: asOptionalRecord(raw.variables),
        runtimePluginState: parseRuntimePluginState(raw.runtimePluginState),
        compositionSnapshot: parseAgentCompositionSnapshot(raw.compositionSnapshot),
      } as unknown as ChatSession);
    } else {
      dropped += 1;
      console.warn("Filtered out corrupted session entry during import:", raw);
    }
  }
  return { items, dropped };
}

function sanitizeMemoryFragments(value: unknown): MemoryFragment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (fragment: unknown): fragment is Record<string, unknown> =>
        isPlainRecord(fragment) &&
        typeof fragment.id === "string" &&
        typeof fragment.sessionId === "string" &&
        typeof fragment.content === "string" &&
        Array.isArray(fragment.sourceMessageIds),
    )
    .map(
      (fragment) =>
        ({
          ...fragment,
          participants: Array.isArray(fragment.participants)
            ? fragment.participants
            : [],
          tags: Array.isArray(fragment.tags) ? fragment.tags : [],
          sourceRole: ["user", "assistant", "system"].includes(
            fragment.sourceRole as string,
          )
            ? fragment.sourceRole
            : "assistant",
          sourceTurnStart: Number.isInteger(fragment.sourceTurnStart)
            ? fragment.sourceTurnStart
            : 0,
          sourceTurnEnd: Number.isInteger(fragment.sourceTurnEnd)
            ? fragment.sourceTurnEnd
            : 0,
          status: ["active", "superseded", "invalid"].includes(
            fragment.status as string,
          )
            ? fragment.status
            : "active",
          importance: asOptionalNumber(fragment.importance, 0.7),
          confidence: asOptionalNumber(fragment.confidence, 1),
          createdAt: asOptionalNumber(fragment.createdAt, Date.now()),
          updatedAt: asOptionalNumber(fragment.updatedAt, Date.now()),
        }) as unknown as MemoryFragment,
    );
}

function sanitizeMemoryFacts(value: unknown): TemporalFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (fact: unknown): fact is Record<string, unknown> =>
        isPlainRecord(fact) &&
        typeof fact.id === "string" &&
        typeof fact.sessionId === "string" &&
        typeof fact.subject === "string" &&
        typeof fact.predicate === "string" &&
        typeof fact.object === "string" &&
        typeof fact.sourceMessageId === "string",
    )
    .map(
      (fact) =>
        ({
          ...fact,
          tags: Array.isArray(fact.tags) ? fact.tags : [fact.subject, fact.object],
          status: ["active", "superseded", "invalid"].includes(
            fact.status as string,
          )
            ? fact.status
            : "active",
          validFromTurn: Number.isInteger(fact.validFromTurn)
            ? fact.validFromTurn
            : 0,
          confidence: asOptionalNumber(fact.confidence, 1),
          createdAt: asOptionalNumber(fact.createdAt, Date.now()),
          updatedAt: asOptionalNumber(fact.updatedAt, Date.now()),
        }) as unknown as TemporalFact,
    );
}

function sanitizeMemoryDictEntries(value: unknown): MemoryDictEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry: unknown): entry is MemoryDictEntry =>
      isPlainRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.sessionId === "string" &&
      typeof entry.entity === "string",
  );
}

/**
 * 导入设置与默认设置逐字段合并（api / memory / promptConfig.sectionHeaders 需深一层）。
 *
 * 旧备份缺失的字段一律回落到当前默认值，禁止静默产生空配置。
 */
export function mergeImportedSettings(
  rawSettings: unknown,
  defaultSettings: UserSettings,
): UserSettings {
  if (!isPlainRecord(rawSettings)) {
    return structuredClone(defaultSettings);
  }
  const api = asOptionalRecord(rawSettings.api) || {};
  const memory = asOptionalRecord(rawSettings.memory) || {};
  const promptConfig = asOptionalRecord(rawSettings.promptConfig) || {};
  const sectionHeaders = asOptionalRecord(promptConfig.sectionHeaders) || {};

  return {
    ...defaultSettings,
    ...rawSettings,
    api: {
      ...defaultSettings.api,
      ...api,
    },
    memory: {
      ...defaultSettings.memory,
      ...memory,
    },
    promptConfig: {
      ...defaultSettings.promptConfig,
      ...promptConfig,
      sectionHeaders: {
        ...defaultSettings.promptConfig.sectionHeaders,
        ...sectionHeaders,
      },
    },
  } as unknown as UserSettings;
}

/** 判定备份版本相对当前能力缺失了什么。 */
export function describeBackupVersionGap(parsedVersion: number): BackupVersionGap {
  if (parsedVersion < 4) {
    return {
      code: "legacy_v3",
      missing: ["独立世界书", "记忆词典", "自定义预设库", "消息附件"],
    };
  }
  if (parsedVersion < 5) {
    return { code: "legacy_v4", missing: ["消息附件"] };
  }
  if (parsedVersion < 6) {
    return { code: "legacy_v5", missing: ["Agent Turn", "Provider 决定", "工具调用记录"] };
  }
  if (parsedVersion < 7) {
    // 缺失墓碑不影响导入本身，但该备份参与双机同步时无法表达删除，
    // 对端已删除的数据无法据此收敛。
    return { code: "legacy_v6", missing: ["跨设备删除记录"] };
  }
  return { code: "current", missing: [] };
}

/** 统计备份规模，供覆盖式操作的双方数据量确认。 */
export function summarizeBackupPayload(
  payload: UnifiedBackupPayload,
): BackupPayloadSummary {
  const sessions = payload.sessions || [];
  return {
    characters: (payload.characters || []).length,
    sessions: sessions.length,
    messages: sessions.reduce(
      (total, session) => total + (session.messages || []).length,
      0,
    ),
    memoryFragments: (payload.memoryFragments || []).length,
    memoryFacts: (payload.memoryFacts || []).length,
    memoryDictEntries: (payload.memoryDictEntries || []).length,
    globalLorebook: (payload.globalLorebook || []).length,
    customWorldbooks: Object.keys(payload.customWorldbooks || {}).length,
    savedPresets: (payload.savedPresets || []).length,
    attachments: (payload.attachments || []).length,
    agentJournal: (payload.agentJournal || []).length,
    tombstones: (payload.tombstones || []).length,
    backupDate:
      typeof payload.backupDate === "string" && payload.backupDate
        ? payload.backupDate
        : null,
  };
}
