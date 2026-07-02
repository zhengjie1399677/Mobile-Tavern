/**
 * MemoryTableDrawer 纯 Props 驱动组件渲染测试
 *
 * 本组件零 Context 依赖，是最适合做 @testing-library/react 组件测试的目标。
 * 覆盖：
 * - isOpen 门控闭合
 * - 默认状态（无表格数据时的初始化提示）
 * - 有数据时的表格渲染
 * - 单元格编辑 → saveSession 回调验证
 * - 空字段/缺失 tableMemory 的兜底（准则五向前兼容）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryTableDrawer } from "../../src/components/MemoryTableDrawer";
import type { ChatSession, TableMemorySheet } from "../../src/types";

// 构建含活跃表格数据的测试会话
function makeSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: "sess-test-1",
    characterId: "char-1",
    title: "测试对话",
    createdAt: Date.now(),
    messages: [],
    summaries: [],
    variables: {},
    tableMemory: [
      {
        id: "sheet_1",
        name: "状态与关系",
        columns: ["角色", "好感度", "当前状态"],
        rows: [
          ["Alice", "50", "初次相识"],
          ["Bob", "30", "陌生人"],
        ],
        enable: true,
        description: "关系状态表",
      },
    ],
    ...overrides,
  } as any as ChatSession;
}

describe("MemoryTableDrawer", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let saveSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    saveSession = vi.fn().mockResolvedValue(undefined);
  });

  // ------------------------------------------------------------------
  // 门控与基本渲染
  // ------------------------------------------------------------------

  it("isOpen=false 时返回 null（不渲染任何 DOM）", () => {
    const { container } = render(
      <MemoryTableDrawer
        isOpen={false}
        onClose={onClose}
        activeSession={makeSession()}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("isOpen=true 时渲染抽屉面板", () => {
    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={makeSession()}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );
    // 标题标记
    expect(screen.getByText(/多维认知记忆中心/)).toBeInTheDocument();
    // 表格名称
    expect(screen.getByText("状态与关系")).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // 无表数据时的兜底（准则五向前兼容）
  // ------------------------------------------------------------------

  it("tableMemory 缺失时显示初始化提示", () => {
    const session = makeSession({ tableMemory: undefined });
    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={session}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );
    expect(screen.getByText("请先初始化表格记忆功能")).toBeInTheDocument();
    expect(screen.getByText("一键初始化")).toBeInTheDocument();
  });

  it("tableMemory 为空数组时显示初始化提示", () => {
    const session = makeSession({ tableMemory: [] });
    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={session}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );
    expect(screen.getByText("请先初始化表格记忆功能")).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // 有数据表格渲染
  // ------------------------------------------------------------------

  it("有数据时渲染表头列名", () => {
    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={makeSession()}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );
    expect(screen.getByText("角色")).toBeInTheDocument();
    expect(screen.getByText("好感度")).toBeInTheDocument();
    expect(screen.getByText("当前状态")).toBeInTheDocument();
  });

  it("有数据时渲染数据行", () => {
    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={makeSession()}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("初次相识")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("数据行为空时显示空状态占位", () => {
    const emptySheet: TableMemorySheet = {
      id: "empty_sheet",
      name: "空表",
      columns: ["A", "B"],
      rows: [],
      enable: true,
      description: "无数据",
    };
    const session = makeSession({ tableMemory: [emptySheet] });
    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={session}
        saveSession={saveSession}
        charName="Test"
        enableTableMemory={true}
      />
    );
    expect(screen.getByText("暂无记录数据，点击下方添加按钮新增一行")).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // 关闭回调
  // ------------------------------------------------------------------

  it("点击关闭按钮触发 onClose", () => {
    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={makeSession()}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );
    // 关闭按钮在 header 中（管理按钮之后），无文本，仅含 X 图标
    const allButtons = screen.getAllByRole("button");
    // header 区域有两个按钮：管理 + X关闭
    const closeBtn = allButtons.find(btn => btn.innerHTML.includes("lucide-x"));
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------
  // 单元格编辑 → saveSession
  // ------------------------------------------------------------------

  it("点击单元格进入编辑模式，修改值并保存后调用 saveSession 传入正确数据", async () => {
    const session = makeSession();
    saveSession.mockResolvedValue(undefined);

    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={session}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );

    // 点击 "Alice" 单元格进入编辑模式
    const aliceCell = screen.getByText("Alice");
    fireEvent.click(aliceCell);

    // 编辑模式出现 input 与确认按钮
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Alice");

    // 修改值
    await userEvent.clear(input);
    await userEvent.type(input, "Alice Updated");

    // 点击确认按钮（Check 图标）- 按钮使用 onMouseDown + preventDefault 阻止 blur
    const checkButtons = screen.getAllByRole("button");
    const checkBtn = checkButtons.find(btn => btn.innerHTML.includes("lucide-check"));
    expect(checkBtn).toBeTruthy();
    fireEvent.mouseDown(checkBtn!);

    // 断言 saveSession 被调用
    await waitFor(() => {
      expect(saveSession).toHaveBeenCalledTimes(1);
    });

    // 断言传入的 session 含正确的更新值
    const savedSession: ChatSession = saveSession.mock.calls[0][0];
    const updatedSheet = savedSession.tableMemory?.[0];
    expect(updatedSheet?.rows[0][0]).toBe("Alice Updated");
    // 其他行未受影响
    expect(updatedSheet?.rows[1][0]).toBe("Bob");
  });

  // ------------------------------------------------------------------
  // 边界：缺失列/行的兜底
  // ------------------------------------------------------------------

  it("缺失行时 cells 缺位留空不抛错", () => {
    const partialRowSheet: TableMemorySheet = {
      id: "partial",
      name: "缺列表",
      columns: ["A", "B", "C"],
      rows: [["仅一列"]], // 只给了 1 列，后2列缺位
      enable: true,
      description: "",
    };
    const session = makeSession({ tableMemory: [partialRowSheet] });
    render(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={session}
        saveSession={saveSession}
        charName="Test"
        enableTableMemory={true}
      />
    );
    // 应正常渲染，不崩溃
    expect(screen.getByText("仅一列")).toBeInTheDocument();
  });
});
