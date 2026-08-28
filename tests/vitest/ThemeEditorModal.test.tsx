import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ThemeEditorModal from "../../src/components/ThemeEditorModal";
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
  render(<ThemeEditorModal {...props} />);
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

  it("存在未保存修改时关闭会先确认", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const showCustomConfirm = vi.fn(async () => false);
    renderEditor({ onClose, showCustomConfirm });

    await user.click(screen.getByRole("button", { name: "外观" }));
    await user.type(screen.getByDisplayValue("测试主题"), "修改");
    await user.click(screen.getByRole("button", { name: "返回主题工作室" }));
    await user.click(screen.getByRole("button", { name: "关闭主题工作室" }));

    await waitFor(() => expect(showCustomConfirm).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });
});
