import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IKernel } from "../../src/kernel/types";
import { AgentRuntimeService } from "../../src/application/services/AgentRuntimeService";
import { ToolPluginRuntimeService } from "../../src/application/services/ToolPluginRuntimeService";
import type { ToolPluginHttpPort } from "../../src/application/toolPlugins/executionContracts";
import { parseToolPluginManifest } from "../../src/domain/toolPlugins";
import {
  __toolPluginStorageTest,
  installToolPluginManifest,
  setToolPluginEnabled,
  setToolPluginPermissions,
} from "../../src/infrastructure/toolPlugins/toolPluginStorage";
import { createV2HttpManifest } from "./helpers/toolPluginFixture";

const journal = { append: async () => undefined, listBySession: async () => [], replace: async () => undefined, deleteBySession: async () => undefined };

describe("External Tool Plugin Runtime", () => {
  beforeEach(async () => {
    vi.stubGlobal("__APP_VERSION__", "1.8.3");
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
});
