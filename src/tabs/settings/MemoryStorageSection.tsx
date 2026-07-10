import { UsageDisplay } from "../../utils/useUsageTracking";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";
import type { ViewportSize } from "./utils";
import MemoryConfigCard from "./sections/MemoryConfigCard";
import BackupRestoreCard from "./sections/BackupRestoreCard";
import ChatImportCard from "./sections/ChatImportCard";
import SystemReportSection from "./sections/SystemReportSection";

export interface MemoryStorageSectionProps
  extends Pick<UnifiedAppContextProps,
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
    | "safeAreas"
    | "showCustomAlert"
    | "getKernelService"
  > {
  isTauri: boolean;
  deviceModel: string;
  viewportSize: ViewportSize;
}

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
  safeAreas,
  showCustomAlert,
  isTauri,
  deviceModel,
  viewportSize,
  getKernelService,
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
      <SystemReportSection
        settings={settings}
        safeAreas={safeAreas}
        showCustomAlert={showCustomAlert}
        getKernelService={getKernelService}
        isTauri={isTauri}
        deviceModel={deviceModel}
        viewportSize={viewportSize}
      />
    </>
  );
}
