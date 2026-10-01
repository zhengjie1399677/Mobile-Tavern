import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import CanvasPresetBanner from "../../src/components/presetForm/CanvasPresetBanner";
import WorkflowNodeLibraryDialog from "../../src/components/presetForm/WorkflowNodeLibraryDialog";
import {
  WORKFLOW_NODE_TEMPLATES,
  createBlockFromTemplate,
} from "../../src/components/presetForm/workflowNodeLibrary";
import {
  createBasicPromptComposition,
  parsePromptComposition,
  validatePromptComposition,
} from "../../src/domain/prompt-composition";
import type { PresetBundleV2 } from "../../src/domain/presets/contracts";

describe("WorkflowCanvasIntegration", () => {
  it("所有工作流节点模板均能生成通过领域校验的合法 Block", () => {
    const base = createBasicPromptComposition();
    for (const template of WORKFLOW_NODE_TEMPLATES) {
      const block = createBlockFromTemplate(template, base.blocks);
      expect(block.name).toBe(template.name);
      expect(block.role).toBe(template.role);
      expect(block.enabled).toBe(true);

      const compositionWithBlock = {
        ...base,
        blocks: [...base.blocks, block],
      };

      // 必须通过严苛的防腐反序列化校验
      expect(() => parsePromptComposition(compositionWithBlock)).not.toThrow();

      // 诊断不应包含致命错误
      const diagnostics = validatePromptComposition(compositionWithBlock);
      const errors = diagnostics.filter((d) => d.level === "error");
      expect(errors).toHaveLength(0);
    }
  });

  describe("CanvasPresetBanner", () => {
    const mockPresets: PresetBundleV2[] = [
      {
        schemaVersion: 2,
        id: "preset-1",
        isBuiltin: false,
        sampler: { id: "preset-1", name: "自定义探险预设", temperature: 0.8 },
        prompt: { version: 2, mode: "composition", source: "mobile-tavern" },
        regexScripts: [],
      },
      {
        schemaVersion: 2,
        id: "preset-builtin",
        isBuiltin: true,
        sampler: { id: "preset-builtin", name: "出厂标准预设", temperature: 0.7 },
        prompt: { version: 2, mode: "legacy", source: "mobile-tavern" },
        regexScripts: [],
      },
    ];

    it("正确展示当前预设名称、未保存修改标记并响应保存与另存为", async () => {
      const onSaveCurrentPreset = vi.fn();
      const onSaveNewPreset = vi.fn();
      const onSetMode = vi.fn();
      const t = (key: string) => key;

      render(
        <CanvasPresetBanner
          savedPresets={mockPresets}
          activeBundleId="preset-1"
          isActivePresetDirty={true}
          freeMode={true}
          onSetMode={onSetMode}
          onSaveCurrentPreset={onSaveCurrentPreset}
          onSaveNewPreset={onSaveNewPreset}
          t={t}
        />
      );

      expect(screen.getByText("当前预设:")).toBeInTheDocument();
      expect(screen.getByText("画布已修改")).toBeInTheDocument();

      const saveBtn = screen.getByRole("button", { name: "保存到预设" });
      fireEvent.click(saveBtn);
      expect(onSaveCurrentPreset).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(saveBtn).not.toBeDisabled());

      const saveAsBtn = screen.getByRole("button", { name: "另存为副本" });
      fireEvent.click(saveAsBtn);
      expect(onSaveNewPreset).toHaveBeenCalledTimes(1);
    });

    it("传统模式下展示升级为自由编排横幅，点击后触发 onSetMode(true)", () => {
      const onSetMode = vi.fn();
      const t = (key: string) => key;

      render(
        <CanvasPresetBanner
          savedPresets={mockPresets}
          activeBundleId="preset-builtin"
          isActivePresetDirty={false}
          freeMode={false}
          onSetMode={onSetMode}
          t={t}
        />
      );

      expect(screen.getByText("传统模式执行中")).toBeInTheDocument();
      const upgradeBtn = screen.getByRole("button", { name: "升级为自由编排" });
      fireEvent.click(upgradeBtn);
      expect(onSetMode).toHaveBeenCalledWith(true);
    });
  });

  describe("WorkflowNodeLibraryDialog", () => {
    it("正确渲染节点分类并支持选择模版", () => {
      const onSelectTemplate = vi.fn();
      const onOpenChange = vi.fn();

      render(
        <LanguageProvider>
          <WorkflowNodeLibraryDialog
            open={true}
            onOpenChange={onOpenChange}
            onSelectTemplate={onSelectTemplate}
          />
        </LanguageProvider>
      );

      expect(screen.getByRole("heading", { name: "添加工作流节点" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "人设与角色" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "上下文与记忆" })).toBeInTheDocument();

      // 点击添加第一个节点
      const addBtns = screen.getAllByRole("button", { name: "添加至画布" });
      expect(addBtns.length).toBeGreaterThan(0);
      fireEvent.click(addBtns[0]);

      expect(onSelectTemplate).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
