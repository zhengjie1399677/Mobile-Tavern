# Tool Plugin SDK

此目录提供仓库内 External Tool Plugin 作者使用的最小 SDK。当前公共面只包含：

- `defineToolPluginManifest`：以 TypeScript 校验 v2 Manifest 定义；
- `defineToolPluginHandlers` 与 `registerToolPlugin`：声明并注册一次性 Worker handler；
- `createToolPluginPackage` 与 `buildToolPluginPackage`：生成带规范化 SHA-256 的确定性 `.mttool` 包。

SDK 不开放应用进程、存储、Kernel、原生能力或明文凭据。Worker 网络请求只能调用宿主提供的 `host.network()`，最终仍受 Manifest 的 HTTPS Origin、方法、流量和授权限制。

低风险、无权限、无副作用且只在当前 turn 内执行的 Tool，可以通过 `composerCommand` 暴露为聊天输入框斜杠命令。命令执行结果只会回填草稿，不会自动发送；`inputProperty` 省略时为无参数命令，`outputProperty` 必须指向 Tool 输出中的必填字符串字段。宿主能力 `system.time` 可读取设备本地日期、时间和时区；`random.dice` / `random.coin` / `random.pick` / `text.count` 分别提供掷骰、掷硬币、随机抽取和字数统计，均无需网络或权限。

Runtime 支持可选 `provenance.json` 和 ECDSA P-256/SHA-256 验签。签名不是安装前置条件：无签名包仍可导入，但管理界面会明确标注来源未验证，并提醒用户代码与后续授权风险；签名有效也不等于代码经过安全审核。当前 SDK 不提供私钥签名命令，外部可信签名者列表为空，签名工具、密钥轮换和远程撤回不在当前实现范围。不要把私钥写入 Manifest、插件包、仓库或 `VITE_*` 配置。

完整用法以 `examples/tool-plugin-text-toolkit/` 为准。当前 SDK 随仓库源码分发，尚未作为独立 npm 包发布。
