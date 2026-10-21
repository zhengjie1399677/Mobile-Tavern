export type QuickActionModuleId =
  | "reroll"
  | "continue"
  | "preset"
  | "token_predict"
  | "tool"
  | "mcp";

export interface QuickActionModulesConfig {
  reroll: boolean;
  continue: boolean;
  preset: boolean;
  token_predict: boolean;
  tool: boolean;
  mcp: boolean;
}

export const MAX_ACTIVE_QUICK_ACTIONS = 4;

export const DEFAULT_QUICK_ACTION_MODULES: QuickActionModulesConfig = {
  reroll: true,
  continue: true,
  preset: true,
  token_predict: true,
  tool: false,
  mcp: false,
};

export const QUICK_ACTION_MODULES_STORAGE_KEY = "mobile_tavern_quick_action_modules";
export const QUICK_ACTIONS_VISIBLE_STORAGE_KEY = "mobile_tavern_show_quick_actions";

/** 旧版本允许同时开启全部模块；升级到 4 项上限时按此顺序从尾部关闭多余项。 */
const QUICK_ACTION_PRIORITY: readonly QuickActionModuleId[] = [
  "reroll",
  "continue",
  "preset",
  "token_predict",
  "tool",
  "mcp",
];

export function normalizeQuickActionModulesConfig(
  config: QuickActionModulesConfig,
): QuickActionModulesConfig {
  const next = { ...config };
  let activeCount = QUICK_ACTION_PRIORITY.filter(id => next[id]).length;
  for (let index = QUICK_ACTION_PRIORITY.length - 1; index >= 0 && activeCount > MAX_ACTIVE_QUICK_ACTIONS; index -= 1) {
    const id = QUICK_ACTION_PRIORITY[index];
    if (next[id]) {
      next[id] = false;
      activeCount -= 1;
    }
  }
  return next;
}

export function loadQuickActionModulesConfig(): QuickActionModulesConfig {
  try {
    const raw = localStorage.getItem(QUICK_ACTION_MODULES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QUICK_ACTION_MODULES };
    const parsed = JSON.parse(raw) as Partial<QuickActionModulesConfig> & {
      token_actions?: boolean;
    };

    // 平滑向下兼容旧版本 token_actions
    const legacyTokenActions = typeof parsed.token_actions === "boolean" ? parsed.token_actions : undefined;

    return normalizeQuickActionModulesConfig({
      reroll: typeof parsed.reroll === "boolean" ? parsed.reroll : (legacyTokenActions ?? DEFAULT_QUICK_ACTION_MODULES.reroll),
      continue: typeof parsed.continue === "boolean" ? parsed.continue : (legacyTokenActions ?? DEFAULT_QUICK_ACTION_MODULES.continue),
      preset: typeof parsed.preset === "boolean" ? parsed.preset : DEFAULT_QUICK_ACTION_MODULES.preset,
      token_predict: typeof parsed.token_predict === "boolean" ? parsed.token_predict : (legacyTokenActions ?? DEFAULT_QUICK_ACTION_MODULES.token_predict),
      tool: typeof parsed.tool === "boolean" ? parsed.tool : DEFAULT_QUICK_ACTION_MODULES.tool,
      mcp: typeof parsed.mcp === "boolean" ? parsed.mcp : DEFAULT_QUICK_ACTION_MODULES.mcp,
    });
  } catch {
    return { ...DEFAULT_QUICK_ACTION_MODULES };
  }
}

export function saveQuickActionModulesConfig(config: QuickActionModulesConfig): void {
  try {
    localStorage.setItem(QUICK_ACTION_MODULES_STORAGE_KEY, JSON.stringify(normalizeQuickActionModulesConfig(config)));
  } catch {
    // 忽略 localStorage 写入异常（如私密模式或存储限额）
  }
}
