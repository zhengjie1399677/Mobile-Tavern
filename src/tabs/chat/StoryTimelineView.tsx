// Sub-tab 2 故事时间线年鉴
// 从原 ChatTab.tsx L1659-1808 抽离
// 通过 selector 订阅所需上下文字段，接收 visibleExtensions 作为 prop

import React from "react";
import {
  Plus,
  Edit2,
  Trash2,
  GitFork,
  Clock,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { useKernel } from "../../contexts/KernelContext";
import { IDatabaseService } from "../../kernel/types";

const StoryTimelineView = () => {
  const kernel = useKernel();
  const databaseService = kernel.getService<IDatabaseService>("database");
  const saveSession = (session: any) => databaseService.saveSession(session);
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
  } = useUnifiedApp((state) => ({
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    setSessions: state.setSessions,
    showCustomConfirm: state.showCustomConfirm,
    setTimelineModalOpen: state.setTimelineModalOpen,
    setNewSummaryTag: state.setNewSummaryTag,
    setNewSummaryLoc: state.setNewSummaryLoc,
    setNewSummaryContent: state.setNewSummaryContent,
    setEditingSummaryId: state.setEditingSummaryId,
    createBacktrackFromTimeline: state.createBacktrackFromTimeline,
  }));

  const summaries = activeSession?.summaries ?? [];

  return (
    <div
      data-testid="story-timeline-scroll"
      style={{ WebkitOverflowScrolling: "touch" }}
      className="h-full min-h-0 flex-1 touch-pan-y space-y-3 overflow-y-auto overscroll-contain p-3 custom-scrollbar"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-foreground">
            故事年表
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            记录长期剧情节点，并在发送时加入系统 Prompt。
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
          className="flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-primary/30 bg-primary px-3 text-[11px] font-bold text-primary-foreground shadow-sm transition active:scale-[0.98]"
        >
          <Plus className="w-3.5 h-3.5" /> 手工补充
        </button>
      </div>

      {summaries.length > 0 ? (
        <div className="relative ml-2 space-y-3 border-l border-primary/25 py-1 pl-4">
        {summaries.map((summary: any) => (
          <div
            key={summary.id}
            className="group relative w-full max-w-full overflow-hidden rounded-xl border border-border/70 bg-card/60 p-2.5 shadow-sm"
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
            <p className="whitespace-pre-wrap break-words text-[12.5px] italic font-serif text-muted-foreground leading-relaxed font-light mt-1.5">
              {summary.content}
            </p>
          </div>
        ))}
        </div>
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 px-5 py-6 text-center text-muted-foreground">
          <Clock className="mb-2 size-7 stroke-[1.2] opacity-55" />
          <p className="text-xs font-semibold">尚无故事节点</p>
          <p className="mt-1 max-w-sm text-[10px] leading-4 opacity-70">
            对话积累后可整理潜意识碎片，也可以手工补充阶段性剧情记录。
          </p>
        </div>
      )}
    </div>
  );
};

export default StoryTimelineView;
