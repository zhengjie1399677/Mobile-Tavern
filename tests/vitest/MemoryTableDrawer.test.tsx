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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryTableDrawer } from "../../src/components/MemoryTableDrawer";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import type { ChatSession, TableMemorySheet } from "../../src/types";

// i18n 迁移后 MemoryTableDrawer 内部调用 useTranslation()，必须包裹 LanguageProvider。
// 统一通过 renderWithI18n 渲染，避免每个用例重复手写 wrapper。
const renderWithI18n = (ui: ReactElement) =>
  render(ui, { wrapper: ({ children }) => <LanguageProvider>{children}</LanguageProvider> });

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
  } as unknown as ChatSession;
}

describe("MemoryTableDrawer", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let saveSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    saveSession = vi.fn().mockResolvedValue(undefined);
    // LanguageProvider 默认走 navigator.language 检测，happy-dom 下为 en。
    // 测试断言基于中文文案，强制 localStorage 返回 zh-CN 以匹配断言。
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => (key === "mobile_tavern_language" ? "zh-CN" : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ------------------------------------------------------------------
  // 门控与基本渲染
  // ------------------------------------------------------------------

  it("isOpen=false 时返回 null（不渲染任何 DOM）", () => {
    const { container } = renderWithI18n(
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
    renderWithI18n(
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
    expect(screen.getByText(/记忆与状态中心/)).toBeInTheDocument();
    // 表格名称
    expect(screen.getByText("状态与关系")).toBeInTheDocument();
  });

  it("使用紧凑全高外壳，并为各类记忆保留独立标签", () => {
    const { container } = renderWithI18n(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={makeSession()}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
        enableAutoSummary={true}
        initialTab="table"
      />
    );

    expect(container.querySelector("[data-memory-drawer-surface]"))
      .toHaveAttribute("data-density", "compact");
    expect(screen.getByRole("tablist", { name: "记忆与状态分类" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "故事年表" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "状态数据" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "记忆词典" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "唤醒记忆" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "角色变量" })).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // 无表数据时的兜底（准则五向前兼容）
  // ------------------------------------------------------------------

  it("tableMemory 缺失时显示初始化提示", () => {
    const session = makeSession({ tableMemory: undefined });
    renderWithI18n(
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
    renderWithI18n(
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
    renderWithI18n(
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
    renderWithI18n(
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
    renderWithI18n(
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
    renderWithI18n(
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

    renderWithI18n(
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

  it("新增行时按 Schema 自动填充字段默认值", async () => {
    const session = makeSession();
    session.tableMemory![0].columnDefinitions = [
      { id: "character", name: "角色", type: "text", defaultValue: "NPC" },
      { id: "affinity", name: "好感度", type: "number", defaultValue: "50" },
      { id: "status", name: "当前状态", type: "enum", defaultValue: "稳定", enumOptions: ["稳定", "波动"] },
    ];
    renderWithI18n(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={session}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "添加新行" }));
    await waitFor(() => expect(saveSession).toHaveBeenCalledTimes(1));
    const savedSession: ChatSession = saveSession.mock.calls[0][0];
    expect(savedSession.tableMemory?.[0].rows.at(-1)).toEqual(["NPC", "50", "稳定"]);
  });

  it("表结构编辑可持久化字段类型、默认值并保留旧列数据", async () => {
    const session = makeSession();
    renderWithI18n(
      <MemoryTableDrawer
        isOpen={true}
        onClose={onClose}
        activeSession={session}
        saveSession={saveSession}
        charName="Alice"
        enableTableMemory={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "⚙️ 管理" }));
    fireEvent.click(screen.getByTitle("编辑表结构"));
    const typeSelectors = screen.getAllByLabelText("字段类型");
    fireEvent.change(typeSelectors[1], { target: { value: "number" } });
    const defaultInputs = screen.getAllByLabelText("默认值");
    fireEvent.change(defaultInputs[1], { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => expect(saveSession).toHaveBeenCalledTimes(1));
    const savedSheet = (saveSession.mock.calls[0][0] as ChatSession).tableMemory?.[0];
    expect(savedSheet?.columnDefinitions?.[1]).toMatchObject({
      name: "好感度",
      type: "number",
      defaultValue: "50",
    });
    expect(savedSheet?.rows[0][0]).toBe("Alice");
    expect(savedSheet?.rows[1][1]).toBe("30");
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
    renderWithI18n(
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
