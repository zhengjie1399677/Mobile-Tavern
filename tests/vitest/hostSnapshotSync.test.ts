import { describe, expect, it } from "vitest";
import type { CharacterCard } from "../../src/types";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import { buildUnifiedBackupPayload } from "../../src/application/useCases/dataMigrationUseCases";
import {
  BackupPayloadError,
  describeBackupVersionGap,
  mergeImportedSettings,
  normalizeBackupPayload,
} from "../../src/application/useCases/backupPayloadRestore";
import {
  pullSnapshotFromHost,
  pushSnapshotToHost,
} from "../../src/application/useCases/hostSnapshotSync";

function makeCharacter(id: string, name: string): CharacterCard {
  return {
    id,
    name,
    avatar: "",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    lorebookEntries: [],
  } as unknown as CharacterCard;
}

function snapshotInput(overrides: Record<string, unknown> = {}) {
  return {
    characters: [makeCharacter("host-char", "宿主角色")],
    sessions: [],
    memoryFragments: [],
    memoryFacts: [],
    settings: {
      ...DEFAULT_SETTINGS,
      api: { ...DEFAULT_SETTINGS.api, apiKey: "host-secret" },
    },
    globalLorebook: [],
    customWorldbooks: {},
    backupDate: "2026-09-14T00:00:00.000Z",
    isEncrypted: false,
    ...overrides,
  };
}

/** 仅实现用例实际消费的字段，避免依赖具体 Response 实现。 */
function stubResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

