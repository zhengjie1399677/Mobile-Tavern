import type React from "react";
import { HostCalendarWidget } from "./HostCalendarWidget";
import { RussellMoodCompassWidget } from "./RussellMoodCompassWidget";
import { ActivityRingsOrbitWidget } from "./ActivityRingsOrbitWidget";
import { TrendSparklineWaveWidget } from "./TrendSparklineWaveWidget";
import { SessionRankWidget } from "./SessionRankWidget";
import { TokenPerformanceWidget } from "./TokenPerformanceWidget";
import { HostStorageMetricsWidget } from "./HostStorageMetricsWidget";
import { ToolCapabilitiesWidget } from "./ToolCapabilitiesWidget";

/**
 * 工作台卡片清单（唯一来源）。
 *
 * 顺序、标题与组件都从这里取：布局编辑器按同一份清单渲染开关与排序按钮，
 * 工作台按用户布局渲染卡片。新增卡片只需在这里追加一条，旧布局会自动把它补到末尾。
 */
export interface WorkbenchCardDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly component: React.ComponentType;
}

export const WORKBENCH_CARDS: readonly WorkbenchCardDefinition[] = [
  {
    id: "calendar",
    title: "时空活跃热力日历",
    description: "近月消息活跃热力矩阵",
    component: HostCalendarWidget,
  },
  {
    id: "mood",
    title: "心智气象罗盘",
    description: "Russell 情绪环状罗盘",
    component: RussellMoodCompassWidget,
  },
  {
    id: "activity",
    title: "宿主活跃脉搏",
    description: "活跃圆环与昼夜分布",
    component: ActivityRingsOrbitWidget,
  },
  {
    id: "trend",
    title: "7日活跃脉冲波形",
    description: "近一周消息趋势曲线",
    component: TrendSparklineWaveWidget,
  },
  {
    id: "session-rank",
    title: "会话活跃排行",
    description: "按轮次 / 字数排 Top 5",
    component: SessionRankWidget,
  },
  {
    id: "token-performance",
    title: "Token 与生成性能",
    description: "输出 Token、耗时与 tok/s",
    component: TokenPerformanceWidget,
  },
  {
    id: "storage",
    title: "本地存储与持久化",
    description: "IndexedDB 容量与健康度",
    component: HostStorageMetricsWidget,
  },
  {
    id: "tools",
    title: "扩展能力（MCP / Tool）",
    description: "外部来源、插件与单工具诊断",
    component: ToolCapabilitiesWidget,
  },
];

export const WORKBENCH_CARD_IDS: readonly string[] = WORKBENCH_CARDS.map((card) => card.id);

export function findWorkbenchCard(id: string): WorkbenchCardDefinition | null {
  return WORKBENCH_CARDS.find((card) => card.id === id) ?? null;
}
