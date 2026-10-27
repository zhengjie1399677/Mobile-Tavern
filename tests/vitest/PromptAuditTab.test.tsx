import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { PromptAuditTab } from "../../src/components/memory-drawer/PromptAuditTab";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import type { PromptAuditSnapshot } from "../../src/domain/promptAudit";

const renderWithI18n = (ui: ReactElement) =>
  render(ui, { wrapper: ({ children }) => <LanguageProvider>{children}</LanguageProvider> });

function snapshot(overrides: Partial<PromptAuditSnapshot> = {}): PromptAuditSnapshot {
  return {
    version: 1,
    sessionId: "s1",
    capturedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    generationType: "normal",
    lorebook: {
      budgetChars: 24000,
      candidateCount: 3,
      entries: [
        {
          id: "常驻",
          title: "世界背景",
          source: "character",
          trigger: "constant",
          keys: [],
          chars: 120,
          content: "世界背景正文：艾尔德兰大陆常年被雾气笼罩。",
        },
        {
          id: "城门",
          title: "城门",
          source: "global",
          trigger: "keyword",
          matchedKey: "城门",
          keys: ["城门", "守卫"],
          chars: 80,
          content: "城门正文：暮色里守卫换岗。",
        },
      ],
      budgetDropped: [{ id: "长文", title: "长文", chars: 9000 }],
    },
    prompt: {
      sections: [
        { id: "system", title: "系统提示词", phase: "system", chars: 40, content: "系统正文" },
      ],
      systemChars: 40,
      historyChars: 200,
      userInputChars: 12,
    },
    ...overrides,
  };
}

describe("PromptAuditTab", () => {
  it("没有快照时给出明确空态", () => {
    renderWithI18n(<PromptAuditTab audit={null} />);
    expect(screen.getByText(/还没有组装记录|No assembly recorded/)).toBeInTheDocument();
  });

  it("展示世界书命中来源、触发原因与预算裁剪", () => {
    renderWithI18n(<PromptAuditTab audit={snapshot()} />);

    expect(screen.getByText("世界背景")).toBeInTheDocument();
    // 断言走翻译后的文案，兼容默认语言为英文的测试环境
    expect(screen.getByText(/^(常驻|Constant)$/)).toBeInTheDocument();
    expect(screen.getByText(/关键词：城门|Keyword: 城门/)).toBeInTheDocument();
    expect(screen.getByText(/^(角色|Character)$/)).toBeInTheDocument();
    expect(screen.getByText(/^(全局|Global)$/)).toBeInTheDocument();
    expect(screen.getByText(/预算不足，1 条未注入|Over budget: 1/)).toBeInTheDocument();
    expect(screen.getByText(/命中 2 \/ 候选 3|2 of 3 candidates/)).toBeInTheDocument();
  });

  it("世界书条目默认收起，点击后展开正文，可同时展开多条", () => {
    renderWithI18n(<PromptAuditTab audit={snapshot()} />);

    expect(screen.queryByText(/艾尔德兰大陆常年被雾气笼罩/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "世界背景" }));
    fireEvent.click(screen.getByRole("button", { name: "城门" }));
    expect(screen.getByText(/艾尔德兰大陆常年被雾气笼罩/)).toBeInTheDocument();
    expect(screen.getByText(/暮色里守卫换岗/)).toBeInTheDocument();

    // 再点一次收起，且不影响另一条
    fireEvent.click(screen.getByRole("button", { name: "世界背景" }));
    expect(screen.queryByText(/艾尔德兰大陆常年被雾气笼罩/)).not.toBeInTheDocument();
    expect(screen.getByText(/暮色里守卫换岗/)).toBeInTheDocument();
  });

  it("分区默认收起，点击后展开正文", () => {
    renderWithI18n(<PromptAuditTab audit={snapshot()} />);

    expect(screen.queryByText("系统正文")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /系统提示词|Prompt sections|system/i }));
    expect(screen.getByText("系统正文")).toBeInTheDocument();
  });
});
