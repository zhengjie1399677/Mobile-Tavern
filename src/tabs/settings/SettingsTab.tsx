import React from "react";
import { Settings, Sparkles, UserCheck, Puzzle, Database, RefreshCw, Loader2, KeySquare } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../../components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../components/ui/tabs";
import PresetForm from "../../components/PresetForm";
import { performUpdateCheck, showUpdatePrompt } from "../../components/UpdatePrompt";

import { getDeviceModel, getFreeTrialCount, useViewportSize } from "./utils";
import GeneralConfigSection from "./GeneralConfigSection";
import ThemeConfigSection from "./ThemeConfigSection";
import PersonaConfigSection from "./PersonaConfigSection";
import FeaturesSection from "./FeaturesSection";
import MemoryStorageSection from "./MemoryStorageSection";

export default function SettingsTab() {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const deviceModel = getDeviceModel();
  const viewportSize = useViewportSize();
  const freeCount = getFreeTrialCount();

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
  } = useUnifiedApp(state => ({
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

  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">("idle");
  const [isCheckingUpdate, setIsCheckingUpdate] = React.useState(false);
  const lastApiRef = React.useRef(JSON.stringify(settings.api));

  // 手动触发更新检查：跳过 6h 冷却期，结果通过 showCustomAlert 或 UpdatePrompt 弹窗反馈
  const handleCheckUpdate = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      // force=true 跳过冷却期，用户主动点击即立即检查
      const res = await performUpdateCheck(true);
      if (res === null) {
        // 理论上 force=true 不会返回 null（除非 UpdateCheckService 未注册），这里兜底
        showCustomAlert("提示", "UpdateCheckService 未就绪，请稍后再试");
      } else if (res.hasUpdate && res.downloadUrl) {
        // 触发 UpdatePrompt 弹窗（避免重复请求 FC 接口）
        showUpdatePrompt({
          latestVersion: res.latestVersion,
          downloadUrl: res.downloadUrl,
          message: res.message,
        });
      } else {
        // 无更新：显示服务端返回的 message 或说明当前安装的实际版本已经是最新版
        showCustomAlert("已是最新版本", res.message || `您当前运行的 v${__APP_VERSION__} 已经是最新版本。`);
      }
    } catch (err: any) {
      console.error("[SettingsTab] Manual check update failed:", err);
      showCustomAlert("检查失败", `检查更新时出错：${err?.message || "未知错误"}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  React.useEffect(() => {
    const apiStr = JSON.stringify(settings.api);
    if (apiStr !== lastApiRef.current) {
      lastApiRef.current = apiStr;
      setSaveState("saving");
      const timer1 = setTimeout(() => {
        setSaveState("saved");
      }, 550);
      return () => clearTimeout(timer1);
    }
  }, [settings.api]);

  React.useEffect(() => {
    if (saveState === "saved") {
      const timer2 = setTimeout(() => {
        setSaveState("idle");
      }, 2000);
      return () => clearTimeout(timer2);
    }
  }, [saveState]);

  return (
    <div className="px-2.5 pb-2.5 pt-1 flex flex-col h-full overflow-hidden">
      <div className="border-b border-border pb-1.5 mb-1.5 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2 text-foreground tracking-tight">
            <Settings className="w-4.5 h-4.5 text-primary" /> 控制面板
            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-semibold select-none ml-2 animate-pulse">
              v{__APP_VERSION__}
            </span>
            <button
              type="button"
              onClick={handleCheckUpdate}
              disabled={isCheckingUpdate}
              aria-label="检查更新"
              className="ml-1 text-[9px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30 font-semibold hover:bg-primary/20 transition-all flex items-center gap-1 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCheckingUpdate ? (
                <>
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>检查中</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>检查更新</span>
                </>
              )}
            </button>
          </h1>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            系统参数与颗粒化规则调节
          </p>
        </div>
      </div>

      <Tabs
        defaultValue="api"
        className="flex-1 flex flex-col min-h-0 bg-transparent"
      >
        <TabsList className="grid grid-cols-4 w-full h-9.5 p-0.5 bg-muted/40 rounded-lg">
          <TabsTrigger
            value="api"
            className="text-[10.5px] font-bold flex items-center justify-center gap-1 whitespace-nowrap h-8 rounded-md py-1"
          >
            <KeySquare className="w-3.5 h-3.5" /> 连接
          </TabsTrigger>
          <TabsTrigger
            value="features"
            className="text-[10.5px] font-bold flex items-center justify-center gap-1 whitespace-nowrap h-8 rounded-md py-1"
          >
            <Puzzle className="w-3.5 h-3.5" /> 功能
          </TabsTrigger>
          <TabsTrigger
            value="persona"
            className="text-[10.5px] font-bold flex items-center justify-center gap-1 whitespace-nowrap h-8 rounded-md py-1"
          >
            <UserCheck className="w-3.5 h-3.5" /> 人设
          </TabsTrigger>
          <TabsTrigger
            value="storage"
            className="text-[10.5px] font-bold flex items-center justify-center gap-1 whitespace-nowrap h-8 rounded-md py-1"
          >
            <Database className="w-3.5 h-3.5" /> 存储
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto mt-2 custom-scrollbar pb-6">
          {/* 1. API CONFIG & PRESETS */}
          <TabsContent
            value="api"
            className="space-y-2 m-0 data-[state=inactive]:hidden outline-none"
          >
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

            <PresetForm />

            {/* 3. DEVELOPER PLAYGROUND */}
            <Card className="glass-panel shadow-sm border border-dashed border-primary/30">
              <CardHeader className="pb-2 pt-3 px-3 border-b border-border/40">
                <CardTitle className="text-xs flex items-center gap-2 text-primary font-bold">
                  <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                  <span>系统运行沙盒</span>
                </CardTitle>
                <CardDescription className="text-[10px]">
                  实时观测 Prompt 编译原理、SSE 流式解析缓冲区以及世界书扫描流程
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-3 px-3 pb-3">
                <button
                  type="button"
                  onClick={() => setActiveTab("playground")}
                  className="w-full py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  🚀 进入系统运行沙盒 (Sandbox)
                </button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 2. THEMES & APPLICATION FEATURES */}
          <TabsContent
            value="features"
            className="space-y-2 m-0 data-[state=inactive]:hidden outline-none"
          >
            <ThemeConfigSection
              settings={settings}
              updateSettings={updateSettings}
              currentTheme={currentTheme}
              handleThemeChange={handleThemeChange}
              showCustomAlert={showCustomAlert}
            />

            <FeaturesSection
              settings={settings}
              updateSettings={updateSettings}
            />
          </TabsContent>

          {/* 3. PERSONA CONFIG */}
          <TabsContent
            value="persona"
            className="space-y-2 m-0 data-[state=inactive]:hidden outline-none"
          >
            <PersonaConfigSection
              settings={settings}
              updateSettings={updateSettings}
              switchUserPersona={switchUserPersona}
              addUserPersona={addUserPersona}
              deleteUserPersona={deleteUserPersona}
              showCustomAlert={showCustomAlert}
            />
          </TabsContent>

          {/* 4. MEMORY AND STORAGE CONFIG */}
          <TabsContent
            value="storage"
            className="space-y-2 m-0 data-[state=inactive]:hidden outline-none"
          >
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
            />
          </TabsContent>
        </div>
      </Tabs>

    </div>
  );
}

