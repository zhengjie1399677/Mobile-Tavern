export const PROTECTED_MAIN_TABS: ReadonlySet<string> = new Set(["characters", "settings"]);

export function sanitizeHiddenMainTabs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is string => (
    typeof id === "string" &&
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) &&
    !PROTECTED_MAIN_TABS.has(id)
  ))));
}

interface BottomBarTab {
  id: string;
  meta?: { showInBottomBar?: unknown };
}

export function getVisibleBottomBarTabs<TTab extends BottomBarTab>(
  tabs: readonly TTab[],
  hiddenMainTabs: unknown,
): TTab[] {
  const hidden = new Set(sanitizeHiddenMainTabs(hiddenMainTabs));
  return tabs.filter(tab => tab.meta?.showInBottomBar === true && !hidden.has(tab.id));
}
