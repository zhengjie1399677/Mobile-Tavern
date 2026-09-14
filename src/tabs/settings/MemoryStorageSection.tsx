import { UsageDisplay } from "../../utils/useUsageTracking";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";
import MemoryConfigCard from "./sections/MemoryConfigCard";
import BackupRestoreCard from "./sections/BackupRestoreCard";
import HostSyncCard from "./sections/HostSyncCard";
import ChatImportCard from "./sections/ChatImportCard";

export type MemoryStorageSectionProps = Pick<UnifiedAppContextProps,
    | "settings"
    | "updateSettings"
    | "backupPass"
    | "setBackupPass"
    | "backupStatus"
    | "encryptBackup"
    | "setEncryptBackup"
    | "showBackupUI"
    | "setShowBackupUI"
    | "handleExportLocalDataBackup"
    | "handleImportLocalDataBackup"
    | "handleImportSillyChatHistory"
    | "handlePullFromHost"
    | "handlePushToHost"
  > & {
    /** 未配置宿主时的引导入口：切到「宿主与互联」分区。 */
    onNavigateToHost?: () => void;
  };

export default function MemoryStorageSection({
  settings,
  updateSettings,
  backupPass,
  setBackupPass,
  backupStatus,
  encryptBackup,
  setEncryptBackup,
  showBackupUI,
  setShowBackupUI,
  handleExportLocalDataBackup,
  handleImportLocalDataBackup,
  handleImportSillyChatHistory,
  handlePullFromHost,
  handlePushToHost,
  onNavigateToHost,
}: MemoryStorageSectionProps) {
  return (
    <>
      <MemoryConfigCard settings={settings} updateSettings={updateSettings} />
      <BackupRestoreCard
        backupPass={backupPass}
        setBackupPass={setBackupPass}
        backupStatus={backupStatus}
        encryptBackup={encryptBackup}
        setEncryptBackup={setEncryptBackup}
        showBackupUI={showBackupUI}
        setShowBackupUI={setShowBackupUI}
        handleExportLocalDataBackup={handleExportLocalDataBackup}
        handleImportLocalDataBackup={handleImportLocalDataBackup}
      />
      <HostSyncCard
        settings={settings}
        backupStatus={backupStatus}
        handlePushToHost={handlePushToHost}
        handlePullFromHost={handlePullFromHost}
        onNavigateToHost={onNavigateToHost}
      />
      <ChatImportCard handleImportSillyChatHistory={handleImportSillyChatHistory} />
      <UsageDisplay />
    </>
  );
}
