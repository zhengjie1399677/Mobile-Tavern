import type { IKernel } from "../serviceContracts";
import {
  CAPABILITY_EXTENSION_POINT,
  assertUniqueCapabilityIds,
  sortCapabilities,
  type CapabilityDescriptor,
} from "../../domain/capabilities";
import { defaultCapabilityCatalog } from "./capabilityCatalog";

export function registerRuntimeCapabilities(
  kernel: IKernel,
  capabilities: readonly CapabilityDescriptor[] = defaultCapabilityCatalog,
): void {
  assertUniqueCapabilityIds(capabilities);
  for (const capability of capabilities) {
    kernel.registerExtension({
      id: capability.id,
      targetPoint: CAPABILITY_EXTENSION_POINT,
      value: capability,
      meta: {
        kind: capability.kind,
        providedBy: capability.providedBy,
        lifecycle: capability.lifecycle,
      },
    });
  }
}

export function listRuntimeCapabilities(kernel: IKernel): CapabilityDescriptor[] {
  return sortCapabilities(
    kernel.getExtensions<CapabilityDescriptor>(CAPABILITY_EXTENSION_POINT)
      .map((extension) => extension.value),
  );
}
