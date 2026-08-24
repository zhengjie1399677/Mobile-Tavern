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
  IAttachmentService,
  IAgentRuntimeService,
} from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import type { MemoryServiceTyped } from "./memory";
import {
  buildUnifiedBackupPayload,
  redactSettingsForPlainBackup,
  type UnifiedBackupPayload,
} from "../useCases/dataMigrationUseCases";
import { replaceLocalDataFromBackup } from "../../infrastructure/storage/repositories/dataMigrationRepository";
import { collectMessageAssetIds } from "../../domain/messages/messageContent";

type DatabaseService = IDatabaseService<
  ChatSession,
  CharacterCard,
  SummaryCard,
  Message
>;

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
    KernelServices.Attachments,
    KernelServices.AgentRuntime,
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
    const attachmentService = this.kernel.getService<IAttachmentService>(KernelServices.Attachments);
    const agentRuntime = this.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);

    const characters = await characterService.getAllCharacters();
    const sessionMetadata = await databaseService.getAllSessions();
    const storage = memoryService.getStorage();
    const sessions = await Promise.all(sessionMetadata.map(async (session) => ({
      ...session,
      messages: await databaseService.getSessionPromptMessages(session.id, {
        preserveFirstAssistant: false,
      }),
    })));
    const assetIds = Array.from(new Set(sessions.flatMap(session =>
      session.messages.flatMap(message => collectMessageAssetIds(message.parts ?? [])),
    )));
    const [memoryDictEntries, memoryFragments, memoryFacts, globalLorebook, customWorldbooks, savedPresets, agentJournal] = await Promise.all([
      Promise.all(sessionMetadata.map((session) => storage.getDictBySession(session.id))).then((items) => items.flat()),
      Promise.all(sessionMetadata.map((session) => storage.getFragmentsBySession(session.id))).then((items) => items.flat()),
      Promise.all(sessionMetadata.map((session) => storage.getTemporalFactsBySession(session.id))).then((items) => items.flat()),
      worldbookService.getGlobalLorebook(),
      worldbookService.getCustomWorldbooks(),
      presetService.getStoredSavedPresets(),
      Promise.all(sessionMetadata.map((session) => agentRuntime.listJournalBySession(session.id)))
        .then((events) => events.flat()),
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
      attachments: await attachmentService.exportAttachments(assetIds),
      agentJournal,
    });
  }

  async replaceFromBackup(payload: UnifiedBackupPayload, signal?: AbortSignal): Promise<void> {
    const attachmentService = this.kernel.getService<IAttachmentService>(KernelServices.Attachments);
    const agentRuntime = this.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);
    const references = payload.sessions.flatMap(session => session.messages.flatMap(message => {
      const assetIds = collectMessageAssetIds(message.parts ?? []);
      return assetIds.length > 0
        ? [{ referenceId: `${session.id}/${message.id}`, assetIds }]
        : [];
    }));
    const expectedIds = new Set(references.flatMap(reference => reference.assetIds));
    const backupIds = new Set(payload.attachments.map(record => record.id));
    for (const id of expectedIds) {
      if (!backupIds.has(id)) throw new Error(`ATTACHMENT_BACKUP_MISSING: ${id}`);
    }
    const sessionIds = new Set(payload.sessions.map((session) => session.id));
    for (const event of payload.agentJournal) {
      if (!sessionIds.has(event.sessionId)) throw new Error(`AGENT_JOURNAL_SESSION_MISSING: ${event.sessionId}`);
    }

    const previousAttachments = await attachmentService.exportAttachments();
    const previousSessions = await this.kernel
      .getService<DatabaseService>(KernelServices.Database)
      .getAllSessions();
    const previousJournal = (await Promise.all(previousSessions.map((session) =>
      agentRuntime.listJournalBySession(session.id),
    ))).flat();
    let mainDatabaseReplaced = false;
    try {
      await attachmentService.replaceAttachments(payload.attachments);
      await agentRuntime.replaceJournal(payload.agentJournal);
      await replaceLocalDataFromBackup(
        payload,
        signal || this.abortController?.signal,
      );
      mainDatabaseReplaced = true;
      await attachmentService.reconcileReferences(references);
    } catch (error) {
      if (!mainDatabaseReplaced) {
        await Promise.all([
          attachmentService.replaceAttachments(previousAttachments),
          agentRuntime.replaceJournal(previousJournal),
        ]);
      }
      throw error;
    }
  }
}

export type DataMigrationServiceTyped = IDataMigrationService<UserSettings, UnifiedBackupPayload>;
