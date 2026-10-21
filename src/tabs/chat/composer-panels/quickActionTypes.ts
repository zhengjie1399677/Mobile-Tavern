export type QuickActionModuleId =
  | "reroll"
  | "continue"
  | "preset"
  | "token_predict"
  | "tool";

export interface QuickActionModulesConfig {
  reroll: boolean;
  continue: boolean;
  preset: boolean;
  token_predict: boolean;
  tool: boolean;
}

export const MAX_ACTIVE_QUICK_ACTIONS = 4;

export const DEFAULT_QUICK_ACTION_MODULES: QuickActionModulesConfig = {
  reroll: true,
  continue: true,
  preset: true,
  token_predict: true,
  tool: false,
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

/**
 * 读取快捷栏模块配置。
 *
 * 迁移说明（CHANGE-SAFE）：`mcp` 曾是独立快捷模块，与「工具」气泡内的 MCP 入口重复；
 * 两者已合并为单一「工具」面板，因此旧缓存里的 `mcp: true` 必须平移为 `tool: true`，
 * 不能静默丢弃用户此前开启它的意图。
 */
export function loadQuickActionModulesConfig(): QuickActionModulesConfig {
  try {
    const raw = localStorage.getItem(QUICK_ACTION_MODULES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QUICK_ACTION_MODULES };
    const parsed = JSON.parse(raw) as Partial<QuickActionModulesConfig> & {
      token_actions?: boolean;
      mcp?: boolean;
    };

    // 平滑向下兼容旧版本 token_actions
    const legacyTokenActions = typeof parsed.token_actions === "boolean" ? parsed.token_actions : undefined;
    // 平滑向下兼容已合并的 mcp 模块
    const legacyMcp = parsed.mcp === true;
    const tool = typeof parsed.tool === "boolean" ? parsed.tool : DEFAULT_QUICK_ACTION_MODULES.tool;

    return normalizeQuickActionModulesConfig({
      reroll: typeof parsed.reroll === "boolean" ? parsed.reroll : (legacyTokenActions ?? DEFAULT_QUICK_ACTION_MODULES.reroll),
      continue: typeof parsed.continue === "boolean" ? parsed.continue : (legacyTokenActions ?? DEFAULT_QUICK_ACTION_MODULES.continue),
      preset: typeof parsed.preset === "boolean" ? parsed.preset : DEFAULT_QUICK_ACTION_MODULES.preset,
      token_predict: typeof parsed.token_predict === "boolean" ? parsed.token_predict : (legacyTokenActions ?? DEFAULT_QUICK_ACTION_MODULES.token_predict),
      tool: tool || legacyMcp,
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
