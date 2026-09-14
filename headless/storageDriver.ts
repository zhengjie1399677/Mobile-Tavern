import "fake-indexeddb/auto";
import fs from "node:fs";
import path from "node:path";
import type {
  IKernel,
  IDatabaseService,
  ISettingsService,
} from "../src/application/serviceContracts";
import { KernelServices } from "../src/application/serviceContracts";
import type { DataMigrationServiceTyped } from "../src/application/services/DataMigrationService";
import {
  parseSyncTombstones,
  type UnifiedBackupPayload,
} from "../src/application/useCases/dataMigrationUseCases";
import { mergeBackupPayloads, type BackupMergeStats } from "../src/application/useCases/backupMerge";
import type { UserSettings } from "../src/types";
import { Logger } from "../src/utils/logger";

const logger = Logger.create("HeadlessStorageDriver");

const SNAPSHOT_FILENAME = "snapshot.json";

export function ensureDataDirectory(dataDir: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info(`Created headless data directory at: ${dataDir}`);
  }
}

/** 从无头数据目录加载快照到内存数据库中。若快照不存在则返回 false。 */
export async function loadPersistedSnapshot(
  kernel: IKernel,
  dataDir: string,
): Promise<boolean> {
  ensureDataDirectory(dataDir);
  const snapshotPath = path.join(dataDir, SNAPSHOT_FILENAME);
  if (!fs.existsSync(snapshotPath)) {
    logger.info("No prior snapshot found, running with fresh database.");
    return false;
  }

  try {
    const content = fs.readFileSync(snapshotPath, "utf8");
    const payload = JSON.parse(content) as UnifiedBackupPayload;
    const migrationService = kernel.getService<DataMigrationServiceTyped>(
      KernelServices.DataMigration,
    );
    await migrationService.replaceFromBackup(payload);
    logger.info(`Successfully loaded persistent snapshot from: ${snapshotPath}`);
    return true;
  } catch (err) {
    logger.error("Failed to load snapshot file, proceeding with empty store", err);
    return false;
  }
}

/** 将当前数据库状态序列化持久化至数据目录的 snapshot.json 中。 */
export async function savePersistedSnapshot(
  kernel: IKernel,
  dataDir: string,
): Promise<string> {
  ensureDataDirectory(dataDir);
  const snapshotPath = path.join(dataDir, SNAPSHOT_FILENAME);
  const tempPath = `${snapshotPath}.tmp.${Date.now()}`;

  const migrationService = kernel.getService<DataMigrationServiceTyped>(
    KernelServices.DataMigration,
  );
  const settingsService = kernel.getService<ISettingsService<UserSettings>>(
    KernelServices.Settings,
  );

  const settings = (await settingsService.getStoredSettings()) || ({} as UserSettings);
  const payload = await migrationService.createBackupPayload(settings, false);

  const jsonStr = JSON.stringify(payload, null, 2);
  fs.writeFileSync(tempPath, jsonStr, "utf8");
  fs.renameSync(tempPath, snapshotPath);
  logger.info(`Persisted database snapshot saved to: ${snapshotPath}`);
  return snapshotPath;
}

/** 宿主侧导入语义：整体覆盖，或与宿主当前数据求并集。 */
export type HeadlessImportMode = "replace" | "merge";

export interface HeadlessImportResult {
  mode: HeadlessImportMode;
  /** 合并模式下的变更统计，供客户端展示"这次同步到底改了什么"。 */
  mergeStats?: BackupMergeStats;
}

/**
 * 从备份 JSON 字符串导入数据。
 *
 * `mode`：
 *  - `replace`（默认）：宿主数据整体被该备份替换，两台设备会互相抹掉。
 *  - `merge`：把该备份并进宿主现有数据，宿主独有内容原样保留；宿主的删除墓碑
 *    与对端墓碑一起参与合并。**跨设备日常同步应使用这个模式。**
 *
 * `preserveLocalSettings`：覆盖模式下跨设备同步时必须开启。快照导出是脱敏的
 * （apiKey 等被清空），因此"用发送端快照里的 settings 回写"会把接收端自己的凭据抹掉；
 * 接收端的设置只能由接收端自己保留 —— 这个判断只能在宿主侧做，客户端无从知道宿主的
 * 真实凭据（也不该知道）。合并模式无条件保留宿主设置，不依赖该开关。
 */
export async function importBackupJson(
  kernel: IKernel,
  backupJson: string,
  options?: { preserveLocalSettings?: boolean; mode?: HeadlessImportMode },
): Promise<HeadlessImportResult> {
  const payload = JSON.parse(backupJson) as UnifiedBackupPayload;
  const migrationService = kernel.getService<DataMigrationServiceTyped>(
    KernelServices.DataMigration,
  );
  const settingsService = kernel.getService<ISettingsService<UserSettings>>(
    KernelServices.Settings,
  );

  if (options?.mode === "merge") {
    // 合并需要两侧数据：宿主当前快照作为 local，请求体作为 remote。这样一次推送
    // 只会把对端内容并进来，不会抹掉宿主独有数据。
    // 这个端点直接暴露在网络里，墓碑又是唯一能删除数据的东西，因此必须在这里校验一次：
    // 结构异常的墓碑会让合并逻辑静默产出垃圾，而抛错至少能变成一条可解释的拒绝响应。
    payload.tombstones = parseSyncTombstones(payload.tombstones);
    const hostSettings = (await settingsService.getStoredSettings()) || ({} as UserSettings);
    const localPayload = await migrationService.createBackupPayload(hostSettings, false);
    const plan = mergeBackupPayloads({ local: localPayload, remote: payload });
    // createBackupPayload 的导出是脱敏的，这里必须换回宿主真实设置再落库，
    // 否则一次合并就会清空宿主的 LLM 凭据。
    await migrationService.mergeFromBackup({ ...plan.merged, settings: hostSettings });
    logger.info("Merged incoming backup payload into headless kernel.", {
      sessionsAdded: plan.stats.sessions.added,
      sessionsRemoved: plan.stats.sessions.removed,
      conflicts: plan.conflicts.length,
    });
    return { mode: "merge", mergeStats: plan.stats };
  }

  if (options?.preserveLocalSettings) {
    const currentSettings = await settingsService.getStoredSettings();
    if (currentSettings) {
      payload.settings = currentSettings;
      logger.info("Import request asked to preserve local settings; kept host settings.");
    }
  }

  await migrationService.replaceFromBackup(payload);
  logger.info("Imported backup payload into headless kernel.");
  return { mode: "replace" };
}

/** 将当前数据导出为标准统一备份 v7 格式的 JSON 字符串。 */
export async function exportBackupJson(kernel: IKernel): Promise<string> {
  const migrationService = kernel.getService<DataMigrationServiceTyped>(
    KernelServices.DataMigration,
  );
  const settingsService = kernel.getService<ISettingsService<UserSettings>>(
    KernelServices.Settings,
  );
  const settings = (await settingsService.getStoredSettings()) || ({} as UserSettings);
  const payload = await migrationService.createBackupPayload(settings, false);
  return JSON.stringify(payload, null, 2);
}
