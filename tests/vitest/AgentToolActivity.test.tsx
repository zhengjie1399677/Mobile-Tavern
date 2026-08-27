import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AgentToolActivity from "../../src/tabs/chat/message-bubble/AgentToolActivity";
import { KernelProvider } from "../../src/contexts/KernelContext";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import type { IAgentRuntimeService } from "../../src/application/serviceContracts";
import type { AgentToolApprovalRequest } from "../../src/domain/agents/contracts";
import type { IKernel } from "../../src/kernel";

describe("AgentToolActivity", () => {
  it("在聊天内展示具体风险和参数，并只提交一次性审批决定", async () => {
    const request: AgentToolApprovalRequest = {
      id: "approval-1",
      sessionId: "session-1",
      turnId: "turn-1",
      callId: "call-1",
      toolName: "session.branch",
      description: "创建一个新的本地会话分支",
      arguments: { title: "新的分支" },
      riskLevel: "medium",
      sideEffect: "local-write",
      executionScope: "session",
      expiresAt: Date.now() + 60_000,
    };
    let pending = [request];
    const resolveToolApproval = vi.fn((_id: string, _decision: "allow" | "deny") => {
      pending = [];
      return true;
    });
    const runtime = {
      listPendingToolApprovals: () => pending,
      listJournalBySession: vi.fn().mockResolvedValue([]),
      subscribeToolApprovals: vi.fn(() => () => undefined),
      subscribeJournal: vi.fn(() => () => undefined),
      resolveToolApproval,
    } as unknown as IAgentRuntimeService;
    const kernel = {
      hasService: (name: string) => name === "agentRuntime",
      getService: () => runtime,
    } as unknown as IKernel;

    render(
      <LanguageProvider>
        <KernelProvider kernel={kernel}>
          <AgentToolActivity sessionId="session-1" />
        </KernelProvider>
      </LanguageProvider>,
    );

    expect(await screen.findByLabelText("等待审批：session.branch")).toBeInTheDocument();
    expect(screen.getByText(/中风险 · 写入本地数据 · 本地会话/)).toBeInTheDocument();
    expect(screen.getByText(/新的分支/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /允许一次/ }));

    expect(resolveToolApproval).toHaveBeenCalledWith("approval-1", "allow");
    await waitFor(() => expect(screen.queryByLabelText("等待审批：session.branch")).toBeNull());
  });
});
