import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import {
  DEFAULT_QUICK_ACTION_MODULES,
  loadQuickActionModulesConfig,
  saveQuickActionModulesConfig,
  QUICK_ACTION_MODULES_STORAGE_KEY,
  type QuickActionModulesConfig,
} from "../../src/tabs/chat/composer-panels/quickActionTypes";
import { QuickActionManagerModal } from "../../src/tabs/chat/composer-panels/QuickActionManagerModal";

function renderWithLang(ui: React.ReactElement) {
  localStorage.setItem("mobile_tavern_language", "zh-CN");
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("快捷栏管理与模块配置 (Quick Action Bar Management)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("在没有任何缓存时加载出符合预期的默认配置 (重发/继续/预设/Token预测 默认开启)", () => {
    const config = loadQuickActionModulesConfig();
    expect(config).toEqual(DEFAULT_QUICK_ACTION_MODULES);
    expect(config.reroll).toBe(true);
    expect(config.continue).toBe(true);
    expect(config.preset).toBe(true);
    expect(config.token_predict).toBe(true);
    expect(config.tool).toBe(false);
    expect(config.mcp).toBe(false);
  });

  it("旧缓存开启超过 4 个模块时按优先级收敛，避免升级后突破上限", () => {
    localStorage.setItem(QUICK_ACTION_MODULES_STORAGE_KEY, JSON.stringify({
      reroll: true,
      continue: true,
      preset: true,
      token_predict: true,
      tool: true,
      mcp: true,
    }));

    const loaded = loadQuickActionModulesConfig();
    expect(Object.values(loaded).filter(Boolean)).toHaveLength(4);
    expect(loaded.tool).toBe(false);
    expect(loaded.mcp).toBe(false);

    saveQuickActionModulesConfig({
      reroll: true,
      continue: true,
      preset: true,
      token_predict: true,
      tool: true,
      mcp: true,
    });
    const stored = JSON.parse(localStorage.getItem(QUICK_ACTION_MODULES_STORAGE_KEY) ?? "{}") as QuickActionModulesConfig;
    expect(Object.values(stored).filter(Boolean)).toHaveLength(4);
  });

  it("能正确持久化与重新读取 6 个模块的自由开关配置", () => {
    const customConfig: QuickActionModulesConfig = {
      reroll: false,
      continue: true,
      preset: false,
      token_predict: false,
      tool: true,
      mcp: true,
    };
    saveQuickActionModulesConfig(customConfig);

    const loaded = loadQuickActionModulesConfig();
    expect(loaded).toEqual(customConfig);
    expect(loaded.reroll).toBe(false);
    expect(loaded.tool).toBe(true);
    expect(loaded.mcp).toBe(true);
  });

  it("平滑兼容旧版本存储的 token_actions 键", () => {
    localStorage.setItem(
      QUICK_ACTION_MODULES_STORAGE_KEY,
      JSON.stringify({ token_actions: false, mcp: true, tool: false, preset: false })
    );
    const loaded = loadQuickActionModulesConfig();
    expect(loaded.reroll).toBe(false);
    expect(loaded.continue).toBe(false);
    expect(loaded.token_predict).toBe(false);
    expect(loaded.mcp).toBe(true);
  });

  it("在 localStorage 包含损坏 JSON 时平滑回退到默认值而不抛出异常", () => {
    localStorage.setItem(QUICK_ACTION_MODULES_STORAGE_KEY, "{ damaged_json: true ");
    const loaded = loadQuickActionModulesConfig();
    expect(loaded).toEqual(DEFAULT_QUICK_ACTION_MODULES);
  });

  it("QuickActionManagerModal 正常渲染标题、总开关与 6 个功能模块卡片及 4 个上限控制", () => {
    const onClose = vi.fn();
    const onToggleQuickActionsVisible = vi.fn();
    const onUpdateModulesConfig = vi.fn();

    renderWithLang(
      <QuickActionManagerModal
        open={true}
        onClose={onClose}
        quickActionsVisible={true}
        onToggleQuickActionsVisible={onToggleQuickActionsVisible}
        modulesConfig={DEFAULT_QUICK_ACTION_MODULES}
        onUpdateModulesConfig={onUpdateModulesConfig}
      />
    );

    // 检查标题与说明
    expect(screen.getByText("快捷栏管理")).toBeInTheDocument();
    expect(screen.getAllByText("启用输入框快捷栏").length).toBeGreaterThanOrEqual(1);

    // 检查 6 个独立模块都在列表中渲染
    expect(screen.getAllByText("重新生成回复 (重发)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("继续推进剧情").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("预设调控 (Preset)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Token 实时预估").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("工具插件 (Tool)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("外部能力 (MCP)").length).toBeGreaterThanOrEqual(1);

    // 默认 4 个开启 (reroll + continue + preset + token_predict)
    expect(screen.getByText("4 / 4 已开启")).toBeInTheDocument();
    expect(screen.getByText(/最多同时开启 4 个快捷功能/)).toBeInTheDocument();
  });

  it("点击恢复默认按钮能重置 6 个模块与总开关", () => {
    const onClose = vi.fn();
    const onToggleQuickActionsVisible = vi.fn();
    const onUpdateModulesConfig = vi.fn();

    const customConfig: QuickActionModulesConfig = {
      reroll: false,
      continue: false,
      preset: false,
      token_predict: false,
      tool: true,
      mcp: true,
    };

    renderWithLang(
      <QuickActionManagerModal
        open={true}
        onClose={onClose}
        quickActionsVisible={false}
        onToggleQuickActionsVisible={onToggleQuickActionsVisible}
        modulesConfig={customConfig}
        onUpdateModulesConfig={onUpdateModulesConfig}
      />
    );

    const resetBtn = screen.getByRole("button", { name: /恢复默认/ });
    fireEvent.click(resetBtn);

    expect(onUpdateModulesConfig).toHaveBeenCalledWith(DEFAULT_QUICK_ACTION_MODULES);
    expect(onToggleQuickActionsVisible).toHaveBeenCalledWith(true);
  });
});
