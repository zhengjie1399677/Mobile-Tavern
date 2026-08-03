import type {
  CharacterCard,
  ChatSession,
  Message,
  SummaryCard,
  UserSettings,
} from "../../types";
import type {
  ICharacterService,
  IDataMigrationService,
  IDatabaseService,
  IKernel,
  IPresetService,
  IWorldbookService,
} from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import type { MemoryServiceTyped } from "./memory";
import type { MessageRecord } from "./memory/types";
import {
  buildUnifiedBackupPayload,
  redactSettingsForPlainBackup,
  type UnifiedBackupPayload,
} from "../useCases/dataMigrationUseCases";
import { replaceLocalDataFromBackup } from "../../infrastructure/storage/repositories/dataMigrationRepository";

type DatabaseService = IDatabaseService<
  ChatSession,
  CharacterCard,
  SummaryCard,
  Message
>;

function toBackupMessage(record: MessageRecord): Message {
  return {
    id: record.id,
    sender: record.role,
    content: record.content,
    timestamp: record.createdAt,
    extra: record.metadata,
    turnIndex: record.turnIndex,
    tags: record.tags,
    extractSource: record.extractSource,
    metadata: record.metadata,
  } as Message;
}

/** 数据迁移应用边界：读取完整聚合并委托基础设施执行原子覆盖。 */
export class DataMigrationService implements IDataMigrationService<UserSettings, UnifiedBackupPayload> {
  name = KernelServices.DataMigration;
  isCritical = false;
  readonly dependencies = [
    KernelServices.Database,
    KernelServices.Character,
    KernelServices.Worldbook,
    KernelServices.Memory,
    KernelServices.Preset,
  ] as const;

  private kernel!: IKernel;
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort(), { once: true });
    }
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async createBackupPayload(
    settings: UserSettings,
    isEncrypted: boolean,
    backupDate = new Date().toISOString(),
  ): Promise<UnifiedBackupPayload> {
    const characterService = this.kernel.getService<ICharacterService<CharacterCard>>(KernelServices.Character);
    const databaseService = this.kernel.getService<DatabaseService>(KernelServices.Database);
    const worldbookService = this.kernel.getService(KernelServices.Worldbook) as IWorldbookService;
    const memoryService = this.kernel.getService<MemoryServiceTyped>(KernelServices.Memory);
    const presetService = this.kernel.getService<IPresetService>(KernelServices.Preset);

    const characters = await characterService.getAllCharacters();
    const sessionMetadata = await databaseService.getAllSessions();
    const storage = memoryService.getStorage();
    const sessions = await Promise.all(sessionMetadata.map(async (session) => ({
      ...session,
      messages: (await storage.getMessagesBySession(session.id)).map(toBackupMessage),
    })));
    const [memoryDictEntries, memoryFragments, memoryFacts, globalLorebook, customWorldbooks, savedPresets] = await Promise.all([
      Promise.all(sessionMetadata.map((session) => storage.getDictBySession(session.id))).then((items) => items.flat()),
      Promise.all(sessionMetadata.map((session) => storage.getFragmentsBySession(session.id))).then((items) => items.flat()),
      Promise.all(sessionMetadata.map((session) => storage.getTemporalFactsBySession(session.id))).then((items) => items.flat()),
      worldbookService.getGlobalLorebook(),
      worldbookService.getCustomWorldbooks(),
      presetService.getStoredSavedPresets(),
    ]);

    return buildUnifiedBackupPayload({
      characters,
      sessions,
      memoryDictEntries,
      memoryFragments,
      memoryFacts,
      settings: isEncrypted ? structuredClone(settings) : redactSettingsForPlainBackup(settings),
      savedPresets: (savedPresets || []) as UnifiedBackupPayload["savedPresets"],
      globalLorebook: globalLorebook as UnifiedBackupPayload["globalLorebook"],
      customWorldbooks: customWorldbooks as UnifiedBackupPayload["customWorldbooks"],
      backupDate,
      isEncrypted,
    });
  }

  replaceFromBackup(payload: UnifiedBackupPayload, signal?: AbortSignal): Promise<void> {
    return replaceLocalDataFromBackup(
      payload,
      signal || this.abortController?.signal,
    );
  }
}

export type DataMigrationServiceTyped = IDataMigrationService<UserSettings, UnifiedBackupPayload>;
