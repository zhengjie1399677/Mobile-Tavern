import { useCallback, useEffect, useState } from "react";
import type { PromptComposition } from "../../domain/prompt-composition";

const MAX_HISTORY_ENTRIES = 30;
const MERGE_WINDOW_MS = 800;

interface HistoryState {
  current: PromptComposition;
  past: PromptComposition[];
  future: PromptComposition[];
  mergeKey?: string;
  mergeAt: number;
}

type CompositionChangeHandler = (next: PromptComposition) => void;

export function usePromptCompositionHistory(
  composition: PromptComposition,
  onChange: CompositionChangeHandler,
) {
  const [history, setHistory] = useState<HistoryState>(() => ({
    current: composition,
    past: [],
    future: [],
    mergeAt: 0,
  }));

  useEffect(() => {
    setHistory((prev) => {
      if (composition === prev.current) return prev;
      if (
        composition.name === prev.current.name &&
        composition.blocks.length === prev.current.blocks.length &&
        composition.blocks === prev.current.blocks
      ) {
        return { ...prev, current: composition };
      }
      return { current: composition, past: [], future: [], mergeAt: 0 };
    });
  }, [composition]);

  const commit = useCallback((next: PromptComposition, mergeKey?: string) => {
    setHistory((prev) => {
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
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
