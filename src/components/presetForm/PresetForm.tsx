import { useMemo } from "react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { useKernel } from "../../contexts/KernelContext";
import type { IPromptService } from "../../kernel/types";
import { usePresetFormState } from "./usePresetFormState";
import PresetSelectorSection from "./PresetSelectorSection";
import SamplersSection from "./SamplersSection";
import PromptsConfigSection from "./PromptsConfigSection";
import PromptCompositionEditor from "./PromptCompositionEditor";
import RegexManagementSection from "./RegexManagementSection";

/**
 * 预设表单组合根：
 * 从全局 Context 取出 settings/handlers，交给 usePresetFormState 集中管理局部状态，
 * 再向下分发给四个 Section 子组件，本身不持有任何业务逻辑。
 *
 * 路径兼容：外部 `import PresetForm from "../components/PresetForm"` 经原文件 barrel
 * re-export 后，最终解析到本文件的默认导出，导入路径零变更。
 */
export type PresetFormSection = "preset" | "samplers" | "prompts" | "regex" | "composer";

interface PresetFormProps {
  sections?: PresetFormSection[];
}

export default function PresetForm({
  sections = ["preset", "samplers", "prompts", "regex"],
}: PresetFormProps) {
  const showPreset = sections.includes("preset");
  const showSamplers = sections.includes("samplers");
  const showPrompts = sections.includes("prompts");
  const showRegex = sections.includes("regex");
  const showComposer = sections.includes("composer");
  const kernel = useKernel();
  const promptService = kernel.getService<IPromptService>("prompt");
  const {
    settings,
    updateSettings,
    settingsSaveState,
    settingsLastSavedAt,
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    handleToggleCustomPrompt,
    handleUpdateCustomPrompt,
    handleAddNewCustomPrompt,
    handleDeleteCustomPrompt,
    showCustomConfirm,
    showCustomAlert,
    activeCharacter,
    activeSession,
    characters,
    globalLorebook,
    customWorldbooks,
    lastRecalledMemories,
    saveCharacter,
  } = useUnifiedApp((state) => ({
    settings: state.settings,
    updateSettings: state.updateSettings,
    settingsSaveState: state.settingsSaveState,
    settingsLastSavedAt: state.settingsLastSavedAt,
    handleImportPresetJSON: state.handleImportPresetJSON,
    handleExportPresetJSON: state.handleExportPresetJSON,
    handleSaveNewPresetBundle: state.handleSaveNewPresetBundle,
    handleLoadPresetBundle: state.handleLoadPresetBundle,
    handleDeletePresetBundle: state.handleDeletePresetBundle,
    handleToggleCustomPrompt: state.handleToggleCustomPrompt,
    handleUpdateCustomPrompt: state.handleUpdateCustomPrompt,
    handleAddNewCustomPrompt: state.handleAddNewCustomPrompt,
    handleDeleteCustomPrompt: state.handleDeleteCustomPrompt,
    showCustomConfirm: state.showCustomConfirm,
    showCustomAlert: state.showCustomAlert,
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    characters: state.characters,
    globalLorebook: state.globalLorebook,
    customWorldbooks: state.customWorldbooks,
    lastRecalledMemories: state.lastRecalledMemories,
    saveCharacter: state.saveCharacter,
  }));

  const {
    activeBundleId,
    selectedPromptIds,
    setSelectedPromptIds,
    selectedGlobalRegexIds,
    setSelectedGlobalRegexIds,
    selectedPresetRegexIds,
    setSelectedPresetRegexIds,
    isBatchDeletingPrompts,
    setIsBatchDeletingPrompts,
    isBatchDeletingGlobalRegex,
    setIsBatchDeletingGlobalRegex,
    isBatchDeletingPresetRegex,
    setIsBatchDeletingPresetRegex,
    isSamplersFolded,
    handleToggleSamplersFold,
    isPromptsFolded,
    handleTogglePromptsFold,
    isRegexFolded,
    handleToggleRegexFold,
    coreStatusText,
    activeCustomPrompts,
    activeGlobalRegex,
    activePresetRegex,
    activeCharRegex,
    editingRegex,
    setEditingRegex,
    isRegexModalOpen,
    setIsRegexModalOpen,
    toggleRegexDisabled,
    deleteRegex,
    saveRegex,
    handleBatchDeletePrompts,
    handleBatchDeleteGlobalRegex,
    handleBatchDeletePresetRegex,
  } = usePresetFormState({
    settings,
    updateSettings,
    showCustomConfirm,
    showCustomAlert,
    activeCharacter,
    saveCharacter,
  });

  const promptCompositionPreview = useMemo(() => {
    if ((!showPrompts && !showComposer) || !activeCharacter || !activeSession || !settings.promptConfig.composition) return undefined;
    const otherCharacterEntries = characters
      .filter((character) => character.isWorldbookGlobal && character.id !== activeCharacter.id)
      .flatMap((character) => character.lorebookEntries || []);
    const customEntries = Object.values(customWorldbooks || {})
      .filter((worldbook) => worldbook.enabled)
      .flatMap((worldbook) => worldbook.entries || []);
    const result = promptService.assemblePrompt({
      character: activeCharacter,
      chat: activeSession,
      userInput: "",
      settings: {
        ...settings,
        promptConfig: { ...settings.promptConfig, usePromptComposition: true },
      },
      globalLorebook: [...globalLorebook, ...otherCharacterEntries, ...customEntries],
      recalledMemories: lastRecalledMemories,
    });
    const messages = result.messages || [];
    return {
      messages,
      diagnostics: result.diagnostics || [],
      traces: result.traces || [],
      budget: result.budget,
      estimatedTokens: messages.reduce((total, message) => total + promptService.estimateTokens(message.content), 0),
      contextAvailable: true,
    };
  }, [
    activeCharacter,
    activeSession,
    characters,
    customWorldbooks,
    globalLorebook,
    lastRecalledMemories,
    promptService,
    settings,
    showComposer,
    showPrompts,
  ]);

  return (
    <div className="space-y-2.5">
      {/* 1. 预设选择与管理 */}
      {showPreset && (
        <PresetSelectorSection
          settings={settings}
          activeBundleId={activeBundleId}
          handleImportPresetJSON={handleImportPresetJSON}
          handleExportPresetJSON={handleExportPresetJSON}
          handleSaveNewPresetBundle={handleSaveNewPresetBundle}
          handleLoadPresetBundle={handleLoadPresetBundle}
          handleDeletePresetBundle={handleDeletePresetBundle}
        />
      )}

      {/* 2. 温度与采样参数 */}
      {showSamplers && (
        <SamplersSection
          settings={settings}
          updateSettings={updateSettings}
          isSamplersFolded={isSamplersFolded}
          handleToggleSamplersFold={handleToggleSamplersFold}
        />
      )}

      {/* 3. 提示词配置（核心 + 自定义模组） */}
      {showPrompts && (
        <PromptsConfigSection
          settings={settings}
          updateSettings={updateSettings}
          promptCompositionPreview={promptCompositionPreview}
          settingsSaveState={settingsSaveState}
          settingsLastSavedAt={settingsLastSavedAt}
          handleToggleCustomPrompt={handleToggleCustomPrompt}
          handleUpdateCustomPrompt={handleUpdateCustomPrompt}
          handleAddNewCustomPrompt={handleAddNewCustomPrompt}
          handleDeleteCustomPrompt={handleDeleteCustomPrompt}
          isPromptsFolded={isPromptsFolded}
          handleTogglePromptsFold={handleTogglePromptsFold}
          coreStatusText={coreStatusText}
          activeCustomPrompts={activeCustomPrompts}
          selectedPromptIds={selectedPromptIds}
          setSelectedPromptIds={setSelectedPromptIds}
          isBatchDeletingPrompts={isBatchDeletingPrompts}
          setIsBatchDeletingPrompts={setIsBatchDeletingPrompts}
          handleBatchDeletePrompts={handleBatchDeletePrompts}
        />
      )}

      {/* 横屏专注模式只挂载编排器本体，不展示设置分类、正则或外层卡片。 */}
      {showComposer && (
        <PromptCompositionEditor
          settings={settings}
          updateSettings={updateSettings}
          preview={promptCompositionPreview}
          saveState={settingsSaveState}
          lastSavedAt={settingsLastSavedAt}
        />
      )}

      {/* 4. 正则过滤脚本管理（全局 / 预设 / 角色只读 + 编辑 Modal） */}
      {showRegex && (
        <RegexManagementSection
          settings={settings}
          activeCharacter={activeCharacter}
          isRegexFolded={isRegexFolded}
          handleToggleRegexFold={handleToggleRegexFold}
          activeGlobalRegex={activeGlobalRegex}
          activePresetRegex={activePresetRegex}
          activeCharRegex={activeCharRegex}
          selectedGlobalRegexIds={selectedGlobalRegexIds}
          setSelectedGlobalRegexIds={setSelectedGlobalRegexIds}
          selectedPresetRegexIds={selectedPresetRegexIds}
          setSelectedPresetRegexIds={setSelectedPresetRegexIds}
          isBatchDeletingGlobalRegex={isBatchDeletingGlobalRegex}
          setIsBatchDeletingGlobalRegex={setIsBatchDeletingGlobalRegex}
          isBatchDeletingPresetRegex={isBatchDeletingPresetRegex}
          setIsBatchDeletingPresetRegex={setIsBatchDeletingPresetRegex}
          handleBatchDeleteGlobalRegex={handleBatchDeleteGlobalRegex}
          handleBatchDeletePresetRegex={handleBatchDeletePresetRegex}
          editingRegex={editingRegex}
          setEditingRegex={setEditingRegex}
          isRegexModalOpen={isRegexModalOpen}
          setIsRegexModalOpen={setIsRegexModalOpen}
          toggleRegexDisabled={toggleRegexDisabled}
          deleteRegex={deleteRegex}
          saveRegex={saveRegex}
        />
      )}
    </div>
  );
}
