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
      {/* 顶部活跃连接极简紧凑状态栏 */}
      <section className="rounded-xl border border-border/70 bg-card/60 px-3 py-2 backdrop-blur-md shadow-xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Wifi className="h-3 w-3" />
          </span>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-bold text-foreground truncate max-w-[110px] sm:max-w-none">
              {activeProfile ? activeProfile.name : "当前端点"}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 text-[10px] font-semibold font-mono shrink-0 ${
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
            <span className="text-[11px] font-mono text-muted-foreground/75 truncate hidden sm:inline" title={currentModelName}>
              · {currentModelName}
            </span>
          </div>
        </div>

        {/* 快速多模态状态微标 */}
        <div className="flex items-center gap-1 shrink-0">
          <span
            className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border ${
              settings.imageGenApi?.enabled
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 font-semibold"
                : "bg-muted/20 text-muted-foreground/50 border-transparent font-normal"
            }`}
            title={`生图: ${settings.imageGenApi?.enabled ? "已开启" : "已关闭"}`}
          >
            <Palette className="h-3 w-3" />
            <span>生图</span>
          </span>
          <span
            className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border ${
              settings.ttsConfig?.enabled
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25 font-semibold"
                : "bg-muted/20 text-muted-foreground/50 border-transparent font-normal"
            }`}
            title={`TTS: ${settings.ttsConfig?.enabled ? "已开启" : "已关闭"}`}
          >
            <Volume2 className="h-3 w-3" />
            <span>TTS</span>
          </span>
          <span
            className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border ${
              settings.asrConfig?.enabled
                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25 font-semibold"
                : "bg-muted/20 text-muted-foreground/50 border-transparent font-normal"
            }`}
            title={`ASR: ${settings.asrConfig?.enabled ? "已开启" : "已关闭"}`}
          >
            <Mic className="h-3 w-3" />
            <span>ASR</span>
          </span>
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
