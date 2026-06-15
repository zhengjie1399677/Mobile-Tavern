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
    newSummaryCondition,
    setNewSummaryCondition,
    newSummaryInventory,
    setNewSummaryInventory,
    newSummaryBonding,
    setNewSummaryBonding,
    editingSummaryId,
    setEditingSummaryId,
    handleAddTimelineSummary,
  } = useContext(AppContext);

  if (!timelineModalOpen) return null;

  const handleCancel = () => {
    setTimelineModalOpen(false);
    setEditingSummaryId(null);
    setNewSummaryTag("");
    setNewSummaryLoc("");
    setNewSummaryContent("");
    setNewSummaryCondition("");
    setNewSummaryInventory("");
    setNewSummaryBonding("");
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[999] flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-xl max-w-md w-full sm:max-w-lg p-4 space-y-3 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h4 className="font-bold text-foreground flex items-center gap-1">
            <Clock className="w-4 h-4 text-primary" />{" "}
            {editingSummaryId ? "编辑年表时间卡" : "手动编纂年表时间卡"}
          </h4>
          <button
            onClick={handleCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Top: Event Content Textarea */}
          <div>
            <label className="block text-muted-foreground mb-1 font-medium">
              当前剧情里程碑浓缩扼要 (150字以内) <span className="text-destructive">*</span>
            </label>
            <textarea
              placeholder="在这段时间内发生的主要剧情或事件摘要..."
              rows={6}
              value={newSummaryContent}
              onChange={(e) => setNewSummaryContent(e.target.value)}
              className="w-full bg-input border border-border rounded p-2 text-foreground outline-none resize-y leading-relaxed text-sm font-medium"
            />
          </div>

          {/* Middle: Basic Metadata side-by-side */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-muted-foreground mb-1 font-medium">
                时间标签目幕牌 <span className="text-destructive">*</span>
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
              <label className="block text-muted-foreground mb-1 font-medium">
                地点场景卡
              </label>
              <input
                type="text"
                placeholder="场景或地点说明"
                value={newSummaryLoc}
                onChange={(e) => setNewSummaryLoc(e.target.value)}
                className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none"
              />
            </div>
          </div>

          {/* Game Extensions Divider */}
          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-border/60"></div>
            <span className="flex-shrink mx-2 text-[10px] font-bold text-muted-foreground/85 tracking-widest uppercase">
              游戏化拓展字段 (可选)
            </span>
            <div className="flex-grow border-t border-border/60"></div>
          </div>

          {/* Bottom: Game Extensions */}
          <div className="space-y-2.5">
            <div>
              <label className="block text-muted-foreground mb-0.5 font-medium">
                💓 心境/生理状态 (Condition)
              </label>
              <input
                type="text"
                placeholder="如: 警惕、疲惫、好感微升"
                value={newSummaryCondition}
                onChange={(e) => setNewSummaryCondition(e.target.value)}
                className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none"
              />
            </div>

            <div>
              <label className="block text-muted-foreground mb-0.5 font-medium">
                🎒 随身道具变动 (Inventory)
              </label>
              <input
                type="text"
                placeholder="如: 获得加密文件*1、失去金币*10"
                value={newSummaryInventory}
                onChange={(e) => setNewSummaryInventory(e.target.value)}
                className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none"
              />
            </div>

            <div>
              <label className="block text-muted-foreground mb-0.5 font-medium">
                🔗 双方情感羁绊 (Bonding)
              </label>
              <input
                type="text"
                placeholder="如: 达成合作、关系冷淡、信任度增加"
                value={newSummaryBonding}
                onChange={(e) => setNewSummaryBonding(e.target.value)}
                className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/40">
            <button
              onClick={handleCancel}
              className="bg-muted hover:bg-muted/80 active:scale-[0.98] text-muted-foreground px-3.5 py-1.5 rounded font-medium transition"
            >
              取消
            </button>
            <button
              onClick={handleAddTimelineSummary}
              disabled={!newSummaryTag.trim() || !newSummaryContent.trim()}
              className="bg-primary hover:bg-primary/95 disabled:opacity-50 text-primary-foreground px-4 py-1.5 rounded font-bold transition animate-hover"
            >
              {editingSummaryId ? "保存修改" : "确定植入"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
