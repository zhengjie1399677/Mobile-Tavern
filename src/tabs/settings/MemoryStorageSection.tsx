import { UsageDisplay } from "../../utils/useUsageTracking";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";
import MemoryConfigCard from "./sections/MemoryConfigCard";
import BackupRestoreCard from "./sections/BackupRestoreCard";
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
  >;

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
      <ChatImportCard handleImportSillyChatHistory={handleImportSillyChatHistory} />
      <UsageDisplay />
    </>
  );
}
