/**
 * SillyTavern Compatibility Runtime 权威入口。
 *
 * 该运行时只负责外部角色卡脚本、MVU、正则和 iframe 兼容语义，
 * 不属于通用 Service，不得注册为 Kernel 业务服务。
 */
export * from "../../utils/tavernHelper";
export * from "./isolatedBridgeHost";
export * from "./isolatedScriptRuntime";
