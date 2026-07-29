# 社区功能配置

社区入口的配置集中在 `src/domain/community/config.ts` 中，不属于应用内设置，普通用户无法自行修改。修改后需要重新构建并发布 App 才会生效。

当前配置如下：

```ts
export const COMMUNITY_ENTRY_CONFIG = {
  enabled: false,
  minFirstUseAgeDays: 3,
  minCumulativeUsageHours: 3,
} as const;
```

- `enabled`：社区入口总开关。改为 `true` 后才会进行门槛判断。
- `minFirstUseAgeDays`：从 App 首次使用时间起计算的最少天数。
- `minCumulativeUsageHours`：App 累计处于运行状态的最少小时数。

入口显示条件是：

```text
enabled 为 true
并且
首次使用时间达到 minFirstUseAgeDays
或累计运行时间达到 minCumulativeUsageHours
```

因此当前配置表示：总开关仍然关闭；未来改成 `enabled: true` 后，首次使用达到三天或累计运行达到三小时中的任意一项，即显示社区主入口。

社区接口地址也在同一文件维护。生产环境默认使用 `https://community.neural-node.xyz`，开发构建可通过 `VITE_COMMUNITY_ORIGIN` 覆盖。
