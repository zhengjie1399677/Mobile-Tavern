import { globalKernel } from "./Kernel";
import { DatabaseService } from "./services/DatabaseService";
import { LLMService } from "./services/LLMService";
import { PromptService } from "./services/PromptService";
import { TelemetryService } from "./services/TelemetryService";
import { TableMemoryService } from "./services/TableMemoryService";
import { ScriptService } from "./services/ScriptService";
import { AutoSummaryService } from "./services/AutoSummaryService";
import { KernelServices } from "./types";

import CharactersTab from "../tabs/CharactersTab";
import ChatHistoryTab from "../tabs/ChatHistoryTab";
import ChatTab from "../tabs/ChatTab";
import GlobalWorldbookTab from "../tabs/GlobalWorldbookTab";
import SettingsTab from "../tabs/SettingsTab";
import PlaygroundTab from "../tabs/PlaygroundTab";

/**
 * 使用 registerServiceBatch 进行批量注册：
 * - 无需手工维护注册顺序，内核自动根据各服务的 `dependencies` 字段进行拓扑排序。
 * - 新增服务时只需在此数组中追加条目，并在服务类中声明 `dependencies`，不会影响其他服务。
 * - initTimeoutMs 按各服务 IO 特性酌情配置（DatabaseService 需 IndexedDB 初始化，设置较宽超时）。
 */
export async function initializeKernel() {
  await globalKernel.registerServiceBatch([
    {
      name: KernelServices.Database,
      service: new DatabaseService(),
      initTimeoutMs: 5000,
    },
    {
      name: KernelServices.LLM,
      service: new LLMService(),
    },
    {
      name: KernelServices.Prompt,
      service: new PromptService(),
    },
    {
      name: KernelServices.Telemetry,
      service: new TelemetryService(),
    },
    {
      name: KernelServices.TableMemory,
      service: new TableMemoryService(),
    },
    {
      name: KernelServices.Script,
      service: new ScriptService(),
    },
    {
      name: KernelServices.AutoSummary,
      service: new AutoSummaryService(),
      // AutoSummaryService 依赖 LLM 和 Database，拓扑排序会自动保证它们先被注册
      // 注：依赖声明应在 AutoSummaryService 类的 dependencies 字段中定义
    },
  ]);

  // 运行期装配官方 6 个核心 Tab 页面到 "main:tabs" 扩展点
  globalKernel.registerExtension({
    id: "characters",
    targetPoint: "main:tabs",
    priority: 100,
    component: CharactersTab,
    meta: {
      name: "角色馆",
      icon: "VenetianMask",
      showInBottomBar: true,
    },
  });

  globalKernel.registerExtension({
    id: "chat-history",
    targetPoint: "main:tabs",
    priority: 90,
    component: ChatHistoryTab,
    meta: {
      name: "历史对话",
      icon: "MessageSquare",
      showInBottomBar: true,
      highlightOnActiveTabs: ["chat-history", "chat"],
    },
  });

  globalKernel.registerExtension({
    id: "chat",
    targetPoint: "main:tabs",
    priority: 80,
    component: ChatTab,
    meta: {
      name: "对话",
      showInBottomBar: false,
    },
  });

  globalKernel.registerExtension({
    id: "global-worldbook",
    targetPoint: "main:tabs",
    priority: 70,
    component: GlobalWorldbookTab,
    meta: {
      name: "世界书",
      icon: "Book",
      showInBottomBar: true,
    },
  });

  globalKernel.registerExtension({
    id: "settings",
    targetPoint: "main:tabs",
    priority: 60,
    component: SettingsTab,
    meta: {
      name: "设置",
      icon: "Settings",
      showInBottomBar: true,
    },
  });

  globalKernel.registerExtension({
    id: "playground",
    targetPoint: "main:tabs",
    priority: 50,
    component: PlaygroundTab,
    meta: {
      name: "沙盒",
      showInBottomBar: false,
    },
  });
}

export { globalKernel } from "./Kernel";
export { createKernel } from "./Kernel";
export * from "./types";
