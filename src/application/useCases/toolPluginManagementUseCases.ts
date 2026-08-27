import type { ToolPluginPermission } from "../../domain/toolPlugins";
import type { ToolPluginInspection } from "../../domain/toolPlugins";
import { parseToolPluginManifest, parseToolPluginPackage } from "../../domain/toolPlugins";
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

export const toolPluginManagementUseCases = {
  list: listInstalledToolPlugins,
  async inspectFile(file: File) {
    const bytes = await file.arrayBuffer();
    if (file.name.toLowerCase().endsWith(".mttool")) return parseToolPluginPackage(bytes);
    const manifest = await parseToolPluginManifest(bytes);
    if (manifest.manifestVersion === 2 && manifest.tools.some((tool) => tool.handler?.kind === "worker")) {
      throw new Error("TOOL_PLUGIN_PACKAGE_REQUIRED");
    }
    return { manifest } satisfies ToolPluginInspection;
  },
  install(inspection: ToolPluginInspection) {
    return installToolPlugin(inspection.manifest, inspection.artifact);
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
