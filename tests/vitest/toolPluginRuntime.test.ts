import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IKernel } from "../../src/kernel/types";
import { AgentRuntimeService } from "../../src/application/services/AgentRuntimeService";
import { ToolPluginRuntimeService } from "../../src/application/services/ToolPluginRuntimeService";
import type { ToolPluginHttpPort } from "../../src/application/toolPlugins/executionContracts";
import { parseToolPluginManifest, parseToolPluginPackage } from "../../src/domain/toolPlugins";
import {
  __toolPluginStorageTest,
  installToolPluginManifest,
  installToolPlugin,
  setToolPluginEnabled,
  setToolPluginPermissions,
} from "../../src/infrastructure/toolPlugins/toolPluginStorage";
import { createV2HttpManifest, createV2WorkerPackage } from "./helpers/toolPluginFixture";
import { AGENT_PROFILE_SETTINGS_DECISION_ID } from "../../src/application/runtimeProfiles/agentSettings";
import {
  DEVICE_TIME_TOOL_PLUGIN_ID,
  listOfficialToolPluginInspections,
  MEMORY_TOOL_PLUGIN_ID,
  MEMORY_WRITE_TOOL_NAME,
  UTILITY_TOOL_PLUGIN_ID,
} from "../../src/application/toolPlugins/officialCatalog";
import { KernelServices } from "../../src/application/serviceContracts";
import type { MemoryServiceTyped } from "../../src/application/services/memory";

const journal = { append: async () => undefined, appendMany: async () => undefined, listBySession: async () => [], replace: async () => undefined, deleteBySession: async () => undefined };

