import {
  generateThemeId,
  type CustomThemePackage,
  validateThemePackage,
} from "../../utils/themePackage";
import { parseThemeInteractionConfig } from "./themeInteractionContract";

const EMPTY_INTERACTIONS = {
  media: {},
  state: {},
  interactions: [],
};

export const NEUTRAL_DARK_THEME: CustomThemePackage = {
  schemaVersion: "1.0",
  name: "新自定义主题",
  version: "1.0.0",
  description: "",
  isDark: true,
  variables: {
    "--background": "#111318",
    "--foreground": "#f4f4f5",
    "--card": "#191c22",
    "--card-foreground": "#f4f4f5",
    "--popover": "#191c22",
    "--popover-foreground": "#f4f4f5",
    "--primary": "#d4d4d8",
    "--primary-foreground": "#18181b",
    "--secondary": "#272a32",
    "--secondary-foreground": "#f4f4f5",
    "--muted": "#24272e",
    "--muted-foreground": "#a1a1aa",
    "--accent": "#30343d",
    "--accent-foreground": "#fafafa",
    "--destructive": "#dc2626",
    "--destructive-foreground": "#ffffff",
    "--border": "#343840",
    "--input": "#24272e",
    "--ring": "#a1a1aa",
    "--radius": "0.6rem",
    "--dialogue-color": "#f4f4f5",
    "--prose-color": "#d4d4d8",
  },
  customCss: "",
};

export interface ThemeDocumentDraft {
  theme: CustomThemePackage;
  interactionSource: string;
  baseline: CustomThemePackage;
  baselineInteractionSource: string;
}

export type ThemeDocumentBuildResult =
  | { success: true; theme: CustomThemePackage }
  | { success: false; errors: string[] };

function cloneTheme(theme: CustomThemePackage): CustomThemePackage {
  return JSON.parse(JSON.stringify(theme)) as CustomThemePackage;
}

function buildInteractionSource(theme: CustomThemePackage): string {
  return JSON.stringify({
    media: theme.media ?? {},
    state: theme.state ?? {},
    interactions: theme.interactions ?? [],
  }, null, 2);
}

export function createThemeDocumentDraft(source: CustomThemePackage | null): ThemeDocumentDraft {
  const theme = cloneTheme(source ?? NEUTRAL_DARK_THEME);
  const interactionSource = buildInteractionSource(theme);
  return {
    theme,
    interactionSource,
    baseline: cloneTheme(theme),
    baselineInteractionSource: interactionSource,
  };
}

export function cloneThemeDocumentDraft(draft: ThemeDocumentDraft): ThemeDocumentDraft {
  return {
    theme: cloneTheme(draft.theme),
    interactionSource: draft.interactionSource,
    baseline: cloneTheme(draft.baseline),
    baselineInteractionSource: draft.baselineInteractionSource,
  };
}

export function isThemeDocumentDirty(draft: ThemeDocumentDraft): boolean {
  return JSON.stringify(draft.theme) !== JSON.stringify(draft.baseline) ||
    draft.interactionSource !== draft.baselineInteractionSource;
}

export function buildThemeDocumentCandidate(
  draft: ThemeDocumentDraft,
  customThemes: CustomThemePackage[],
): ThemeDocumentBuildResult {
  const trimmedName = draft.theme.name.trim();
  if (!trimmedName) return { success: false, errors: ["主题名称不能为空"] };
  if (trimmedName.length > 40) return { success: false, errors: ["主题名称不能超过 40 字符"] };

  const trimmedVersion = draft.theme.version.trim();
  if (!trimmedVersion) return { success: false, errors: ["版本号不能为空"] };

  const existingId = draft.baseline.id;
  const duplicate = customThemes.some(theme => (
    theme.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase() &&
    theme.id !== existingId
  ));
  if (duplicate) return { success: false, errors: [`已存在同名主题「${trimmedName}」，请使用其他名称。`] };

  let rawInteractions: unknown;
  try {
    rawInteractions = JSON.parse(draft.interactionSource);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, errors: [`交互规则 JSON 无法解析：${message}`] };
  }

  const interactionResult = parseThemeInteractionConfig(rawInteractions);
  if (!interactionResult.success || !interactionResult.config) {
    return { success: false, errors: interactionResult.errors.map(error => `交互规则：${error}`) };
  }

  const interactionConfig = interactionResult.config;
  const hasInteractions = Object.keys(interactionConfig.media).length > 0 ||
    Object.keys(interactionConfig.state).length > 0 ||
    interactionConfig.interactions.length > 0;
  const candidate: CustomThemePackage = {
    ...cloneTheme(draft.theme),
    schemaVersion: hasInteractions ? "1.1" : "1.0",
    name: trimmedName,
    version: trimmedVersion,
    description: draft.theme.description?.trim() || undefined,
    // 已保存主题的 ID 是运行时引用，重命名不能令当前主题或外部引用悬空。
    id: existingId ?? generateThemeId(trimmedName),
    importedAt: draft.baseline.importedAt ?? Date.now(),
    media: hasInteractions ? interactionConfig.media : undefined,
    state: hasInteractions ? interactionConfig.state : undefined,
    interactions: hasInteractions ? interactionConfig.interactions : undefined,
  };

  const validation = validateThemePackage(candidate);
  if (!validation.valid || !validation.sanitized) {
    return { success: false, errors: validation.errors };
  }

  return {
    success: true,
    theme: {
      ...validation.sanitized,
      id: candidate.id,
      importedAt: candidate.importedAt,
    },
  };
}

export function markThemeDocumentSaved(
  draft: ThemeDocumentDraft,
  savedTheme: CustomThemePackage,
): ThemeDocumentDraft {
  return createThemeDocumentDraft(savedTheme);
}

export function upsertCustomThemePackage(
  themes: CustomThemePackage[],
  updatedTheme: CustomThemePackage,
  previousId?: string,
): CustomThemePackage[] {
  const nextThemes = [...themes];
  const index = nextThemes.findIndex(theme => theme.id === (previousId ?? updatedTheme.id));
  if (index >= 0) nextThemes[index] = updatedTheme;
  else nextThemes.push(updatedTheme);
  return nextThemes;
}

export function getEmptyThemeInteractionSource(): string {
  return JSON.stringify(EMPTY_INTERACTIONS, null, 2);
}
