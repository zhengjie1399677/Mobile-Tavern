import { useState } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import PromptsConfigSection from "../../src/components/presetForm/PromptsConfigSection";
import { listPromptCompositionScenePresets } from "../../src/domain/prompt-composition";
import { useCustomPrompts } from "../../src/hooks/settings/useCustomPrompts";
import { preparePresetBundleImport } from "../../src/application/useCases/preparePresetBundleImport";
import { testSillyTavernCompatibilityCodec } from "../fixtures/sillyTavernCompatibilityCodec";

afterEach(cleanup);

it("场景主提示词连续编辑后仍发送最新正文，且可以关闭", () => {
  let latest = structuredClone(DEFAULT_SETTINGS);
  latest.promptConfig.mainPrompt = "原始内容";
  latest.promptConfig.useMainPrompt = true;
  latest.promptConfig.useJailbreak = false;
  latest.promptConfig.jailbreakPrompt = "";
  latest.promptConfig.customPrompts = [];
  latest.promptConfig.usePromptComposition = true;
  latest.promptConfig.composition = listPromptCompositionScenePresets()[0].composition;
  function Harness() {
    const [settings, setSettings] = useState(latest);
    latest = settings;
    return <LanguageProvider><PromptsConfigSection
      settings={settings} updateSettings={setSettings}
      handleToggleCustomPrompt={vi.fn()} handleUpdateCustomPrompt={vi.fn()}
      handleAddNewCustomPrompt={vi.fn()} handleDeleteCustomPrompt={vi.fn(async () => undefined)}
      isPromptsFolded={false} handleTogglePromptsFold={vi.fn()} coreStatusText="1/1"
      activeCustomPrompts={0} selectedPromptIds={[]} setSelectedPromptIds={vi.fn()}
      isBatchDeletingPrompts={false} setIsBatchDeletingPrompts={vi.fn()}
      handleBatchDeletePrompts={vi.fn(async () => undefined)}
    /></LanguageProvider>;
  }
  localStorage.setItem("mobile_tavern_language", "zh-CN");
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: /展开或折叠.*底层扮演/ }));
  const textarea = screen.getByPlaceholderText("在此输入提示词文本内容...");
  fireEvent.change(textarea, { target: { value: "第一次编辑" } });
  fireEvent.change(textarea, { target: { value: "第二次编辑" } });
  const block = latest.promptConfig.composition!.blocks.find(b => b.id === "light_main")!;
  expect(block.template.replace("{{prompt.main}}", latest.promptConfig.mainPrompt)).toBe("第二次编辑");
  fireEvent.click(screen.getByRole("switch", { name: /启用提示词.*底层扮演/ }));
  expect(latest.promptConfig.composition!.blocks.find(b => b.id === "light_main")!.enabled).toBe(false);
});

it("重命名导入的角色描述 Marker 保留动态数据源，显式编辑正文才替换模板", () => {
  const initial = structuredClone(DEFAULT_SETTINGS);
  const prepared = preparePresetBundleImport({
    input: { prompts: [{ identifier: "charDescription", name: "角色描述", role: "system", marker: true, content: "" }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: "charDescription", enabled: true }] }] },
    fallbackName: "Marker", currentPromptConfig: initial.promptConfig, compatibilityCodec: testSillyTavernCompatibilityCodec,
  });
  initial.promptConfig = { ...initial.promptConfig, ...prepared.bundle.promptConfig, composition: prepared.composition, usePromptComposition: true };
  expect(initial.promptConfig.composition!.blocks[0].template).toBe("{{character.description}}");
  let latest = initial;
  const { result } = renderHook(() => useCustomPrompts({ settings: initial,
    updateSettings: updater => { latest = typeof updater === "function" ? updater(latest) : updater; },
    setExpandedPromptIds: vi.fn(), showCustomConfirm: vi.fn(async () => true) }));
  const prompt = initial.promptConfig.customPrompts![0];
  act(() => result.current.handleUpdateCustomPrompt(prompt.id, "新的描述名称", prompt.role, prompt.content));
  expect(latest.promptConfig.composition!.blocks[0].template).toBe("{{character.description}}");
  expect(latest.promptConfig.composition!.blocks[0].name).toBe("新的描述名称");
  act(() => result.current.handleUpdateCustomPrompt(prompt.id, "新的描述名称", prompt.role, "主动替换正文"));
  expect(latest.promptConfig.composition!.blocks[0].template).toBe("主动替换正文");
});
