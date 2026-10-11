import React from "react";
import { RefreshCw, Cpu, Play } from "lucide-react";
import { useUnifiedApp } from "../../../UnifiedAppContext";
import { useTranslation } from "../../../contexts/LanguageContext";
import { useComposerCompatibilityVariables } from "../useComposerInputPath";
import { McpChatPopover } from "../../../components/externalTools/McpChatPopover";
import { KernelServices, type IExternalSourceRuntimeService } from "@/src/application/serviceContracts";
import type { CustomPromptBlock, Message, SummaryCard } from "../../../types";
import type { RecalledMessage } from "@/src/application/services/memory/types";

interface ComposerQuickActionBarProps {
  /** 由输入区控制显隐（AttachmentPicker 的快捷栏开关），组件本身不持有该状态。 */
  visible: boolean;
  draftText: string;
  onInsertData: (data: string) => void;
  mcpPopoverOpen: boolean;
  onMcpPopoverOpenChange: (next: boolean) => void;
  mcpSeedText: string;
}

/**
 * 输入区上方的快捷操作栏：重发 / 继续 / MCP 能力面板 + push token 预估。
 * token 预估需要兼容变量表，按需读取且可降级，绝不在按键路径上深拷贝。
 */
export function ComposerQuickActionBar({
  visible,
  draftText,
  onInsertData,
  mcpPopoverOpen,
  onMcpPopoverOpenChange,
  mcpSeedText,
}: ComposerQuickActionBarProps) {
  const { t } = useTranslation();
  const {
    isSending,
    activeSession,
    activeCharacter,
    settings,
    handleRerollLast,
    handleSendMessage,
    showCustomAlert,
    lastRecalledMemories,
    setActiveTab,
    getKernelService,
  } = useUnifiedApp((state) => ({
    isSending: state.isSending,
    activeSession: state.activeSession,
    activeCharacter: state.activeCharacter,
    settings: state.settings,
    handleRerollLast: state.handleRerollLast,
    handleSendMessage: state.handleSendMessage,
    showCustomAlert: state.showCustomAlert,
    lastRecalledMemories: state.lastRecalledMemories,
    setActiveTab: state.setActiveTab,
    getKernelService: state.getKernelService,
  }));

  const compatibilityVariables = useComposerCompatibilityVariables({
    enabled: visible,
    session: activeSession,
    getKernelService,
  });

  const getExternalSourceRuntime = React.useCallback((): IExternalSourceRuntimeService | null => {
    try {
      return getKernelService<IExternalSourceRuntimeService>(KernelServices.ExternalSources);
    } catch {
      return null;
    }
  }, [getKernelService]);

  if (!visible) return null;

  const tokenPrediction = Math.ceil(
    (draftText || "").length * 1.5 +
      ((Array.isArray(activeSession?.messages)
        ? activeSession.messages.slice(-settings.memory.recentTurns)
        : []
      ).reduce(
        (acc: number, m: Message) => acc + (m.content || "").length,
        0,
      ) || 0) *
        1.5 +
      ((activeCharacter?.description || "").length +
        (activeCharacter?.personality || "").length +
        (activeCharacter?.scenario || "").length +
        (activeCharacter?.system_prompt || "").length) *
        1.5 +
      (settings.promptConfig?.customPrompts || [])
        .filter((p: CustomPromptBlock) => p.enabled)
        .reduce(
          (acc: number, p: CustomPromptBlock) => acc + (p.content || "").length,
          0,
        ) *
        1.5 +
      (activeSession?.summaries || []).reduce(
        (acc: number, s: SummaryCard) => acc + (s.content || "").length,
        0,
      ) *
        1.5 +
      ((settings.memory?.enableRecall !== false && lastRecalledMemories) || []).reduce(
        (acc: number, m: RecalledMessage) => acc + (m.content || "").length,
        0,
      ) *
        1.5 +
      (settings.enableScriptExecution &&
      (() => {
        const ext = activeCharacter?.extensions || {};
        return (
          (Array.isArray(ext.tavern_helper?.scripts) && ext.tavern_helper.scripts.length > 0) ||
          !!(ext.mvu_settings || ext.mvu || ext.MVU)
        );
      })() &&
      Object.keys(compatibilityVariables).length > 0
        ? JSON.stringify(compatibilityVariables).length
        : 0) *
        1.5,
  );

  return (
    <div className="chat-composer-popover flex w-full max-w-3xl items-center justify-between rounded-xl px-2 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleRerollLast()}
          disabled={
            isSending ||
            !activeSession ||
            !Array.isArray(activeSession.messages) ||
            !activeSession.messages.some((m: Message) => m.sender === "assistant")
          }
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary disabled:opacity-40"
          title="消除整条故事分支的最后一条AI回复并进行重新生成"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSending ? "animate-spin" : ""}`} />
          <span className="text-xs font-medium">{t("chat_input.reroll_last")}</span>
        </button>
        <button
          type="button"
          onClick={() => handleSendMessage(t("chat_input.continue"))}
          disabled={isSending || !activeSession}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary disabled:opacity-40"
          title={`替用户发送"继续"以继续当前剧情`}
        >
          <Play className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{t("chat_input.continue")}</span>
        </button>
        {/* MCP 能力：总开关打开时才出现在快捷栏（气泡锚定在此按钮上，默认关闭=不显示） */}
        {settings.enableExternalCapabilities === true && (
          <McpChatPopover
            triggerVariant="bar"
            triggerDisabled={isSending || !activeSession}
            open={mcpPopoverOpen}
            onOpenChange={onMcpPopoverOpenChange}
            draftText={mcpSeedText}
            getRuntime={getExternalSourceRuntime}
            onInsertData={onInsertData}
            onOpenWorkbench={() => setActiveTab("workbench")}
            showAlert={showCustomAlert}
          />
        )}
      </div>

      <div
        aria-hidden="true"
        className="flex items-center gap-1.5 pr-1 text-muted-foreground font-mono text-[9px] opacity-75"
      >
        <Cpu className="w-3 h-3" />
        <span>
          {t("chat_input.token_prediction")} ~{tokenPrediction} tok
        </span>
      </div>
    </div>
  );
}
