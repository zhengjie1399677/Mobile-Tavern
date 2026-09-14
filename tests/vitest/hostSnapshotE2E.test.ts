// @vitest-environment happy-dom
/**
 * 宿主快照同步端到端验证：进程内装配真实 headless 宿主（真 express、真端口、真落盘），
 * 跑通「推送 / 拉取」全链路。
 *
 * 为什么需要它：单元测试用 stub fetch 只能证明"请求发对了"，证明不了宿主真的接受这份载荷、
 * 真的落盘、以及宿主自己保存的设置不会被同步覆盖。这里把两条硬约束钉死：
 * 1. 推送后宿主数据 = 本机数据，但宿主的本机设置（含 API Key）未被本机设置覆盖。
 * 2. 拉取后本机拿到的 settings 必须是本机自己的（含 API Key）。
 *
 * 关于传输层：测试环境是 happy-dom，其 window.fetch 会执行同源策略，直连本机宿主端口会被
 * CORS 拦截（真机走 tauri-plugin-http，由 Rust 侧发出，不受此限制）。因此这里用 Node http
 * 直连，既绕开测试环境限制，又验证真实的 HTTP 往返（含鉴权与 50mb body 限制）。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  pullSnapshotFromHost,
  pushSnapshotToHost,
} from "../../src/application/useCases/hostSnapshotSync";
import { buildUnifiedBackupPayload } from "../../src/application/useCases/dataMigrationUseCases";
import {
  KernelServices,
  type ISettingsService,
} from "../../src/application/serviceContracts";
import type { CharacterCard, ChatSession, Message, UserSettings } from "../../src/types";
import type { SyncTombstone } from "../../src/domain/sync/tombstones";

const PORT = 18241;
const API_KEY = "e2e-host-key";
const DATA_DIR = path.resolve(process.cwd(), "tmp/e2e-host-data-vitest");
const BASE = `http://127.0.0.1:${PORT}`;

type HostInstance = Awaited<
  ReturnType<typeof import("../../headless/bootstrap").bootstrapHeadlessHost>
>;
type ServerHandle = Awaited<
  ReturnType<typeof import("../../headless/server").startHeadlessServer>
>;

let host: HostInstance | null = null;
let server: ServerHandle | null = null;

/** 最小 fetch 兼容实现：走 Node http，避开 happy-dom 的同源策略。 */
function nodeFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => body,
            json: async () => JSON.parse(body),
          } as unknown as Response);
        });
      },
    );
    request.on("error", reject);
    if (init?.body) request.write(String(init.body));
    request.end();
  });
}

const httpFetch = nodeFetch as unknown as typeof fetch;
const fetchDeps = { fetchImpl: httpFetch };

function character(id: string, name: string): CharacterCard {
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

function settingsWith(apiKey: string): UserSettings {
  return {
    api: { apiKey },
    memory: {},
    promptConfig: { sectionHeaders: {} },
  } as unknown as UserSettings;
}

function snapshotText(options: { characters: CharacterCard[]; apiKey: string }): string {
  return JSON.stringify(
    buildUnifiedBackupPayload({
      characters: options.characters,
      sessions: [],
      memoryFragments: [],
      memoryFacts: [],
      settings: settingsWith(options.apiKey),
      globalLorebook: [],
      customWorldbooks: {},
      backupDate: new Date().toISOString(),
      isEncrypted: false,
    }),
  );
}

function phonePayload() {
  return buildUnifiedBackupPayload({
    characters: [character("phone-char", "手机角色")],
    sessions: [],
    memoryFragments: [],
    memoryFacts: [],
    settings: settingsWith("phone-secret"),
    globalLorebook: [],
    customWorldbooks: {},
    backupDate: new Date().toISOString(),
    isEncrypted: false,
  });
}

const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

/** 直接读宿主进程内的设置：宿主导出的快照是脱敏的，看不到真实凭据。 */
async function readHostApiKey(): Promise<string> {
  if (!host) throw new Error("宿主尚未启动");
  const settingsService = host.kernel.getService<ISettingsService<UserSettings>>(
    KernelServices.Settings,
  );
  const stored = await settingsService.getStoredSettings();
  return stored?.api?.apiKey ?? "";
}

beforeAll(async () => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  process.env.NODE_ENV = "test";
  process.env.HEADLESS_PORT = String(PORT);
  process.env.HEADLESS_HOST = "127.0.0.1";
  process.env.HEADLESS_API_KEY = API_KEY;
  process.env.HEADLESS_DATA_DIR = DATA_DIR;

  const { loadHeadlessConfig } = await import("../../headless/config");
  const { bootstrapHeadlessHost } = await import("../../headless/bootstrap");
  const { startHeadlessServer } = await import("../../headless/server");

  host = await bootstrapHeadlessHost(loadHeadlessConfig());
  server = await startHeadlessServer(host);
}, 120_000);

