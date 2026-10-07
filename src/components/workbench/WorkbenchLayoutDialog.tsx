import React from "react";
import { ChevronDown, ChevronUp, LayoutGrid, RotateCcw, X } from "lucide-react";
import { Switch } from "../../../components/ui/switch";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";
import { moveWorkbenchCard } from "../../domain/ui/workbenchLayout";
import { WORKBENCH_CARDS } from "./workbenchCards";

export interface WorkbenchLayoutDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** 当前顺序（已解析后的 card id 数组）。 */
  readonly order: readonly string[];
  /** 当前被隐藏的 card id。 */
  readonly hidden: readonly string[];
  readonly onChange: (next: { order: string[]; hidden: string[] }) => void;
}

/**
 * 工作台布局编辑器：调整卡片顺序与显示开关，改动即时保存。
 *
 * 交互刻意采用「上移 / 下移 + 显示开关」而不是拖拽：移动端触控与无障碍键盘都可用，
 * 也能被测试直接覆盖（拖拽排序需要额外的指针手势状态机）。
 */
export const WorkbenchLayoutDialog: React.FC<WorkbenchLayoutDialogProps> = ({
  open,
  onClose,
  order,
  hidden,
  onChange,
}) => {
  useMobileBackHandler(open, () => {
    onClose();
    return true;
  }, 880);

  if (!open) return null;

  const hiddenSet = new Set(hidden);
  const titleById = new Map(WORKBENCH_CARDS.map((card) => [card.id, card.title]));
  const descriptionById = new Map(WORKBENCH_CARDS.map((card) => [card.id, card.description]));

  const applyOrder = (nextOrder: string[]) => {
    onChange({ order: nextOrder, hidden: [...hidden] });
  };

  const toggleVisible = (id: string, visible: boolean) => {
    const nextHidden = visible
      ? hidden.filter((item) => item !== id)
      : [...hidden, id];
    onChange({ order: [...order], hidden: nextHidden });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-cyan-400" />
            <div>
              <h4 className="text-sm font-bold text-foreground">编辑工作台布局</h4>
              <p className="text-[10px] text-muted-foreground">上移 / 下移调顺序，开关控制显示，改动即时保存</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭布局编辑"
            className="rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {order.map((id, index) => {
            const visible = !hiddenSet.has(id);
            return (
              <div
                key={id}
                className={`flex items-center gap-2 rounded-xl border p-2.5 transition-all ${
                  visible ? "border-white/10 bg-white/5" : "border-white/5 bg-black/20 opacity-70"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => applyOrder(moveWorkbenchCard(order, id, -1))}
                    disabled={index === 0}
                    aria-label={`上移 ${titleById.get(id) ?? id}`}
                    className="rounded-md border border-white/10 p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyOrder(moveWorkbenchCard(order, id, 1))}
                    disabled={index === order.length - 1}
                    aria-label={`下移 ${titleById.get(id) ?? id}`}
                    className="rounded-md border border-white/10 p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-muted-foreground/60">#{index + 1}</span>
                    <span className="truncate text-xs font-semibold text-foreground">
                      {titleById.get(id) ?? id}
                    </span>
                  </div>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {descriptionById.get(id) ?? ""}
                  </p>
                </div>

                <Switch
                  aria-label={`显示 ${titleById.get(id) ?? id}`}
                  checked={visible}
                  onCheckedChange={(value: boolean) => toggleVisible(id, value)}
                  className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3 shrink-0"
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={() => onChange({
              order: WORKBENCH_CARDS.map((card) => card.id),
              hidden: [],
            })}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认布局
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-cyan-500/20 px-3 py-1.5 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/30"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
