/**
 * 内核架构边界守卫。
 *
 * 防止后续业务开发重新绕过持久化端口、回流全局内核单例，
 * 或让基础服务反向依赖 React Hook。
 */
import { readFileSync, readdirSync } from "node:fs";
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

  for (const file of listCodeFiles("src/kernel/services/memory")) {
    assert(
      !read(file).includes("utils/localDB"),
      `${file} 不得绕过记忆持久化端口直接依赖 localDB`
    );
    assert(
      !read(file).includes("infrastructure/"),
      `${file} 不得反向依赖具体基础设施适配器`
    );
  }

  for (const file of listCodeFiles("src/services")) {
    assert(
      !/from\s+["'][^"']*hooks\//.test(read(file)),
      `${file} 不得反向依赖 Hook 层`
    );
  }

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
    /activeTab === ["']settings["'] \? ["']max-w-lg landscape:max-w-none["']/.test(mainLayout),
    "设置页横屏时必须解除手机竖屏宽度上限，确保高级工作台获得真实可用宽度"
  );
  assert(
    /!promptFocusActive/.test(mainLayout),
    "Prompt 横屏专注模式必须隐藏全局底栏，避免设置导航继续挤占工作台"
  );

  const settingsTab = read("src/tabs/settings/SettingsTab.tsx");
  assert(
    /promptFocus\.active[\s\S]*sections=\{\[["']composer["']\]\}/.test(settingsTab),
    "Prompt 横屏专注模式必须只挂载编排器本体"
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
    memoryDrawer.includes("React.lazy") && memoryDrawer.includes("./MvuVariablesTabContent"),
    "MVU 面板必须与记忆中心主体分离，并在切换到角色变量后动态加载"
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
    "src/kernel/services/PromptService.ts",
  ]) {
    const lines = read(file).split(/\r?\n/).length;
    assert(lines <= 1000, `${file} 超过单文件 1000 行硬上限：${lines}`);
  }

  console.log("✔ 内核架构边界守卫通过");
}
