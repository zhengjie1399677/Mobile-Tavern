import { useEffect, useReducer, useRef } from "react";
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

export function usePromptCompositionHistory(
  composition: PromptComposition,
  onChange: (next: PromptComposition) => void,
) {
  const historyRef = useRef<HistoryState>({
    current: composition,
    past: [],
    future: [],
    mergeAt: 0,
  });
  const [, refresh] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    const history = historyRef.current;
    if (composition === history.current) return;
    if (JSON.stringify(composition) === JSON.stringify(history.current)) {
      history.current = composition;
      return;
    }
    historyRef.current = { current: composition, past: [], future: [], mergeAt: 0 };
    refresh();
  }, [composition]);

  const commit = (next: PromptComposition, mergeKey?: string) => {
    const history = historyRef.current;
    if (next === history.current) return;

    const now = Date.now();
    const shouldMerge = Boolean(
      mergeKey && history.mergeKey === mergeKey && now - history.mergeAt <= MERGE_WINDOW_MS,
    );
    if (!shouldMerge) {
      history.past.push(history.current);
      if (history.past.length > MAX_HISTORY_ENTRIES) history.past.shift();
    }
    history.current = next;
    history.future = [];
    history.mergeKey = mergeKey;
    history.mergeAt = now;
    onChange(next);
    refresh();
  };

  const undo = () => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push(history.current);
    history.current = previous;
    history.mergeKey = undefined;
    onChange(previous);
    refresh();
  };

  const redo = () => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) return;
    history.past.push(history.current);
    history.current = next;
    history.mergeKey = undefined;
    onChange(next);
    refresh();
  };

  return {
    commit,
    undo,
    redo,
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
  };
}
