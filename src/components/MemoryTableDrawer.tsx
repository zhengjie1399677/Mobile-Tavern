import React, { useState } from "react";
import { ChatSession } from "../types";
import { X, BrainCircuit } from "lucide-react";
import { MvuVariablesTabContent } from "./MvuVariablesTabContent";
import StoryTimelineView from "../tabs/chat/StoryTimelineView";
import TableMemoryTab from "./memory-drawer/TableMemoryTab";
import DictTab from "./memory-drawer/DictTab";
import RecallTab from "./memory-drawer/RecallTab";

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
  // 大 Tab 面板：'timeline' | 'table' | 'dict' | 'recall' | 'mvu'
  const [activeTab, setActiveTab] = useState<'timeline' | 'table' | 'dict' | 'recall' | 'mvu'>(
    enableAutoSummary ? 'timeline' : (enableTableMemory ? 'table' : 'recall')
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
      <div className="w-full max-w-lg bg-background/85 border-t border-border/80 rounded-t-2xl shadow-2xl overflow-hidden flex flex-col h-[75vh] backdrop-blur-xl env-bottom">

        {/* Header Section */}
        <div className="px-4 py-3 border-b border-border/50 flex justify-between items-center bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold bg-primary/10 text-primary px-2.5 py-1 rounded-full flex items-center gap-1.5 font-sans">
              <BrainCircuit className="w-3.5 h-3.5" />
              记忆与状态中心
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* 原 ⚙️管理按钮已迁移至 TableMemoryTab 内部顶部，控制其内部 showConfig 状态 */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-muted border border-border/40 text-muted-foreground transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab 栏切换器 */}
        <div className="flex border-b border-border/30 bg-muted/10 px-4 py-2 gap-2 text-xs font-semibold overflow-x-auto scrollbar-none shrink-0">
          {enableAutoSummary && (
            <button
              onClick={() => setActiveTab('timeline')}
              className={`px-3 py-1.5 rounded-lg border transition-all ${activeTab === 'timeline' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
                }`}
            >
              故事年表
            </button>
          )}
          {enableTableMemory && (
            <button
              onClick={() => setActiveTab('table')}
              className={`px-3 py-1.5 rounded-lg border transition-all ${activeTab === 'table' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
                }`}
            >
              状态数据
            </button>
          )}
          <button
            onClick={() => setActiveTab('dict')}
            className={`px-3 py-1.5 rounded-lg border transition-all ${activeTab === 'dict' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
              }`}
          >
            记忆词典
          </button>
          <button
            onClick={() => setActiveTab('recall')}
            className={`px-3 py-1.5 rounded-lg border transition-all ${activeTab === 'recall' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
              }`}
          >
            唤醒记忆
          </button>
          <button
            onClick={() => setActiveTab('mvu')}
            className={`px-3 py-1.5 rounded-lg border transition-all ${activeTab === 'mvu' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
              }`}
          >
            角色变量
          </button>
        </div>

        {/* Inner Content Area */}
        <div className={`flex-1 min-h-0 ${activeTab === 'timeline' ? '' : 'overflow-y-auto p-4 space-y-4'}`}>

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
            />
          )}

          {/* TAB 2: 📖 记忆词典 */}
          {activeTab === 'dict' && (
            <DictTab activeSession={activeSession} />
          )}

          {/* TAB 3: 唤醒记忆 */}
          {activeTab === 'recall' && (
            <RecallTab
              activeSession={activeSession}
              saveSession={saveSession}
            />
          )}

          {/* TAB 4: 🏮 角色变量 */}
          {activeTab === 'mvu' && (
            <MvuVariablesTabContent
              variables={activeSession.variables || {}}
              onSave={async (newVars) => {
                const nextSession = {
                  ...activeSession,
                  variables: newVars
                };
                await saveSession(nextSession);
              }}
            />
          )}

        </div>
      </div>
    </div>
  );
};
