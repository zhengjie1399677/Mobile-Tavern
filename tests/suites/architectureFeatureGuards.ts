/**
 * 扩展功能、平台隔离与工程约束的架构边界守卫。
 *
 * 从 `architectureBoundaries.test.ts` 按职责拆出，保持双文件均低于 1000 行阈值。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { assert } from "./testUtils";

export interface FeatureArchitectureGuardHelpers {
  readonly workspace: string;
  readonly read: (relativePath: string) => string;
  readonly listCodeFiles: (relativeDir: string) => string[];
}

export function assertFeatureArchitectureBoundaries({
  workspace,
  read,
  listCodeFiles,
}: FeatureArchitectureGuardHelpers): void {
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
    "src/hooks/useChat/useSendMessage.ts",
    "src/components/session-manager/SessionManagerPanel.tsx",
    "src/components/FormattedText.tsx",
    "src/components/formatted-text/renderingRuntime.tsx",
    "src/tabs/settings/sections/system-report/SystemReportSectionView.tsx",
    "src/tabs/settings/sections/system-report/SystemReportPanel.tsx",
    "src/tabs/chat/MessageBubble.tsx",
    "src/tabs/chat/message-bubble/MessageAvatar.tsx",
    "src/tabs/chat/message-bubble/ReasoningBlock.tsx",
    "src/tabs/chat/message-bubble/GeneratedImageBlock.tsx",
    "src/tabs/chat/message-bubble/MessageTimestamp.tsx",
    "src/tabs/chat/ChatInputArea.tsx",
    "src/tabs/chat/voice-composer/VoiceHoldOverlay.tsx",
    "src/tabs/chat/voice-composer/VoiceHoldButton.tsx",
    "src/tabs/chat/voice-composer/VoiceModeToggle.tsx",
    "src/tabs/chat/voice-composer/VoiceDraftHint.tsx",
    "src/tabs/chat/composer-panels/ComposerQuickActionBar.tsx",
    "src/tabs/chat/composer-panels/ComposerReplySuggestions.tsx",
    "tests/suites/architectureBoundaries.test.ts",
    "tests/suites/architectureFeatureGuards.ts",
  ]) {
    const lines = read(file).split(/\r?\n/).length;
    assert(lines <= 1000, `${file} 超过单文件 1000 行硬上限：${lines}`);
  }
  const promptService = read("src/application/services/PromptService.ts");
  const sendMessage = read("src/hooks/useChat/useSendMessage.ts");
  const rerollMessage = read("src/hooks/useChat/useRerollMessage.ts");
  const promptTurnExecution = read("src/application/useCases/chatTurnExecution.ts");
  assert(
    // v3 起预设实体只保留传统 Prompt 权威：v1/v2 记录只能经迁移入口读取，且迁移实现只写一处。
    read("src/domain/presets/bundleMigration.ts").includes("v1/v2 → v3")
      && read("src/domain/presets/bundleMigration.ts").includes("export function readPresetBundleList")
      && read("src/domain/presets/contracts.ts").includes("PRESET_BUNDLE_SCHEMA_VERSION")
      && !promptService.includes("assemblePromptComposition")
      && promptTurnExecution.includes("assembleAuthoritativePromptEnvelope")
      && sendMessage.includes("executeChatTurnModelPhase")
      && rerollMessage.includes("executeChatTurnModelPhase")
      && !promptTurnExecution.includes("promptPayload.messages ||")
      && !sendMessage.includes("promptPayload.messages ||")
      && !rerollMessage.includes("promptPayload.messages ||"),
    "Prompt 预设必须经 v1/v2→v3 迁移归一化，运行期只走传统字段，发送与重生成只能消费单一权威 messages"
  );
  assert(
    read("src/components/FormattedText.tsx").includes("./formatted-text/renderingRuntime") &&
      read("src/tabs/settings/sections/system-report/SystemReportSectionView.tsx").includes("./SystemReportPanel") &&
      read("src/tabs/chat/MessageBubble.tsx").includes("./message-bubble/ReasoningBlock") &&
      read("src/tabs/chat/MessageBubble.tsx").includes("./message-bubble/GeneratedImageBlock") &&
      read("src/tabs/chat/ChatInputArea.tsx").includes("./voice-composer/VoiceHoldButton") &&
      read("src/tabs/chat/ChatInputArea.tsx").includes("./composer-panels/ComposerQuickActionBar"),
    "FormattedText、SystemReportSection、MessageBubble 与 ChatInputArea 必须保持职责拆分，不能重新合并为接近千行的单体组件"
  );

  // 外部能力通道边界：MCP 只是第一个 Connector 实现，协议适配必须留在基础设施层。
  const externalSourceDirectory = path.join("src", "domain", "externalSources").split(path.sep).join("/");
  const mcpImportAllowlist = path
    .join("src", "infrastructure", "externalSources", "mcp")
    .split(path.sep)
    .join("/");
  for (const file of listCodeFiles("src")) {
    const normalized = file.split(path.sep).join("/");
    const source = read(file);
    assert(
      !source.includes("@modelcontextprotocol/client/stdio"),
      `禁止导入 MCP stdio 子路径（会引入 Node 专用依赖）：${normalized}`
    );
    if (!source.includes("@modelcontextprotocol/")) continue;
    assert(
      normalized.startsWith(mcpImportAllowlist),
      `只有 ${mcpImportAllowlist} 可以导入 MCP SDK，违规文件：${normalized}`
    );
  }
  for (const file of listCodeFiles(path.join("src", "kernel"))) {
    const normalized = file.split(path.sep).join("/");
    const source = read(file);
    assert(!source.includes("@modelcontextprotocol/"), `Kernel 不得导入 MCP SDK：${normalized}`);
    assert(
      !source.includes("externalSources"),
      `Kernel 不得依赖外部能力通道：${normalized}`
    );
  }
  assert(
    existsSync(path.join(workspace, externalSourceDirectory)),
    "外部能力通道的中立契约目录缺失：src/domain/externalSources"
  );

  // UnifiedAppContext 是历史包袱而非扩展点：字段数已冻结，新增领域状态必须建立独立 Context/Store。
  const unifiedContextSource = read("src/UnifiedAppContext.tsx");
  const unifiedContextStart = unifiedContextSource.indexOf("export interface UnifiedAppContextProps");
  const unifiedContextEnd = unifiedContextSource.indexOf("\n}", unifiedContextStart);
  assert(
    unifiedContextStart >= 0 && unifiedContextEnd > unifiedContextStart,
    "UnifiedAppContextProps 接口必须保持可解析"
  );
  const unifiedContextFields = unifiedContextSource
    .slice(unifiedContextStart, unifiedContextEnd)
    .split(/\r?\n/)
    .filter((line) => /^\s{2}[A-Za-z_$][\w$]*\??\s*[:(]/.test(line)).length;
  assert(
    unifiedContextFields <= 171,
    `UnifiedAppContextProps 字段数已冻结为 171，当前 ${unifiedContextFields}。新增领域状态请建立独立 Context/Store。`
  );
}

