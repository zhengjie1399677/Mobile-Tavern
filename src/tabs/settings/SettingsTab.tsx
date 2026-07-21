import React from "react";
import {
  ArrowLeft,
  ChevronRight,
  Database,
  Info,
  KeySquare,
  Loader2,
  MessageSquareText,
  Palette,
  Puzzle,
  RefreshCw,
  Settings,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { Card, CardContent } from "../../../components/ui/card";
import PresetForm from "../../components/PresetForm";
import { performUpdateCheck, showUpdatePrompt } from "../../components/UpdatePrompt";
import { useKernel } from "../../contexts/KernelContext";
import { getDeviceModel, getFreeTrialCount, useViewportSize } from "./utils";
import GeneralConfigSection from "./GeneralConfigSection";
import ThemeConfigSection from "./ThemeConfigSection";
import PersonaConfigSection from "./PersonaConfigSection";
import FeaturesSection from "./FeaturesSection";
import MemoryStorageSection from "./MemoryStorageSection";
import { useTranslation } from "../../contexts/LanguageContext";

/** Tauri WebView 注入的内部接口声明（与 src/utils/keyManager.ts、LLMService.ts 对齐）。 */
interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

type SettingsSectionId =
  | "connection"
  | "prompt"
  | "appearance"
  | "persona"
  | "memory"
  | "advanced";

interface SettingsSectionMeta {
  id: SettingsSectionId;
  titleKey: string;
  descriptionKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: "connection",
    titleKey: "settings_hub.connection_title",
    descriptionKey: "settings_hub.connection_desc",
    icon: KeySquare,
  },
  {
    id: "prompt",
    titleKey: "settings_hub.prompt_title",
    descriptionKey: "settings_hub.prompt_desc",
    icon: MessageSquareText,
  },
  {
    id: "appearance",
    titleKey: "settings_hub.appearance_title",
    descriptionKey: "settings_hub.appearance_desc",
    icon: Palette,
  },
  {
    id: "persona",
    titleKey: "settings_hub.persona_title",
    descriptionKey: "settings_hub.persona_desc",
    icon: UserCheck,
  },
  {
    id: "memory",
    titleKey: "settings_hub.memory_title",
    descriptionKey: "settings_hub.memory_desc",
    icon: Database,
  },
  {
    id: "advanced",
    titleKey: "settings_hub.advanced_title",
    descriptionKey: "settings_hub.advanced_desc",
    icon: Puzzle,
  },
];

