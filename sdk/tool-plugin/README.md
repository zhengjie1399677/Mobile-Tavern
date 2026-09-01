# Tool Plugin SDK

此目录提供仓库内 External Tool Plugin 作者使用的最小 SDK。当前公共面只包含：

- `defineToolPluginManifest`：以 TypeScript 校验 v2 Manifest 定义；
- `defineToolPluginHandlers` 与 `registerToolPlugin`：声明并注册一次性 Worker handler；
- `createToolPluginPackage` 与 `buildToolPluginPackage`：生成带规范化 SHA-256 的确定性 `.mttool` 包。

SDK 不开放应用进程、存储、Kernel、原生能力或明文凭据。Worker 网络请求只能调用宿主提供的 `host.network()`，最终仍受 Manifest 的 HTTPS Origin、方法、流量和授权限制。

Runtime 已支持可选 `provenance.json` 和 ECDSA P-256/SHA-256 验签，但当前 SDK 尚未提供私钥签名命令，外部可信签名者列表也仍为空。不要把私钥写入 Manifest、插件包、仓库或 `VITE_*` 配置；后续签名工具必须从显式的本地秘密入口读取，并只把 SPKI 公钥与签名写入包。

完整用法以 `examples/tool-plugin-text-toolkit/` 为准。当前 SDK 随仓库源码分发，尚未作为独立 npm 包发布。