afterAll(async () => {
  await server?.close().catch(() => undefined);
  await host?.dispose().catch(() => undefined);
}, 30_000);

describe("真实宿主上的覆盖式同步", () => {
  it("宿主接受统一备份并落盘，且无凭据访问被拒", async () => {
    const seeded = await nodeFetch(`${BASE}/api/host/backup/import`, {
      method: "POST",
      headers: authHeaders,
      body: snapshotText({
        characters: [character("host-char", "宿主角色")],
        apiKey: "host-secret",
      }),
    });
    expect(seeded.ok).toBe(true);

    const anonymous = await nodeFetch(`${BASE}/api/host/backup/export`, { method: "POST" });
    expect(anonymous.status).toBe(401);

    const files = fs.readdirSync(DATA_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it("推送：覆盖宿主数据，但保留宿主自己的设置", async () => {
    const pushed = await pushSnapshotToHost(
      {
        target: { baseUrl: BASE, accessKey: API_KEY },
        localPayload: phonePayload(),
        defaultSettings: settingsWith("phone-secret"),
      },
      fetchDeps,
    );
    expect(pushed.ok).toBe(true);
    expect(pushed.remoteSummaryBefore?.characters).toBe(1);

    const exportedRes = await nodeFetch(`${BASE}/api/host/backup/export`, {
      method: "POST",
      headers: authHeaders,
    });
    const exportedText = await exportedRes.text();
    const exported = JSON.parse(exportedText) as {
      characters: Array<{ id: string }>;
      settings: { api: { apiKey: string } };
    };

    expect(exported.characters.map((c) => c.id)).toEqual(["phone-char"]);
    // 宿主导出的快照本身就是脱敏的（apiKey 一定为空），所以必须读宿主进程内的设置来验证。
    // 核心不变量：推送不得改变宿主自己的凭据。
    expect(await readHostApiKey()).toBe("host-secret");
    // 发送端凭据既不该出现在宿主体内，也不该出现在传输结果里
    expect(exportedText.includes("phone-secret")).toBe(false);
  });

  it("拉取：数据来自宿主，设置保留本机", async () => {
    const pulled = await pullSnapshotFromHost(
      {
        target: { baseUrl: BASE, accessKey: API_KEY },
        localSettings: settingsWith("phone-secret"),
        defaultSettings: settingsWith("phone-secret"),
      },
      fetchDeps,
    );

    expect(pulled.ok).toBe(true);
    expect(pulled.payload?.characters.map((c) => c.id)).toEqual(["phone-char"]);
    expect(pulled.payload?.settings.api.apiKey).toBe("phone-secret");
  });

  it("失败原因可区分：凭据错误 / 端口不通 / 协议非法", async () => {
    const badKey = await pullSnapshotFromHost(
      {
        target: { baseUrl: BASE, accessKey: "wrong-key" },
        localSettings: settingsWith("phone-secret"),
        defaultSettings: settingsWith("phone-secret"),
      },
      fetchDeps,
    );
    expect(badKey.failure).toBe("unauthorized");

    const unreachable = await pullSnapshotFromHost(
      {
        target: { baseUrl: "http://127.0.0.1:19999", accessKey: "" },
        localSettings: settingsWith("phone-secret"),
        defaultSettings: settingsWith("phone-secret"),
      },
      fetchDeps,
    );
    expect(unreachable.failure).toBe("unreachable");

    const invalidUrl = await pullSnapshotFromHost(
      {
        target: { baseUrl: "ftp://nope", accessKey: "" },
        localSettings: settingsWith("phone-secret"),
        defaultSettings: settingsWith("phone-secret"),
      },
      fetchDeps,
    );
    expect(invalidUrl.failure).toBe("invalid_url");
  });

  it("读不到宿主现状时不会发出导入请求", async () => {
    const pushed = await pushSnapshotToHost(
      {
        target: { baseUrl: "http://127.0.0.1:19999", accessKey: "" },
        localPayload: phonePayload(),
        defaultSettings: settingsWith("phone-secret"),
      },
      fetchDeps,
    );
    expect(pushed.ok).toBe(false);
    expect(pushed.failure).toBe("unreachable");
  });

  it("不带 preserveSettings 的导入会覆盖宿主设置（证明该防护真的在起作用）", async () => {
    const res = await nodeFetch(`${BASE}/api/host/backup/import`, {
      method: "POST",
      headers: authHeaders,
      body: snapshotText({
        characters: [character("raw-char", "直灌角色")],
        apiKey: "phone-secret",
      }),
    });
    expect(res.ok).toBe(true);
    // 不带 preserveSettings 时，请求体里的 settings 会**直接覆盖**宿主设置。
    // 真实客户端推送时发送的是脱敏副本（apiKey 已抹除），所以后果是把宿主凭据清空
    // —— 这正是同步流程必须显式要求宿主保留设置的原因。
    expect(await readHostApiKey()).toBe("phone-secret");
  });
});

/**
 * 合并模式（`?mode=merge`）在真实宿主上的行为。
 *
 * 覆盖式同步的断言只能证明"宿主接受了载荷"，证明不了"两台设备各自新增的数据都还在"。
 * 这里把合并语义的三条性质钉在真实宿主上：对端独有内容不丢、宿主独有内容不丢、
 * 删除墓碑能跨设备生效 —— 同时保留"宿主自己的凭据永远不被同步改动"这条铁律。
 */
function makeMessage(id: string, timestamp: number): Message {
  return { id, sender: "user", content: `内容 ${id}`, timestamp };
}

function makeSession(id: string, messages: Message[], updatedAt = 100): ChatSession {
  return {
    id,
    characterId: "character-1",
    title: `会话 ${id}`,
    createdAt: 1,
    messages,
    summaries: [],
    lifecycle: "active",
    updatedAt,
    contentRevision: 1,
  };
}

interface SeedOptions {
  characters: CharacterCard[];
  sessions?: ChatSession[];
  tombstones?: SyncTombstone[];
  apiKey: string;
}

function payloadText(options: SeedOptions): string {
  return JSON.stringify(
    buildUnifiedBackupPayload({
      characters: options.characters,
      sessions: options.sessions ?? [],
      memoryFragments: [],
      memoryFacts: [],
      settings: settingsWith(options.apiKey),
      globalLorebook: [],
      customWorldbooks: {},
      tombstones: options.tombstones ?? [],
      backupDate: new Date().toISOString(),
      isEncrypted: false,
    }),
  );
}

interface ExportedSnapshot {
  characters: Array<{ id: string }>;
  sessions: Array<{ id: string }>;
  tombstones: SyncTombstone[];
}

async function exportHostSnapshotRaw(): Promise<ExportedSnapshot> {
  const res = await nodeFetch(`${BASE}/api/host/backup/export`, {
    method: "POST",
    headers: authHeaders,
  });
  return JSON.parse(await res.text()) as ExportedSnapshot;
}

/** 直灌宿主、不保留设置 —— 用于把宿主重置到一个已知状态。 */
async function seedHost(options: SeedOptions): Promise<void> {
  const res = await nodeFetch(`${BASE}/api/host/backup/import`, {
    method: "POST",
    headers: authHeaders,
    body: payloadText(options),
  });
  expect(res.ok).toBe(true);
}

describe("真实宿主上的合并式同步", () => {
  it("推送合并：宿主独有内容保留、对端新增内容并入、宿主凭据不变", async () => {
    await seedHost({
      characters: [character("host-char", "宿主角色")],
      sessions: [makeSession("hs", [makeMessage("hm1", 100)])],
      apiKey: "host-secret",
    });

    const pushed = await pushSnapshotToHost(
      {
        target: { baseUrl: BASE, accessKey: API_KEY },
        localPayload: buildUnifiedBackupPayload({
          characters: [character("phone-char", "手机角色")],
          sessions: [makeSession("ps", [makeMessage("pm1", 200)])],
          memoryFragments: [],
          memoryFacts: [],
          settings: settingsWith("phone-secret"),
          globalLorebook: [],
          customWorldbooks: {},
          backupDate: new Date().toISOString(),
          isEncrypted: false,
        }),
        defaultSettings: settingsWith("phone-secret"),
        mode: "merge",
      },
      fetchDeps,
    );

    expect(pushed.ok).toBe(true);
    // 宿主侧变更统计必须回到客户端，否则界面无法说明"这次同步改了什么"。
    expect(pushed.mergeStats?.characters.added).toBe(1);
    expect(pushed.mergeStats?.sessions.added).toBe(1);
    expect(pushed.mergeStats?.sessions.removed).toBe(0);

    const exported = await exportHostSnapshotRaw();
    // 两侧独有内容都在 —— 这正是合并区别于覆盖的地方。
    expect(exported.characters.map((item) => item.id).sort()).toEqual(["host-char", "phone-char"]);
    expect(exported.sessions.map((item) => item.id).sort()).toEqual(["hs", "ps"]);
    // 合并模式无条件保留宿主设置，无需 preserveSettings 参数。
    expect(await readHostApiKey()).toBe("host-secret");
  });

  it("推送合并：对端的删除墓碑在宿主上生效", async () => {
    await seedHost({
      characters: [character("host-char", "宿主角色")],
      sessions: [makeSession("gone", [makeMessage("gm1", 100)], 100)],
      apiKey: "host-secret",
    });

    const pushed = await pushSnapshotToHost(
      {
        target: { baseUrl: BASE, accessKey: API_KEY },
        localPayload: buildUnifiedBackupPayload({
          characters: [],
          sessions: [makeSession("kept", [makeMessage("km1", 300)])],
          memoryFragments: [],
          memoryFacts: [],
          settings: settingsWith("phone-secret"),
          globalLorebook: [],
          customWorldbooks: {},
          // 本机曾同步过该会话后将其删除，因此墓碑时间晚于会话的 updatedAt。
          tombstones: [
            { entity: "session", targetId: "gone", sessionId: "gone", deletedAt: 999 },
          ],
          backupDate: new Date().toISOString(),
          isEncrypted: false,
        }),
        defaultSettings: settingsWith("phone-secret"),
        mode: "merge",
      },
      fetchDeps,
    );

    expect(pushed.ok).toBe(true);
    expect(pushed.mergeStats?.sessions.removed).toBe(1);

    const exported = await exportHostSnapshotRaw();
    expect(exported.sessions.map((item) => item.id)).toEqual(["kept"]);
    expect(exported.tombstones.map((item) => item.targetId)).toEqual(["gone"]);
  });

  it("拉取合并：本机独有会话与宿主会话求并集，设置保留本机", async () => {
    await seedHost({
      characters: [character("host-char", "宿主角色")],
      sessions: [makeSession("hs", [makeMessage("hm1", 100)])],
      apiKey: "host-secret",
    });

    const localPayload = buildUnifiedBackupPayload({
      characters: [character("phone-char", "手机角色")],
      sessions: [makeSession("local-only", [makeMessage("lm1", 400)])],
      memoryFragments: [],
      memoryFacts: [],
      settings: settingsWith("phone-secret"),
      globalLorebook: [],
      customWorldbooks: {},
      backupDate: new Date().toISOString(),
      isEncrypted: false,
    });

    const pulled = await pullSnapshotFromHost(
      {
        target: { baseUrl: BASE, accessKey: API_KEY },
        localSettings: settingsWith("phone-secret"),
        defaultSettings: settingsWith("phone-secret"),
        localPayload,
      },
      fetchDeps,
    );

    expect(pulled.ok).toBe(true);
    expect(pulled.payload?.sessions.map((item) => item.id).sort()).toEqual(["hs", "local-only"]);
    expect(pulled.payload?.characters.map((item) => item.id).sort()).toEqual([
      "host-char",
      "phone-char",
    ]);
    // 合并算法只取 local 一侧的设置，本机凭据不会被宿主快照覆盖。
    expect(pulled.payload?.settings.api.apiKey).toBe("phone-secret");
    // 预览能力的前提：拉取就要带回合并计划，界面才能"先看再落库"。
    expect(pulled.mergePlan?.stats.sessions.added).toBe(1);
    expect(pulled.mergePlan?.mergedSummary.sessions).toBe(2);
  });

  it("结构异常的墓碑被拒收，而不是静默产出错误合并结果", async () => {
    const res = await nodeFetch(`${BASE}/api/host/backup/import?mode=merge`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        ...(JSON.parse(payloadText({
          characters: [character("host-char", "宿主角色")],
          apiKey: "host-secret",
        })) as Record<string, unknown>),
        tombstones: "not-an-array",
      }),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    const body = JSON.parse(await res.text()) as { error: string };
    expect(body.error).toContain("tombstones");
  });
});