describe("External Tool Plugin Runtime", () => {
  beforeEach(async () => {
    vi.stubGlobal("__APP_VERSION__", "1.8.9");
    await __toolPluginStorageTest.reset();
  });

  it("注册到 Agent Runtime、扩展新会话快照，并让撤销对旧闭包立即生效", async () => {
    const manifest = await parseToolPluginManifest(JSON.stringify(await createV2HttpManifest()));
    await installToolPluginManifest(manifest);
    await setToolPluginPermissions(manifest.id, ["network.request"]);
    await setToolPluginEnabled(manifest.id, true);

    const agentRuntime = new AgentRuntimeService(journal);
    const kernel = {
      getService: () => agentRuntime,
      hasService: () => true,
    } as unknown as IKernel;
    agentRuntime.init(kernel);
    const http: ToolPluginHttpPort = {
      request: async () => ({ status: 200, contentType: "application/json", body: { temperature: 21 } }),
    };
    const worker = { execute: async () => ({}), getActiveWorkerCount: () => 0, destroy: () => undefined };
    const service = new ToolPluginRuntimeService(http, worker);
    await service.init(kernel);

    expect(service.getDiagnostics().failures).toEqual({});
    const [tool] = agentRuntime.listTools().filter((item) => item.name.startsWith("ext.example.weather."));
    expect(tool.name).toBe("ext.example.weather.weather.get");
    expect(service.extendComposition({
      profileId: "mobile-tavern.base",
      profileVersion: 1,
      pluginVersions: {},
      providerBindings: {},
      contributionOrder: { tool: [] },
      capabilityDecisions: {},
    })).toMatchObject({
      pluginVersions: { "tool-plugin/example.weather": "1.0.0" },
      contributionOrder: { tool: ["ext.example.weather.weather.get"] },
    });
    await expect(tool.execute({ city: "上海" }, {
      sessionId: "session", turnId: "turn", callId: "call", signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 200 });

    await setToolPluginPermissions(manifest.id, []);
    await expect(tool.execute({ city: "上海" }, {
      sessionId: "session", turnId: "turn", callId: "call-2", signal: new AbortController().signal,
    })).rejects.toThrow("TOOL_PLUGIN_RUNTIME_REVOKED");
    await service.destroy();
    await agentRuntime.destroy();
  });

  it("星号目标可用于自定义 Profile，且只向组合快照加入 Agent 已挂载的 Tool", async () => {
    const manifest = await parseToolPluginManifest(JSON.stringify(await createV2HttpManifest({
      targetProfiles: ["*"],
    })));
    await installToolPluginManifest(manifest);
    await setToolPluginPermissions(manifest.id, ["network.request"]);
    await setToolPluginEnabled(manifest.id, true);

    const agentRuntime = new AgentRuntimeService(journal);
    const kernel = {
      getService: () => agentRuntime,
      hasService: () => true,
    } as unknown as IKernel;
    agentRuntime.init(kernel);
    const service = new ToolPluginRuntimeService(
      { request: async () => ({ status: 200, contentType: "application/json", body: {} }) },
      { execute: async () => ({}), getActiveWorkerCount: () => 0, destroy: () => undefined },
    );
    await service.init(kernel);

    const toolName = "ext.example.weather.weather.get";
    expect(service.getEnabledToolNames("user.profile.custom")).toContain(toolName);
    const baseSnapshot = {
      profileId: "user.profile.custom",
      profileVersion: 1,
      pluginVersions: {},
      providerBindings: {},
      contributionOrder: { tool: [] },
    } as const;
    expect(service.extendComposition({
      ...baseSnapshot,
      capabilityDecisions: {
        [AGENT_PROFILE_SETTINGS_DECISION_ID]: { toolMounts: [] },
      },
    }).contributionOrder.tool).toEqual([]);
    expect(service.extendComposition({
      ...baseSnapshot,
      capabilityDecisions: {
        [AGENT_PROFILE_SETTINGS_DECISION_ID]: { toolMounts: [{ name: toolName, version: "1.0.0" }] },
      },
    }).contributionOrder.tool).toEqual([toolName]);

    await service.destroy();
    await agentRuntime.destroy();
  });

  it("只向匹配 Profile 暴露纯 Tool 输入框命令，并通过原执行器回填字符串结果", async () => {
    const bytes = await createV2WorkerPackage(undefined, undefined, {
      tools: [{
        id: "echo",
        name: "回显",
        description: "回显输入。",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        permissions: [],
        riskLevel: "low",
        sideEffect: "none",
        executionScope: "turn",
        composerCommand: { name: "echo", inputProperty: "value", outputProperty: "value" },
        handler: { kind: "worker", exportName: "echo" },
      }],
    });
    const inspection = await parseToolPluginPackage(bytes);
    await installToolPlugin(inspection.manifest, inspection.artifact);
    await setToolPluginEnabled(inspection.manifest.id, true);

    const agentRuntime = new AgentRuntimeService(journal);
    const kernel = {
      getService: () => agentRuntime,
      hasService: () => true,
    } as unknown as IKernel;
    agentRuntime.init(kernel);
    const execute = vi.fn(async ({ input }: { input: unknown }) => input);
    const service = new ToolPluginRuntimeService(
      { request: async () => ({ status: 200, contentType: "application/json", body: {} }) },
      { execute, getActiveWorkerCount: () => 0, destroy: () => undefined },
    );
    await service.init(kernel);

    expect(service.listComposerCommands("mobile-tavern.base")).toEqual([
      expect.objectContaining({ name: "echo", acceptsArgument: true }),
    ]);
    expect(service.listComposerCommands("mobile-tavern.tavern")).toEqual([]);
    await expect(service.executeComposerCommand({
      profileId: "mobile-tavern.base",
      sessionId: "session-composer",
      name: "echo",
      argument: "现在几点",
    })).resolves.toBe("现在几点");
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: "example.worker",
      input: { value: "现在几点" },
    }));
    await expect(service.executeComposerCommand({
      profileId: "mobile-tavern.tavern",
      sessionId: "session-composer",
      name: "echo",
      argument: "拒绝",
    })).rejects.toThrow("TOOL_PLUGIN_COMPOSER_COMMAND_PROFILE_UNAVAILABLE");

    await service.destroy();
    await agentRuntime.destroy();
  });

  it("官方设备时间插件在所有 Profile 暴露 /time 并通过 Host Capability 回填", async () => {
    const inspections = await listOfficialToolPluginInspections();
    const manifest = inspections.find((item) => item.manifest.id === DEVICE_TIME_TOOL_PLUGIN_ID)!.manifest;
    await installToolPluginManifest(manifest);
    await setToolPluginEnabled(manifest.id, true);

    const agentRuntime = new AgentRuntimeService(journal);
    const kernel = {
      getService: () => agentRuntime,
      hasService: () => true,
    } as unknown as IKernel;
    agentRuntime.init(kernel);
    const service = new ToolPluginRuntimeService(
      { request: async () => ({ status: 200, contentType: "application/json", body: {} }) },
      { execute: async () => ({}), getActiveWorkerCount: () => 0, destroy: () => undefined },
    );
    await service.init(kernel);

    expect(service.listComposerCommands("mobile-tavern.base")).toEqual([
      expect.objectContaining({ name: "time", acceptsArgument: false }),
    ]);
    expect(service.listComposerCommands("mobile-tavern.tavern")).toEqual([
      expect.objectContaining({ name: "time" }),
    ]);
    await expect(service.executeComposerCommand({
      profileId: "mobile-tavern.base",
      sessionId: "session-time",
      name: "time",
      argument: "",
    })).resolves.toMatch(/^📅 .+\n🕒 .+ · .+$/);

    await service.destroy();
    await agentRuntime.destroy();
  });

  it("官方本地实用工具插件暴露四个输入框命令并回填草稿", async () => {
    const inspections = await listOfficialToolPluginInspections();
    const manifest = inspections.find((item) => item.manifest.id === UTILITY_TOOL_PLUGIN_ID)!.manifest;
    await installToolPluginManifest(manifest);
    await setToolPluginEnabled(manifest.id, true);

    const agentRuntime = new AgentRuntimeService(journal);
    const kernel = {
      getService: () => agentRuntime,
      hasService: () => true,
    } as unknown as IKernel;
    agentRuntime.init(kernel);
    const service = new ToolPluginRuntimeService(
      { request: async () => ({ status: 200, contentType: "application/json", body: {} }) },
      { execute: async () => ({}), getActiveWorkerCount: () => 0, destroy: () => undefined },
    );
    await service.init(kernel);

    expect(service.listComposerCommands("mobile-tavern.base").map((command) => command.name))
      .toEqual(["coin", "count", "dice", "pick"]);

    await expect(service.executeComposerCommand({
      profileId: "mobile-tavern.base",
      sessionId: "session-utility",
      name: "dice",
      argument: "2d6",
    })).resolves.toMatch(/^🎲 2d6 = \[\d, \d\] → \d+$/);

    await expect(service.executeComposerCommand({
      profileId: "mobile-tavern.base",
      sessionId: "session-utility",
      name: "coin",
      argument: "",
    })).resolves.toMatch(/^(🪙 正面|🪙 反面)$/);

    await expect(service.executeComposerCommand({
      profileId: "mobile-tavern.base",
      sessionId: "session-utility",
      name: "pick",
      argument: "苹果,香蕉",
    })).resolves.toMatch(/^🎯 从 2 个选项抽中：(苹果|香蕉)$/);

    await expect(service.executeComposerCommand({
      profileId: "mobile-tavern.base",
      sessionId: "session-utility",
      name: "count",
      argument: "hello",
    })).resolves.toBe("字符 5（含空白）· 非空白 5 · 汉字 0 · 行 1");

    await service.destroy();
    await agentRuntime.destroy();
  });

  it("通过宿主能力把已审批事实写入带来源的长期记忆，并在来源缺失时拒绝", async () => {
    const inspections = await listOfficialToolPluginInspections();
    const manifest = inspections.find((item) => item.manifest.id === MEMORY_TOOL_PLUGIN_ID)!.manifest;
    await installToolPluginManifest(manifest);
    await setToolPluginPermissions(manifest.id, ["memory.write"]);
    await setToolPluginEnabled(manifest.id, true);

    const source = {
      id: "message-user-1",
      sessionId: "session-memory",
      role: "user" as const,
      content: "请记住集合地点是钟楼。",
      createdAt: 10,
      turnIndex: 4,
      tags: ["钟楼"],
      extractSource: "dict" as const,
    };
    const getMessagesBySession = vi.fn()
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([]);
    const upsertFragment = vi.fn(async () => undefined);
    const invalidateCache = vi.fn();
    const memory = {
      getStorage: () => ({
        getMessagesBySession,
        getFragmentById: vi.fn(async () => null),
        upsertFragment,
      }),
      getRecall: () => ({ invalidateCache }),
    } as unknown as MemoryServiceTyped;
    const agentRuntime = new AgentRuntimeService(journal);
    const kernel = {
      getService: (name: string) => name === KernelServices.Memory ? memory : agentRuntime,
      hasService: () => true,
    } as unknown as IKernel;
    agentRuntime.init(kernel);
    const service = new ToolPluginRuntimeService(
      { request: async () => ({ status: 200, contentType: "application/json", body: {} }) },
      { execute: async () => ({}), getActiveWorkerCount: () => 0, destroy: () => undefined },
    );
    await service.init(kernel);

    const tool = agentRuntime.listTools().find((item) => item.name === MEMORY_WRITE_TOOL_NAME)!;
    expect(tool).toMatchObject({
      policy: "ask",
      permissions: ["memory.write"],
      riskLevel: "high",
      sideEffect: "local-write",
      executionScope: "memory",
    });
    const input = {
      content: "集合地点是钟楼。",
      participants: ["用户"],
      tags: ["集合", "钟楼"],
      importance: 0.8,
    };
    const context = {
      sessionId: "session-memory",
      turnId: "turn-memory",
      callId: "call-memory-1",
      signal: new AbortController().signal,
    };
    await expect(tool.execute(input, context)).resolves.toMatchObject({
      status: "active",
      sourceMessageId: source.id,
    });
    expect(getMessagesBySession).toHaveBeenCalledWith("session-memory", { limit: 1, descending: true });
    expect(upsertFragment).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-memory",
      content: input.content,
      sourceMessageIds: [source.id],
      sourceTurnStart: 4,
      sourceTurnEnd: 4,
      confidence: 1,
    }), true, context.signal);
    expect(invalidateCache).toHaveBeenCalledWith("session-memory");

    await expect(tool.execute(input, { ...context, callId: "call-memory-no-source" }))
      .rejects.toThrow("TOOL_PLUGIN_MEMORY_SOURCE_NOT_FOUND");
    expect(upsertFragment).toHaveBeenCalledTimes(1);

    await service.destroy();
    await agentRuntime.destroy();
  });
});
