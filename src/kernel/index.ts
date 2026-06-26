import { globalKernel } from "./Kernel";
import { DatabaseService } from "./services/DatabaseService";
import { LLMService } from "./services/LLMService";
import { PromptService } from "./services/PromptService";
import { TelemetryService } from "./services/TelemetryService";
import { ScriptService } from "./services/ScriptService";
import { MultiMessageService } from "./services/MultiMessageService";
import { ChatStreamService } from "./services/ChatStreamService";
import { UpdateCheckService } from "./services/UpdateCheckService";
import { MemoryService } from "./services/memory";
import {
  tableMemoryMiddleware,
  mvuScriptMiddleware,
  bisonModeMiddleware,
  autoSummaryMiddleware
} from "./middlewares/outputMiddlewares";
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
 * - initTimeoutMs 按各服务 IO 特性酌情配置（P1-3：所有服务均配置超时，避免 init 挂起导致启动白屏）。
 *   * DatabaseService 需 IndexedDB 初始化，5s
 *   * LLMService/MemoryService 涉及网络或重计算，8s/5s
 *   * ChatStreamService 涉及流式连接，5s
 *   * 其余纯计算服务，3s
 *
 * 阶段 C 迁移说明：
 *   - TableMemoryService 与 AutoSummaryService 已从注册表移除，逻辑合并到 MemoryService
 *     的 stateTable 与 summary 子模块。旧文件保留 @deprecated 标记，下个版本周期后删除。
 *   - KernelServices.TableMemory / KernelServices.AutoSummary 枚举值保留（向后兼容类型引用），
 *     但不再有服务实例注册到这些 key。
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
      initTimeoutMs: 8000,
    },
    {
      name: KernelServices.Prompt,
      service: new PromptService(),
      initTimeoutMs: 3000,
    },
    {
      name: KernelServices.Telemetry,
      service: new TelemetryService(),
      initTimeoutMs: 3000,
    },
    {
      name: KernelServices.Script,
      service: new ScriptService(),
      initTimeoutMs: 3000,
    },
    {
      name: KernelServices.MultiMessage,
      service: new MultiMessageService(),
      initTimeoutMs: 3000,
    },
    {
      name: KernelServices.ChatStream,
      service: new ChatStreamService(),
      initTimeoutMs: 5000,
    },
    {
      name: KernelServices.UpdateCheck,
      service: new UpdateCheckService(),
    },
    {
      name: KernelServices.Memory,
      service: new MemoryService(),
      initTimeoutMs: 5000,
      // MemoryService 依赖 Database 与 LLM（在服务类的 dependencies 字段中声明）
      // 拓扑排序自动保证 Database/LLM 先完成注册与初始化
      // 阶段 C 已完成全部 6 子模块装配：storage / extractor / recall / stateTable / summary / parser
    },
  ]);

  // 初始化 output 管道默认中间件
  const outputPipeline = globalKernel.getPipeline("output");
  outputPipeline.use(tableMemoryMiddleware, 100);
  outputPipeline.use(mvuScriptMiddleware, 90);
  outputPipeline.use(bisonModeMiddleware, 80);
  outputPipeline.use(autoSummaryMiddleware, 70);

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
