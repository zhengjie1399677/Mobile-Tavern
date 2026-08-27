import { describe, expect, it, vi } from "vitest";
import type { IKernel } from "../../src/application/serviceContracts";
import { KernelServices } from "../../src/application/serviceContracts";
import type { UnifiedBackupPayload } from "../../src/application/useCases/dataMigrationUseCases";

const { replaceLocalDataFromBackup } = vi.hoisted(() => ({
  replaceLocalDataFromBackup: vi.fn(async () => {
    throw new Error("MAIN_DATABASE_REPLACE_FAILED");
  }),
}));

vi.mock("../../src/infrastructure/storage/repositories/dataMigrationRepository", () => ({
  replaceLocalDataFromBackup,
}));

import { DataMigrationService } from "../../src/application/services/DataMigrationService";

describe("备份恢复补偿事务", () => {
  it("主库替换失败时恢复先前附件索引与 Agent journal", async () => {
    const previousAttachment = {
      id: "att_previous",
      kind: "image" as const,
      mimeType: "image/png",
      originalName: "previous.png",
      size: 8,
      createdAt: 1,
      updatedAt: 1,
      dataBase64: "iVBORw0KGgo=",
    };
    const attachments = {
      exportAttachments: vi.fn(async () => [previousAttachment]),
      listAttachments: vi.fn(async () => [{
        ...previousAttachment,
        state: "committed",
        referenceIds: ["old-session/old-message"],
      }]),
      replaceAttachments: vi.fn(async () => undefined),
    };
    const previousJournal = [{ id: "old-event", sessionId: "old-session" }];
    const agentRuntime = {
      listJournalBySession: vi.fn(async () => previousJournal),
      replaceJournal: vi.fn(async () => undefined),
    };
    const database = {
      getAllSessions: vi.fn(async () => [{ id: "old-session" }]),
    };
    const services: Record<string, unknown> = {
      [KernelServices.Attachments]: attachments,
      [KernelServices.AgentRuntime]: agentRuntime,
      [KernelServices.Database]: database,
    };
    const kernel = {
      getService: (name: string) => services[name],
    } as unknown as IKernel;
    const payload = {
      sessions: [],
      attachments: [],
      agentJournal: [],
    } as unknown as UnifiedBackupPayload;
    const service = new DataMigrationService();
    service.init(kernel);

    await expect(service.replaceFromBackup(payload)).rejects.toThrow("MAIN_DATABASE_REPLACE_FAILED");

    expect(attachments.replaceAttachments).toHaveBeenNthCalledWith(1, [], []);
    expect(attachments.replaceAttachments).toHaveBeenNthCalledWith(2, [previousAttachment], [{
      referenceId: "old-session/old-message",
      assetIds: ["att_previous"],
    }]);
    expect(agentRuntime.replaceJournal).toHaveBeenNthCalledWith(1, []);
    expect(agentRuntime.replaceJournal).toHaveBeenNthCalledWith(2, previousJournal);
  });
});
