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
import type { UnifiedBackupPayload } from "../src/application/useCases/dataMigrationUseCases";
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

/** 从备份 JSON 字符串直接导入全量数据。 */
export async function importBackupJson(
  kernel: IKernel,
  backupJson: string,
): Promise<void> {
  const payload = JSON.parse(backupJson) as UnifiedBackupPayload;
  const migrationService = kernel.getService<DataMigrationServiceTyped>(
    KernelServices.DataMigration,
  );
  await migrationService.replaceFromBackup(payload);
  logger.info("Imported backup payload into headless kernel.");
}

/** 将当前数据导出为标准统一备份 v6 格式的 JSON 字符串。 */
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
