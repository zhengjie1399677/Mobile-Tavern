import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  AgentRuntimeService,
  type AgentJournalPort,
} from "../../src/application/services/AgentRuntimeService";
import type {
  AgentJournalEvent,
  AgentToolApprovalRequest,
  AgentTurnExecutionContext,
} from "../../src/domain/agents/contracts";
import { createKernel } from "../../src/kernel/Kernel";

class MemoryAgentJournal implements AgentJournalPort {
  readonly events: AgentJournalEvent[] = [];

  async append(event: AgentJournalEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async appendMany(events: AgentJournalEvent[]): Promise<void> {
    this.events.push(...structuredClone(events));
  }

  async listBySession(sessionId: string): Promise<AgentJournalEvent[]> {
    return this.events.filter((event) => event.sessionId === sessionId);
  }

  async replace(events: readonly AgentJournalEvent[]): Promise<void> {
    this.events.splice(0, this.events.length, ...structuredClone(events));
  }

  async deleteBySession(sessionId: string): Promise<void> {
    const remaining = this.events.filter((event) => event.sessionId !== sessionId);
    this.events.splice(0, this.events.length, ...remaining);
  }
}

async function createService() {
  const journal = new MemoryAgentJournal();
  const service = new AgentRuntimeService(journal);
  await service.init(createKernel());
  return { journal, service };
}

describe("AgentRuntimeService", () => {
  it("Driver 与 Provider 注册可撤销且拒绝重复 ID", async () => {
    const { service } = await createService();
    const disposeDriver = service.registerDriver({
      id: "driver.test",
      version: "1.0.0",
      run: async ({ executeLegacy }) => executeLegacy(),
    });
    const disposeProvider = service.registerProvider({
      id: "provider.test",
      version: "1.0.0",
      capabilities: {
        inputModalities: ["text"],
        supportsStreaming: true,
        supportsTools: false,
      },
      buildRequestBody: (request) => ({ ...request, provider: "test" }),
    });

    expect(service.listDrivers().map((item) => item.id)).toEqual(["driver.test"]);
    expect(service.listProviders().map((item) => item.id)).toEqual(["provider.test"]);
    expect(() => service.registerDriver({
      id: "driver.test",
      version: "2.0.0",
      run: async () => undefined,
    })).toThrow("AGENT_DRIVER_DUPLICATE");

    await disposeProvider();
    await disposeDriver();
    expect(service.listDrivers()).toEqual([]);
    expect(service.listProviders()).toEqual([]);
    await service.destroy();
  });

  it("AgentHandle 记录 Turn 生命周期、Provider 选择与可重放决定", async () => {
    const { journal, service } = await createService();
    service.registerDriver({
      id: "driver.legacy",
      version: "1.0.0",
      async run(context) {
        await context.recordDecision("provider.request", {
          model: "model-a",
          mediaStrategy: "text-only",
        });
        await context.executeLegacy();
      },
    });
    service.registerProvider({
      id: "provider.primary",
      version: "1.0.0",
      capabilities: {
        inputModalities: ["text", "image"],
        supportsStreaming: true,
        supportsTools: true,
      },
      buildRequestBody: (request) => request,
    });
    const executeLegacy = vi.fn(async (_context: AgentTurnExecutionContext) => undefined);
    const handle = service.openHandle({
      sessionId: "session-1",
      driverId: "driver.legacy",
      providerId: "provider.primary",
      executeLegacy,
      grantedPermissions: [],
    });

    const result = await handle.send({ text: "你好", attachmentIds: [] });

    expect(result.status).toBe("completed");
    expect(executeLegacy).toHaveBeenCalledOnce();
    expect(handle.getSnapshot()).toMatchObject({ status: "idle", activeTurnId: null });
    expect(journal.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.decision",
      "turn.completed",
    ]);
    expect(journal.events[0]).toMatchObject({
      sessionId: "session-1",
      driverId: "driver.legacy",
      providerId: "provider.primary",
    });
    expect(journal.events[1]).toMatchObject({
      decisionType: "provider.request",
      value: { model: "model-a", mediaStrategy: "text-only" },
    });
    await handle.dispose();
    await service.destroy();
  });

  it("停止与销毁会中止活跃 Turn，不残留 Handle", async () => {
    const { journal, service } = await createService();
    service.registerDriver({
      id: "driver.blocked",
      version: "1.0.0",
      run: async ({ signal }) => new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });
    service.registerProvider({
      id: "provider.text",
      version: "1.0.0",
      capabilities: {
        inputModalities: ["text"],
        supportsStreaming: true,
        supportsTools: false,
      },
      buildRequestBody: (request) => request,
    });
    const handle = service.openHandle({
      sessionId: "session-stop",
      driverId: "driver.blocked",
      providerId: "provider.text",
      executeLegacy: async () => undefined,
      grantedPermissions: [],
    });
    const running = handle.send({ text: "等待", attachmentIds: [] });

    await vi.waitFor(() => expect(handle.getSnapshot().status).toBe("running"));
    await handle.stop("user");
    await expect(running).resolves.toMatchObject({ status: "cancelled" });
    expect(journal.events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.cancelled",
    ]);

    await service.destroy();
    expect(service.getDiagnostics().activeHandles).toBe(0);
  });

