import React from "react";
import { RefreshCw, Cpu, Play } from "lucide-react";
import { useUnifiedApp } from "../../../UnifiedAppContext";
import { useTranslation } from "../../../contexts/LanguageContext";
import { useComposerCompatibilityVariables } from "../useComposerInputPath";
import { McpChatPopover } from "../../../components/externalTools/McpChatPopover";
import { ToolChatPopover } from "./ToolChatPopover";
import { PresetQuickPopover } from "./PresetQuickPopover";
import { KernelServices, type IExternalSourceRuntimeService } from "@/src/application/serviceContracts";
import type { CustomPromptBlock, Message, SummaryCard } from "../../../types";
import type { RecalledMessage } from "@/src/application/services/memory/types";
import type { QuickActionModulesConfig } from "./quickActionTypes";
import type { ComposerCommandDescriptor } from "@/src/domain/composer/contracts";

interface ComposerQuickActionBarProps {
  /** 由输入区控制显隐（AttachmentPicker 的快捷栏开关），组件本身不持有该状态。 */
  visible: boolean;
  draftText: string;
  onInsertData: (data: string) => void;
  mcpPopoverOpen: boolean;
  onMcpPopoverOpenChange: (next: boolean) => void;
  mcpSeedText: string;
  isHolding?: boolean;
  modulesConfig: QuickActionModulesConfig;
  availableCommands?: readonly ComposerCommandDescriptor[];
  onSelectCommand?: (command: ComposerCommandDescriptor) => void;
}

/**
 * 输入区上方的快捷操作栏：支持最多同时开启 4 个功能模块（自由开关）：
 * 1. reroll: 重发最后回复
 * 2. continue: 沿当前剧情推进
 * 3. preset: 预设方案与采样调控
 * 4. token_predict: 实时上下文 Token 预估
 * 5. tool: 工具插件（DeepSeek 搜索/抓取等）
 * 6. mcp: MCP 外部能力面板
 */
export function ComposerQuickActionBar({
  visible,
  draftText,
  onInsertData,
  mcpPopoverOpen,
  onMcpPopoverOpenChange,
  mcpSeedText,
  isHolding = false,
  modulesConfig,
  availableCommands = [],
  onSelectCommand,
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

  const [toolPopoverOpen, setToolPopoverOpen] = React.useState(false);
  const [presetPopoverOpen, setPresetPopoverOpen] = React.useState(false);

  const compatibilityVariables = useComposerCompatibilityVariables({
    enabled: visible && modulesConfig.token_predict,
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

  const hasAnyActiveModule =
    modulesConfig.reroll ||
    modulesConfig.continue ||
    modulesConfig.preset ||
    modulesConfig.token_predict ||
    modulesConfig.tool ||
    modulesConfig.mcp;

  if (!visible || !hasAnyActiveModule) return null;

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
    <div
      className={`chat-composer-popover flex w-full max-w-3xl items-center justify-between rounded-xl px-2 py-1 animate-in fade-in slide-in-from-top-1 duration-200 ${
        isHolding ? "pointer-events-none" : ""
      }`}
    >
      <div className="flex flex-1 min-w-0 items-center gap-1.5 overflow-x-auto no-scrollbar">
        {/* 模块 1: 重发回复 */}
        {modulesConfig.reroll && (
          <button
            type="button"
            onClick={() => handleRerollLast()}
            disabled={
              isSending ||
              !activeSession ||
              !Array.isArray(activeSession.messages) ||
              !activeSession.messages.some((m: Message) => m.sender === "assistant")
            }
            className="flex h-8 flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary disabled:opacity-40"
            title="消除整条故事分支的最后一条AI回复并进行重新生成"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isSending ? "animate-spin" : ""}`} />
            <span className="truncate text-xs font-medium">{t("chat_input.reroll_last")}</span>
          </button>
        )}

        {/* 模块 2: 继续推进 */}
        {modulesConfig.continue && (
          <button
            type="button"
            onClick={() => {
              const continuePrompt = t("chat_input.continue_prompt") || "[请沿当前剧情继续推进]";
              void handleSendMessage(continuePrompt);
            }}
            disabled={isSending || !activeSession}
            className="flex h-8 flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary disabled:opacity-40"
            title="发送指令，引导 AI 沿当前剧情继续推进"
          >
            <Play className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate text-xs font-medium">{t("chat_input.continue")}</span>
          </button>
        )}

        {/* 模块 3: 预设调控 (Preset) */}
        {modulesConfig.preset && (
          <PresetQuickPopover
            open={presetPopoverOpen}
            onOpenChange={setPresetPopoverOpen}
            disabled={isSending || !activeSession}
          />
        )}

        {/* 模块 4: 工具插件 (Tool) */}
        {modulesConfig.tool && (
          <ToolChatPopover
            open={toolPopoverOpen}
            onOpenChange={setToolPopoverOpen}
            disabled={isSending || !activeSession}
            availableCommands={availableCommands}
            onSelectCommand={(cmd) => {
              if (onSelectCommand) onSelectCommand(cmd);
            }}
          />
        )}

        {/* 模块 5: MCP 外部能力 */}
        {modulesConfig.mcp && settings.enableExternalCapabilities === true && (
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

      {/* 模块 6: Token 实时预估显示在快捷栏右侧 */}
      {modulesConfig.token_predict && (
        <div
          aria-hidden="true"
          className="flex shrink-0 items-center gap-1.5 pr-1 text-muted-foreground font-mono text-[9px] opacity-75"
        >
          <Cpu className="w-3 h-3" />
          <span>
            {t("chat_input.token_prediction")} ~{tokenPrediction} tok
          </span>
        </div>
      )}
    </div>
  );
}
