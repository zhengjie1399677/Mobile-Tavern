// 回归：已启用外部能力源（MCP）对"已有会话"立即生效。
//
// 组合快照在会话建立时冻结；如果发送链路只读冻结快照里的 tool 列表，
// 用户在工作台启用 MCP 后，老会话里模型永远看不到工具
//（"测试调用正常、正文聊天根本调用不了一点"）。
// 外部来源是用户显式启用的实时能力，必须叠加。
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
  it("冻结会话也会叠加当前已启用的外部来源工具", () => {
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

    expect(names).toEqual(["session.branch", "mcp.wiki.search"]);
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
