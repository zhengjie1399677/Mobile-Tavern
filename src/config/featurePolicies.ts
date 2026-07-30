import { publicEnvironment } from "./publicEnvironment";

export interface CommunityEntryPolicy {
  enabled: boolean;
  minFirstUseAgeDays: number;
  minCumulativeUsageHours: number;
}

export interface FeaturePolicies {
  communityEntry: CommunityEntryPolicy;
}

export function createFeaturePolicies(
  environment = publicEnvironment,
): FeaturePolicies {
  return Object.freeze({
    communityEntry: Object.freeze({
      enabled: environment.communityEnabled ?? environment.isDevelopment,
      minFirstUseAgeDays: environment.communityMinFirstUseAgeDays,
      minCumulativeUsageHours: environment.communityMinCumulativeUsageHours,
    }),
  });
}

export const featurePolicies = createFeaturePolicies();
