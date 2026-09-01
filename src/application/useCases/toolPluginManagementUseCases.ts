import type { ToolPluginPermission } from "../../domain/toolPlugins";
import type { ToolPluginInspection } from "../../domain/toolPlugins";
import {
  parseToolPluginManifest,
  parseToolPluginPackage,
  unsignedToolPluginSource,
} from "../../domain/toolPlugins";
import { toolPluginTrustPolicy } from "../../config";
import {
  installToolPlugin,
  deleteToolPluginCredential,
  listInstalledToolPlugins,
  listToolPluginCredentialStatus,
  rollbackToolPlugin,
  setToolPluginEnabled,
  setToolPluginCredential,
  setToolPluginPermissions,
  uninstallToolPlugin,
} from "../../infrastructure/toolPlugins/toolPluginStorage";
import { verifyToolPluginSourceProof } from "../../infrastructure/toolPlugins/toolPluginSourceVerifier";
import { listOfficialToolPluginInspections } from "../toolPlugins/officialCatalog";

export const toolPluginManagementUseCases = {
  list: listInstalledToolPlugins,
  listOfficial: listOfficialToolPluginInspections,
  async inspectFile(file: File) {
    const bytes = await file.arrayBuffer();
    if (file.name.toLowerCase().endsWith(".mttool")) {
      const inspection = await parseToolPluginPackage(bytes);
      const sourceVerification = inspection.sourceProof
        ? await verifyToolPluginSourceProof(
            inspection.manifest,
            inspection.sourceProof,
            toolPluginTrustPolicy.trustedSigners,
          )
        : unsignedToolPluginSource();
      return { ...inspection, sourceVerification } satisfies ToolPluginInspection;
    }
    const manifest = await parseToolPluginManifest(bytes);
    if (manifest.manifestVersion === 2 && manifest.tools.some((tool) => tool.handler?.kind === "worker")) {
      throw new Error("TOOL_PLUGIN_PACKAGE_REQUIRED");
    }
    return { manifest, sourceVerification: unsignedToolPluginSource() } satisfies ToolPluginInspection;
  },
  install(inspection: ToolPluginInspection) {
    return installToolPlugin(
      inspection.manifest,
      inspection.artifact,
      inspection.sourceVerification ?? unsignedToolPluginSource(),
    );
  },
  setPermissions(pluginId: string, permissions: readonly ToolPluginPermission[]) {
    return setToolPluginPermissions(pluginId, permissions);
  },
  setEnabled: setToolPluginEnabled,
  rollback: rollbackToolPlugin,
  uninstall: uninstallToolPlugin,
  listCredentialStatus: listToolPluginCredentialStatus,
  setCredential: setToolPluginCredential,
  deleteCredential: deleteToolPluginCredential,
};
