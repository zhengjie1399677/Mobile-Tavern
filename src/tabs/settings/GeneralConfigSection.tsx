import {
  Activity,
  AlertCircle,
  CheckCircle2,
  KeySquare,
  Mic,
  Palette,
  RefreshCw,
  Sparkles,
  Volume2,
  Wifi,
} from "lucide-react";
import { Accordion } from "../../../components/ui/accordion";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";
import { useTranslation } from "../../contexts/LanguageContext";
import AsrConfigSection from "./AsrConfigSection";
import ApiConfigSection, { type SaveState } from "./sections/ApiConfigSection";
import ImageGenConfigSection from "./sections/ImageGenConfigSection";
import TtsConfigSection from "./sections/TtsConfigSection";

export interface GeneralConfigSectionProps
  extends Pick<UnifiedAppContextProps,
    | "settings"
    | "updateSettings"
    | "availableModels"
    | "isFetchingModels"
    | "handleFetchModels"
    | "testApiConnection"
    | "connectionStatus"
    | "showCustomPrompt"
    | "showCustomConfirm"
    | "getKernelService"
  > {
  saveState: SaveState;
  freeCount: number;
}

export default function GeneralConfigSection({
  settings,
  updateSettings,
  availableModels,
  isFetchingModels,
  handleFetchModels,
  testApiConnection,
  connectionStatus,
  showCustomPrompt,
  showCustomConfirm,
  getKernelService,
  saveState,
  freeCount,
}: GeneralConfigSectionProps) {
  const { t } = useTranslation();

  const isTesting = Boolean(connectionStatus?.testing);
  const isConnected = connectionStatus?.success === true;
  const isFailed = connectionStatus?.success === false;

  const currentModelName = settings.api.modelName || settings.api.type || "未设置模型";
  const activeProfile = (settings.savedApiProfiles || []).find(
    (p) => p.id === settings.currentApiProfileId
  );

  return (
    <div className="settings-connection-page space-y-2.5">
      {/* 顶部活跃连接与服务概览看板 */}
      <section className="rounded-2xl border border-border/70 bg-card/60 p-3 backdrop-blur-md shadow-xs space-y-2.5 transition-all">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary shadow-xs">
              <Wifi className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-foreground truncate">
                  {activeProfile ? activeProfile.name : "当前活跃连接"}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 text-[9px] font-semibold font-mono ${
                    isConnected
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                      : isFailed
                        ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                        : isTesting
                          ? "bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 animate-pulse"
                          : "bg-muted/40 text-muted-foreground border border-border/40"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isConnected
                        ? "bg-emerald-500"
                        : isFailed
                          ? "bg-rose-500"
                          : isTesting
                            ? "bg-sky-500 animate-ping"
                            : "bg-muted-foreground/60"
                    }`}
                  />
                  {isTesting ? "测试中" : isConnected ? "已连接" : isFailed ? "连接异常" : "待测试"}
                </span>
              </div>
              <p className="text-[10.5px] font-mono text-muted-foreground truncate mt-0.5">
                {currentModelName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={testApiConnection}
            disabled={isTesting}
            className="flex h-7.5 shrink-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-2.5 text-[11px] font-bold text-primary shadow-xs hover:bg-primary/20 hover:border-primary/40 active:scale-95 disabled:opacity-50 transition-all"
          >
            <RefreshCw className={`h-3 w-3 ${isTesting ? "animate-spin" : ""}`} />
            <span>{isTesting ? "测试中..." : "测试连接"}</span>
          </button>
        </div>

        {/* 快速多模态服务状态一览条 */}
        <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-border/40">
          <div className="flex items-center gap-1.5 rounded-lg bg-background/50 px-2 py-1 border border-border/40 text-[10px]">
            <Palette className={`h-3 w-3 shrink-0 ${settings.imageGenApi?.enabled ? "text-emerald-500" : "text-muted-foreground/50"}`} />
            <span className="truncate text-muted-foreground">生图:</span>
            <span className={`font-semibold shrink-0 ${settings.imageGenApi?.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/70"}`}>
              {settings.imageGenApi?.enabled ? "开启" : "关闭"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-background/50 px-2 py-1 border border-border/40 text-[10px]">
            <Volume2 className={`h-3 w-3 shrink-0 ${settings.ttsConfig?.enabled ? "text-amber-500" : "text-muted-foreground/50"}`} />
            <span className="truncate text-muted-foreground">TTS:</span>
            <span className={`font-semibold shrink-0 ${settings.ttsConfig?.enabled ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/70"}`}>
              {settings.ttsConfig?.enabled ? "开启" : "关闭"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-background/50 px-2 py-1 border border-border/40 text-[10px]">
            <Mic className={`h-3 w-3 shrink-0 ${settings.asrConfig?.enabled ? "text-sky-500" : "text-muted-foreground/50"}`} />
            <span className="truncate text-muted-foreground">ASR:</span>
            <span className={`font-semibold shrink-0 ${settings.asrConfig?.enabled ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground/70"}`}>
              {settings.asrConfig?.enabled ? "开启" : "关闭"}
            </span>
          </div>
        </div>
      </section>

      {/* 4 大核心服务配置折叠卡片组 */}
      <Accordion defaultValue={["api-config"]} className="settings-connection-stack">
        <ApiConfigSection
          settings={settings}
          updateSettings={updateSettings}
          availableModels={availableModels}
          isFetchingModels={isFetchingModels}
          handleFetchModels={handleFetchModels}
          testApiConnection={testApiConnection}
          connectionStatus={connectionStatus}
          showCustomPrompt={showCustomPrompt}
          showCustomConfirm={showCustomConfirm}
          saveState={saveState}
          freeCount={freeCount}
        />
        <ImageGenConfigSection settings={settings} updateSettings={updateSettings} />
        <TtsConfigSection settings={settings} updateSettings={updateSettings} getKernelService={getKernelService} />
        <AsrConfigSection settings={settings} updateSettings={updateSettings} />
      </Accordion>
    </div>
  );
}