  it("Tool 执行校验 Schema、权限、超时并持久化 Call/Result", async () => {
    const { journal, service } = await createService();
    service.registerDriver({
      id: "driver.tool",
      version: "1.0.0",
      async run({ executeTool }) {
        await executeTool({
          callId: "call-1",
          name: "math.double",
          arguments: { value: 4 },
        });
      },
    });
    service.registerProvider({
      id: "provider.tools",
      version: "1.0.0",
      capabilities: {
        inputModalities: ["text"],
        supportsStreaming: true,
        supportsTools: true,
      },
      buildRequestBody: (request) => request,
    });
    service.registerTool({
      name: "math.double",
      version: "1.0.0",
      description: "把数值乘以二",
      inputSchema: z.object({ value: z.number() }),
      inputJsonSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
        additionalProperties: false,
      },
      outputSchema: z.object({ value: z.number() }),
      permissions: ["compute.basic"],
      riskLevel: "low",
      sideEffect: "none",
      executionScope: "turn",
      policy: "allow",
      timeoutMs: 100,
      execute: async (input) => ({ value: (input as { value: number }).value * 2 }),
    });
    const handle = service.openHandle({
      sessionId: "session-tool",
      driverId: "driver.tool",
      providerId: "provider.tools",
      executeLegacy: async () => undefined,
      grantedPermissions: ["compute.basic"],
    });

    await expect(handle.send({ text: "计算", attachmentIds: [] }))
      .resolves.toMatchObject({ status: "completed" });
    expect(journal.events.map((event) => event.type)).toEqual([
      "turn.started",
      "tool.called",
      "tool.result",
      "turn.completed",
    ]);
    expect(journal.events[2]).toMatchObject({
      callId: "call-1",
      toolName: "math.double",
      result: { value: 8 },
    });

    const deniedHandle = service.openHandle({
      sessionId: "session-denied",
      driverId: "driver.tool",
      providerId: "provider.tools",
      executeLegacy: async () => undefined,
      grantedPermissions: [],
    });
    await expect(deniedHandle.send({ text: "计算", attachmentIds: [] }))
      .rejects.toThrow("AGENT_TOOL_PERMISSION_DENIED");
    expect(journal.events.slice(-2).map((event) => event.type)).toEqual([
      "tool.failed",
      "turn.failed",
    ]);
    expect(journal.events.at(-2)).toMatchObject({
      type: "tool.failed",
      callId: "call-1",
      toolName: "math.double",
      errorCode: "AGENT_TOOL_PERMISSION_DENIED",
    });
    await deniedHandle.dispose();
    await handle.dispose();
    await service.destroy();
  });

  it("ask Tool 必须经一次性审批后执行，并记录可重放审批事件", async () => {
    const { journal, service } = await createService();
    service.registerDriver({
      id: "driver.approval",
      version: "1.0.0",
      async run({ executeTool }) {
        await executeTool({
          callId: "call-approval",
          name: "session.branch",
          arguments: { title: "新的分支" },
        });
      },
    });
    service.registerProvider({
      id: "provider.approval",
      version: "1.0.0",
      capabilities: {
        inputModalities: ["text"],
        supportsStreaming: true,
        supportsTools: true,
      },
      buildRequestBody: (request) => request,
    });
    const execute = vi.fn(async () => ({ sessionId: "session-branch" }));
    service.registerTool({
      name: "session.branch",
      version: "1.0.0",
      description: "创建新的本地会话分支",
      inputSchema: z.object({ title: z.string() }),
      inputJsonSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
      outputSchema: z.object({ sessionId: z.string() }),
      permissions: ["session.write"],
      riskLevel: "medium",
      sideEffect: "local-write",
      executionScope: "session",
      policy: "ask",
      timeoutMs: 100,
      approvalTimeoutMs: 1_000,
      execute,
    });
    const requests: AgentToolApprovalRequest[] = [];
    const unsubscribe = service.subscribeToolApprovals((request) => requests.push(request));
    const handle = service.openHandle({
      sessionId: "session-source",
      driverId: "driver.approval",
      providerId: "provider.approval",
      executeLegacy: async () => undefined,
      grantedPermissions: ["session.write"],
      enabledToolNames: ["session.branch"],
    });

    const running = handle.send({ text: "创建一个新分支", attachmentIds: [] });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(service.listPendingToolApprovals()).toEqual([requests[0]]);
    expect(execute).not.toHaveBeenCalled();
    expect(service.resolveToolApproval(requests[0].id, "allow")).toBe(true);

    await expect(running).resolves.toMatchObject({ status: "completed" });
    expect(execute).toHaveBeenCalledOnce();
    expect(service.listPendingToolApprovals()).toEqual([]);
    expect(journal.events.map((event) => event.type)).toEqual([
      "turn.started",
      "tool.called",
      "tool.approval.requested",
      "tool.approval.resolved",
      "tool.result",
      "turn.completed",
    ]);
    expect(journal.events[3]).toMatchObject({
      type: "tool.approval.resolved",
      decision: "allow",
      reason: "user",
    });

    unsubscribe();
    await handle.dispose();
    await service.destroy();
  });

  it("ask Tool 在审批宿主不可用时 fail-closed，且不会执行副作用", async () => {
    const { journal, service } = await createService();
    service.registerDriver({
      id: "driver.fail-closed",
      version: "1.0.0",
      async run({ executeTool }) {
        await executeTool({
          callId: "call-denied",
          name: "memory.write",
          arguments: { text: "不要写入" },
        });
      },
    });
    service.registerProvider({
      id: "provider.fail-closed",
      version: "1.0.0",
      capabilities: {
        inputModalities: ["text"],
        supportsStreaming: true,
        supportsTools: true,
      },
      buildRequestBody: (request) => request,
    });
    const execute = vi.fn(async () => ({ ok: true }));
    service.registerTool({
      name: "memory.write",
      version: "1.0.0",
      description: "写入本地长期记忆",
      inputSchema: z.object({ text: z.string() }),
      inputJsonSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      outputSchema: z.object({ ok: z.boolean() }),
      permissions: ["memory.write"],
      riskLevel: "high",
      sideEffect: "local-write",
      executionScope: "memory",
      policy: "ask",
      timeoutMs: 100,
      execute,
    });
    const handle = service.openHandle({
      sessionId: "session-fail-closed",
      driverId: "driver.fail-closed",
      providerId: "provider.fail-closed",
      executeLegacy: async () => undefined,
      grantedPermissions: ["memory.write"],
      enabledToolNames: ["memory.write"],
    });

    await expect(handle.send({ text: "写入记忆", attachmentIds: [] }))
      .rejects.toThrow("AGENT_TOOL_APPROVAL_HOST_UNAVAILABLE");
    expect(execute).not.toHaveBeenCalled();
    expect(journal.events.map((event) => event.type)).toEqual([
      "turn.started",
      "tool.called",
      "tool.approval.requested",
      "tool.approval.resolved",
      "tool.failed",
      "turn.failed",
    ]);
    expect(journal.events[3]).toMatchObject({
      type: "tool.approval.resolved",
      decision: "deny",
      reason: "host-unavailable",
    });
    await handle.dispose();
    await service.destroy();
  });

  it("媒体 Processor 结果进入 Journal 并可在插件卸载时撤销", async () => {
    const { journal, service } = await createService();
    service.registerDriver({
      id: "driver.media",
      version: "1.0.0",
      async run({ processMedia }) {
        await processMedia("media.audio.test", {
          assetId: "att_audio1",
          kind: "audio",
          options: { secret: "not-journaled" },
        });
      },
    });
    service.registerProvider({
      id: "provider.media",
      version: "1.0.0",
      capabilities: {
        inputModalities: ["text"],
        supportsStreaming: true,
        supportsTools: false,
      },
      buildRequestBody: (request) => request,
    });
    const disposeProcessor = service.registerMediaProcessor({
      id: "media.audio.test",
      version: "1.0.0",
      inputKinds: ["audio"],
      process: async (request) => ({
        sourceAssetId: request.assetId,
        projectionParts: [{ type: "text", text: "转写结果" }],
        derivedAssetIds: [],
        strategy: "test-asr",
      }),
    });
    const handle = service.openHandle({
      sessionId: "session-media",
      driverId: "driver.media",
      providerId: "provider.media",
      executeLegacy: async () => undefined,
      grantedPermissions: [],
    });

    await handle.send({ text: "", attachmentIds: ["att_audio1"] });

    expect(journal.events.map((event) => event.type)).toEqual([
      "turn.started",
      "media.processed",
      "turn.completed",
    ]);
    expect(JSON.stringify(journal.events)).not.toContain("not-journaled");
    expect(journal.events[1]).toMatchObject({
      processorId: "media.audio.test",
      result: { strategy: "test-asr" },
    });
    await disposeProcessor();
    expect(service.listMediaProcessors()).toEqual([]);
    await handle.dispose();
    await service.destroy();
  });
});
