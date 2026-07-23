export type PluginOrientation = "portrait" | "landscape" | "auto";

/** 插件可声明的权限白名单。未声明的 llm.* 方法调用会被宿主拒绝。 */
export type PluginPermission = "llm.chat" | "llm.chatStream" | "llm.preset.list";

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
  /** 权限声明白名单。 */
  permissions?: PluginPermission[];
  /** LLM 接入配置：syncPreset=true 同步宿主当前预设采样参数，false 由插件自管。 */
  llm?: { syncPreset: boolean };
}

export interface InstalledFullscreenPlugin {
  id: string;
  manifest: FullscreenPluginManifest;
  files: Record<string, Uint8Array>;
  installedAt: number;
  updatedAt: number;
  uncompressedSize: number;
  builtin?: boolean;
}

export interface PluginSaveRecord {
  key: string;
  pluginId: string;
  slot: string;
  data: unknown;
  updatedAt: number;
}
