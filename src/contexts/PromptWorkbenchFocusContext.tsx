import { createContext, useContext } from "react";

export interface PromptWorkbenchFocusValue {
  active: boolean;
  managed: boolean;
  setActive: (active: boolean) => void;
}

const PromptWorkbenchFocusContext = createContext<PromptWorkbenchFocusValue>({
  active: false,
  managed: false,
  setActive: () => undefined,
});

export const PromptWorkbenchFocusProvider = PromptWorkbenchFocusContext.Provider;

export function usePromptWorkbenchFocus(): PromptWorkbenchFocusValue {
  return useContext(PromptWorkbenchFocusContext);
}
