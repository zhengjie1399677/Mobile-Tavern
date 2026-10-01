import { useCallback, useEffect, useState } from "react";
import type { PromptComposition } from "../../domain/prompt-composition";
import {
  syncCustomPromptSwitches,
  type PromptSwitchSnapshot,
} from "../../application/useCases/promptSwitchSync";

const MAX_HISTORY_ENTRIES = 30;
const MERGE_WINDOW_MS = 800;

interface HistoryState {
  current: PromptSwitchSnapshot;
  past: PromptSwitchSnapshot[];
  future: PromptSwitchSnapshot[];
  mergeKey?: string;
  mergeAt: number;
}

type SnapshotChangeHandler = (next: PromptSwitchSnapshot) => void;

/**
 * 编排编辑器的撤销栈。
 *
 * 记录的是"编排 + 提示词列表"整份快照，而不是只有编排：删除区块会连带删除同源的列表条目，
 * 若撤销栈只记编排，撤销后区块回来了、列表条目却回不来，两侧立刻又不一致。
 * 因此删除必须走 `commitSnapshot` 连带写入两侧，撤销/重做才能把两侧一起还原。
 */
export function usePromptCompositionHistory(
  snapshot: PromptSwitchSnapshot,
  onChange: SnapshotChangeHandler,
) {
  const [history, setHistory] = useState<HistoryState>(() => ({
    current: snapshot,
    past: [],
    future: [],
    mergeAt: 0,
  }));

  useEffect(() => {
    setHistory((prev) => {
      if (snapshot === prev.current) return prev;
      // 外部写入（列表侧增删改、预设切换、设置持久化回写）只更新当前值并作废旧历史：
      // 那种情况下栈里的旧快照已不代表用户的下一步预期，回退会覆盖外部改动。
      if (
        snapshot.customPrompts === prev.current.customPrompts &&
        snapshot.composition.name === prev.current.composition.name &&
        snapshot.composition.blocks === prev.current.composition.blocks
      ) {
        return { ...prev, current: snapshot };
      }
      return { current: snapshot, past: [], future: [], mergeAt: 0 };
    });
  }, [snapshot]);

  const push = useCallback((
    resolve: (current: PromptSwitchSnapshot) => PromptSwitchSnapshot,
    mergeKey?: string,
  ) => {
    setHistory((prev) => {
      const next = resolve(prev.current);
      if (next === prev.current) return prev;
      const now = Date.now();
      const shouldMerge = Boolean(
        mergeKey && prev.mergeKey === mergeKey && now - prev.mergeAt <= MERGE_WINDOW_MS,
      );
      const newPast = shouldMerge ? [...prev.past] : [...prev.past, prev.current];
      if (newPast.length > MAX_HISTORY_ENTRIES) newPast.shift();

      onChange(next);
      return {
        current: next,
        past: newPast,
        future: [],
        mergeKey,
        mergeAt: now,
      };
    });
  }, [onChange]);

  /**
   * 纯编排改动：列表只跟随"开关变化"（`syncCustomPromptSwitches`），结构变更不碰列表。
   */
  const commit = useCallback((next: PromptComposition, mergeKey?: string) => {
    push((current) => {
      if (next === current.composition) return current;
      const customPrompts = syncCustomPromptSwitches(current.customPrompts, current.composition, next);
      return { composition: next, customPrompts };
    }, mergeKey);
  }, [push]);

  /**
   * 连带改动两侧（删除区块 + 删掉同源列表条目）：快照整体入栈，撤销时两侧一起还原。
   */
  const commitSnapshot = useCallback((next: PromptSwitchSnapshot, mergeKey?: string) => {
    push(() => next, mergeKey);
  }, [push]);

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      const newPast = [...prev.past];
      const previous = newPast.pop();
      if (!previous) return prev;

      onChange(previous);
      return {
        current: previous,
        past: newPast,
        future: [...prev.future, prev.current],
        mergeKey: undefined,
        mergeAt: 0,
      };
    });
  }, [onChange]);

  const redo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      const newFuture = [...prev.future];
      const next = newFuture.pop();
      if (!next) return prev;

      onChange(next);
      return {
        current: next,
        past: [...prev.past, prev.current],
        future: newFuture,
        mergeKey: undefined,
        mergeAt: 0,
      };
    });
  }, [onChange]);

  return {
    commit,
    commitSnapshot,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
