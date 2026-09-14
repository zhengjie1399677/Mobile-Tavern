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
import { mergeLocalDataFromBackup } from "../../infrastructure/storage/repositories/mergeRepository";
import { listSyncTombstones } from "../../infrastructure/storage/repositories/tombstoneRepository";
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
      tombstones: await listSyncTombstones(),
    });
  }

  /**
   * 计算附件反向引用并校验备份自洽性。覆盖与合并两条路径共用同一份校验，
   * 避免出现"一条路径收紧了、另一条还松着"。
   */
  private buildAttachmentReferences(
    payload: UnifiedBackupPayload,
  ): Array<{ referenceId: string; assetIds: string[] }> {
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
    return references;
  }

  /**
   * 记录操作前的附件与 Journal 状态，供写入失败时回滚。
   *
   * 主库写入本身是单事务的，但附件库与 Agent Journal 是独立存储，必须显式补偿，
   * 否则会出现"主库没换、附件索引已换"的撕裂状态。
   */
  private async captureRestorePoint() {
    const attachmentService = this.kernel.getService<IAttachmentService>(KernelServices.Attachments);
    const agentRuntime = this.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime);

    const attachments = await attachmentService.exportAttachments();
    const metadata = await attachmentService.listAttachments();
    const referencesById = new Map<string, string[]>();
    for (const item of metadata) {
      for (const referenceId of item.referenceIds) {
        const assetIds = referencesById.get(referenceId) ?? [];
        assetIds.push(item.id);
        referencesById.set(referenceId, assetIds);
      }
    }
    const sessions = await this.kernel
      .getService<DatabaseService>(KernelServices.Database)
      .getAllSessions();
    const journal = (await Promise.all(sessions.map((session) =>
      agentRuntime.listJournalBySession(session.id),
    ))).flat();

    return {
      attachmentService,
      agentRuntime,
      restore: () => Promise.all([
        attachmentService.replaceAttachments(
          attachments,
          Array.from(referencesById, ([referenceId, assetIds]) => ({ referenceId, assetIds })),
        ),
        agentRuntime.replaceJournal(journal),
      ]),
    };
  }

  async replaceFromBackup(payload: UnifiedBackupPayload, signal?: AbortSignal): Promise<void> {
    const references = this.buildAttachmentReferences(payload);
    const restorePoint = await this.captureRestorePoint();
    try {
      // 附件字节与反向引用在同一个附件库事务中一次提交。主库替换成功后不再
      // 执行可能失败的二次 reconcile，从而消除“主库已换、附件索引未换”的窗口。
      await restorePoint.attachmentService.replaceAttachments(payload.attachments, references);
      await restorePoint.agentRuntime.replaceJournal(payload.agentJournal);
      await replaceLocalDataFromBackup(
        payload,
        signal || this.abortController?.signal,
      );
    } catch (error) {
      await restorePoint.restore();
      throw error;
    }
  }

  /**
   * 以合并结果增量更新本地数据，保留双方独有内容。
   *
   * 与 replaceFromBackup 的差别只在主库写入方式：附件与 Agent Journal 同样以
   * 合并结果为权威（入参已是两侧并集），而会话、消息与记忆分轨走增量写入，
   * 不清空 Store。失败时沿用同一套补偿。
   */
  async mergeFromBackup(payload: UnifiedBackupPayload, signal?: AbortSignal): Promise<void> {
    const references = this.buildAttachmentReferences(payload);
    const restorePoint = await this.captureRestorePoint();
    try {
      await restorePoint.attachmentService.replaceAttachments(payload.attachments, references);
      await restorePoint.agentRuntime.replaceJournal(payload.agentJournal);
      await mergeLocalDataFromBackup(
        payload,
        signal || this.abortController?.signal,
      );
    } catch (error) {
      await restorePoint.restore();
      throw error;
    }
  }
}

export type DataMigrationServiceTyped = IDataMigrationService<UserSettings, UnifiedBackupPayload>;
