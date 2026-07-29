import { getStoredUsageMetrics } from "../../utils/localDB";
import type { UsageMetrics } from "../../utils/useUsageTracking";
import { COMMUNITY_ENTRY_CONFIG } from "./config";

export const COMMUNITY_MIN_INSTALL_AGE_MS =
  COMMUNITY_ENTRY_CONFIG.minFirstUseAgeDays * 24 * 60 * 60 * 1000;
export const COMMUNITY_MIN_USAGE_SECONDS =
  COMMUNITY_ENTRY_CONFIG.minCumulativeUsageHours * 60 * 60;

export function deriveFirstOpenedAt(
  metrics: Partial<UsageMetrics> | null | undefined,
  now = Date.now(),
): number {
  if (typeof metrics?.firstOpenedAt === "number" && Number.isFinite(metrics.firstOpenedAt)) {
    return metrics.firstOpenedAt;
  }

  const earliestHistoryTime = metrics?.history
    ?.map((entry) => Date.parse(`${entry.date}T00:00:00`))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];

  if (typeof earliestHistoryTime === "number") {
    return earliestHistoryTime;
  }
  if (typeof metrics?.lastOpenedAt === "number" && Number.isFinite(metrics.lastOpenedAt)) {
    return metrics.lastOpenedAt;
  }
  return now;
}

export function meetsCommunityEntryThreshold(
  metrics: Partial<UsageMetrics> | null | undefined,
  now = Date.now(),
): boolean {
  if (!metrics) return false;
  const installAge = Math.max(0, now - deriveFirstOpenedAt(metrics, now));
  const totalUsageSeconds = Math.max(0, Number(metrics.totalUsageSeconds) || 0);
  return (
    installAge >= COMMUNITY_MIN_INSTALL_AGE_MS ||
    totalUsageSeconds >= COMMUNITY_MIN_USAGE_SECONDS
  );
}

export async function shouldShowCommunityEntry(now = Date.now()): Promise<boolean> {
  if (!COMMUNITY_ENTRY_CONFIG.enabled) return false;
  try {
    const metrics = (await getStoredUsageMetrics()) as UsageMetrics | null;
    return meetsCommunityEntryThreshold(metrics, now);
  } catch (error) {
    console.warn("[Community] Failed to read usage gate metrics:", error);
    return false;
  }
}
