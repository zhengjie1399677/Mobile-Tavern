# SillyTavern Compatibility Runtime

本目录是 SillyTavern 外部生态兼容运行时的权威入口（门面层），负责角色卡扩展、MVU、正则脚本、iframe 注入和兼容降级。

**⚠️ 真实状态（2026-09-14 核查）**

本目录约 820 行，是**对外门面**，不是完整实现。核心逻辑仍位于 `src/utils/tavernHelper/`（约 4,241 行），
本目录的 `mvuParser.ts` 等文件通过 `export * from "../../utils/tavernHelper/..."` 转发回去。

因此：**本目录目前尚不能独立支撑 ST 兼容能力**，阅读或调试时需跳到 `utils/tavernHelper/`。

**迁移状态：已暂缓。** 原计划"待旧路径调用清零后再物理迁移实现"未执行，原因见下：

- `src/utils/tavernHelper/` 仍有 12 个活跃调用方，包含 application 服务与聊天主链路，
  迁移涉及关键路径，成本与风险都高；
- 该目录中约 3,900 行属于「脚本宿主 / 沙箱执行」能力（scriptIframe / bridgeCore /
  tavernHelperMocks / zodMock / scriptPreprocessor / esmReplacer），其**归属未定**——
  是 ST 兼容的一部分，还是应升为底座通用能力？归属未定则无法安全迁移；
- 决策：**待产品功能收敛后一并重做**（预计重做成本显著低于原地搬运）。

**新代码约定：ST 相关新增代码从本目录导入**，不要新增对 `utils/tavernHelper/` 的依赖，
使旧路径调用自然衰减。

它不属于 Kernel，也不属于通用应用 Service 体系；应用服务只能把它当作外部格式防腐运行时调用。

角色卡脚本的权限与用户提示以 [`docs/agents/sillytavern_compat.md`](../../../docs/agents/sillytavern_compat.md#6-角色卡脚本信任边界) 为唯一权威说明。

