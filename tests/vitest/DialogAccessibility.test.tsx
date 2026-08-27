import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";

function AccessibleDialogHarness() {
  return (
    <Dialog>
      <DialogTrigger render={<button type="button" />}>打开设置</DialogTrigger>
      <DialogContent>
        <DialogTitle>界面设置</DialogTitle>
        <DialogDescription>用于验证移动端弹窗的键盘和读屏契约。</DialogDescription>
        <button type="button">第一个操作</button>
        <button type="button">最后一个操作</button>
      </DialogContent>
    </Dialog>
  );
}

describe("Base UI Dialog 可访问交互", () => {
  it("打开后进入弹窗，Tab 不离开弹窗，Escape 关闭并恢复触发器焦点", async () => {
    const user = userEvent.setup();
    render(<AccessibleDialogHarness />);

    const trigger = screen.getByRole("button", { name: "打开设置" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "界面设置" });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    const dialogButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
    expect(dialogButtons.length).toBeGreaterThanOrEqual(3);

    for (let index = 0; index < dialogButtons.length + 1; index++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "界面设置" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
