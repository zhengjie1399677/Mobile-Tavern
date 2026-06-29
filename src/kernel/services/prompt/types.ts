import { UserSettings } from "../../../types";

export type SectionPhase = "Engine" | "Context" | "Generation" | "Protocol";
export type SectionType = "Instruction" | "Context" | "Reference";
export type SectionPriority = "Highest" | "High" | "Normal" | "Low";

export interface RuntimeContext {
  settings: UserSettings;
  modelCapabilities: any;
  enabledFeatures: {
    tableMemory: boolean;
    replySuggestions: boolean;
    memoryRecall: boolean;
  };
  repetitionDetected?: boolean;
}

export interface PromptNode {
  id: string;
  phase: SectionPhase;
  type: SectionType;
  priority: SectionPriority;
  mutable: boolean;
  title: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface PromptSection {
  id: string;
  phase: SectionPhase;
  enabled: boolean;
  compile: (context: RuntimeContext) => PromptNode;
}
