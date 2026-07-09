// Sub-tab 2 故事时间线年鉴
// 从原 ChatTab.tsx L1659-1808 抽离
// 内部调用 useUnifiedApp() 获取上下文，接收 visibleExtensions 作为 prop

import React from "react";
import {
  Plus,
  Edit2,
  Trash2,
  GitFork,
  Clock,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { saveSession } from "../../utils/localDB";

const StoryTimelineView = () => {
  const {
    sessions,
    activeSessionId,
    activeCharacter,
    activeSession,
    setSessions,
    showCustomConfirm,
    setTimelineModalOpen,
    setNewSummaryTag,
    setNewSummaryLoc,
    setNewSummaryContent,
    setEditingSummaryId,
    createBacktrackFromTimeline,
  } = useUnifiedApp();

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 min-h-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">
            故事历史卡片轴 (Memory Timeline)
          </p>
          <p className="text-[11px] text-muted-foreground">
            这些卡片将作为辅助长期记忆状态，拼写入系统 Prompt 中。
          </p>

        </div>
        <button
          onClick={() => {
            setNewSummaryTag(
              `幕段 ${sessions.find((s: any) => s.id === activeSessionId)?.summaries?.length || 0}`,
            );
            setNewSummaryLoc(
              activeCharacter?.scenario?.slice(0, 8) || "荒野野营",
            );
            setNewSummaryContent("");
            setTimelineModalOpen(true);
          }}
          className="bg-primary hover:bg-primary text-primary-foreground text-[11px] px-2.5 py-1.5 rounded transition flex items-center gap-1 font-medium shrink-0 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" /> 手工补充
        </button>
      </div>

      <div className="relative border-l border-primary/25 ml-3 pl-5 space-y-5 py-2">
        {activeSession?.summaries.map((summary: any) => (
          <div
            key={summary.id}
            className="relative group bg-card p-3 rounded-lg border border-border shadow-sm w-full max-w-full overflow-hidden"
          >
            {/* Timeline Dot Indicator */}
            <span className="absolute -left-[25px] top-4 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-background"></span>

            {/* Header summary node detail */}
            <div className="flex flex-col gap-1.5 mb-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-bold tracking-tight bg-primary/20 border border-amber-800/40 text-primary px-1.5 py-0.5 rounded max-w-full inline-block truncate">
                  ⏱ {summary.timeTag} · {summary.location}
                </span>

                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => createBacktrackFromTimeline(summary)}
                    title="以此历史年表节点作为新旅程重演起点进行平行剧本推写"
                    className="text-muted-foreground hover:text-muted-foreground p-0.5 text-[10px] bg-muted border border-border px-1 py-0.5 rounded flex items-center gap-0.5 mr-1"
                  >
                    <GitFork className="w-2.5 h-2.5 text-primary" /> 分支宇宙
                  </button>
                  <button
                    onClick={() => {
                      setEditingSummaryId(summary.id);
                      setNewSummaryTag(summary.timeTag);
                      setNewSummaryLoc(summary.location);
                      setNewSummaryContent(summary.content);
                      setTimelineModalOpen(true);
                    }}
                    className="text-muted-foreground hover:text-foreground p-1"
                    title="编辑该条记忆年表"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!activeSession) return;
                      const ok =
                        await showCustomConfirm(
                          "是否彻底解散清除该记忆卡片？",
                        );
                      if (ok) {
                         const nextSums = activeSession.summaries.filter(
                           (s: any) => s.id !== summary.id,
                         );
                         const updated = {
                           ...activeSession,
                           summaries: nextSums,
                           lastSummarizedMessageId: nextSums[nextSums.length - 1]?.lastMessageId || undefined,
                         };
                        setSessions((prev: any) =>
                          prev.map((s: any) =>
                            s.id === updated.id ? updated : s,
                          ),
                        );
                        await saveSession(updated);
                      }
                    }}
                    className="text-muted-foreground hover:text-red-400 p-1"
                    title="删除该条记忆年表"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>


            </div>

            {/* Summary prose item */}
            <p className="text-[12.5px] italic font-serif text-muted-foreground leading-relaxed font-light mt-1.5">
              {summary.content}
            </p>
          </div>
        ))}

        {(!activeSession?.summaries ||
          activeSession.summaries.length === 0) && (
          <div className="text-center py-8 text-muted-foreground border border-dashed border-border/80 rounded pl-2">
            <Clock className="w-8 h-8 stroke-[1.2] mx-auto mb-1.5 opacity-60" />
            <p className="text-xs">目前尚未归档任何宏观发展大纲</p>
            <p className="text-[10px] leading-normal px-4 mt-1 opacity-70">
              当聊天内容变长时，可通过上方 “记忆” 菜单中的 “整理潜意识碎片”
              自主浓缩，或手工录入您对当前关系演变的阶段性理解记录。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StoryTimelineView;
