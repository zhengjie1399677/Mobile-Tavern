import type React from "react";

export type StudioSection =
  | "overview"
  | "appearance"
  | "colors"
  | "css"
  | "interactions"
  | "preview";

export type SaveState = "editing" | "validating" | "failed" | "saved";

export type ThemeStudioPreviewScene = "chat" | "characters" | "settings";

export interface StudioSectionItem {
  id: Exclude<StudioSection, "overview" | "preview">;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}