function createFetchStub(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("backupPayloadRestore 备份边界收口", () => {
  it("明文备份解析后归一化到当前版本", async () => {
    const text = JSON.stringify(buildUnifiedBackupPayload(snapshotInput()));
    const normalized = await normalizeBackupPayload({
      text,
      defaultSettings: DEFAULT_SETTINGS,
    });

    expect(normalized.parsedVersion).toBe(7);
    expect(normalized.versionGap.code).toBe("current");
    expect(normalized.payload.tombstones).toEqual([]);
    expect(normalized.payload.magic).toBe("MOBILE_TAVERN_UNIFIED_BACKUP");
    expect(normalized.payload.characters).toHaveLength(1);
    expect(normalized.payload.characters[0].name).toBe("宿主角色");
    expect(normalized.summary.characters).toBe(1);
    expect(normalized.dropped).toEqual({ characters: 0, sessions: 0 });
  });

  it("BOM 或前导空白不会把明文误判成加密载荷", async () => {
    const text = `\uFEFF\n  ${JSON.stringify(buildUnifiedBackupPayload(snapshotInput()))}`;
    const normalized = await normalizeBackupPayload({
      text,
      defaultSettings: DEFAULT_SETTINGS,
    });
    expect(normalized.payload.characters).toHaveLength(1);
  });

  it("签名不匹配时拒绝导入", async () => {
    const text = JSON.stringify({ magic: "other-app-backup", characters: [], sessions: [] });
    await expect(
      normalizeBackupPayload({ text, defaultSettings: DEFAULT_SETTINGS }),
    ).rejects.toMatchObject({ code: "magic_mismatch" });
  });

  it("顶层结构缺失时给出可区分的失败原因", async () => {
    await expect(
      normalizeBackupPayload({
        text: JSON.stringify({ characters: {}, sessions: [] }),
        defaultSettings: DEFAULT_SETTINGS,
      }),
    ).rejects.toMatchObject({ code: "invalid_characters" });

    await expect(
      normalizeBackupPayload({
        text: JSON.stringify({ characters: [], sessions: "nope" }),
        defaultSettings: DEFAULT_SETTINGS,
      }),
    ).rejects.toMatchObject({ code: "invalid_sessions" });
  });

  it("加密载荷缺少口令时提示先输入密码", async () => {
    await expect(
      normalizeBackupPayload({
        text: "PBK2:00112233445566778899aabbccddeeff",
        defaultSettings: DEFAULT_SETTINGS,
      }),
    ).rejects.toBeInstanceOf(BackupPayloadError);
    await expect(
      normalizeBackupPayload({
        text: "PBK2:00112233445566778899aabbccddeeff",
        defaultSettings: DEFAULT_SETTINGS,
      }),
    ).rejects.toMatchObject({ code: "encrypted_password_required" });
  });

  it("非法 JSON 归类为 malformed_json", async () => {
    await expect(
      normalizeBackupPayload({ text: "{not-json", defaultSettings: DEFAULT_SETTINGS }),
    ).rejects.toMatchObject({ code: "malformed_json" });
  });

  it("损坏条目被丢弃并计数，而不是让整份备份失败", async () => {
    const text = JSON.stringify({
      magic: "MOBILE_TAVERN_UNIFIED_BACKUP",
      version: 6,
      characters: [
        makeCharacter("ok", "正常角色"),
        { id: "no-name" },
        null,
      ],
      sessions: [
        { id: "s1", characterId: "ok", messages: [] },
        { id: "s2" },
      ],
      settings: {},
    });

    const normalized = await normalizeBackupPayload({
      text,
      defaultSettings: DEFAULT_SETTINGS,
    });

    expect(normalized.payload.characters).toHaveLength(1);
    expect(normalized.payload.sessions).toHaveLength(1);
    expect(normalized.dropped).toEqual({ characters: 2, sessions: 1 });
  });

  it("旧版本备份按能力缺口分档", () => {
    expect(describeBackupVersionGap(3).code).toBe("legacy_v3");
    expect(describeBackupVersionGap(3).missing).toContain("消息附件");
    expect(describeBackupVersionGap(4).code).toBe("legacy_v4");
    expect(describeBackupVersionGap(5).code).toBe("legacy_v5");
    expect(describeBackupVersionGap(6).code).toBe("legacy_v6");
    expect(describeBackupVersionGap(6).missing).toContain("跨设备删除记录");
    expect(describeBackupVersionGap(7).code).toBe("current");
  });

  it("旧备份缺失字段回落到默认设置", async () => {
    const text = JSON.stringify({
      magic: "MOBILE_TAVERN_UNIFIED_BACKUP",
      version: 4,
      characters: [],
      sessions: [],
      settings: { api: { apiKey: "old-key" } },
    });
    const normalized = await normalizeBackupPayload({
      text,
      defaultSettings: DEFAULT_SETTINGS,
    });

    expect(normalized.parsedVersion).toBe(4);
    expect(normalized.versionGap.code).toBe("legacy_v4");
    expect(normalized.payload.settings.api.apiKey).toBe("old-key");
    // 旧备份没写的字段必须回落到当前默认值，而不是变成 undefined
    expect(normalized.payload.settings.promptConfig.sectionHeaders).toEqual(
      DEFAULT_SETTINGS.promptConfig.sectionHeaders,
    );
    expect(normalized.payload.settings.memory).toEqual(DEFAULT_SETTINGS.memory);
    expect(normalized.payload.version).toBe(7);
  });

  it("非对象 settings 直接回落到默认值", () => {
    expect(mergeImportedSettings("oops", DEFAULT_SETTINGS)).toEqual(
      structuredClone(DEFAULT_SETTINGS),
    );
  });
});

describe("hostSnapshotSync 覆盖式同步的设置边界", () => {
  it("拉取宿主快照时保留本机设置", async () => {
    const hostText = JSON.stringify(buildUnifiedBackupPayload(snapshotInput()));
    const { impl, calls } = createFetchStub(() => stubResponse(hostText));
    const localSettings = {
      ...DEFAULT_SETTINGS,
      api: { ...DEFAULT_SETTINGS.api, apiKey: "phone-secret" },
    };

    const result = await pullSnapshotFromHost(
      { target: { baseUrl: "192.168.1.10:18080", accessKey: "k" }, localSettings, defaultSettings: DEFAULT_SETTINGS },
      { fetchImpl: impl },
    );

    expect(calls.map((call) => call.url)).toEqual([
      "http://192.168.1.10:18080/api/host/backup/export",
    ]);
    expect(result.ok).toBe(true);
    // 数据来自宿主，设置来自本机：跨设备同步绝不覆盖接收端凭据
    expect(result.payload?.characters[0].name).toBe("宿主角色");
    expect(result.payload?.settings.api.apiKey).toBe("phone-secret");
    expect(result.remoteSummary?.characters).toBe(1);
  });

  it("拉取失败时给出可区分原因", async () => {
    const unauthorized = createFetchStub(() => stubResponse("{}", 401));
    const badPayload = createFetchStub(() => stubResponse("{not-json"));

    const unauthorizedResult = await pullSnapshotFromHost(
      { target: { baseUrl: "host.local:18080", accessKey: "" }, localSettings: DEFAULT_SETTINGS, defaultSettings: DEFAULT_SETTINGS },
      { fetchImpl: unauthorized.impl },
    );
    expect(unauthorizedResult.ok).toBe(false);
    expect(unauthorizedResult.failure).toBe("unauthorized");

    const malformed = await pullSnapshotFromHost(
      { target: { baseUrl: "host.local:18080", accessKey: "" }, localSettings: DEFAULT_SETTINGS, defaultSettings: DEFAULT_SETTINGS },
      { fetchImpl: badPayload.impl },
    );
    expect(malformed.ok).toBe(false);
    expect(malformed.failure).toBe("malformed_json");
  });

  it("推送时要求宿主保留自己的设置，且发送内容不含本机凭据", async () => {
    const hostText = JSON.stringify(buildUnifiedBackupPayload(snapshotInput()));
    const { impl, calls } = createFetchStub(() => stubResponse(hostText));

    const localPayload = buildUnifiedBackupPayload(
      snapshotInput({
        characters: [makeCharacter("phone-char", "手机角色")],
        settings: {
          ...DEFAULT_SETTINGS,
          api: { ...DEFAULT_SETTINGS.api, apiKey: "phone-secret" },
        },
      }),
    );

    const result = await pushSnapshotToHost(
      {
        target: { baseUrl: "http://192.168.1.10:18080", accessKey: "k" },
        localPayload,
        defaultSettings: DEFAULT_SETTINGS,
      },
      { fetchImpl: impl },
    );

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      "http://192.168.1.10:18080/api/host/backup/export",
      "http://192.168.1.10:18080/api/host/backup/import?preserveSettings=true",
    ]);
    expect(result.localSummary?.characters).toBe(1);
    expect(result.remoteSummaryBefore?.characters).toBe(1);

    const importBody = JSON.parse(String(calls[1].init?.body));
    expect(importBody.characters[0].name).toBe("手机角色");
    // 宿主快照是脱敏的，宿主设置只能由宿主自己保留（?preserveSettings=true）；
    // 发送体里不得出现发送端凭据，避免凭据进入传输体与宿主日志
    expect(importBody.settings.api.apiKey).toBe("");
    expect(String(calls[1].init?.body)).not.toContain("phone-secret");
  });

  it("显式关闭接收端设置保留时，导入请求不携带 preserveSettings", async () => {
    const hostText = JSON.stringify(buildUnifiedBackupPayload(snapshotInput()));
    const { impl, calls } = createFetchStub(() => stubResponse(hostText));

    const result = await pushSnapshotToHost(
      {
        target: { baseUrl: "http://192.168.1.10:18080", accessKey: "k" },
        localPayload: buildUnifiedBackupPayload(snapshotInput()),
        defaultSettings: DEFAULT_SETTINGS,
        preserveReceiverSettings: false,
      },
      { fetchImpl: impl },
    );

    expect(result.ok).toBe(true);
    // 关闭保留时不预读宿主（少一次往返），直接覆盖
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://192.168.1.10:18080/api/host/backup/import");
  });

  it("读不到宿主现状时绝不推送", async () => {
    const { impl, calls } = createFetchStub(() => stubResponse("{}", 500));

    const result = await pushSnapshotToHost(
      {
        target: { baseUrl: "http://192.168.1.10:18080", accessKey: "" },
        localPayload: buildUnifiedBackupPayload(snapshotInput()),
        defaultSettings: DEFAULT_SETTINGS,
      },
      { fetchImpl: impl },
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("rejected");
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith("/api/host/backup/export")).toBe(true);
  });

  it("宿主拒收超大载荷时报告明确原因", async () => {
    const hostText = JSON.stringify(buildUnifiedBackupPayload(snapshotInput()));
    const { impl } = createFetchStub((url) =>
      url.endsWith("/backup/export") ? stubResponse(hostText) : stubResponse("{}", 413),
    );

    const result = await pushSnapshotToHost(
      {
        target: { baseUrl: "http://192.168.1.10:18080", accessKey: "" },
        localPayload: buildUnifiedBackupPayload(snapshotInput()),
        defaultSettings: DEFAULT_SETTINGS,
      },
      { fetchImpl: impl },
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("payload_too_large");
  });

  it("网络不可达时归类为 unreachable", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await pullSnapshotFromHost(
      {
        target: { baseUrl: "http://192.168.1.10:18080", accessKey: "" },
        localSettings: DEFAULT_SETTINGS,
        defaultSettings: DEFAULT_SETTINGS,
      },
      { fetchImpl: impl },
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("unreachable");
  });
});
