export type PluginOrientation = "portrait" | "landscape" | "auto";

export interface FullscreenPluginManifest {
  format: "mobile-tavern.plugin";
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  type: "fullscreen";
  entry: string;
  description?: string;
  author?: string;
  orientation?: PluginOrientation;
}

export interface InstalledFullscreenPlugin {
  id: string;
  manifest: FullscreenPluginManifest;
  files: Record<string, Uint8Array>;
  installedAt: number;
  updatedAt: number;
  uncompressedSize: number;
}

export interface PluginSaveRecord {
  key: string;
  pluginId: string;
  slot: string;
  data: unknown;
  updatedAt: number;
}

