import React, { useState } from "react";
import { ChatSession } from "../types";
import { X, BrainCircuit, LoaderCircle } from "lucide-react";
import StoryTimelineView from "../tabs/chat/StoryTimelineView";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { notifyVariablesUpdated } from "../utils/tavernHelper";

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
  saveSession: (session: ChatSession) => Promise<void>;
  charName: string;
  enableTableMemory: boolean;
  enableAutoSummary: boolean;
  initialTab?: 'timeline' | 'table' | 'dict' | 'recall' | 'mvu';
}

export const MemoryTableDrawer: React.FC<MemoryTableDrawerProps> = ({
  isOpen,
  onClose,
  activeSession,
  saveSession,
  charName,
  enableTableMemory,
  enableAutoSummary,
  initialTab
}) => {
  const { setSessions, showCustomAlert, showCustomConfirm, lastRecalledMemories } = useUnifiedApp((state) => ({
    setSessions: state.setSessions,
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
    lastRecalledMemories: state.lastRecalledMemories,
  }));
  const { t } = useTranslation();
  // 大 Tab 面板：'timeline' | 'table' | 'dict' | 'recall' | 'mvu'
  const [activeTab, setActiveTab] = useState<'timeline' | 'table' | 'dict' | 'recall' | 'mvu'>(
    initialTab ?? (enableAutoSummary ? 'timeline' : (enableTableMemory ? 'table' : 'recall'))
  );

  // 当抽屉打开时，根据当前配置或传入初始 Tab 动态重置 Tab
  React.useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      } else {
        setActiveTab(enableAutoSummary ? 'timeline' : (enableTableMemory ? 'table' : 'recall'));
      }
    }
  }, [isOpen, initialTab, enableTableMemory, enableAutoSummary]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] transition-all duration-300">
      <div
        data-memory-drawer-surface
        data-density="compact"
        className="flex h-[92dvh] max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[22px] border-t border-border/80 bg-background/95 shadow-2xl backdrop-blur-xl env-bottom sm:h-[86vh] sm:max-h-[760px] [&_button]:touch-manipulation [&_button]:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-primary/25 [&_button]:disabled:cursor-not-allowed [&_button]:disabled:opacity-50"
      >

        {/* Header Section */}
        <div className="flex min-h-12 items-center justify-between border-b border-border/50 bg-muted/20 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-foreground">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BrainCircuit className="size-4" />
              </span>
              {t("memory_drawer.title")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* 原 ⚙️管理按钮已迁移至 TableMemoryTab 内部顶部，控制其内部 showConfig 状态 */}
            <button
              onClick={onClose}
              aria-label="关闭记忆与状态中心"
              className="flex size-9 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Tab 栏切换器 */}
        <div role="tablist" aria-label="记忆与状态分类" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/30 bg-muted/10 px-2 py-1.5 text-[11px] font-semibold scrollbar-none">
          {enableAutoSummary && (
            <button
              onClick={() => setActiveTab('timeline')}
              role="tab"
              aria-selected={activeTab === 'timeline'}
              className={`min-h-9 shrink-0 rounded-lg border px-3 transition-all ${activeTab === 'timeline' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
                }`}
            >
              {t("memory_drawer.tab_timeline")}
            </button>
          )}
          {enableTableMemory && (
            <button
              onClick={() => setActiveTab('table')}
              role="tab"
              aria-selected={activeTab === 'table'}
              className={`min-h-9 shrink-0 rounded-lg border px-3 transition-all ${activeTab === 'table' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
                }`}
            >
              {t("memory_drawer.tab_table")}
            </button>
          )}
          <button
            onClick={() => setActiveTab('dict')}
            role="tab"
            aria-selected={activeTab === 'dict'}
            className={`min-h-9 shrink-0 rounded-lg border px-3 transition-all ${activeTab === 'dict' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
              }`}
          >
            {t("memory_drawer.tab_dict")}
          </button>
          <button
            onClick={() => setActiveTab('recall')}
            role="tab"
            aria-selected={activeTab === 'recall'}
            className={`min-h-9 shrink-0 rounded-lg border px-3 transition-all ${activeTab === 'recall' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
              }`}
          >
            {t("memory_drawer.tab_recall")}
          </button>
          <button
            onClick={() => setActiveTab('mvu')}
            role="tab"
            aria-selected={activeTab === 'mvu'}
            className={`min-h-9 shrink-0 rounded-lg border px-3 transition-all ${activeTab === 'mvu' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
              }`}
          >
            {t("memory_drawer.tab_mvu")}
          </button>
        </div>

        {/* Inner Content Area */}
        <div className={`min-h-0 flex-1 ${activeTab === 'timeline' ? '' : 'overflow-y-auto p-3'}`}>
          <React.Suspense fallback={<MemoryTabFallback />}>

          {/* TAB 0: ⏱️ 故事年表 */}
          {activeTab === 'timeline' && (
            <StoryTimelineView />
          )}

          {/* TAB 1: 📊 状态沙盒 */}
          {activeTab === 'table' && (
            <TableMemoryTab
              activeSession={activeSession}
              saveSession={saveSession}
              charName={charName}
              showCustomAlert={showCustomAlert}
              showCustomConfirm={showCustomConfirm}
            />
          )}

          {/* TAB 2: 📖 记忆词典 */}
          {activeTab === 'dict' && (
            <DictTab
              activeSession={activeSession}
              showCustomAlert={showCustomAlert}
              showCustomConfirm={showCustomConfirm}
            />
          )}

          {/* TAB 3: 唤醒记忆 */}
          {activeTab === 'recall' && (
            <RecallTab
              activeSession={activeSession}
              saveSession={saveSession}
              lastRecalledMemories={lastRecalledMemories}
            />
          )}

          {/* TAB 4: 🏮 角色变量 */}
          {activeTab === 'mvu' && (
            <MvuVariablesTabContent
              variables={activeSession.variables || {}}
              onSave={async (newVars) => {
                console.log(`[MVU-SAVE-DIAG] onSave called, sessId=${activeSession.id}, varKeys=${Object.keys(newVars?.stat_data || {}).join(',')}`);
                const nextSession = {
                  ...activeSession,
                  variables: newVars
                };
                try {
                  await saveSession(nextSession);
                  console.log(`[MVU-SAVE-DIAG] saveSession done`);
                } catch (e) {
                  console.error(`[MVU-SAVE-DIAG] saveSession FAILED:`, e);
                }
                setSessions((prev) => prev.map((s) => (s.id === nextSession.id ? nextSession : s)));
                console.log(`[MVU-SAVE-DIAG] setSessions done`);
                try {
                  notifyVariablesUpdated(nextSession);
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
      </div>
    </div>
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
