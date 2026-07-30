# 社区功能配置

社区入口的配置集中在 `src/domain/community/config.ts` 中，不属于应用内设置，普通用户无法自行修改。修改后需要重新构建并发布 App 才会生效。

当前配置如下：

```ts
export const COMMUNITY_ENTRY_CONFIG = {
  enabled: import.meta.env.DEV,
  minFirstUseAgeDays: 0,
  minCumulativeUsageHours: 0,
} as const;
```

- `enabled`：开发构建开启，生产构建关闭。
- `minFirstUseAgeDays`：从 App 首次使用时间起计算的最少天数。
- `minCumulativeUsageHours`：App 累计处于运行状态的最少小时数。

入口显示条件是：

```text
enabled 为 true
并且
首次使用时间达到 minFirstUseAgeDays
或累计运行时间达到 minCumulativeUsageHours
```

因此当前配置表示：开发构建直接显示社区入口，便于联调；生产构建完全隐藏入口。若以后恢复灰度发布，可重新启用非零的首次使用或累计运行门槛。

社区接口地址也在同一文件维护。生产环境默认使用 `https://community.neural-node.xyz`，开发构建可通过 `VITE_COMMUNITY_ORIGIN` 覆盖。
