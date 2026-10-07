import React from "react";
import { GripVertical, LayoutGrid, RotateCcw, X } from "lucide-react";
import { Switch } from "../../../components/ui/switch";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";
import { moveWorkbenchCardTo } from "../../domain/ui/workbenchLayout";
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

/** 长按多久进入拖动（毫秒）。 */
export const LAYOUT_LONG_PRESS_MS = 320;
/** 拖动时每跨过一个行高就交换一次位置；行高固定，避免依赖 DOM 测量。 */
export const LAYOUT_DRAG_ROW_STEP_PX = 64;
/** 长按判定前允许的抖动，超过即判定为用户在滚动列表。 */
const LONG_PRESS_TOLERANCE_PX = 12;

/**
 * 工作台布局编辑器：**长按拖动**调整顺序，开关控制显示。
 *
 * 交互要点：
 *   - 抓手图标按下即进入拖动；行体需要长按（320ms）后进入拖动，未长按的滑动仍然滚动列表；
 *   - 拖动过程只改本地草稿顺序，松手时才写一次设置，避免拖动期间频繁落库；
 *   - 显示开关是离散意图，改动即时保存。
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

  const [draftOrder, setDraftOrder] = React.useState<string[]>(() => [...order]);
  const [draftHidden, setDraftHidden] = React.useState<string[]>(() => [...hidden]);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  /**
   * 长按判定期间就把该行的 touch-action 设为 none。
   * Android WebView 会在长按窗口内先启动滚动并发出 pointercancel，
   * 导致"完全拖不动"；先接管触摸，未长按成功再恢复滚动。
   */
  const [armedId, setArmedId] = React.useState<string | null>(null);

  const draftOrderRef = React.useRef<string[]>(draftOrder);
  const draftHiddenRef = React.useRef<string[]>(draftHidden);
  const dragRef = React.useRef<{ id: string; startY: number; startIndex: number } | null>(null);
  const longPressRef = React.useRef<number | null>(null);
  const longPressStartRef = React.useRef<{ id: string; y: number } | null>(null);
  const onChangeRef = React.useRef(onChange);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 外部（设置）变化时同步草稿；拖动过程中不回灌，避免把手里的预览拽回去。
  React.useEffect(() => {
    if (dragRef.current) return;
    const next = [...order];
    draftOrderRef.current = next;
    setDraftOrder(next);
  }, [order]);

  React.useEffect(() => {
    const next = [...hidden];
    draftHiddenRef.current = next;
    setDraftHidden(next);
  }, [hidden]);

  const clearLongPress = React.useCallback(() => {
    longPressStartRef.current = null;
    setArmedId(null);
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const beginDrag = React.useCallback((id: string, startY: number) => {
    const startIndex = draftOrderRef.current.indexOf(id);
    if (startIndex < 0) return;
    dragRef.current = { id, startY, startIndex };
    setDraggingId(id);
  }, []);

  const endDrag = React.useCallback((commit: boolean) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDraggingId(null);
    if (commit) {
      onChangeRef.current({
        order: [...draftOrderRef.current],
        hidden: [...draftHiddenRef.current],
      });
    }
  }, []);

  // 拖动期间在 window 上监听：手指移出行范围也不会丢事件。
  React.useEffect(() => {
    if (!draggingId) return;
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const steps = Math.round((event.clientY - drag.startY) / LAYOUT_DRAG_ROW_STEP_PX);
      const clamped = Math.max(
        0,
        Math.min(draftOrderRef.current.length - 1, drag.startIndex + steps),
      );
      const current = draftOrderRef.current.indexOf(drag.id);
      if (clamped === current) return;
      const next = moveWorkbenchCardTo(draftOrderRef.current, drag.id, clamped);
      draftOrderRef.current = next;
      setDraftOrder(next);
    };
    const handleUp = () => endDrag(true);
    const handleCancel = () => endDrag(false);
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }, [draggingId, endDrag]);

  React.useEffect(() => clearLongPress, [clearLongPress]);

  if (!open) return null;

  const hiddenSet = new Set(draftHidden);
  const titleById = new Map(WORKBENCH_CARDS.map((card) => [card.id, card.title]));
  const descriptionById = new Map(WORKBENCH_CARDS.map((card) => [card.id, card.description]));

  const toggleVisible = (id: string, visible: boolean) => {
    const nextHidden = visible
      ? draftHiddenRef.current.filter((item) => item !== id)
      : [...draftHiddenRef.current, id];
    draftHiddenRef.current = nextHidden;
    setDraftHidden(nextHidden);
    onChangeRef.current({ order: [...draftOrderRef.current], hidden: nextHidden });
  };

  const handleRowPointerDown = (id: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const startY = event.clientY;
    clearLongPress();
    setArmedId(id);
    longPressStartRef.current = { id, y: startY };
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      longPressStartRef.current = null;
      beginDrag(id, startY);
    }, LAYOUT_LONG_PRESS_MS);
  };

  const handleRowPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const pending = longPressStartRef.current;
    if (!pending || longPressRef.current === null) return;
    // 长按判定前的大幅移动视为滚动列表，取消长按。
    if (Math.abs(event.clientY - pending.y) > LONG_PRESS_TOLERANCE_PX) clearLongPress();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-cyan-400" />
            <div>
              <h4 className="text-sm font-bold text-foreground">编辑布局</h4>
              <p className="text-[10px] text-muted-foreground">长按卡片拖动排序，开关控制是否显示</p>
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
          {draftOrder.map((id, index) => {
            const visible = !hiddenSet.has(id);
            const dragging = draggingId === id;
            return (
              <div
                key={id}
                data-card-row={id}
                data-dragging={dragging ? "true" : undefined}
                onPointerDown={(event) => handleRowPointerDown(id, event)}
                onPointerMove={handleRowPointerMove}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onPointerLeave={clearLongPress}
                style={dragging || armedId === id ? { touchAction: "none" } : undefined}
                className={`flex items-center gap-2 rounded-xl border p-2.5 transition-all ${
                  dragging
                    ? "border-cyan-400/40 bg-cyan-500/10 shadow-lg scale-[1.02]"
                    : visible
                      ? "border-white/10 bg-white/5"
                      : "border-white/5 bg-black/20 opacity-70"
                }`}
              >
                <button
                  type="button"
                  aria-label={`拖动 ${titleById.get(id) ?? id}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    clearLongPress();
                    try {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } catch {
                      // 捕获失败时仍依赖 window 监听兜底
                    }
                    beginDrag(id, event.clientY);
                  }}
                  className="shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
                >
                  <GripVertical className="h-4 w-4" />
                </button>

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
            onClick={() => {
              const defaultOrder = WORKBENCH_CARDS.map((card) => card.id);
              draftOrderRef.current = defaultOrder;
              draftHiddenRef.current = [];
              setDraftOrder(defaultOrder);
              setDraftHidden([]);
              onChangeRef.current({ order: defaultOrder, hidden: [] });
            }}
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
