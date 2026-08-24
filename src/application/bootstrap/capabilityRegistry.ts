import type { EffectDisposer, IKernel } from "../serviceContracts";
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
): EffectDisposer {
  assertUniqueCapabilityIds(capabilities);
  const disposers: EffectDisposer[] = [];
  for (const capability of capabilities) {
    disposers.push(kernel.registerExtension({
      id: capability.id,
      targetPoint: CAPABILITY_EXTENSION_POINT,
      value: capability,
      meta: {
        kind: capability.kind,
        providedBy: capability.providedBy,
        lifecycle: capability.lifecycle,
      },
    }));
  }
  let active = true;
  return async () => {
    if (!active) return;
    active = false;
    for (let index = disposers.length - 1; index >= 0; index--) {
      await disposers[index]();
    }
  };
}

export function listRuntimeCapabilities(kernel: IKernel): CapabilityDescriptor[] {
  return sortCapabilities(
    kernel.getExtensions<CapabilityDescriptor>(CAPABILITY_EXTENSION_POINT)
      .map((extension) => extension.value),
  );
}