export default function SettingsTab() {
  const { t } = useTranslation();
  const kernel = useKernel();
  const isTauri = typeof window !== "undefined" && !!(window as TauriWindow).__TAURI_INTERNALS__;
  const deviceModel = getDeviceModel();
  const viewportSize = useViewportSize();
  const freeCount = getFreeTrialCount();
  const isLandscape = viewportSize.w >= 600 && viewportSize.w > viewportSize.h;

  const {
    settings,
    currentTheme,
    handleThemeChange,
    availableModels,
    isFetchingModels,
    handleFetchModels,
    backupPass,
    setBackupPass,
    backupStatus,
    encryptBackup,
    setEncryptBackup,
    showBackupUI,
    setShowBackupUI,
    updateSettings,
    switchUserPersona,
    addUserPersona,
    deleteUserPersona,
    connectionStatus,
    testApiConnection,
    setActiveTab,
    showCustomPrompt,
    showCustomConfirm,
    showCustomAlert,
    safeAreas,
    handleExportLocalDataBackup,
    handleImportLocalDataBackup,
    handleImportSillyChatHistory,
    getKernelService,
  } = useUnifiedApp((state) => ({
    settings: state.settings,
    currentTheme: state.currentTheme,
    handleThemeChange: state.handleThemeChange,
    availableModels: state.availableModels,
    isFetchingModels: state.isFetchingModels,
    handleFetchModels: state.handleFetchModels,
    backupPass: state.backupPass,
    setBackupPass: state.setBackupPass,
    backupStatus: state.backupStatus,
    encryptBackup: state.encryptBackup,
    setEncryptBackup: state.setEncryptBackup,
    showBackupUI: state.showBackupUI,
    setShowBackupUI: state.setShowBackupUI,
    updateSettings: state.updateSettings,
    switchUserPersona: state.switchUserPersona,
    addUserPersona: state.addUserPersona,
    deleteUserPersona: state.deleteUserPersona,
    connectionStatus: state.connectionStatus,
    testApiConnection: state.testApiConnection,
    setActiveTab: state.setActiveTab,
    showCustomPrompt: state.showCustomPrompt,
    showCustomConfirm: state.showCustomConfirm,
    showCustomAlert: state.showCustomAlert,
    safeAreas: state.safeAreas,
    handleExportLocalDataBackup: state.handleExportLocalDataBackup,
    handleImportLocalDataBackup: state.handleImportLocalDataBackup,
    handleImportSillyChatHistory: state.handleImportSillyChatHistory,
    getKernelService: state.getKernelService,
  }));

  const [activeSection, setActiveSection] = React.useState<SettingsSectionId | null>(null);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">("idle");
  const [isCheckingUpdate, setIsCheckingUpdate] = React.useState(false);
  const lastApiRef = React.useRef(JSON.stringify(settings.api));
  const selectedSection = activeSection ?? (isLandscape ? "connection" : null);
  const selectedMeta = SETTINGS_SECTIONS.find((section) => section.id === selectedSection);

  const handleCheckUpdate = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      const res = await performUpdateCheck(true, kernel);
      if (res === null) {
        showCustomAlert(t("dialog.alert_default_title"), t("settings.update_service_not_ready"));
      } else if (res.hasUpdate && res.downloadUrl) {
        showUpdatePrompt({
          latestVersion: res.latestVersion,
          downloadUrl: res.downloadUrl,
          message: res.message,
        });
      } else {
        showCustomAlert(
          t("settings.already_latest"),
          res.message || t("settings.already_latest_message", { version: __APP_VERSION__ })
        );
      }
    } catch (err: any) {
      console.error("[SettingsTab] Manual check update failed:", err);
      showCustomAlert(
        t("settings.check_failed"),
        t("settings.check_failed_message", { error: err?.message || "未知错误" })
      );
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  React.useEffect(() => {
    const apiStr = JSON.stringify(settings.api);
    if (apiStr !== lastApiRef.current) {
      lastApiRef.current = apiStr;
      setSaveState("saving");
      const timer = setTimeout(() => setSaveState("saved"), 550);
      return () => clearTimeout(timer);
    }
  }, [settings.api]);

  React.useEffect(() => {
    if (saveState !== "saved") return;
    const timer = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  const renderSectionContent = (section: SettingsSectionId) => {
    switch (section) {
      case "connection":
        return (
          <div className="space-y-2">
            <GeneralConfigSection
              settings={settings}
              updateSettings={updateSettings}
              availableModels={availableModels}
              isFetchingModels={isFetchingModels}
              handleFetchModels={handleFetchModels}
              testApiConnection={testApiConnection}
              connectionStatus={connectionStatus}
              showCustomPrompt={showCustomPrompt}
              showCustomConfirm={showCustomConfirm}
              getKernelService={getKernelService}
              saveState={saveState}
              freeCount={freeCount}
            />
            <PresetForm sections={["preset", "samplers"]} />
          </div>
        );
      case "prompt":
        return <PresetForm sections={["prompts", "regex"]} />;
      case "appearance":
        return (
          <ThemeConfigSection
            settings={settings}
            updateSettings={updateSettings}
            currentTheme={currentTheme}
            handleThemeChange={handleThemeChange}
            showCustomAlert={showCustomAlert}
          />
        );
      case "persona":
        return (
          <PersonaConfigSection
            settings={settings}
            updateSettings={updateSettings}
            switchUserPersona={switchUserPersona}
            addUserPersona={addUserPersona}
            deleteUserPersona={deleteUserPersona}
            showCustomAlert={showCustomAlert}
          />
        );
      case "memory":
        return (
          <MemoryStorageSection
            settings={settings}
            updateSettings={updateSettings}
            backupPass={backupPass}
            setBackupPass={setBackupPass}
            backupStatus={backupStatus}
            encryptBackup={encryptBackup}
            setEncryptBackup={setEncryptBackup}
            showBackupUI={showBackupUI}
            setShowBackupUI={setShowBackupUI}
            handleExportLocalDataBackup={handleExportLocalDataBackup}
            handleImportLocalDataBackup={handleImportLocalDataBackup}
            handleImportSillyChatHistory={handleImportSillyChatHistory}
            safeAreas={safeAreas}
            showCustomAlert={showCustomAlert}
            isTauri={isTauri}
            deviceModel={deviceModel}
            viewportSize={viewportSize}
            getKernelService={getKernelService}
          />
        );
      case "advanced":
        return (
          <div className="space-y-2">
            <Card className="glass-panel shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Info className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-foreground">{t("settings_hub.about_title")}</p>
                  <p className="text-[10px] text-muted-foreground">Mobile Tavern v{__APP_VERSION__}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCheckUpdate}
                  disabled={isCheckingUpdate}
                  className="min-h-9 px-3 rounded-lg border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                >
                  {isCheckingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {isCheckingUpdate ? t("control_panel.checking") : t("control_panel.check_update")}
                </button>
              </CardContent>
            </Card>

            <FeaturesSection settings={settings} updateSettings={updateSettings} />

            <Card className="glass-panel shadow-sm border border-dashed border-primary/30">
              <CardContent className="p-3 flex items-center gap-3">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-foreground">{t("sandbox.title")}</p>
                  <p className="text-[9px] text-muted-foreground truncate">{t("sandbox.desc")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("playground")}
                  className="min-h-9 px-3 bg-primary/10 text-primary border border-primary/30 text-[10px] font-bold rounded-lg active:scale-95"
                >
                  {t("settings_hub.open")}
                </button>
              </CardContent>
            </Card>
          </div>
        );
    }
  };

  const renderSectionList = (compact: boolean) => (
    <nav aria-label={t("settings_hub.categories")} className={compact ? "space-y-1" : "space-y-2"}>
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon;
        const selected = section.id === selectedSection;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => setActiveSection(section.id)}
            aria-current={selected ? "page" : undefined}
            className={`w-full flex items-center text-left border transition-colors active:scale-[0.99] ${
              compact ? "min-h-12 rounded-xl px-2.5 py-2 gap-2.5" : "min-h-16 rounded-2xl px-3.5 py-3 gap-3"
            } ${selected ? "bg-primary/10 border-primary/30" : "bg-card/55 border-border/70 hover:bg-muted/60"}`}
          >
            <span className={`rounded-xl flex items-center justify-center shrink-0 ${compact ? "w-8 h-8" : "w-10 h-10"} ${selected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
              <Icon className={compact ? "w-4 h-4" : "w-5 h-5"} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`${compact ? "text-[11px]" : "text-[13px]"} block font-bold text-foreground`}>
                {t(section.titleKey)}
              </span>
              <span className={`${compact ? "text-[8.5px]" : "text-[10px]"} block text-muted-foreground truncate mt-0.5`}>
                {t(section.descriptionKey)}
              </span>
            </span>
            <ChevronRight className={`w-4 h-4 shrink-0 ${selected ? "text-primary" : "text-muted-foreground/60"}`} />
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden px-1.5 pt-0 pb-1">
      <header className="h-9 shrink-0 flex items-center gap-2 px-1 border-b border-border/70">
        {!isLandscape && selectedSection ? (
          <button
            type="button"
            onClick={() => setActiveSection(null)}
            aria-label={t("settings_hub.back")}
            className="w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted active:scale-95"
          >
            <ArrowLeft className="w-4.5 h-4.5" />
          </button>
        ) : (
          <Settings className="w-4.5 h-4.5 text-primary" />
        )}
        <h1 className="text-sm font-black text-foreground tracking-tight truncate">
          {selectedMeta ? t(selectedMeta.titleKey) : t("nav.settings")}
        </h1>
        {!selectedMeta && (
          <span className="ml-auto text-[9px] font-mono text-muted-foreground">v{__APP_VERSION__}</span>
        )}
      </header>

      {isLandscape ? (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(205px,27%)_1fr] gap-2 pt-2">
          <aside className="min-h-0 overflow-y-auto pr-1 custom-scrollbar">
            {renderSectionList(true)}
          </aside>
          <section className="min-w-0 min-h-0 overflow-y-auto pr-1 pb-2 custom-scrollbar">
            {selectedSection && renderSectionContent(selectedSection)}
          </section>
        </div>
      ) : selectedSection ? (
        <main className="flex-1 min-h-0 overflow-y-auto pt-2 pb-2 custom-scrollbar">
          {renderSectionContent(selectedSection)}
        </main>
      ) : (
        <main className="flex-1 min-h-0 overflow-y-auto pt-2 pb-2 custom-scrollbar">
          <div className="px-1 pb-2">
            <p className="text-[10px] text-muted-foreground">{t("settings_hub.home_desc")}</p>
          </div>
          {renderSectionList(false)}
        </main>
      )}
    </div>
  );
}
