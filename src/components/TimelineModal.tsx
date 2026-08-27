import React from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { Clock } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";

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
  } = useUnifiedApp((state) => ({
    timelineModalOpen: state.timelineModalOpen,
    setTimelineModalOpen: state.setTimelineModalOpen,
    newSummaryTag: state.newSummaryTag,
    setNewSummaryTag: state.setNewSummaryTag,
    newSummaryLoc: state.newSummaryLoc,
    setNewSummaryLoc: state.setNewSummaryLoc,
    newSummaryContent: state.newSummaryContent,
    setNewSummaryContent: state.setNewSummaryContent,
    editingSummaryId: state.editingSummaryId,
    setEditingSummaryId: state.setEditingSummaryId,
    handleAddTimelineSummary: state.handleAddTimelineSummary,
  }));

  const handleCancel = () => {
    setTimelineModalOpen(false);
    setEditingSummaryId(null);
    setNewSummaryTag("");
    setNewSummaryLoc("");
    setNewSummaryContent("");
  };

  useMobileBackHandler(timelineModalOpen, () => {
    handleCancel();
    return true;
  }, 900);

  if (!timelineModalOpen) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <DialogContent showCloseButton={false} className="z-[999] gap-3 border-border bg-background text-sm shadow-2xl sm:max-w-lg">
        <DialogHeader className="border-b border-border pb-3">
          <DialogTitle className="font-bold text-foreground flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-primary" />{" "}
            {editingSummaryId ? "编辑年表时间卡" : "手动编纂年表时间卡"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Top: Event Content Textarea */}
          <div>
            <label htmlFor="timeline-summary-content" className="block text-muted-foreground mb-1 font-medium">
              当前剧情里程碑浓缩扼要 (150字以内) <span className="text-destructive">*</span>
            </label>
            <textarea
              id="timeline-summary-content"
              placeholder="在这段时间内发生的主要剧情或事件摘要..."
              rows={6}
              value={newSummaryContent}
              onChange={(e) => setNewSummaryContent(e.target.value)}
              className="w-full bg-input border border-border rounded-lg p-3 text-foreground outline-none resize-y leading-relaxed text-sm font-medium focus:ring-2 focus:ring-ring/40"
            />
          </div>

          {/* Middle: Basic Metadata side-by-side */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="timeline-summary-tag" className="block text-muted-foreground mb-1 font-medium">
                时间标签目幕牌 <span className="text-destructive">*</span>
              </label>
              <input
                id="timeline-summary-tag"
                type="text"
                placeholder="如: 第 1 天 · 清晨"
                value={newSummaryTag}
                onChange={(e) => setNewSummaryTag(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>

            <div>
              <label htmlFor="timeline-summary-location" className="block text-muted-foreground mb-1 font-medium">
                地点场景卡
              </label>
              <input
                id="timeline-summary-location"
                type="text"
                placeholder="场景或地点说明"
                value={newSummaryLoc}
                onChange={(e) => setNewSummaryLoc(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>
          <DialogFooter className="flex-row justify-end">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-11 min-w-20"
              onClick={handleCancel}
            >
              取消
            </Button>
            <Button
              type="button"
              size="lg"
              className="min-h-11 min-w-24"
              onClick={handleAddTimelineSummary}
              disabled={!newSummaryTag.trim() || !newSummaryContent.trim()}
            >
              {editingSummaryId ? "保存修改" : "确定植入"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
