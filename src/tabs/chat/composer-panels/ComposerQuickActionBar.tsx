import React from "react";
import { RefreshCw, Cpu, Play } from "lucide-react";
import { useUnifiedApp } from "../../../UnifiedAppContext";
import { useTranslation } from "../../../contexts/LanguageContext";
import { useComposerCompatibilityVariables } from "../useComposerInputPath";
import { ToolsPanel, type SessionManualToolSummary, type SessionModelToolSummary, type ToolsPanelTab } from "./ToolsPanel";
import { PresetQuickPopover } from "./PresetQuickPopover";
import type { IExternalSourceRuntimeService } from "@/src/application/serviceContracts";
import type { ManualToolInvocationResult } from "@/src/application/useCases/manualToolInvocation";
import type { CustomPromptBlock, Message, SummaryCard } from "../../../types";
import type { RecalledMessage } from "@/src/application/services/memory/types";
import type { QuickActionModulesConfig } from "./quickActionTypes";
import type { ComposerCommandDescriptor } from "@/src/domain/composer/contracts";

/** 工具面板的受控绑定：打开态、当前分区与数据源都由输入区持有。 */
export interface ComposerToolsPanelBinding {
  readonly open: boolean;
  readonly tab: ToolsPanelTab;
  readonly onOpenChange: (open: boolean) => void;
  readonly draftText: string;
  readonly modelTools: readonly SessionModelToolSummary[];
  readonly manualTools: readonly SessionManualToolSummary[];
  readonly onInvokeTool: (toolName: string, input: Record<string, unknown>) => Promise<ManualToolInvocationResult>;
  readonly externalCapabilitiesEnabled: boolean;
  readonly getRuntime: () => IExternalSourceRuntimeService | null;
  readonly showAlert: (message: string, title?: string) => Promise<void> | void;
}

interface ComposerQuickActionBarProps {
  /** 由输入区控制显隐（AttachmentPicker 的快捷栏开关），组件本身不持有该状态。 */
  visible: boolean;
  draftText: string;
  onInsertData: (data: string) => void;
  toolsPanel: ComposerToolsPanelBinding;
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
 * 5. tool: 统一工具面板（自动调用 / 手动调用）
 *
 * 2026-10-21：原独立的 MCP 模块已合并进工具面板，避免同一能力出现两个入口。
 */
export function ComposerQuickActionBar({
  visible,
  draftText,
  onInsertData,
  toolsPanel,
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
    setActiveTab,
    getKernelService,
    lastRecalledMemories,
  } = useUnifiedApp((state) => ({
    isSending: state.isSending,
    activeSession: state.activeSession,
    activeCharacter: state.activeCharacter,
    settings: state.settings,
    handleRerollLast: state.handleRerollLast,
    handleSendMessage: state.handleSendMessage,
    setActiveTab: state.setActiveTab,
    getKernelService: state.getKernelService,
    lastRecalledMemories: state.lastRecalledMemories,
  }));

  const [presetPopoverOpen, setPresetPopoverOpen] = React.useState(false);

  const compatibilityVariables = useComposerCompatibilityVariables({
    enabled: visible && modulesConfig.token_predict,
    session: activeSession,
    getKernelService,
  });

  const hasAnyActiveModule =
    modulesConfig.reroll ||
    modulesConfig.continue ||
    modulesConfig.preset ||
    modulesConfig.token_predict ||
    modulesConfig.tool ||
    // `/tool` 与 `/mcp` 可在模块关闭时直接唤起面板：此时仍需渲染触发器以承载弹层。
    toolsPanel.open;

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

        {/* 模块 4: 统一工具面板（自动调用 / 手动调用）；命令唤起时即使模块关闭也要挂载 */}
        {(modulesConfig.tool || toolsPanel.open) && (
          <ToolsPanel
            open={toolsPanel.open}
            onOpenChange={toolsPanel.onOpenChange}
            initialTab={toolsPanel.tab}
            disabled={isSending || !activeSession}
            draftText={toolsPanel.draftText}
            modelTools={toolsPanel.modelTools}
            manualTools={toolsPanel.manualTools}
            onInvokeTool={toolsPanel.onInvokeTool}
            availableCommands={availableCommands}
            onSelectCommand={(command) => onSelectCommand?.(command)}
            onInsertData={onInsertData}
            onOpenWorkbench={() => setActiveTab("workbench")}
            showAlert={toolsPanel.showAlert}
            getRuntime={toolsPanel.getRuntime}
            externalCapabilitiesEnabled={toolsPanel.externalCapabilitiesEnabled}
          />
        )}
      </div>

      {/* 模块 5: Token 实时预估显示在快捷栏右侧 */}
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
