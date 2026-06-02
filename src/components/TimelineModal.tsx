import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { Clock, X } from "lucide-react";

export default function TimelineModal() {
  const {
    timelineModalOpen,
    setTimelineModalOpen,
    newSummaryTag,
    setNewSummaryTag,
    newSummaryLoc,
    setNewSummaryLoc,
    newSummaryContent,
    setNewSummaryContent,
    editingSummaryId,
    setEditingSummaryId,
    handleAddTimelineSummary,
  } = useContext(AppContext);

  if (!timelineModalOpen) return null;

  return (
    <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-30 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-xl max-w-sm w-full p-4 space-y-3 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h4 className="font-bold text-foreground flex items-center gap-1">
            <Clock className="w-4 h-4 text-primary" />{" "}
            {editingSummaryId ? "编辑年表时间卡" : "手动编纂年表时间卡"}
          </h4>
          <button
            onClick={() => {
              setTimelineModalOpen(false);
              setEditingSummaryId(null);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-muted-foreground mb-1">
              时间标签目幕牌 (e.g. 第次或三天、冬深夜等)
            </label>
            <input
              type="text"
              placeholder="如: 第 1 天 · 清晨"
              value={newSummaryTag}
              onChange={(e) => setNewSummaryTag(e.target.value)}
              className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none"
            />
          </div>

          <div>
            <label className="block text-muted-foreground mb-1">
              地点场景卡 (Location)
            </label>
            <input
              type="text"
              placeholder="场景或地点说明"
              value={newSummaryLoc}
              onChange={(e) => setNewSummaryLoc(e.target.value)}
              className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none"
            />
          </div>

          <div>
            <label className="block text-muted-foreground mb-1">
              当前剧情里程碑浓缩扼要 (150字以内)
            </label>
            <textarea
              placeholder="在这段时间内发生的主要剧情或事件摘要..."
              rows={4}
              value={newSummaryContent}
              onChange={(e) => setNewSummaryContent(e.target.value)}
              className="w-full bg-input border border-border rounded p-1.5 text-stone-250 text-foreground outline-none resize-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-1.5">
            <button
              onClick={() => {
                setTimelineModalOpen(false);
                setEditingSummaryId(null);
              }}
              className="bg-muted active:scale-[0.98] text-muted-foreground px-3.5 py-1.5 rounded font-medium"
            >
              取消
            </button>
            <button
              onClick={handleAddTimelineSummary}
              disabled={!newSummaryTag.trim() || !newSummaryContent.trim()}
              className="bg-primary hover:bg-primary disabled:opacity-50 text-primary-foreground px-4 py-1.5 rounded font-bold"
            >
              {editingSummaryId ? "保存修改" : "确定植入"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
