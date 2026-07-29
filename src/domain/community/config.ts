const DEFAULT_COMMUNITY_ORIGIN = "https://community.neural-node.xyz";

/**
 * 社区入口的源码配置。
 *
 * Debug 构建（npm run tauri dev）直接开启社区入口，跳过时间门槛；
 * 正式构建（npm run tauri build）关闭入口。
 */
export const COMMUNITY_ENTRY_CONFIG = {
  enabled: import.meta.env.DEV,
  minFirstUseAgeDays: 0,
  minCumulativeUsageHours: 0,
} as const;

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export const COMMUNITY_ORIGIN = normalizeOrigin(
  import.meta.env.VITE_COMMUNITY_ORIGIN || DEFAULT_COMMUNITY_ORIGIN,
);

export function buildCommunityUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${COMMUNITY_ORIGIN}${normalizedPath}`;
}
