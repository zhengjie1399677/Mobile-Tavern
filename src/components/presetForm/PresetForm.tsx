import { useUnifiedApp } from "../../UnifiedAppContext";
import { usePresetFormState } from "./usePresetFormState";
import PresetSelectorSection from "./PresetSelectorSection";
import SamplersSection from "./SamplersSection";
import PromptsConfigSection from "./PromptsConfigSection";
import RegexManagementSection from "./RegexManagementSection";

/**
 * 预设表单组合根：
 * 从全局 Context 取出 settings/handlers，交给 usePresetFormState 集中管理局部状态，
 * 再向下分发给四个核心 Section 子组件（预设选择、采样参数、提示词配置、正则脚本）。
 */
export type PresetFormSection = "preset" | "samplers" | "prompts" | "regex";

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

  const {
    settings,
    updateSettings,
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleSaveCurrentPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    isActivePresetDirty,
    handleToggleCustomPrompt,
    handleUpdateCustomPrompt,
    handleAddNewCustomPrompt,
    handleDeleteCustomPrompt,
    showCustomConfirm,
    showCustomAlert,
    activeCharacter,
    saveCharacter,
  } = useUnifiedApp((state) => ({
    settings: state.settings,
    updateSettings: state.updateSettings,
    handleImportPresetJSON: state.handleImportPresetJSON,
    handleExportPresetJSON: state.handleExportPresetJSON,
    handleSaveNewPresetBundle: state.handleSaveNewPresetBundle,
    handleSaveCurrentPresetBundle: state.handleSaveCurrentPresetBundle,
    handleLoadPresetBundle: state.handleLoadPresetBundle,
    handleDeletePresetBundle: state.handleDeletePresetBundle,
    isActivePresetDirty: state.isActivePresetDirty,
    handleToggleCustomPrompt: state.handleToggleCustomPrompt,
    handleUpdateCustomPrompt: state.handleUpdateCustomPrompt,
    handleAddNewCustomPrompt: state.handleAddNewCustomPrompt,
    handleDeleteCustomPrompt: state.handleDeleteCustomPrompt,
    showCustomConfirm: state.showCustomConfirm,
    showCustomAlert: state.showCustomAlert,
    activeCharacter: state.activeCharacter,
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
    deleteBuiltinPrompt,
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

  return (
    <div className="space-y-2.5">
      {/* 1. 预设选择与管理 */}
      {showPreset && (
        <PresetSelectorSection
          settings={settings}
          activeBundleId={activeBundleId}
          isActivePresetDirty={isActivePresetDirty}
          handleImportPresetJSON={handleImportPresetJSON}
          handleExportPresetJSON={handleExportPresetJSON}
          handleSaveNewPresetBundle={handleSaveNewPresetBundle}
          handleSaveCurrentPresetBundle={handleSaveCurrentPresetBundle}
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

      {/* 3. 提示词配置（核心系统指令 + 模块化自定义库） */}
      {showPrompts && (
        <PromptsConfigSection
          settings={settings}
          updateSettings={updateSettings}
          handleToggleCustomPrompt={handleToggleCustomPrompt}
          handleUpdateCustomPrompt={handleUpdateCustomPrompt}
          handleAddNewCustomPrompt={handleAddNewCustomPrompt}
          handleDeleteCustomPrompt={handleDeleteCustomPrompt}
          handleDeleteBuiltinPrompt={deleteBuiltinPrompt}
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
