import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ThemeEditorModal from "../../src/components/ThemeEditorModal";
import type { ThemeStudioResourcePort } from "../../src/components/theme-studio/themeStudioResourcePort";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import type { LocalResourceMetadata } from "../../src/domain/resources/types";
import {
  dispatchMobileBack,
  resetMobileBackHandlersForTest,
} from "../../src/infrastructure/native/mobileBackNavigation";
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
    "--card-foreground": "#f5f5f5",
    "--primary": "#cccccc",
    "--primary-foreground": "#111111",
    "--border": "#333333",
    "--radius": "0.6rem",
  },
  customCss: "",
};

const RESOURCE: LocalResourceMetadata = {
  id: "r_audio",
  name: "rain.mp3",
  kind: "audio",
  mimeType: "audio/mpeg",
  size: 1024,
  createdAt: 0,
  updatedAt: 0,
};

function createResourcePort(): ThemeStudioResourcePort {
  return {
    listResources: vi.fn(async () => [RESOURCE]),
    importFile: vi.fn(async () => RESOURCE),
    getObjectUrl: vi.fn(async () => "blob:rain"),
    getResourceReference: vi.fn((id: string) => `tavern-resource://${id}`),
  };
}

function renderEditor(
  overrides: Partial<React.ComponentProps<typeof ThemeEditorModal>> = {},
): React.ComponentProps<typeof ThemeEditorModal> {
  const props: React.ComponentProps<typeof ThemeEditorModal> = {
    isOpen: true,
    onClose: vi.fn(),
    themeToEdit: THEME,
    customThemes: [THEME],
    onSave: vi.fn(async () => undefined),
    showCustomAlert: vi.fn(async () => undefined),
    showCustomConfirm: vi.fn(async () => true),
    resourcePort: createResourcePort(),
    mediaPermissionEnabled: true,
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

async function openInteractions(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "交互与媒体" }));
}

describe("主题工作室 Theme 1.1 可视化编辑", () => {
  beforeEach(() => {
    resetMobileBackHandlersForTest();
    localStorage.clear();
  });

  it("可视化添加状态、媒体与规则并保存为 Theme 1.1", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (_pkg: CustomThemePackage, _applyAfterSave: boolean) => undefined);
    renderEditor({ onSave });
    await openInteractions();

    expect(await screen.findByText("Theme 1.0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加状态" }));
    await waitFor(() => expect(screen.getAllByText(/state-false/).length).toBeGreaterThan(0));
    expect(screen.getByText("Theme 1.1")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("option", { name: "rain.mp3" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("本地资源"), RESOURCE.id);
    await user.click(screen.getByRole("button", { name: "添加媒体" }));
    expect(await screen.findByText("media")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加规则" }));
    expect(await screen.findByText("编辑规则")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回规则列表" }));
    expect(await screen.findByText("rule")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存主题" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as CustomThemePackage;
    expect(saved.schemaVersion).toBe("1.1");
    expect(Object.keys(saved.media ?? {})).toHaveLength(1);
    expect(Object.keys(saved.state ?? {})).toHaveLength(1);
    expect(saved.interactions).toHaveLength(1);
    expect(onSave.mock.calls[0][1]).toBe(false);
  });

  it("初始非法 JSON 不会提供清空数据的丢弃按钮", async () => {
    const user = userEvent.setup();
    const brokenTheme: CustomThemePackage = {
      ...THEME,
      schemaVersion: "1.1",
      interactions: [{ id: "bad" }] as unknown as CustomThemePackage["interactions"],
    };
    renderEditor({ themeToEdit: brokenTheme, customThemes: [brokenTheme] });
    await openInteractions();

    expect(await screen.findByText(/当前 JSON 无法解析/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "丢弃非法 JSON，继续可视化编辑" })).not.toBeInTheDocument();
    expect(screen.getByText(/没有可恢复的上次有效状态/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "去修复 JSON" }));
    expect(await screen.findByLabelText("主题受限交互 JSON")).toBeInTheDocument();
  });

  it("同一会话内改坏 JSON 后丢弃会恢复上次可视化配置", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openInteractions();

    await user.click(screen.getByRole("button", { name: "添加状态" }));
    await waitFor(() => expect(screen.getAllByText(/state-false/).length).toBeGreaterThan(0));

    await user.click(screen.getByRole("tab", { name: "高级 JSON" }));
    const textarea = screen.getByLabelText("主题受限交互 JSON");
    fireEvent.change(textarea, {
      target: { value: '{"media":{},"state":{},"interactions":[{"id":"bad"}]}' },
    });
    await user.click(screen.getByRole("tab", { name: "可视化" }));

    expect(await screen.findByText(/当前 JSON 无法解析/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "丢弃非法 JSON，继续可视化编辑" }));

    await waitFor(() => expect(screen.queryByText(/当前 JSON 无法解析/)).not.toBeInTheDocument());
    expect(screen.getAllByText(/state-false/).length).toBeGreaterThan(0);
  });

  it("规则 ID 重命名时仍停留在同一条规则", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openInteractions();

    await user.click(screen.getByRole("button", { name: "添加规则" }));
    expect(await screen.findByText("编辑规则")).toBeInTheDocument();

    const idInput = screen.getByLabelText("规则 ID");
    await user.clear(idInput);
    await user.type(idInput, "renamed-rule");
    expect(screen.getByText("编辑规则")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回规则列表" }));
    expect(await screen.findByText("renamed-rule")).toBeInTheDocument();
  });

  it("冷却输入可以正常输入多位数", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openInteractions();

    await user.click(screen.getByRole("button", { name: "添加规则" }));
    const cooldown = screen.getByLabelText("冷却（毫秒）");
    await user.clear(cooldown);
    await user.type(cooldown, "500");
    await user.tab();
    expect(cooldown).toHaveValue(500);
  });

  it("规则详情的返回优先于工作室分区返回", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openInteractions();

    await user.click(screen.getByRole("button", { name: "添加规则" }));
    expect(await screen.findByText("编辑规则")).toBeInTheDocument();

    await act(async () => {
      dispatchMobileBack();
    });
    await waitFor(() => expect(screen.queryByText("编辑规则")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "添加规则" })).toBeInTheDocument();

    await act(async () => {
      dispatchMobileBack();
    });
    await waitFor(() => expect(screen.getByText("编辑主题草稿")).toBeInTheDocument());
  });
});
