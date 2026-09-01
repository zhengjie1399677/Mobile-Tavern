import { featurePolicies, publicEnvironment } from "../../config";

/**
 * 社区入口的源码配置。
 *
 * 社区功能默认关闭：`communityEnabled` 未显式设为 `true` 时入口不注册、Tab 不显示。
 * 仅在显式注入 `VITE_COMMUNITY_ENABLED=true` 时才开启，并继续受首次使用时间与累计使用时长门槛约束。
 */
export const COMMUNITY_ENTRY_CONFIG = featurePolicies.communityEntry;
export const COMMUNITY_ORIGIN = publicEnvironment.communityOrigin;

export function buildCommunityUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${COMMUNITY_ORIGIN}${normalizedPath}`;
}
