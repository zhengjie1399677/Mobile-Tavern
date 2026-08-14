export const CAPABILITY_EXTENSION_POINT = "application:capabilities";

export type CapabilityKind =
  | "provider"
  | "storage"
  | "runtime"
  | "native"
  | "compatibility"
  | "plugin-host";

export type CapabilityLifecycle =
  | "boot"
  | "lazy"
  | "on-demand";

export interface CapabilityDescriptor {
  id: `${string}.${string}`;
  kind: CapabilityKind;
  providedBy: string;
  permissions: readonly string[];
  lifecycle: CapabilityLifecycle;
}

export function sortCapabilities(
  capabilities: readonly CapabilityDescriptor[],
): CapabilityDescriptor[] {
  return [...capabilities].sort((left, right) => left.id.localeCompare(right.id));
}

export function assertUniqueCapabilityIds(
  capabilities: readonly CapabilityDescriptor[],
): void {
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (seen.has(capability.id)) {
      throw new Error(`Duplicate capability descriptor: ${capability.id}`);
    }
    seen.add(capability.id);
  }
}
