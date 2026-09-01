/**
 * 内核架构边界守卫。
 *
 * 防止后续业务开发重新绕过持久化端口、回流全局内核单例，
 * 或让基础服务反向依赖 React Hook。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { assert } from "./testUtils";

const workspace = process.cwd();
const read = (relativePath: string): string =>
  readFileSync(path.join(workspace, relativePath), "utf8");

const listCodeFiles = (relativeDir: string): string[] => {
  const absoluteDir = path.join(workspace, relativeDir);
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return listCodeFiles(relative);
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  });
};

export async function testArchitectureBoundaries(): Promise<void> {
  console.log("\n--- Running Architecture Boundary Guards ---");

  const agentsGuide = read("AGENTS.md");
  const architectureEntry = read("docs/agents/architecture_entry.md");
  const stableRuleIds = [
    "ARCH-KERNEL",
    "ARCH-FLOW",
    "COMPAT-DATA",
    "PLATFORM-MOBILE",
    "CONFIG-TRACKS",
    "QUALITY-TYPES",
    "CHANGE-SAFE",
    "TEST-CONTROLLED",
    "DOC-CHINESE",
    "COLLAB-IDENTITY",
  ];
  for (const ruleId of stableRuleIds) {
    assert(
      agentsGuide.includes(`\`${ruleId}\``),
      `AGENTS.md 必须保留稳定规则标识 ${ruleId}，不得退回会因排序变化而失效的数字编号`
    );
  }
  assert(
    !/^# .*核心行为准则[一二三四五六七八九十]/m.test(agentsGuide),
    "AGENTS.md 不得恢复按追加时间排列的中文数字准则编号，规则引用必须使用稳定标识"
  );
  assert(
    agentsGuide.split(/\r?\n/).length <= 180,
    "AGENTS.md 只保留默认必读铁律，超过 180 行的细则必须下沉到按需专项文档"
  );
  assert(
    architectureEntry.split(/\r?\n/).length <= 130,
    "architecture_entry.md 只负责阅读路由和权威入口，排障、测试与实现细节必须下沉"
  );
  for (const requiredDocument of [
    "docs/agents/runtime_boundaries.md",
    "docs/agents/configuration_strategy.md",
    "docs/agents/typescript_discipline.md",
    "docs/agents/development_workflow.md",
    "docs/agents/troubleshooting_entry.md",
  ]) {
    assert(
      existsSync(path.join(workspace, requiredDocument)),
      `行为指导引用的按需文档不存在：${requiredDocument}`
    );
    assert(
      agentsGuide.includes(requiredDocument) || architectureEntry.includes(requiredDocument),
      `按需文档必须从 AGENTS.md 或 architecture_entry.md 获得明确路由：${requiredDocument}`
    );
  }
  assert(
    !agentsGuide.includes("豁免清单（待后续阶段渐进清理") &&
      read("docs/agents/typescript_discipline.md").includes("历史豁免清单"),
    "TypeScript 历史豁免表必须留在按需类型规范，不得重新膨胀默认必读 AGENTS.md"
  );
  const qualityWorkflow = read(".github/workflows/quality.yml");
  assert(
    /pull_request:\s*[\s\S]*?branches:\s*[\s\S]*?-\s*main/.test(qualityWorkflow) &&
      read(".githooks/pre-push").includes("npm run quality:push") &&
      read("package.json").includes('"quality:push"'),
    "main 主分支必须同时具备 GitHub PR 自动质量门禁和仓库内 pre-push 门禁"
  );

  for (const file of listCodeFiles("src")) {
    const normalizedFile = file.replaceAll("\\", "/");
    if (
      normalizedFile === "src/config/publicEnvironment.ts"
      || normalizedFile === "src/kernel/runtimeEnvironment.ts"
    ) {
      continue;
    }
    assert(
      !/\b(?:import\.meta\.env|process\.env)\b/.test(read(file)),
      `${file} 不得直接读取环境变量；移动端公开环境统一通过 src/config/publicEnvironment.ts，Kernel 仅保留运行模式自检例外`
    );
  }

  assert(
    !read("server.ts").includes("process.env")
      && !read("vite.config.ts").includes("process.env"),
    "Node 服务与 Vite 配置入口不得散落读取 process.env，必须通过各自的类型化配置模块"
  );
  assert(
    read("server/config.ts").includes("生产环境必须提供")
      && read("server/config.ts").includes("AES_ENCRYPT_KEY")
      && read("build/viteEnvironment.ts").includes("parseViteEnvironment"),
    "服务端和构建配置必须保留类型校验与生产秘密 fail-fast 保护"
  );
  assert(
    read("src/config/featurePolicies.ts").includes("minFirstUseAgeDays")
      && read("src/config/featurePolicies.ts").includes("minCumulativeUsageHours"),
    "功能发布时间策略必须集中在 src/config/featurePolicies.ts，并在名称中明确时间单位"
  );

  const allowedKernelFiles = new Set([
    "src/kernel/EffectScope.ts",
    "src/kernel/index.ts",
    "src/kernel/Kernel.ts",
    "src/kernel/KernelLifecycle.ts",
    "src/kernel/Pipeline.ts",
    "src/kernel/runtimeKernel.ts",
    "src/kernel/runtimeEnvironment.ts",
    "src/kernel/types.ts",
    "src/kernel/validation.ts",
  ]);

  for (const forbiddenDir of [
    "src/kernel/services",
    "src/kernel/bootstrap",
    "src/kernel/schemas",
    "src/kernel/utils",
    "src/services",
  ]) {
    assert(
      !existsSync(path.join(workspace, forbiddenDir)),
      `${forbiddenDir} 不得存在：业务服务、契约校验与装配必须位于 src/application/services；原生适配必须位于 src/infrastructure；React Hook 必须位于 src/hooks`
    );
  }

  for (const file of listCodeFiles("src/kernel")) {
    const normalizedFile = file.replaceAll("\\", "/");
    assert(
      allowedKernelFiles.has(normalizedFile),
      `${normalizedFile} 不在 Kernel 通用机制白名单中；新增内核文件前必须先确认其与具体业务无关`
    );
    const source = read(file);
    assert(
      !/from\s+["'][^"']*(?:application|domain|infrastructure|components|hooks|tabs)\//.test(source),
      `${file} 不得反向依赖应用、领域、基础设施或界面层`
    );
  }

  for (const file of listCodeFiles("src/application/services/memory")) {
    assert(
      !read(file).includes("utils/localDB"),
      `${file} 不得绕过记忆持久化端口直接依赖 localDB`
    );
    assert(
      !read(file).includes("infrastructure/"),
      `${file} 不得反向依赖具体基础设施适配器`
    );
  }

  for (const file of listCodeFiles("src/infrastructure/storage")) {
    assert(
      !read(file).includes("utils/localDB"),
      `${file} 不得反向依赖 localDB 兼容门面`
    );
  }

  const localDbFacade = read("src/utils/localDB.ts");
  assert(
    !/\bindexedDB\.open\s*\(|\.createObjectStore\s*\(|\.transaction\s*\(/.test(localDbFacade),
    "localDB 只能保留重导出与测试重置协调，不得重新承载 IndexedDB 物理实现"
  );

  for (const file of listCodeFiles("src")) {
    if (file.replaceAll("\\", "/") === "src/utils/localDB.ts") continue;
    assert(
      !/(?:from\s+|import\s*\()\s*["'][^"']*localDB["']/.test(read(file)),
      `${file} 不得导入已冻结的 localDB 兼容门面；业务存储访问必须走 Service 或领域端口`
    );
  }

  for (const file of listCodeFiles("src/contexts")) {
    const source = read(file);
    assert(
      !/(?:infrastructure\/storage|utils\/localDB|compatibility\/sillytavern|infrastructure\/ar)\b/.test(source),
      `${file} 只能保存和投影界面状态，不得直接访问存储、Compatibility Runtime 或 Native Adapter`
    );
    assert(
      !/\b(?:dbService|memoryService|characterService)\.(?:save|delete|getStorage|getSessions|getCharacter|bulk|create)/.test(source),
      `${file} 不得直接编排业务 Service；持久化、分页和级联流程必须进入 application/useCases`
    );
  }

  for (const directory of ["src/components", "src/tabs", "src/hooks", "src/contexts"]) {
    for (const file of listCodeFiles(directory)) {
      assert(
        !/infrastructure\/(?:resources|attachments|toolPlugins)/.test(read(file)),
        `${file} 不得直接读取本地界面资源、消息附件或 Tool Plugin 存储；必须通过对应应用层入口访问`
      );
    }
  }

  const attachmentStorage = read("src/infrastructure/attachments/attachmentStorage.ts");
  assert(
    attachmentStorage.includes('MobileTavernAttachmentDB') &&
      attachmentStorage.includes('METADATA_STORE = "metadata"') &&
      attachmentStorage.includes('CONTENT_STORE = "contents"') &&
      !read("src/infrastructure/resources/localResourceStorage.ts").includes("Attachment"),
    "消息附件必须使用独立数据库并分轨元数据与字节，不能回流主题资源存储"
  );
  const messageRecord = read("src/infrastructure/storage/messageRecord.ts");
  assert(
    messageRecord.includes("contentVersion: 2") &&
      messageRecord.includes("content: MessageContentPart[]") &&
      !/contentVersion:\s*2[\s\S]{0,160}\bparts\s*:/.test(messageRecord),
    "V2 消息记录必须以 Content Parts 作为唯一权威 content，不得并列持久化派生 parts/content 字段"
  );

  const toolPluginStorage = read("src/infrastructure/toolPlugins/toolPluginStorage.ts");
  const toolPluginUseCases = read("src/application/useCases/toolPluginManagementUseCases.ts");
  const toolPluginManager = read("src/components/plugins/ToolPluginManagerSection.tsx");
  assert(
    toolPluginStorage.includes('MobileTavernToolPluginDB')
      && toolPluginUseCases.includes("infrastructure/toolPlugins/toolPluginStorage")
      && toolPluginManager.includes("application/useCases/toolPluginManagementUseCases")
      && !toolPluginManager.includes("infrastructure/toolPlugins"),
    "Tool Plugin 管理必须使用独立数据库，并由 React 经应用用例访问；管理界面不得直连基础设施"
  );
  const toolPluginRuntime = read("src/application/services/ToolPluginRuntimeService.ts");
  const toolPluginWorker = read("src/infrastructure/toolPlugins/browserToolPluginExecutor.ts");
  assert(
    toolPluginRuntime.includes("KernelServices.AgentRuntime")
      && toolPluginRuntime.includes("TOOL_PLUGIN_RUNTIME_REVOKED")
      && toolPluginWorker.includes("worker.terminate()")
      && !toolPluginWorker.includes("getService<"),
    "External Tool 必须经独立应用服务注册到 Agent Runtime；Worker 必须可回收且不得访问 Kernel"
  );

  assert(
    read("src/components/MainLayout.tsx").includes('data-tab-id={tab.id}') &&
      read("src/domain/ui/mainTabVisibility.ts").includes("PROTECTED_MAIN_TABS"),
    "主 Tab 必须提供稳定 data-tab-id，角色与设置必须保留为不可隐藏的恢复入口"
  );

  for (const file of listCodeFiles("src")) {
    const normalizedFile = file.replaceAll("\\", "/");
    if (
      normalizedFile.startsWith("src/utils/tavernHelper/") ||
      normalizedFile.startsWith("src/compatibility/sillytavern/")
    ) {
      continue;
    }
    assert(
      !/(?:from\s+|import\s*\()\s*["'][^"']*utils\/tavernHelper/.test(read(file)),
      `${file} 不得继续使用旧 TavernHelper 导入路径；新代码必须进入 SillyTavern Compatibility Runtime`
    );
  }

  const compatibilityPluginEntry = "src/application/runtimePlugins/sillyTavernCompatibilityRuntimePlugin.ts";
  for (const file of listCodeFiles("src")) {
    const normalizedFile = file.replaceAll("\\", "/");
    if (
      normalizedFile.startsWith("src/compatibility/sillytavern/")
      || normalizedFile.startsWith("src/utils/tavernHelper/")
      || normalizedFile.startsWith("src/infrastructure/compat/sillytavern/")
      || normalizedFile === compatibilityPluginEntry
    ) {
      continue;
    }
    const source = read(file);
    assert(
      !/(?:from\s+|import\s*\()\s*["'][^"']*compatibility\/sillytavern/.test(source),
      `${file} 不得直接导入 SillyTavern 实现；通用消费者只能依赖 Compatibility Host 契约`
    );
    assert(
      !/(?:from\s+|import\s*\()\s*["'][^"']*infrastructure\/compat\/sillytavern/.test(source),
      `${file} 不得绕过 Codec Slot 直接导入 SillyTavern 基础设施 Adapter`
    );
    assert(
      !/TavernHelperIsSending|TavernHelperStreamingMessageId|TavernHelperMvuLibs/.test(source),
      `${file} 不得直接读写 SillyTavern 运行时全局字段；必须通过 Renderer 契约访问`
    );
  }

  const compatibilityHost = read("src/application/services/CompatibilityRuntimeService.ts");
  assert(
    compatibilityHost.includes("registerCodec")
      && compatibilityHost.includes("registerPromptSection")
      && compatibilityHost.includes("registerContextSource")
      && compatibilityHost.includes("registerTransform")
      && compatibilityHost.includes("registerStateReducer")
      && compatibilityHost.includes("registerWorldInfoResolver")
      && compatibilityHost.includes("registerRenderer")
      && !compatibilityHost.includes('from "react"')
      && !compatibilityHost.includes("from 'react'"),
    "Compatibility Host 必须在 Application 层提供七类可撤销贡献，且不得依赖 React"
  );
  const genericRenderingRuntime = read("src/components/formatted-text/renderingRuntime.tsx");
  assert(
    !genericRenderingRuntime.includes("regex_scripts")
      && !genericRenderingRuntime.includes("globalRegexScripts")
      && !genericRenderingRuntime.includes("presetRegexScripts"),
    "通用渲染层不得读取或解释 Compatibility Runtime 的 Regex 来源"
  );
  const compatibilityPlugin = read(compatibilityPluginEntry);
  assert(
    compatibilityPlugin.includes("SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID")
      && compatibilityPlugin.includes("scope.add(runtime.registerCodec")
      && compatibilityPlugin.includes("scope.add(runtime.registerRenderer"),
    "SillyTavern 兼容能力必须由独立受信 Runtime Plugin 注册，并归属 Profile Scope"
  );
  const runtimeProfiles = read("src/application/runtimePlugins/legacyRuntimePlugin.ts");
  const baseProfileSource = runtimeProfiles.slice(
    runtimeProfiles.indexOf("export const baseRuntimeProfileDefinition"),
    runtimeProfiles.indexOf("export const legacyRuntimeProfileDefinition"),
  );
  assert(
    runtimeProfiles.includes("baseRuntimeProfileDefinition")
      && runtimeProfiles.includes('id: "mobile-tavern.base"')
      && runtimeProfiles.includes('id: "mobile-tavern.tavern"')
      && runtimeProfiles.includes("SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID")
      && !baseProfileSource.includes("SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID"),
    "运行时必须同时保留不装载兼容实现的 base Profile 与显式装载兼容插件的 Tavern Profile"
  );
  const runtimePluginContracts = read("src/application/runtimePlugins/contracts.ts");
  const runtimeProfileLoader = read("src/application/runtimePlugins/profileLoader.ts");
  assert(
    runtimePluginContracts.includes("readonly configSchema: z.ZodType<unknown>")
      && runtimePluginContracts.includes("RuntimeCapabilityToken")
      && runtimePluginContracts.includes("defineRuntimePlugin")
      && runtimeProfileLoader.includes("definition.configSchema.parse")
      && runtimeProfileLoader.includes("RUNTIME_CAPABILITY_PROVIDER_CONFLICT")
      && runtimeProfileLoader.includes("RUNTIME_CAPABILITY_TOKEN_CONFLICT"),
    "Runtime Plugin 必须以 Zod 校验公开配置，并通过类型化 Capability Token 检测 Provider 与 Slot 冲突"
  );

  for (const file of listCodeFiles("src/domain/plugins")) {
    const source = read(file);
    assert(
      !source.includes("compatibility/sillytavern") && !source.includes("infrastructure/ar"),
      `${file} 的 Plugin Host RPC 不得复用 Compatibility Runtime 或 Native Adapter`
    );
  }

  for (const file of listCodeFiles("src/infrastructure/ar")) {
    const source = read(file);
    assert(
      !source.includes("domain/plugins") && !source.includes("compatibility/sillytavern"),
      `${file} 的 Native Adapter 不得反向依赖 Plugin Host RPC 或 Compatibility Runtime`
    );
  }

  for (const file of listCodeFiles("src/utils/tavernHelper")) {
    const source = read(file);
    assert(
      !source.includes("domain/plugins") && !source.includes("infrastructure/ar"),
      `${file} 的 SillyTavern Compatibility Runtime 不得反向依赖 Plugin Host RPC 或 Native Adapter`
    );
  }

  for (const file of listCodeFiles("src/compatibility/sillytavern")) {
    const source = read(file);
    assert(
      !source.includes("domain/plugins") && !source.includes("infrastructure/ar"),
      `${file} 的 Compatibility Runtime 权威入口不得反向依赖 Plugin Host RPC 或 Native Adapter`
    );
    assert(
      !/\bIKernelService\b|registerService\s*\(/.test(source),
      `${file} 的 Compatibility Runtime 不得实现或注册为通用 Kernel Service`
    );
  }

  for (const file of listCodeFiles("src/application/services")) {
    assert(
      !/from\s+["'][^"']*hooks\//.test(read(file)),
      `${file} 不得反向依赖 Hook 层`
    );
  }

  const llmCompatibilityRoot = "src/application/services/llmCompatibility";
  for (const file of listCodeFiles(llmCompatibilityRoot)) {
    const source = read(file);
    assert(
      !/(?:from\s+["'][^"']*(?:kernel|hooks|components|contexts|infrastructure)\/|from\s+["']react["'])/.test(source),
      `${file} 的 LLM Provider 兼容层不得反向依赖 Kernel、React、Hook、Context 或基础设施`,
    );
  }
  const legacyModelRegistry = read("src/application/services/memory/ModelCapabilityRegistry.ts");
  assert(
    legacyModelRegistry.includes("@deprecated")
      && legacyModelRegistry.includes('from "../llmCompatibility"')
      && !legacyModelRegistry.includes("class ModelCapabilityRegistry"),
    "模型能力注册表的权威实现必须位于 llmCompatibility；memory 路径只允许保留兼容导出",
  );
  assert(
    read("src/application/services/LLMService.ts").includes("prepareProviderRequest")
      && read("src/application/services/ChatStreamService.ts").includes("normalizeProviderStreamChunk")
      && read("src/hooks/useChat/useSendMessage.ts").includes("preserveAssistantReasoning")
      && read("src/hooks/useChat/useRerollMessage.ts").includes("preserveAssistantReasoning"),
    "LLM 请求、流式响应、发送与重生成必须统一经过 llmCompatibility 防腐边界",
  );

  for (const file of listCodeFiles("src/domain/prompt-composition")) {
    assert(
      !/sillytavern/i.test(read(file)),
      `${file} 必须保持格式中立，SillyTavern 语义只能存在于 infrastructure/compat`
    );
  }

  assert(
    !read("src/hooks/useChat/pipelineHelpers.ts").includes("globalKernel"),
    "聊天输出管线必须使用调用方注入的 IKernel"
  );

  const applicationRuntime = read("src/application/runtime.ts");
  assert(
    applicationRuntime.includes("mountRuntimeProfile") &&
      applicationRuntime.includes("legacyRuntimePluginCatalog") &&
      !applicationRuntime.includes("registerCoreServices") &&
      !applicationRuntime.includes("registerDefaultPipelines") &&
      !applicationRuntime.includes("registerRuntimeCapabilities"),
    "应用组合根必须通过 Runtime Profile 装载 legacy runtime，不能恢复服务、Pipeline 和能力清单的散落直接注册"
  );
  for (const file of listCodeFiles("src/kernel")) {
    assert(
      !/RuntimePlugin|RuntimeProfile|legacy-runtime|AgentHandle|AgentRuntime|ToolRegistry|MediaProcessor/.test(read(file)),
      `${file} 不得引入 Application 层 Runtime Plugin/Profile/Agent 业务语义`
    );
  }
  const agentRuntime = read("src/application/services/AgentRuntimeService.ts");
  assert(
    agentRuntime.includes("openHandle") &&
      agentRuntime.includes("registerDriver") &&
      agentRuntime.includes("registerProvider") &&
      agentRuntime.includes("registerTool") &&
      agentRuntime.includes("registerMediaProcessor") &&
      !agentRuntime.includes("from \"react\"") &&
      !agentRuntime.includes("from 'react'"),
    "Agent Runtime 必须留在 Application 层，以可撤销 Registry 和 AgentHandle 管理能力，且不得依赖 React"
  );
  const sendMessageHook = read("src/hooks/useChat/useSendMessage.ts");
  assert(
    sendMessageHook.includes("ensureAgentHandle") &&
      sendMessageHook.includes("MOBILE_TAVERN_CHAT_DRIVER_ID") &&
      sendMessageHook.includes("recordDecision(\"provider.request\"") &&
      sendMessageHook.includes("recordDecision(\"media.projection\""),
    "聊天发送必须经 AgentHandle/通用聊天 Driver，并记录实际 Provider 与媒体投影决定"
  );
  const openAiToolLoop = read("src/application/useCases/openAiToolLoop.ts");
  assert(
    sendMessageHook.includes("executeOpenAiToolLoop")
      && openAiToolLoop.includes("delta.tool_calls")
      && openAiToolLoop.includes("executeTool")
      && openAiToolLoop.includes("tool.loop.step")
      && openAiToolLoop.includes("maxSteps"),
    "OpenAI-compatible 聊天必须消费分片 tool_calls、经 Agent Turn 执行工具并以有限 Step 继续模型循环"
  );
  const agentJournalStorage = read("src/infrastructure/agents/agentJournalStorage.ts");
  assert(
    agentJournalStorage.includes("MobileTavernAgentJournalDB") &&
      agentJournalStorage.includes('EVENT_STORE = "events"') &&
      !agentJournalStorage.includes("application/"),
    "Agent Journal 必须使用独立数据库并保持 Infrastructure 不反向依赖 Application"
  );
  const agentPlugin = read("src/application/runtimePlugins/agentSpineRuntimePlugin.ts");
  assert(
    agentPlugin.includes("media.audio.asr") &&
      agentPlugin.includes("media.video.keyframes") &&
      agentPlugin.includes("scope.add(runtime.registerMediaProcessor"),
    "音频 ASR 与视频关键帧必须作为受信 Runtime Plugin 的可撤销媒体 Processor 注册"
  );
  assert(
    !existsSync(path.join(workspace, "src/application/bootstrap/capabilityCatalog.ts")) &&
      read("src/application/runtimePlugins/legacyRuntimePlugin.ts").includes("coreRuntimeCapabilities") &&
      !read("src/application/bootstrap/capabilityRegistry.ts").includes("defaultCapabilityCatalog"),
    "能力声明必须归属具体 Runtime Plugin，不能恢复旧静态 capability catalog 或隐式默认注册"
  );
  assert(
    applicationRuntime.includes("readRuntimeProfilePreferences") &&
      applicationRuntime.includes("resolveRuntimeProfileSelection") &&
      read("src/tabs/settings/SettingsTab.tsx").includes("RuntimeProfileManagerSection") &&
      read("src/components/plugins/RuntimeProfileManagerSection.tsx").includes("SettingsToggleRow") &&
      read("src/components/plugins/RuntimeProfileManagerSection.tsx").includes("BUILTIN_TAVERN_PROFILE_ID") &&
      read("src/components/plugins/RuntimeProfileManagerSection.tsx").includes("service.selectProfile") &&
      read("src/components/plugins/RuntimeProfileManagerSection.tsx").includes("destroyApplicationRuntime") &&
      sendMessageHook.includes("canRunSessionWithProfile") &&
      read("src/hooks/useChat/useRerollMessage.ts").includes("canRunSessionWithProfile"),
    "阶段 5 必须从持久化选择装载 Profile、提供可切换兼容插件的管理 UI，并在发送与重发前守卫会话组合快照"
  );
  assert(
    read("src/contexts/ChatContext.tsx").includes("prepareRuntimeProfileSessionResume")
      && read("src/contexts/LegacyAppContextProvider.tsx").includes("readRuntimeProfileSessionResumeIntent")
      && read("src/infrastructure/runtimeProfiles/runtimeProfileSessionResume.ts")
        .includes("resumeIntentSchema.safeParse"),
    "跨 Profile 打开会话必须以经过 Schema 校验的一次性意图重启，并在目标组合装载后恢复会话"
  );
  const sessionStateSnapshot = read("src/domain/chat/sessionStateSnapshot.ts");
  assert(
    compatibilityHost.includes("readState(session")
      && compatibilityHost.includes("writeState(session")
      && compatibilityPlugin.includes("variables: undefined")
      && compatibilityPlugin.includes("runtimePluginState")
      && sessionStateSnapshot.includes("version: 2")
      && sessionStateSnapshot.includes("runtimePluginState")
      && !read("src/application/services/ScriptService.ts").includes("session.variables")
      && !read("src/components/MemoryTableDrawer.tsx").includes("activeSession.variables"),
    "兼容会话状态必须经 Compatibility Host 单写插件命名空间；旧 session.variables 只允许在兼容边界读取降级"
  );

  assert(
    !read("src/tabs/chat/ChatInputArea.tsx").includes("useContext(UnifiedAppContext)"),
    "聊天输入区不得订阅完整 UnifiedAppContext，必须通过选择器限制状态扩散"
  );

  const mainLayout = read("src/components/MainLayout.tsx");
  assert(
    !/fallback=\{<SplashScreen\b/.test(mainLayout),
    "主功能页的 Suspense 回退不得复用全屏启动页，避免首次切换时闪回首页"
  );
  assert(
    /fallback=\{<TabLoadingFallback\s*\/>\}/.test(mainLayout),
    "主功能页必须使用局部加载态承接首次代码分块加载"
  );
  assert(
    /mountedTabIds/.test(mainLayout) &&
      /role="tabpanel"/.test(mainLayout),
    "主功能页必须采用已访问页签离屏保活机制，避免重复销毁重构"
  );
  const appContext = read("src/contexts/AppContext.tsx");
  assert(
    /startTransition\(\(\)\s*=>\s*setActiveTabState\(tab\)\)/.test(appContext) &&
      /commitActiveTab\(hash as TabType\)/.test(appContext),
    "主功能页切换必须使用 Transition，避免快速代码分块加载时 loading 动画闪烁"
  );
  assert(
    !read("src/contexts/LegacyAppContextProvider.tsx").includes("Triggering daily backup check"),
    "应用启动不得静默触发文件备份；数据导出必须由用户显式发起"
  );
  assert(
    /activeTab === ["']settings["'] \? ["']max-w-lg landscape:max-w-none["']/.test(mainLayout),
    "设置页横屏时必须解除手机竖屏宽度上限，确保高级工作台获得真实可用宽度"
  );
  assert(
    /!promptFocusActive/.test(mainLayout),
    "Prompt 横屏专注模式必须隐藏全局底栏，避免设置导航继续挤占工作台"
  );

  const settingsTab = read("src/tabs/settings/SettingsTab.tsx");
  const apiConfigSection = read("src/tabs/settings/sections/ApiConfigSection.tsx");
  assert(
    settingsTab.includes("settings-shell")
      && settingsTab.includes("settings-category-list")
      && !settingsTab.includes("settings-home-summary")
      && !settingsTab.includes("settings-home-hero")
      && apiConfigSection.includes("SettingsToggleRow")
      && apiConfigSection.includes("settings-panel"),
    "设置页必须使用现代聊天式设置壳，API 能力开关必须使用统一设置行"
  );
  assert(
    /case\s+["']prompt["']:[\s\S]*sections=\{\[["']preset["'],\s*["']prompts["'],\s*["']regex["']\]\}/.test(settingsTab),
    "预设导入、切换与管理入口必须挂载在用户可见的“预设”分类中"
  );
  assert(
    /promptFocus\.active[\s\S]*sections=\{\[["']composer["']\]\}/.test(settingsTab),
    "Prompt 横屏专注模式必须只挂载编排器本体"
  );
  assert(
    /id:\s*["']composer["'][\s\S]*settings_hub\.composer_title/.test(settingsTab) &&
      /case\s+["']composer["']:[\s\S]*sections=\{\[["']composer["']\]\}/.test(settingsTab) &&
      !read("src/components/presetForm/PromptsConfigSection.tsx").includes("PromptCompositionEditor"),
    "Prompt 组装必须作为独立设置分类，不能继续嵌在预设提示词面板内"
  );
  assert(
    settingsTab.indexOf('id: "composer"') < settingsTab.indexOf('id: "plugins"') &&
      settingsTab.indexOf('id: "plugins"') < settingsTab.indexOf('id: "advanced"') &&
      /case\s+["']plugins["']:[\s\S]*<PluginManagerSection\s*\/>/.test(settingsTab) &&
      /id:\s*["']plugins["'][\s\S]*experimental:\s*true/.test(settingsTab),
    "第三方插件必须作为编排后的独立实验性设置分类"
  );
  assert(
    !read("src/tabs/settings/MemoryStorageSection.tsx").includes("SystemReportSection") &&
      settingsTab.includes("SystemReportSection"),
    "系统报告必须归入独立的关于我们分类，不得继续混在记忆与数据中"
  );
  assert(
    settingsTab.includes("React.lazy") &&
      !/import\s+PresetForm\s+from/.test(settingsTab) &&
      !/import\s+FeaturesSection\s+from/.test(settingsTab),
    "设置页高级分区必须保持按需加载，不能重新静态并入设置入口分包"
  );

  const chatTab = read("src/tabs/chat/ChatTab.tsx");
  assert(
    chatTab.includes("React.lazy") &&
      /isTableDrawerOpen\s*&&[\s\S]*?<React\.Suspense/.test(chatTab),
    "记忆与状态中心必须只在用户打开抽屉后才下载和挂载"
  );
  const memoryDrawer = read("src/components/MemoryTableDrawer.tsx");
  assert(
    memoryDrawer.includes("React.lazy") &&
      memoryDrawer.includes("./MvuVariablesTabContent") &&
      memoryDrawer.includes("./memory-drawer/TableMemoryTab") &&
      memoryDrawer.includes("./memory-drawer/DictTab") &&
      memoryDrawer.includes("./memory-drawer/RecallTab"),
    "状态数据、记忆词典、召回和 MVU 面板必须与会话资料外壳分离，并按面板动态加载"
  );

  const bridgeCore = read("src/utils/tavernHelper/bridgeCore.ts");
  assert(
    bridgeCore.includes("cardNeedsMathRuntime") &&
      bridgeCore.includes("ensureMathLibLoaded") &&
      /ensureMathLibLoaded\(\)[\s\S]*?import\(["']mathjs["']\)/.test(bridgeCore),
    "mathjs 必须保持独立按需加载，普通脚本卡不得后台下载数学运行时"
  );

  for (const file of [
    "src/components/presetForm/PromptCompositionEditor.tsx",
    "src/components/presetForm/PromptBlockEditorDialog.tsx",
    "src/components/presetForm/PromptBlockQuickEditor.tsx",
    "src/components/presetForm/PromptCompositionBudgetSettings.tsx",
    "src/components/presetForm/PromptCompositionTemplateManager.tsx",
    "src/components/presetForm/PromptCompositionTransferToolbar.tsx",
    "src/components/presetForm/PromptCompositionWorkbench.tsx",
    "src/components/presetForm/PromptCompositionGraph.tsx",
  ]) {
    const source = read(file);
    assert(
      !/<(?:button|select|textarea)\b/.test(source) && !/<input\b[^>]*type=["']checkbox["']/.test(source),
      `${file} 的可见交互控件必须复用 PromptComposerControls，不能退回系统默认外观`
    );
  }

  for (const file of [
    "src/components/MvuVariablesTabContent.tsx",
    "src/components/memory-drawer/DictTab.tsx",
    "src/components/memory-drawer/TableMemoryTab.tsx",
  ]) {
    const source = read(file);
    const visibleSource = source.replace(/<input\b[\s\S]*?type=["']file["'][\s\S]*?\/>/g, "");
    assert(
      !/<(?:input|select|textarea)\b/.test(visibleSource),
      `${file} 的可见表单控件必须复用 MemoryDrawerControls，不能退回系统默认外观`
    );
  }

  const memoryDictionary = read("src/components/memory-drawer/DictTab.tsx");
  assert(
    memoryDictionary.includes("AndroidThemeBridge") && memoryDictionary.includes("bridge.saveFile(fileName, json)"),
    "记忆词典导出必须优先调用 Android 原生 saveFile，不能只依赖 WebView Blob 下载"
  );

  for (const file of listCodeFiles("src")) {
    assert(
      !/(?:window\.)?(?:alert|confirm)\s*\(/.test(read(file)),
      `${file} 不得调用系统 alert/confirm，必须使用应用内统一反馈组件`
    );
  }

  for (const file of [
    "src/tabs/settings/FeaturesSection.tsx",
    "src/tabs/settings/sections/MemoryConfigCard.tsx",
  ]) {
    assert(
      !/<select\b/.test(read(file)),
      `${file} 的可见选择控件必须复用 SettingsSelect，不能退回系统默认外观`
    );
  }
  const featuresSection = read("src/tabs/settings/FeaturesSection.tsx");
  assert(
    featuresSection.includes("aria-expanded={showFeatureDetails}") &&
      featuresSection.includes("aria-expanded={showExpressionDictionary}"),
    "设置页高密度功能与表情词典必须默认折叠并按需展开"
  );

  const androidBridgePlugin = read("src-tauri/plugins/android-bridge/src/lib.rs");
  assert(
    androidBridgePlugin.includes("register_android_plugin"),
    "Android 原生桥接必须显式注册 Kotlin 插件，否则横屏、文件与状态栏接口不会注入 WebView"
  );
  const mainActivity = read("src-tauri/gen/android/app/src/main/java/com/aitavern/app/MainActivity.kt");
  assert(
    mainActivity.includes("onBackPressedDispatcher.addCallback") &&
      mainActivity.includes("BACK_EXIT_INTERVAL_MS") &&
      mainActivity.includes("finishAffinity()"),
    "Android 返回操作必须保留原生双击退出兜底，不能依赖 WebView 路由状态"
  );
  const androidBridgeManifest = read(
    "src-tauri/plugins/android-bridge/android/src/main/AndroidManifest.xml"
  );
  const androidThemeBridge = read(
    "src-tauri/plugins/android-bridge/android/src/main/kotlin/com/aitavern/plugin/androidbridge/AndroidThemeBridge.kt"
  );
  assert(
    androidBridgeManifest.includes("android.permission.MANAGE_EXTERNAL_STORAGE") &&
      androidThemeBridge.includes("Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION") &&
      androidThemeBridge.includes("Environment.isExternalStorageManager()") &&
      mainActivity.includes("notifyStoragePermissionStateOnResume"),
    "本地角色卡扫描必须通过 Android 专属的所有文件访问设置授权，并在返回应用后同步结果"
  );
  assert(
    androidThemeBridge.includes("fun setImmersiveMode(enabled: Boolean)") &&
      androidThemeBridge.includes("BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE") &&
      read("src/components/plugins/FullscreenPluginRunner.tsx").includes("setImmersiveMode(true)") &&
      read("src/components/plugins/FullscreenPluginRunner.tsx").includes("setImmersiveMode(false)"),
    "第三方全屏插件必须在运行期启用可临时唤出的 Android 沉浸式系统栏，并在退出时恢复"
  );
  assert(
    androidThemeBridge.includes("Environment.getExternalStorageDirectory()") &&
      androidThemeBridge.includes("storageManager.storageVolumes") &&
      androidThemeBridge.includes("parentName.equals(\"Android\"") &&
      androidThemeBridge.includes("directory.name.equals(\"data\"") &&
      !androidThemeBridge.includes("READ_EXTERNAL_STORAGE") &&
      !androidThemeBridge.includes("ACTION_OPEN_DOCUMENT_TREE"),
    "本地角色卡扫描必须覆盖可访问的共享存储与外置卷，跳过 Android 私有数据区且不得退回失效的旧权限"
  );
  const systemReportSection = read(
    "src/tabs/settings/sections/system-report/SystemReportSectionView.tsx"
  );
  assert(
    androidThemeBridge.includes("fun verifyFileIo(): String") &&
      androidThemeBridge.includes("resolver.openInputStream(uri)") &&
      androidThemeBridge.includes("resolver.delete(it, null, null)") &&
      systemReportSection.includes("const bridge = w.AndroidThemeBridge") &&
      systemReportSection.includes("bridge.verifyFileIo()") &&
      !systemReportSection.includes("readLocalFile(savedPath)"),
    "Android 文件 IO 系统诊断必须在原生层基于同一 MediaStore URI 完成写入、回读和清理，不能把展示路径传给本地导入接口"
  );
  const dialogueHistoryView = read("src/tabs/chat/DialogueHistoryView.tsx");
  assert(
    dialogueHistoryView.includes("useVirtualizer") &&
      !dialogueHistoryView.includes("foldedCount") &&
      !dialogueHistoryView.includes("showFullHistory") &&
      !dialogueHistoryView.includes("已归档") &&
      !dialogueHistoryView.includes("messagesToRender.length > 20") &&
      !dialogueHistoryView.includes("节约内存渲染"),
    "聊天流必须只由消息分页和虚拟列表控制资源占用，不得保留任何形式的正文折叠"
  );

  const androidReleaseWorkflow = read(".github/workflows/tauri-android.yml");
  assert(
    androidReleaseWorkflow.includes("Validate Android signing secrets") &&
      androidReleaseWorkflow.includes("Required Android signing secret is missing") &&
      !androidReleaseWorkflow.includes("Skipping signing") &&
      !androidReleaseWorkflow.includes("Copying raw APK"),
    "Android 发布工作流必须在签名材料缺失时失败，不能降级上传未签名 APK"
  );
  assert(
    androidReleaseWorkflow.includes('-path "*/release/*.apk"') &&
      androidReleaseWorkflow.includes("apksigner\" verify --verbose --print-certs") &&
      androidReleaseWorkflow.includes("sha256sum MobileTavern.apk"),
    "Android 发布工作流必须只签署 release APK，并校验证书与输出摘要"
  );

  const packageScripts = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
    build?: { beforeBuildCommand?: string };
  };
  assert(
    packageScripts.scripts?.["build:web"] === "npm run build:examples && vite build" &&
      packageScripts.scripts?.["build:mobile"] === "npm run build:web && npm run check:mobile-assets" &&
      packageScripts.scripts?.["build:server"]?.includes("server.ts") &&
      tauriConfig.build?.beforeBuildCommand === "npm run build:mobile" &&
      read("scripts/build-android.cjs").includes("execSync('npm run build:mobile'") &&
      read("scripts/check-mobile-assets.cjs").includes("prohibitedNames"),
    "Tauri 与 Android 构建必须执行纯前端 build:mobile 及产物扫描，Node/Express 服务只能通过 build:server 独立构建"
  );

  for (const file of listCodeFiles("src")) {
    assert(
      !/=\s*useUnifiedApp\(\)/.test(read(file)),
      `${file} 不得无选择器订阅完整 UnifiedAppContext`
    );
  }

  for (const file of [
    "src/hooks/useChat/useSendMessage.ts",
    "src/hooks/useChat/useRerollMessage.ts",
  ]) {
    assert(
      !/lastRecalledMemories\s*:/.test(read(file)),
      `${file} 不得把瞬态召回结果附加到 ChatSession`
    );
  }

  for (const file of [
    "src/kernel/Kernel.ts",
    "src/kernel/types.ts",
    "src/utils/localDB.ts",
    "src/application/services/PromptService.ts",
    "src/components/FormattedText.tsx",
    "src/components/formatted-text/renderingRuntime.tsx",
    "src/tabs/settings/sections/system-report/SystemReportSectionView.tsx",
    "src/tabs/settings/sections/system-report/SystemReportPanel.tsx",
    "src/tabs/chat/MessageBubble.tsx",
    "src/tabs/chat/message-bubble/MessageAvatar.tsx",
    "src/tabs/chat/message-bubble/ReasoningBlock.tsx",
    "src/tabs/chat/message-bubble/GeneratedImageBlock.tsx",
    "src/tabs/chat/message-bubble/MessageTimestamp.tsx",
  ]) {
    const lines = read(file).split(/\r?\n/).length;
    assert(lines <= 1000, `${file} 超过单文件 1000 行硬上限：${lines}`);
  }
  const presetPromptPlan = read("src/application/useCases/presetPromptConfig.ts");
  const promptService = read("src/application/services/PromptService.ts");
  const sendMessage = read("src/hooks/useChat/useSendMessage.ts");
  const rerollMessage = read("src/hooks/useChat/useRerollMessage.ts");
  assert(
    read("src/types.ts").includes("interface PromptPresetPlan")
      && presetPromptPlan.includes("normalizeSavedPresetPromptPlan")
      && presetPromptPlan.includes('mode: "legacy"')
      && promptService.includes("assemblePromptComposition")
      && sendMessage.includes("assembleAuthoritativePromptEnvelope")
      && rerollMessage.includes("assembleAuthoritativePromptEnvelope")
      && !sendMessage.includes("promptPayload.messages ||")
      && !rerollMessage.includes("promptPayload.messages ||"),
    "Prompt 预设必须经版本快照归一化，发送与重生成只能消费单一权威 messages，不能恢复二次拼装路径"
  );
  assert(
    read("src/components/FormattedText.tsx").includes("./formatted-text/renderingRuntime") &&
      read("src/tabs/settings/sections/system-report/SystemReportSectionView.tsx").includes("./SystemReportPanel") &&
      read("src/tabs/chat/MessageBubble.tsx").includes("./message-bubble/ReasoningBlock") &&
      read("src/tabs/chat/MessageBubble.tsx").includes("./message-bubble/GeneratedImageBlock"),
    "FormattedText、SystemReportSection 与 MessageBubble 必须保持职责拆分，不能重新合并为接近千行的单体组件"
  );

  console.log("✔ 内核架构边界守卫通过");
}
