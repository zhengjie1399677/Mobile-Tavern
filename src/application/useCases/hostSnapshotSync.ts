/**
 * 宿主快照同步编排。
 *
 * 提供两种语义，由调用方显式选择，**默认仍是覆盖式**：
 *
 * - **覆盖（replace）**：谁后写谁生效。拉取用宿主快照整体替换本机数据，推送用本机数据
 *   整体替换宿主数据。两台设备各自新增的内容会互相抹掉，适合"以某一端为准"的场景。
 * - **合并（merge）**：两侧内容求并集，只删掉墓碑判定应消失的实体。跨设备日常同步
 *   应使用这一种，算法见 `backupMerge.ts`。
 *
 * 两种语义共用同一条铁律：`settings` **永远由接收端保留**。备份导出整体脱敏
 * （apiKey 为空），任何"用发送端携带的 settings 去写接收端"的写法都会清空接收端凭据。
 * 合并模式下这条规则自动成立 —— 合并算法只取 local 一侧的设置。
 *
 * 两端格式相同（UnifiedBackupPayload v7，含删除墓碑），所以同步不需要新协议，
 * 直接复用宿主既有的 /api/host/backup/export 与 /import（后者支持 `?mode=merge`）。
 * 覆盖前的二次确认与安全快照由调用方（界面层）负责，本模块不做 UI。
 */
import type { UserSettings } from "../../types";
import {
  redactSettingsForPlainBackup,
  type UnifiedBackupPayload,
} from "./dataMigrationUseCases";
import {
  mergeBackupPayloads,
  type BackupMergePlan,
  type BackupMergeStats,
} from "./backupMerge";
import {
  normalizeBackupPayload,
  summarizeBackupPayload,
  type BackupPayloadIssueCode,
  type BackupPayloadSummary,
  type NormalizedBackupPayload,
} from "./backupPayloadRestore";
import {
  exportHostSnapshot,
  importSnapshotToHost,
  type HostSnapshotFailure,
} from "./hostServiceUseCases";

export type SnapshotSyncFailure = HostSnapshotFailure | BackupPayloadIssueCode;

export interface SnapshotSyncTarget {
  /** 宿主地址，允许省略协议前缀。 */
  readonly baseUrl: string;
  /** 宿主 Bearer 凭据；宿主未配置凭据时留空。 */
  readonly accessKey: string;
}

export interface SnapshotSyncDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface PullSnapshotResult {
  readonly ok: boolean;
  readonly failure?: SnapshotSyncFailure;
  readonly detail?: string;
  /**
   * 待落库的信封。覆盖模式下是宿主快照原文，合并模式下是"本机 ∪ 宿主"的合并结果；
   * 两种情况都已把 `settings` 替换为本机值。
   */
  readonly payload?: UnifiedBackupPayload;
  /** 宿主侧数据量，用于确认文案。 */
  readonly remoteSummary?: BackupPayloadSummary;
  /** 合并模式下的完整变更计划，供界面预览"将新增/更新/删除什么"。 */
  readonly mergePlan?: BackupMergePlan;
  readonly latencyMs: number;
}

export interface PushSnapshotResult {
  readonly ok: boolean;
  readonly failure?: SnapshotSyncFailure;
  readonly detail?: string;
  /** 本机将要推上去的数据量。 */
  readonly localSummary?: BackupPayloadSummary;
  /** 推送前宿主的数据量；缺失表示未能读取宿主现状（此时不建议继续）。 */
  readonly remoteSummaryBefore?: BackupPayloadSummary;
  /** 合并模式下宿主返回的变更统计，用来说明"宿主那边改了什么"。 */
  readonly mergeStats?: BackupMergeStats;
  readonly latencyMs: number;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 拉取宿主快照。
 *
 * 传入 `localPayload` 即为合并模式：以本机数据为 local、宿主快照为 remote 求并集，
 * 返回的 `payload` 是合并结果（调用方确认后再落库），`mergePlan` 含变更统计。
 * 不传则为覆盖模式，行为与既有实现完全一致。
 *
 * 失败时返回可区分原因：网络/鉴权/载荷问题都从底层透传，
 * 备份内容损坏则由备份边界用例给出 code。
 */
export async function pullSnapshotFromHost(
  input: {
    target: SnapshotSyncTarget;
    /** 接收端（本机）当前设置：跨设备同步不得被宿主设置覆盖。 */
    localSettings: UserSettings;
    /** 默认设置，用于宿主旧版快照的字段回落。 */
    defaultSettings: UserSettings;
    /** 本机当前信封；提供即切换到合并模式。 */
    localPayload?: UnifiedBackupPayload;
  },
  deps?: SnapshotSyncDeps,
): Promise<PullSnapshotResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const exported = await exportHostSnapshot(input.target, deps);
  if (!exported.ok || !exported.text) {
    return {
      ok: false,
      failure: exported.failure ?? "empty_response",
      detail: exported.detail,
      latencyMs: elapsed(),
    };
  }

