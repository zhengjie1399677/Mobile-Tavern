import { describe, expect, it, vi } from "vitest";
import {
  buildUnifiedBackupPayload,
  redactSettingsForPlainBackup,
} from "../../src/application/useCases/dataMigrationUseCases";
import { persistImportedChatSession } from "../../src/application/useCases/chatImportUseCases";
import type { IDatabaseService } from "../../src/application/serviceContracts";
import { KernelServices, type IKernel } from "../../src/application/serviceContracts";
import { DataMigrationService } from "../../src/application/services/DataMigrationService";
import type {
  CharacterCard,
  ChatSession,
  CustomWorldbook,
  Message,
  SummaryCard,
  UserSettings,
} from "../../src/types";

describe("数据迁移应用用例", () => {
  it("导入聊天时同时持久化会话元数据与消息正文", async () => {
    const session = {
      id: "session-imported",
      characterId: "character-1",
      title: "导入会话",
      createdAt: 1,
      summaries: [],
      messages: [
        { id: "message-1", sender: "user", content: "你好", timestamp: 1 },
      ],
    } as ChatSession;
    const database = {
      saveSession: vi.fn().mockResolvedValue(undefined),
      syncSessionMessages: vi.fn().mockResolvedValue(undefined),
    } as unknown as IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message>;

    await persistImportedChatSession(database, session);

    expect(database.saveSession).toHaveBeenCalledWith(session);
    expect(database.syncSessionMessages).toHaveBeenCalledWith(session.id, session.messages);
  });

  it("明文备份同时清空当前通道与全部已保存通道的 API Key", () => {
    const settings = {
      api: { apiKey: "sk-active" },
      savedApiProfiles: [
        { id: "profile-1", name: "主线路", apiKey: "sk-profile-1" },
        { id: "profile-2", name: "备用线路", apiKey: "sk-profile-2" },
      ],
      imageGenApi: { apiKey: "sk-image" },
      ttsConfig: { openaiApiKey: "sk-tts" },
      asrConfig: { openaiApiKey: "sk-asr" },
    } as unknown as UserSettings;

    const redacted = redactSettingsForPlainBackup(settings);

    expect(redacted.api.apiKey).toBe("");
    expect(redacted.savedApiProfiles?.map((profile) => profile.apiKey)).toEqual(["", ""]);
    expect(redacted.imageGenApi?.apiKey).toBe("");
    expect(redacted.ttsConfig?.openaiApiKey).toBe("");
    expect(redacted.asrConfig?.openaiApiKey).toBe("");
    expect(settings.api.apiKey).toBe("sk-active");
    expect(settings.savedApiProfiles?.[0].apiKey).toBe("sk-profile-1");
  });

  it("v4 统一备份包含独立世界书且不与输入对象共享可变引用", () => {
    const customWorldbooks: Record<string, CustomWorldbook> = {
      "worldbook-1": {
        id: "worldbook-1",
        name: "城镇设定",
        enabled: true,
        entries: [],
      },
    };

    const payload = buildUnifiedBackupPayload({
      characters: [],
      sessions: [],
      memoryFragments: [],
      memoryFacts: [],
      settings: { api: { apiKey: "" } } as UserSettings,
      globalLorebook: [],
      customWorldbooks,
      backupDate: "2026-08-03T00:00:00.000Z",
      isEncrypted: false,
    });

    expect(payload.version).toBe(4);
    expect(payload.customWorldbooks).toEqual(customWorldbooks);
    expect(payload.customWorldbooks).not.toBe(customWorldbooks);
  });

  it("迁移服务从物理分轨存储收集消息、记忆词典与独立世界书", async () => {
    const service = new DataMigrationService();
    const services = {
      [KernelServices.Character]: {
        getAllCharacters: vi.fn().mockResolvedValue([]),
      },
      [KernelServices.Database]: {
        getAllSessions: vi.fn().mockResolvedValue([
          { id: "session-1", characterId: "character-1", title: "会话", createdAt: 1, summaries: [], messages: [] },
        ]),
      },
      [KernelServices.Worldbook]: {
        getGlobalLorebook: vi.fn().mockResolvedValue([]),
        getCustomWorldbooks: vi.fn().mockResolvedValue({
          "worldbook-1": { id: "worldbook-1", name: "世界书", enabled: true, entries: [] },
        }),
      },
      [KernelServices.Memory]: {
        getStorage: () => ({
          getMessagesBySession: vi.fn().mockResolvedValue([
            {
              id: "message-1",
              sessionId: "session-1",
              role: "system",
              content: "系统消息",
              createdAt: 1,
              turnIndex: 0,
              tags: ["系统"],
              extractSource: "dict",
            },
          ]),
          getDictBySession: vi.fn().mockResolvedValue([
            {
              id: "session-1:城镇",
              sessionId: "session-1",
              entity: "城镇",
              aliases: [],
              type: "location",
              firstSeenMsgId: "message-1",
              firstSeenTurn: 0,
              count: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          ]),
          getFragmentsBySession: vi.fn().mockResolvedValue([]),
          getTemporalFactsBySession: vi.fn().mockResolvedValue([]),
        }),
      },
      [KernelServices.Preset]: {
        getStoredSavedPresets: vi.fn().mockResolvedValue([
          { id: "preset-1", name: "长篇预设" },
        ]),
      },
    };
    service.init({
      getService: vi.fn((name: keyof typeof services) => services[name]),
    } as unknown as IKernel);

    const payload = await service.createBackupPayload(
      { api: { apiKey: "sk-secret" } } as UserSettings,
      false,
      "2026-08-03T00:00:00.000Z",
    );

    expect(payload.sessions[0].messages[0]).toMatchObject({
      sender: "system",
      content: "系统消息",
      turnIndex: 0,
      tags: ["系统"],
    });
    expect(payload.memoryDictEntries[0].entity).toBe("城镇");
    expect(payload.savedPresets[0].id).toBe("preset-1");
    expect(Object.keys(payload.customWorldbooks)).toEqual(["worldbook-1"]);
    expect(payload.settings.api.apiKey).toBe("");
    service.destroy();
  });
});
