/**
 * P0 回归：Profile 可挂载工具目录必须同时咨询所有能力提供方。
 *
 * 修复前的缺陷：只问 Tool Plugin，导致外部能力源（MCP）的工具在「运行模式」页里不可见，
 * 用户无法挂载 → extendComposition 按 toolMounts 过滤后模型永远拿不到这些工具。
 */
import { describe, expect, it } from "vitest";
import type { IKernel } from "@/src/kernel/types";
import { KernelServices } from "@/src/application/serviceContracts";
import {
  listAllKnownTools,
  listToolsForProfile,
} from "@/src/application/useCases/profileToolCatalogUseCases";
import {
  CHARACTER_READ_TOOL_NAME,
  SESSION_BRANCH_TOOL_NAME,
} from "@/src/application/tools/builtinAgentTools";

function stubKernel(services: Record<string, unknown>): IKernel {
  return {
    hasService: (name: string) => Object.prototype.hasOwnProperty.call(services, name),
    getService: (name: string) => services[name],
  } as unknown as IKernel;
}

const agentRuntime = (names: readonly string[]) => ({
  listTools: () => names.map((name) => ({ name, version: "1.0.0" })),
});

const provider = (names: readonly string[]) => ({
  getEnabledToolNames: (_profileId: string) => [...names],
});

const names = (kernel: IKernel, profileId = "mobile-tavern.base") =>
  listToolsForProfile(kernel, profileId).map((tool) => tool.name);

describe("Profile 可挂载工具目录", () => {
  it("无任何能力服务时只提供内建工具", () => {
    expect(names(stubKernel({}))).toEqual([
      CHARACTER_READ_TOOL_NAME,
      SESSION_BRANCH_TOOL_NAME,
    ]);
  });

  it("Tool Plugin 启用的工具可见", () => {
    const kernel = stubKernel({
      [KernelServices.AgentRuntime]: agentRuntime(["ext.example.weather.get"]),
      [KernelServices.ToolConnectors]: provider(["ext.example.weather.get"]),
    });
    expect(names(kernel)).toContain("ext.example.weather.get");
  });

  it("外部能力源（MCP）的工具同样可见（本次修复点）", () => {
    const kernel = stubKernel({
      [KernelServices.AgentRuntime]: agentRuntime([
        "mcp.deepwiki.search",
        "mcp.deepwiki.resources.read",
      ]),
      [KernelServices.ExternalSources]: provider([
        "mcp.deepwiki.search",
        "mcp.deepwiki.resources.read",
      ]),
    });

    expect(names(kernel)).toEqual([
      CHARACTER_READ_TOOL_NAME,
      "mcp.deepwiki.resources.read",
      "mcp.deepwiki.search",
      SESSION_BRANCH_TOOL_NAME,
    ]);
  });

  it("两类提供方同时存在时取并集并去重排序", () => {
    const kernel = stubKernel({
      [KernelServices.AgentRuntime]: agentRuntime(["ext.a.b", "mcp.c.d"]),
      [KernelServices.ToolConnectors]: provider(["ext.a.b"]),
      [KernelServices.ExternalSources]: provider(["mcp.c.d"]),
    });
    expect(names(kernel)).toEqual([
      CHARACTER_READ_TOOL_NAME,
      "ext.a.b",
      "mcp.c.d",
      SESSION_BRANCH_TOOL_NAME,
    ]);
  });

  it("已注册但未被任何提供方启用的工具不进入可挂载列表", () => {
    const kernel = stubKernel({
      [KernelServices.AgentRuntime]: agentRuntime(["ext.disabled.tool"]),
      [KernelServices.ToolConnectors]: provider([]),
    });
    expect(names(kernel)).not.toContain("ext.disabled.tool");
    // 但它在"已知工具"里，便于诊断。
    expect(listAllKnownTools(kernel).map((tool) => tool.name)).toContain("ext.disabled.tool");
  });

  it("提供方降级（缺 getEnabledToolNames）时不抛错，仅保留内建", () => {
    const kernel = stubKernel({
      [KernelServices.AgentRuntime]: agentRuntime(["ext.example.weather.get"]),
      [KernelServices.ToolConnectors]: {},
      [KernelServices.ExternalSources]: {},
    });
    expect(names(kernel)).toEqual([
      CHARACTER_READ_TOOL_NAME,
      SESSION_BRANCH_TOOL_NAME,
    ]);
  });
});