  let normalized: NormalizedBackupPayload;
  try {
    normalized = await normalizeBackupPayload({
      text: exported.text,
      defaultSettings: input.defaultSettings,
    });
  } catch (err: unknown) {
    return {
      ok: false,
      failure: err instanceof Error && "code" in err
        ? (err as { code: BackupPayloadIssueCode }).code
        : "rejected",
      detail: describeError(err),
      latencyMs: elapsed(),
    };
  }

  if (input.localPayload) {
    // 合并模式：合并算法只取 local 一侧的设置，因此本机凭据天然不会被宿主快照覆盖。
    const plan = mergeBackupPayloads({
      local: { ...input.localPayload, settings: input.localSettings },
      remote: normalized.payload,
    });
    return {
      ok: true,
      payload: plan.merged,
      remoteSummary: normalized.summary,
      mergePlan: plan,
      latencyMs: elapsed(),
    };
  }

  return {
    ok: true,
    payload: { ...normalized.payload, settings: input.localSettings },
    remoteSummary: normalized.summary,
    latencyMs: elapsed(),
  };
}

/**
 * 推送本机快照到宿主（覆盖宿主数据）。
 *
 * `preserveReceiverSettings` 默认为 true，且不建议关闭：宿主快照导出是脱敏的，
 * 发送端既拿不到也不该拿到宿主的凭据，所以"宿主设置"只能由宿主自己保留
 * （`?preserveSettings=true`）。关闭它等于用本机设置覆盖宿主的 API Key 等配置。
 */
export async function pushSnapshotToHost(
  input: {
    target: SnapshotSyncTarget;
    /** 发送端（本机）当前数据信封。 */
    localPayload: UnifiedBackupPayload;
    /** 默认设置，用于读取宿主现状时的字段回落。 */
    defaultSettings: UserSettings;
    preserveReceiverSettings?: boolean;
    /** 导入语义；`merge` 让宿主把本机快照并进自己的数据，而不是整体替换。 */
    mode?: "replace" | "merge";
  },
  deps?: SnapshotSyncDeps,
): Promise<PushSnapshotResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const localSummary = summarizeBackupPayload(input.localPayload);
  const preserveReceiverSettings = input.preserveReceiverSettings !== false;
  const mode = input.mode === "merge" ? "merge" : "replace";

  let remoteSummaryBefore: BackupPayloadSummary | undefined;

  // 合并模式同样要先读宿主现状：既确认可达，也用于说明这次会并进什么。
  if (mode === "merge" || preserveReceiverSettings) {
    // 只读探测：确认宿主可达，并为确认文案提供宿主侧数据量。
    // 注意这里刻意不使用宿主快照里的 settings —— 那是脱敏结果，回写会抹掉宿主凭据。
    const exported = await exportHostSnapshot(input.target, deps);
    if (!exported.ok || !exported.text) {
      return {
        ok: false,
        failure: exported.failure ?? "empty_response",
        detail: exported.detail,
        localSummary,
        latencyMs: elapsed(),
      };
    }
    try {
      const normalizedHost = await normalizeBackupPayload({
        text: exported.text,
        defaultSettings: input.defaultSettings,
      });
      remoteSummaryBefore = normalizedHost.summary;
    } catch (err: unknown) {
      return {
        ok: false,
        failure: err instanceof Error && "code" in err
          ? (err as { code: BackupPayloadIssueCode }).code
          : "rejected",
        detail: describeError(err),
        localSummary,
        latencyMs: elapsed(),
      };
    }
  }

  // 发送前脱敏：宿主会保留自己的设置，这里再抹一层，避免发送端凭据进入传输体与宿主日志。
  const outgoing: UnifiedBackupPayload = {
    ...input.localPayload,
    settings: redactSettingsForPlainBackup(input.localPayload.settings),
  };

  const imported = await importSnapshotToHost(
    input.target,
    JSON.stringify(outgoing),
    { ...deps, preserveReceiverSettings, mode },
  );
  if (!imported.ok) {
    return {
      ok: false,
      failure: imported.failure ?? "rejected",
      detail: imported.detail,
      localSummary,
      remoteSummaryBefore,
      latencyMs: elapsed(),
    };
  }

  return {
    ok: true,
    localSummary,
    remoteSummaryBefore,
    mergeStats: imported.mergeStats,
    latencyMs: elapsed(),
  };
}
