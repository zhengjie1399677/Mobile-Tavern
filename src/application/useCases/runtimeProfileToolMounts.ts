import type { RuntimeProfileToolMount } from "../runtimeProfiles/contracts";

/** 当前可用版本优先；仍保留缺失挂载，供 UI 显示并允许用户移除。 */
export function mergeRuntimeProfileToolMounts(
  available: readonly RuntimeProfileToolMount[],
  requested: readonly RuntimeProfileToolMount[],
): RuntimeProfileToolMount[] {
  const tools = new Map<string, RuntimeProfileToolMount>();
  [...available, ...requested].forEach((tool) => {
    if (!tools.has(tool.name)) tools.set(tool.name, { ...tool });
  });
  return [...tools.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function findUnavailableRuntimeProfileToolNames(
  requested: readonly RuntimeProfileToolMount[],
  available: readonly RuntimeProfileToolMount[],
): string[] {
  const versions = new Map(available.map((tool) => [tool.name, tool.version]));
  return requested.flatMap((tool) => {
    if (!versions.has(tool.name)) return [tool.name];
    return tool.version !== undefined && versions.get(tool.name) !== tool.version
      ? [tool.name]
      : [];
  });
}
