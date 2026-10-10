// 输入框"按键路径"上的两项本地化计算（与 useChatScroll / useChatVoiceInput 同级的兄弟 Hook）：
// 1) textarea 自适应高度 + 消息列表同帧贴底补偿：高度在绘制前定稿，只有本来就贴着底部才动滚动位置；
// 2) 快捷栏 token 预估所需的兼容变量：仅在快捷栏展开时按会话读取，避免每次按键深拷贝整张变量表。
//
// 两条消费路径共用同一份实现：
// - 普通输入框 src/tabs/chat/ChatInputArea.tsx；
// - 消息编辑框 src/tabs/chat/MessageBubble.tsx（高度上下限按可视区现算，且不参与列表贴底补偿）。
//
// 抽离动机见 docs/agents/ui_webview_performance.md：按键不得触发整树重渲染、无谓滚动与可避免的同步重排。

import React from "react";
import type { ChatSession } from "../../types";
import {
  KernelServices,
  type ICompatibilityRuntimeService,
  type IKernelService,
} from "../../application/serviceContracts";
import { CHAT_SCROLL_BOTTOM_THRESHOLD } from "./utils";

/** textarea 自适应高度的上下限（px） */
export interface AutosizeBounds {
  minHeight: number;
  maxHeight: number;
}

interface ComposerAutosizeOptions {
  /** 待自适应的输入框 */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 当前输入文本（本地输入态，不经过全局 store） */
  value: string;
  /** 消息列表滚动容器；缺省时不做任何滚动干预 */
  messageScrollerRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * 高度上下限；缺省为输入框的 38–160。
   * 传入函数时在每次测量前现算：消息编辑框的上限取决于可视区高度，
   * 软键盘开合会改变它，不能在 Hook 外面缓存成常量。
   */
  resolveBounds?: () => AutosizeBounds;
}

export interface ComposerAutosizeHandle {
  /** 文本没变但基准尺寸变了（软键盘开合、旋转）时强制重测一次 */
  remeasure: () => void;
}

const DEFAULT_AUTOSIZE_BOUNDS: AutosizeBounds = { minHeight: 38, maxHeight: 160 };

/**
 * 输入框自适应高度。
 *
 * - 在 useLayoutEffect 中完成：放在被动 effect 里，WebView 会先按塌缩高度提交一次布局，
 *   表现为输入区"被顶一下"。
 * - 文本变长时沿用当前固定高度直接读 scrollHeight，省掉一次样式失效与同步重排；
 *   文本变短时内容可能收缩，必须先清零高度才能量到真实内容高度。
 * - 高度真的变化时，只有列表原本就贴着底部才在同一帧内补回贴底位置；
 *   用户正在翻看历史时一律不碰滚动位置（原先每按键一次都会延迟 100ms 强拽到底部）。
 */
export function useComposerAutosize({
  textareaRef,
  value,
  messageScrollerRef,
  resolveBounds,
}: ComposerAutosizeOptions): ComposerAutosizeHandle {
  // 上一次写入的固定高度、上一次文本长度，用于判断是否需要重新测量以及是否真的发生高度变化
  const lastHeightRef = React.useRef(0);
  const lastLengthRef = React.useRef(-1);

  /** 按当前文本测量一次；返回高度是否真的变化 */
  const measure = React.useCallback((textLength: number): boolean => {
    const textarea = textareaRef.current;
    if (!textarea) return false;
    const bounds = resolveBounds?.() ?? DEFAULT_AUTOSIZE_BOUNDS;
    const previousHeight = lastHeightRef.current;
    const previousLength = lastLengthRef.current;
    lastLengthRef.current = textLength;

    // 行内高度为空 = textarea 刚挂载（每次进入消息编辑都是一次全新挂载）：
    // 缓存高度描述的是已卸载的旧节点，必须重新测量。
    const needsReset =
      previousHeight === 0 || textarea.style.height === "" || textLength < previousLength;
    if (needsReset) {
      textarea.style.height = "auto";
    }
    const nextHeight = Math.max(
      bounds.minHeight,
      Math.min(textarea.scrollHeight, bounds.maxHeight),
    );
    const heightChanged = previousHeight > 0 && nextHeight !== previousHeight;
    if (needsReset || heightChanged) {
      textarea.style.height = `${nextHeight}px`;
    }
    lastHeightRef.current = nextHeight;
    return heightChanged;
  }, [resolveBounds, textareaRef]);

  const compensateBottom = React.useCallback(() => {
    const scroller = messageScrollerRef?.current;
    if (!scroller) return;
    const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceToBottom < CHAT_SCROLL_BOTTOM_THRESHOLD) {
      // 与 useChatUI 的贴底口径一致：同一帧内直接落到列表底部，不使用平滑滚动
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
    }
  }, [messageScrollerRef]);

  React.useLayoutEffect(() => {
    if (measure(value.length)) compensateBottom();
  }, [compensateBottom, measure, value]);

  const remeasure = React.useCallback(() => {
    // 基准尺寸变化与文本无关：复用最近一次文本长度，只重算被钳制的高度
    if (measure(lastLengthRef.current)) compensateBottom();
  }, [compensateBottom, measure]);

  return React.useMemo(() => ({ remeasure }), [remeasure]);
}

interface ComposerCompatibilityVariablesOptions {
  /** 是否需要这份数据（快捷栏展开时才为 true） */
  enabled: boolean;
  session: ChatSession | null | undefined;
  getKernelService: <T extends IKernelService>(name: string) => T;
}

/**
 * 快捷栏 token 预估所需的兼容变量。
 *
 * readState 内部会对整个兼容状态做 structuredClone，而变量表体积与角色卡正相关；
 * 放在渲染路径上会让每次按键都深拷贝一遍，因此这里按需读取并允许降级为空表。
 */
export function useComposerCompatibilityVariables({
  enabled,
  session,
  getKernelService,
}: ComposerCompatibilityVariablesOptions): Record<string, unknown> {
  return React.useMemo<Record<string, unknown>>(() => {
    if (!enabled || !session) return {};
    try {
      return getKernelService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime)
        .readState(session);
    } catch {
      // 兼容运行时未注册或读取失败时退化为"不把兼容变量计入预估"，不影响输入框其余功能。
      return {};
    }
  }, [enabled, getKernelService, session]);
}
