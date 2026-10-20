import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ThemeEditorModal from "../../src/components/ThemeEditorModal";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import type { CustomThemePackage } from "../../src/utils/themePackage";

const THEME: CustomThemePackage = {
  schemaVersion: "1.0",
  id: "custom_test",
  importedAt: 100,
  name: "测试主题",
  version: "1.0.0",
  isDark: true,
  variables: {
    "--background": "#111111",
    "--foreground": "#f5f5f5",
    "--card": "#181818",
    "--primary": "#cccccc",
    "--border": "#333333",
    "--radius": "0.6rem",
  },
};

function renderEditor(overrides: Partial<React.ComponentProps<typeof ThemeEditorModal>> = {}) {
  const props: React.ComponentProps<typeof ThemeEditorModal> = {
    isOpen: true,
    onClose: vi.fn(),
    themeToEdit: THEME,
    customThemes: [THEME],
    onSave: vi.fn(async () => undefined),
    showCustomAlert: vi.fn(async () => undefined),
    showCustomConfirm: vi.fn(async () => true),
    ...overrides,
  };
  localStorage.setItem("mobile_tavern_language", "zh-CN");
  render(
    <LanguageProvider>
      <ThemeEditorModal {...props} />
    </LanguageProvider>,
  );
  return props;
}

describe("主题工作室", () => {
  afterEach(() => {
    document.documentElement.setAttribute("data-theme", "ocean");
  });

  it("以全屏工作室打开，并提供隔离草稿预览", async () => {
    document.documentElement.setAttribute("data-theme", "ocean");
    renderEditor();

    expect(await screen.findByRole("dialog", { name: "主题工作室" })).toBeInTheDocument();
    expect(screen.getByLabelText("主题草稿预览")).toHaveAttribute("data-theme", "custom_theme_studio_preview");
    expect(screen.getByText("隔离预览，不改变正式主题")).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "ocean");
  });

  it("编辑草稿不会切换全局主题，保存与应用是两个动作", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    renderEditor({ onSave });

    await user.click(screen.getByRole("button", { name: "外观" }));
    const nameInput = screen.getByDisplayValue("测试主题");
    await user.clear(nameInput);
    await user.type(nameInput, "新名称");
    expect(document.documentElement).not.toHaveAttribute("data-theme", "custom_theme_studio_preview");

    await user.click(screen.getByRole("button", { name: "保存主题" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenNthCalledWith(1, expect.any(Object), false);
    expect(screen.getByRole("dialog", { name: "外观" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存并应用" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenNthCalledWith(2, expect.any(Object), true);
  });

  it("从颜色分区进入预览后，返回会回到颜色分区而不是工作室首页", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "颜色" }));
    expect(screen.getByRole("dialog", { name: "颜色" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览" }));
    expect(await screen.findByRole("dialog", { name: "预览当前草稿" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回上一页" }));
    expect(await screen.findByRole("dialog", { name: "颜色" })).toBeInTheDocument();
  });

  it("新建主题可从浅色起点开始，并切换预览场景", async () => {
    const user = userEvent.setup();
    renderEditor({ themeToEdit: null, customThemes: [THEME] });

    expect(await screen.findByText("选择起点")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /空白浅色/ }));

    const previews = screen.getAllByLabelText("主题草稿预览");
    expect(previews).toHaveLength(1);
    expect(previews[0]).not.toHaveClass("dark");
    expect(previews[0]).toHaveAttribute("data-preview-scene", "chat");

    await user.click(screen.getByRole("button", { name: "预览" }));
    await user.click(screen.getAllByRole("tab", { name: "角色" })[0]);
    for (const preview of screen.getAllByLabelText("主题草稿预览")) {
      expect(preview).toHaveAttribute("data-preview-scene", "characters");
    }
  });

  it("颜色分区显示对比度检查，并能发现低对比度文本", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "颜色" }));
    expect(await screen.findByText("对比度检查")).toBeInTheDocument();
    expect(screen.getAllByText("通过").length).toBeGreaterThan(0);

    const foregroundInput = screen.getAllByDisplayValue("#f5f5f5").find(
      element => (element as HTMLInputElement).type === "text",
    ) as HTMLInputElement;
    await user.clear(foregroundInput);
    await user.type(foregroundInput, "#111111");
    expect(screen.getByLabelText("对比度检查")).toHaveTextContent("失败");
  });

  it("CSS 诊断给出行列并可点击定位，片段可插入", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "自定义 CSS" }));
    const textarea = screen.getByLabelText("自定义 CSS 文档") as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, "a {{");

    expect(await screen.findByText("CSS 诊断")).toBeInTheDocument();
    expect(screen.getByText("L1:3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /L1:3/ }));
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(3);

    await user.click(screen.getByRole("button", { name: /CSS 片段库/ }));
    await user.click(screen.getAllByRole("button", { name: "插入" })[0]);
    expect(textarea.value).toContain('[data-ui="main-tab-bar"]');
  });

  it("复制现有自定义主题会生成新 ID 的副本", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (_pkg: CustomThemePackage, _applyAfterSave: boolean) => undefined);
    renderEditor({ themeToEdit: null, customThemes: [THEME], onSave });

    await user.click(screen.getByRole("combobox", { name: "复制现有主题" }));
    await user.click(await screen.findByRole("option", { name: "测试主题" }));
    expect(await screen.findByText("测试主题 副本")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存主题" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as CustomThemePackage;
    expect(saved.id).not.toBe(THEME.id);
    expect(saved.name).toBe("测试主题 副本");
  });

  it("存在未保存修改时关闭会先确认", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const showCustomConfirm = vi.fn(async () => false);
    renderEditor({ onClose, showCustomConfirm });

    await user.click(screen.getByRole("button", { name: "外观" }));
    await user.type(screen.getByDisplayValue("测试主题"), "修改");
    await user.click(screen.getByRole("button", { name: "返回上一页" }));
    await user.click(screen.getByRole("button", { name: "关闭主题工作室" }));

    await waitFor(() => expect(showCustomConfirm).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });
});
