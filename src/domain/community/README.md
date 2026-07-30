# 社区功能配置

社区入口的发布策略集中在 `src/config/featurePolicies.ts`，公开环境变量统一由
`src/config/publicEnvironment.ts` 解析和校验。业务模块只消费已解析的配置，不直接读取
`import.meta.env`。这些配置不属于应用内设置，普通用户无法自行修改；修改后需要重新构建并发布
App 才会生效。

可用环境变量如下：

```dotenv
VITE_COMMUNITY_ORIGIN=https://community.neural-node.xyz
VITE_COMMUNITY_ENABLED=true
VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS=0
VITE_COMMUNITY_MIN_CUMULATIVE_USAGE_HOURS=0
```

- `VITE_COMMUNITY_ORIGIN`：社区接口地址。
- `VITE_COMMUNITY_ENABLED`：是否启用社区入口；未设置时仅开发构建默认启用。
- `VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS`：从 App 首次使用时间起计算的最少天数。
- `VITE_COMMUNITY_MIN_CUMULATIVE_USAGE_HOURS`：App 累计处于运行状态的最少小时数。

入口显示条件是：

```text
VITE_COMMUNITY_ENABLED 为 true
并且
首次使用时间达到 VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS
或累计运行时间达到 VITE_COMMUNITY_MIN_CUMULATIVE_USAGE_HOURS
```

完整配置分轨、秘密管理和新增配置流程见
[`docs/agents/configuration_strategy.md`](../../../docs/agents/configuration_strategy.md)。
