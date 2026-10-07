import React from "react";
import { GripVertical, LayoutGrid, RotateCcw, X, EyeOff } from "lucide-react";
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
  // eslint-disable-next-line no-unused-vars -- 函数类型参数名仅作文档，供调用方阅读
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
 * 交互与动效要点：
 *   - 抓手图标按下即进入拖动；行体长按（320ms）后进入拖动，未长按的滑动仍然自然滚动列表；
 *   - 全面禁用文本选择（user-select: none / touch-callout: none），杜绝长按或拖拽时弹出复制菜单；
 *   - 拖拽中被抓取的卡片实时跟手位移（0 延迟 transform），周围卡片具备平滑避让缓动（cubic-bezier）；
 *   - 松开手指（Drop）时无缝落位并持久化设置，操作体验平滑丝滑。
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
  const [dragOffsetY, setDragOffsetY] = React.useState(0);
  const [targetDropIndex, setTargetDropIndex] = React.useState<number | null>(null);
  // 拖拽起始下标必须是 state：渲染期要用它计算周边卡片的避让位移，
  // 从 ref 读取会在 React 编译期规则与并发渲染下失效（react-hooks/refs）。
  const [dragStartIndex, setDragStartIndex] = React.useState(-1);

  const draftOrderRef = React.useRef<string[]>(draftOrder);
  const draftHiddenRef = React.useRef<string[]>(draftHidden);
  const dragRef = React.useRef<{ id: string; startY: number; startIndex: number } | null>(null);
  const targetDropIndexRef = React.useRef<number | null>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const longPressRef = React.useRef<number | null>(null);
  const longPressStartRef = React.useRef<{ id: string; y: number } | null>(null);
  const onChangeRef = React.useRef(onChange);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 外部（设置）变化时同步草稿；拖动过程中不回灌，避免打乱预览。
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
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const beginDrag = React.useCallback((id: string, startY: number) => {
    const startIndex = draftOrderRef.current.indexOf(id);
    if (startIndex < 0) return;
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(18);
      }
    } catch {
      // 静默降级
    }
    dragRef.current = { id, startY, startIndex };
    targetDropIndexRef.current = startIndex;
    setDragStartIndex(startIndex);
    setDraggingId(id);
    setDragOffsetY(0);
    setTargetDropIndex(startIndex);
  }, []);

  const endDrag = React.useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;

    const startIndex = drag.startIndex;
    const finalTarget = targetDropIndexRef.current ?? startIndex;

    dragRef.current = null;
    targetDropIndexRef.current = null;
    setDraggingId(null);
    setDragOffsetY(0);
    setTargetDropIndex(null);
    setDragStartIndex(-1);

    if (commit) {
      let finalOrder = draftOrderRef.current;
      if (finalTarget !== startIndex) {
        finalOrder = moveWorkbenchCardTo(draftOrderRef.current, drag.id, finalTarget);
        draftOrderRef.current = finalOrder;
        setDraftOrder(finalOrder);
        try {
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate(12);
          }
        } catch {
          // 静默降级
        }
      }
      onChangeRef.current({
        order: [...finalOrder],
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
      if (event.cancelable) event.preventDefault();

      // 手指靠近列表上下边缘时自动平滑滚动。
      const container = scrollContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const edge = 56;
        if (event.clientY < rect.top + edge) container.scrollTop -= 10;
        else if (event.clientY > rect.bottom - edge) container.scrollTop += 10;
      }

      const offset = event.clientY - drag.startY;
      setDragOffsetY(offset);

      const steps = Math.round(offset / LAYOUT_DRAG_ROW_STEP_PX);
      const clamped = Math.max(
        0,
        Math.min(draftOrderRef.current.length - 1, drag.startIndex + steps),
      );

      if (targetDropIndexRef.current !== clamped) {
        targetDropIndexRef.current = clamped;
        setTargetDropIndex(clamped);
      }
    };

    /**
     * Android WebView 在移动时可能将触摸接管为原生滚动并触发 cancel，
     * 拖动激活后必须用非被动 touchmove 阻止默认滚动。
     */
    const handleTouchMove = (event: TouchEvent) => {
      if (dragRef.current && event.cancelable) event.preventDefault();
    };

    const handleUp = () => endDrag(true);
    const handleCancel = () => endDrag(false);

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("touchend", handleUp);
    window.addEventListener("touchcancel", handleCancel);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("touchend", handleUp);
      window.removeEventListener("touchcancel", handleCancel);
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
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 某些 WebView 允许兜底到 window
    }
    const startY = event.clientY;
    clearLongPress();
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
    // 超过阈值判定为列表滚动，取消长按。
    if (Math.abs(event.clientY - pending.y) > LONG_PRESS_TOLERANCE_PX) clearLongPress();
  };

  const currentTargetIndex = targetDropIndex ?? dragStartIndex;

  const visibleCount = draftOrder.filter((id) => !hiddenSet.has(id)).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3.5 backdrop-blur-md animate-in fade-in duration-200 select-none"
      style={{ WebkitUserSelect: "none" }}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-card/95 shadow-2xl backdrop-blur-xl transition-all"
        style={{ WebkitTouchCallout: "none", userSelect: "none", WebkitUserSelect: "none" }}
      >
        {/* 顶部标题栏 */}
        <div className="relative flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-cyan-500/10 via-transparent to-transparent px-4 py-3.5 select-none">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-400/25">
              <LayoutGrid className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-foreground">工作台布局</h4>
                <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-medium text-cyan-300">
                  {visibleCount}/{draftOrder.length} 显示
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">长按卡片或按住抓手拖动排序，开关控制显示</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭布局编辑"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 卡片列表容器 */}
        <div
          ref={scrollContainerRef}
          className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-3.5 py-3 select-none"
          style={{ userSelect: "none", WebkitUserSelect: "none" }}
        >
          {draftOrder.map((id, index) => {
            const visible = !hiddenSet.has(id);
            const isDragging = draggingId === id;

            // 计算平滑避让偏移量（单位：px）
            let translateY = 0;
            if (draggingId && !isDragging && dragStartIndex >= 0 && currentTargetIndex >= 0) {
              if (dragStartIndex < currentTargetIndex) {
                // 拖拽项向下移动：介于 (dragStartIndex, currentTargetIndex] 的项向上避让
                if (index > dragStartIndex && index <= currentTargetIndex) {
                  translateY = -LAYOUT_DRAG_ROW_STEP_PX;
                }
              } else if (dragStartIndex > currentTargetIndex) {
                // 拖拽项向上移动：介于 [currentTargetIndex, dragStartIndex) 的项向下避让
                if (index >= currentTargetIndex && index < dragStartIndex) {
                  translateY = LAYOUT_DRAG_ROW_STEP_PX;
                }
              }
            }

            const itemTransform = isDragging
              ? `translateY(${dragOffsetY}px) scale(1.025)`
              : translateY !== 0
                ? `translateY(${translateY}px)`
                : undefined;

            return (
              <div
                key={id}
                data-card-row={id}
                data-dragging={isDragging ? "true" : undefined}
                onPointerDown={(event) => handleRowPointerDown(id, event)}
                onPointerMove={handleRowPointerMove}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onPointerLeave={clearLongPress}
                style={{
                  touchAction: isDragging ? "none" : "pan-y",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                  transform: itemTransform,
                  zIndex: isDragging ? 40 : 1,
                  transition: isDragging
                    ? "box-shadow 200ms ease, border-color 200ms ease, background-color 200ms ease"
                    : "transform 240ms cubic-bezier(0.2, 0, 0, 1), background-color 200ms ease, border-color 200ms ease",
                }}
                className={`relative flex min-h-[58px] items-center gap-2.5 rounded-xl border p-2.5 select-none ${
                  isDragging
                    ? "border-cyan-400/80 bg-cyan-950/70 shadow-2xl shadow-cyan-500/25 ring-1 ring-cyan-400/40 backdrop-blur-md cursor-grabbing"
                    : visible
                      ? "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07] active:scale-[0.99] transition-transform duration-100"
                      : "border-white/5 bg-black/25 opacity-65 hover:opacity-85"
                }`}
              >
                {/* 拖动抓手手柄 */}
                <button
                  type="button"
                  aria-label={`拖动 ${titleById.get(id) ?? id}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    clearLongPress();
                    try {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } catch {
                      // 兜底至 window 监听
                    }
                    beginDrag(id, event.clientY);
                  }}
                  className={`shrink-0 touch-none rounded-lg p-1.5 transition-colors select-none ${
                    isDragging
                      ? "cursor-grabbing text-cyan-300 bg-cyan-500/20"
                      : "cursor-grab text-muted-foreground/60 hover:bg-white/10 hover:text-cyan-400 active:cursor-grabbing"
                  }`}
                >
                  <GripVertical className="h-4 w-4" />
                </button>

                {/* 卡片信息 */}
                <div className="min-w-0 flex-1 select-none pointer-events-none">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold border ${
                        isDragging
                          ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-200"
                          : "border-white/10 bg-white/5 text-muted-foreground/75"
                      }`}
                    >
                      #{index + 1}
                    </span>
                    <span className="truncate text-xs font-semibold text-foreground tracking-tight">
                      {titleById.get(id) ?? id}
                    </span>
                    {!visible && (
                      <span className="flex items-center gap-1 rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground">
                        <EyeOff className="h-2.5 w-2.5" /> 已隐藏
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground select-none">
                    {descriptionById.get(id) ?? ""}
                  </p>
                </div>

                {/* 显示/隐藏开关 */}
                <div
                  className="shrink-0 select-none"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Switch
                    aria-label={`显示 ${titleById.get(id) ?? id}`}
                    checked={visible}
                    onCheckedChange={(value: boolean) => toggleVisible(id, value)}
                    className="data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-400 h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-white/[0.02] px-4 py-3 select-none">
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
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-all hover:border-white/20 hover:bg-white/10 hover:text-foreground active:scale-95"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-cyan-500/25 px-4 py-1.5 text-[11px] font-bold text-cyan-200 ring-1 ring-cyan-400/30 transition-all hover:bg-cyan-500/35 hover:text-cyan-100 hover:shadow-lg hover:shadow-cyan-500/20 active:scale-95"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};

