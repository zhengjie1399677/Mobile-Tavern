/**
 * 第三方全屏插件领域入口。
 *
 * Plugin Host RPC 只处理强沙箱插件的权限化 RPC，不复用 Compatibility Runtime
 * 兼容桥，也不承担 Tauri 原生能力桥接。
 */
export * from "./types";
export * from "./pluginHostRpc";
export * from "./packageParser";
export * from "./runtimeDocument";
