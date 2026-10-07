// 回归：会话可用工具解析。
//
// 用户定稿（2026-10-07）：MCP 只允许在聊天界面里手动强制调用，
// 不向模型暴露任何外部来源工具；这里钉住"mcp.* 永远被过滤"的边界。
import { describe, expect, it, vi } from "vitest";
import { resolveSessionEnabledToolNames } from "../../src/application/useCases/sessionToolComposition";
import { KernelServices } from "../../src/application/serviceContracts";
import type { AgentCompositionSnapshot } from "../../src/domain/agents/contracts";
import type { IKernel } from "../../src/kernel/types";

function createSnapshot(): AgentCompositionSnapshot {
  return {
    profileId: "builtin-tavern",
    profileVersion: 3,
    pluginVersions: {},
    providerBindings: {},
    contributionOrder: { tool: ["session.branch"] },
    capabilityDecisions: {},
  };
}

describe("resolveSessionEnabledToolNames", () => {
  it("外部来源工具永远不暴露给模型（只允许聊天里手动调用）", () => {
    const extendComposition = vi.fn((snapshot: AgentCompositionSnapshot) => ({
      ...snapshot,
      contributionOrder: {
        ...snapshot.contributionOrder,
        tool: [...snapshot.contributionOrder.tool, "mcp.wiki.search"],
      },
    }));
    const toolConnectorsExtend = vi.fn();
    const kernel = {
      hasService: (name: string) =>
        name === KernelServices.ExternalSources
        || name === KernelServices.ToolConnectors
        || name === KernelServices.AgentRuntime,
      getService: (name: string) => {
        if (name === KernelServices.ExternalSources) return { extendComposition };
        if (name === KernelServices.ToolConnectors) return { extendComposition: toolConnectorsExtend };
        if (name === KernelServices.AgentRuntime) {
          return { getCompositionSnapshot: () => createSnapshot() };
        }
        throw new Error(`unexpected service ${name}`);
      },
    } as unknown as IKernel;

    const names = resolveSessionEnabledToolNames({
      kernel,
      character: { id: "char-1" } as never,
      sessionComposition: createSnapshot(),
    });

    // mcp.* 被过滤：即使组合里叠加了外部来源，模型也拿不到，避免自行调用与提示词污染。
    expect(names).toEqual(["session.branch"]);
    expect(extendComposition).toHaveBeenCalledTimes(1);
    // 冻结快照不得再叠加 Tool 插件贡献（保持会话安全边界）。
    expect(toolConnectorsExtend).not.toHaveBeenCalled();
  });

  it("直连 API 角色不暴露任何工具", () => {
    const kernel = {
      hasService: () => true,
      getService: () => ({
        getCompositionSnapshot: () => createSnapshot(),
        extendComposition: (snapshot: unknown) => snapshot,
      }),
    } as unknown as IKernel;

    expect(resolveSessionEnabledToolNames({
      kernel,
      character: { id: "base-agent-builtin", agentMode: "direct-api" } as never,
      sessionComposition: createSnapshot(),
    })).toEqual([]);
  });
});
