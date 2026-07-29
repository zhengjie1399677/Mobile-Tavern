const DEFAULT_COMMUNITY_ORIGIN = "https://community.neural-node.xyz";

/**
 * 社区入口的源码配置。
 *
 * 修改后需要重新构建 App。入口必须先启用，并满足首次使用时间或累计运行时间中的任意一项。
 */
export const COMMUNITY_ENTRY_CONFIG = {
  enabled: false,
  minFirstUseAgeDays: 3,
  minCumulativeUsageHours: 3,
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
