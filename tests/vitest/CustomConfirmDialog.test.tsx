import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CustomConfirmDialog from "../../src/components/CustomConfirmDialog";

const callbacks = vi.hoisted(() => ({
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  onConfirmPrompt: vi.fn(),
}));

const appState = vi.hoisted(() => ({
  customDialog: {
    isOpen: true,
    title: "确认删除",
    message: "这个操作需要确认。",
    type: "confirm" as "alert" | "confirm" | "prompt",
    inputType: "text" as "text" | "textarea" | "password",
    defaultValue: "",
    onCancel: callbacks.onCancel,
    onConfirm: callbacks.onConfirm,
    onConfirmPrompt: callbacks.onConfirmPrompt,
  },
}));

vi.mock("../../src/UnifiedAppContext", () => ({
  useUnifiedApp: (selector: (state: typeof appState) => unknown) => selector(appState),
}));

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("全局标准弹窗", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.customDialog.type = "confirm";
    appState.customDialog.defaultValue = "";
    appState.customDialog.message = "这个操作需要确认。";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("提供标准 dialog 语义，并支持 Escape 取消", async () => {
    render(<CustomConfirmDialog />);

    expect(screen.getByRole("dialog", { name: "确认删除" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(callbacks.onCancel).toHaveBeenCalledTimes(1));
  });

  it("输入弹窗按 Enter 提交当前值", () => {
    appState.customDialog.type = "prompt";
    appState.customDialog.defaultValue = "旧名称";
    render(<CustomConfirmDialog />);

    const input = screen.getByRole("textbox", { name: "确认删除" });
    fireEvent.change(input, { target: { value: "新名称" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(callbacks.onConfirmPrompt).toHaveBeenCalledWith("新名称");
  });

  it("提示弹窗可以复制完整消息且不会关闭弹窗", async () => {
    appState.customDialog.type = "alert";
    appState.customDialog.message = "发送失败：完整错误详情";
    render(<CustomConfirmDialog />);

    fireEvent.click(screen.getByRole("button", { name: "dialog.copy" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("发送失败：完整错误详情");
      expect(screen.getByRole("button", { name: "dialog.copied" })).toBeInTheDocument();
    });
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
  });

  it("确认弹窗不显示复制按钮", () => {
    render(<CustomConfirmDialog />);

    expect(screen.queryByRole("button", { name: "dialog.copy" })).not.toBeInTheDocument();
  });
});
