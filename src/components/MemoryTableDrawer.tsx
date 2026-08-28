import React from "react";
import { ChatSession, ChatSessionMetadataPatch } from "../types";
import { X, LoaderCircle } from "lucide-react";
import StoryTimelineView from "../tabs/chat/StoryTimelineView";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { useOptionalKernel } from "../contexts/KernelContext";
import {
  KernelServices,
  type ICompatibilityRuntimeService,
} from "../application/serviceContracts";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";

const MvuVariablesTabContent = React.lazy(() =>
  import("./MvuVariablesTabContent").then((module) => ({ default: module.MvuVariablesTabContent }))
);
const TableMemoryTab = React.lazy(() => import("./memory-drawer/TableMemoryTab"));
const DictTab = React.lazy(() => import("./memory-drawer/DictTab"));
const RecallTab = React.lazy(() => import("./memory-drawer/RecallTab"));

interface MemoryTableDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: ChatSession;
  updateSessionMetadata: (sessionId: string, patch: ChatSessionMetadataPatch) => Promise<void>;
  charName: string;
  enableTableMemory: boolean;
  enableAutoSummary: boolean;
  enableRecall?: boolean;
  enableMvuVariables?: boolean;
  initialTab?: MemoryDrawerPanel;
}

type MemoryDrawerPanel = 'timeline' | 'table' | 'dict' | 'recall' | 'mvu';

const PANEL_LABEL_KEYS: Record<MemoryDrawerPanel, string> = {
  timeline: "memory_drawer.tab_timeline",
  table: "memory_drawer.tab_table",
  dict: "memory_drawer.tab_dict",
  recall: "memory_drawer.tab_recall",
  mvu: "memory_drawer.tab_mvu",
};

function resolvePanel(
  initialPanel: MemoryDrawerPanel | undefined,
  availability: Readonly<Record<MemoryDrawerPanel, boolean>>,
): MemoryDrawerPanel {
  if (initialPanel && availability[initialPanel]) return initialPanel;
  return (Object.keys(availability) as MemoryDrawerPanel[])
    .find((panel) => availability[panel]) ?? 'dict';
}

export const MemoryTableDrawer: React.FC<MemoryTableDrawerProps> = ({
  isOpen,
  onClose,
  activeSession,
  updateSessionMetadata,
  charName,
  enableTableMemory,
  enableAutoSummary,
  enableRecall = false,
  enableMvuVariables = false,
  initialTab
}) => {
  const kernel = useOptionalKernel();
  const { setSessionViews, showCustomAlert, showCustomConfirm, lastRecalledMemories, lastMemoryAudit } = useUnifiedApp((state) => ({
    setSessionViews: state.setSessionViews,
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
    lastRecalledMemories: state.lastRecalledMemories,
    lastMemoryAudit: state.lastMemoryAudit,
  }));
  const { t } = useTranslation();
  const availability: Readonly<Record<MemoryDrawerPanel, boolean>> = {
    timeline: enableAutoSummary,
    table: enableTableMemory,
    dict: true,
    recall: enableRecall,
    mvu: enableMvuVariables,
  };
  const activeTab = resolvePanel(initialTab, availability);
  const panelTitle = t(PANEL_LABEL_KEYS[activeTab]);

  useMobileBackHandler(isOpen, () => {
    onClose();
    return true;
  }, 850);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-50 bg-black/55"
        data-memory-drawer-surface
        data-panel={activeTab}
        data-density="comfortable"
        className="!bottom-0 !top-auto z-50 flex h-[84dvh] max-h-[84dvh] w-full max-w-lg !translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none rounded-t-3xl border-x-0 border-b-0 border-t border-border/70 bg-background p-0 shadow-xl env-bottom sm:!bottom-auto sm:!top-1/2 sm:h-[82vh] sm:max-h-[720px] sm:!-translate-y-1/2 sm:rounded-3xl sm:border [&_button]:touch-manipulation [&_button]:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-primary/25 [&_button]:disabled:cursor-not-allowed [&_button]:disabled:opacity-50"
      >

        {/* Header Section */}
        <div className="flex min-h-14 items-center justify-between border-b border-border/45 bg-background px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-muted-foreground">{t("memory_drawer.title")}</p>
            <DialogTitle className="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              {panelTitle}
            </DialogTitle>
          </div>
          <div className="flex items-center gap-1.5">
            {/* 原 ⚙️管理按钮已迁移至 TableMemoryTab 内部顶部，控制其内部 showConfig 状态 */}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭会话资料"
              className="flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Inner Content Area */}
        <div className={`min-h-0 flex-1 ${activeTab === 'timeline' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto p-4'}`}>
          <React.Suspense fallback={<MemoryTabFallback />}>

          {/* 故事年表面板 */}
          {activeTab === 'timeline' && (
            <StoryTimelineView />
          )}

          {/* 状态数据面板 */}
          {activeTab === 'table' && (
            <TableMemoryTab
              activeSession={activeSession}
              updateSessionMetadata={updateSessionMetadata}
              charName={charName}
              showCustomAlert={showCustomAlert}
              showCustomConfirm={showCustomConfirm}
            />
          )}

          {/* 记忆词典面板 */}
          {activeTab === 'dict' && (
            <DictTab
              activeSession={activeSession}
              showCustomAlert={showCustomAlert}
              showCustomConfirm={showCustomConfirm}
            />
          )}

          {/* 唤醒记忆面板 */}
          {activeTab === 'recall' && (
            <RecallTab
              activeSession={activeSession}
              updateSessionMetadata={updateSessionMetadata}
              lastRecalledMemories={lastRecalledMemories}
              lastMemoryAudit={lastMemoryAudit}
            />
          )}

          {/* 角色变量面板 */}
          {activeTab === 'mvu' && (
            <MvuVariablesTabContent
              variables={kernel?.hasService(KernelServices.CompatibilityRuntime)
                ? kernel
                    .getService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime)
                    .readState(activeSession)
                : {}}
              onSave={async (newVars) => {
                console.log(`[MVU-SAVE-DIAG] onSave called, sessId=${activeSession.id}, varKeys=${Object.keys(newVars?.stat_data || {}).join(',')}`);
                const compatibilityRuntime = kernel?.hasService(KernelServices.CompatibilityRuntime)
                  ? kernel.getService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime)
                  : null;
                if (!compatibilityRuntime?.isEnabled()) {
                  throw new Error("SILLY_TAVERN_COMPATIBILITY_RUNTIME_DISABLED");
                }
                const nextSession = compatibilityRuntime.writeState(activeSession, newVars);
                await updateSessionMetadata(nextSession.id, {
                  variables: undefined,
                  runtimePluginState: nextSession.runtimePluginState,
                });
                setSessionViews((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
                console.log(`[MVU-SAVE-DIAG] setSessionViews done`);
                try {
                  if (kernel?.hasService(KernelServices.CompatibilityRuntime)) {
                    kernel
                      .getService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime)
                      .notifyStateChanged(nextSession);
                  }
                  console.log(`[MVU-SAVE-DIAG] notifyVariablesUpdated done`);
                } catch (e) {
                  console.warn("[MemoryTableDrawer] notifyVariablesUpdated failed:", e);
                }
                showCustomAlert(t("memory_drawer.mvu_save_success"));
              }}
            />
          )}
          </React.Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
};

function MemoryTabFallback() {
  return (
    <div className="flex min-h-32 items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
      <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
      正在加载当前面板…
    </div>
  );
}
