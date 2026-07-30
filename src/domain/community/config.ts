import { featurePolicies, publicEnvironment } from "../../config";

/**
 * 社区入口的源码配置。
 *
 * Debug 构建（npm run tauri dev）直接开启社区入口，跳过时间门槛；
 * 正式构建（npm run tauri build）关闭入口。
 */
export const COMMUNITY_ENTRY_CONFIG = featurePolicies.communityEntry;
export const COMMUNITY_ORIGIN = publicEnvironment.communityOrigin;

export function buildCommunityUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${COMMUNITY_ORIGIN}${normalizedPath}`;
}
