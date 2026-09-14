/**
 * 宿主快照同步编排（覆盖式）。
 *
 * 语义先说清楚：这是**覆盖式同步**，不是合并。谁后写谁生效。
 * 因此本模块只做两件事，并把最容易踩的坑挡在用例层：
 *
 * 1. **拉取（宿主 → 本机）**：拿宿主快照覆盖本机角色/会话/记忆/世界书，
 *    但 `settings` 保留**本机**值 —— 否则手机端的 API Key、主题、语言会被宿主的覆盖。
 * 2. **推送（本机 → 宿主）**：用本机数据覆盖宿主快照，但 `settings` 用**宿主自己**的 ——
 *    为此推送前先读一次宿主快照；读不到就不推，绝不拿本机设置去盖宿主。
 *
 * 两端格式相同（UnifiedBackupPayload v6），所以同步不需要新协议，
 * 直接复用宿主既有的 /api/host/backup/export 与 /import。
 * 覆盖前的二次确认与安全快照由调用方（界面层）负责，本模块不做 UI。
 */
import type { UserSettings } from "../../types";
import {
  redactSettingsForPlainBackup,
  type UnifiedBackupPayload,
} from "./dataMigrationUseCases";
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
  /** 归一化后的宿主快照，且 `settings` 已替换为本机值。 */
  readonly payload?: UnifiedBackupPayload;
  /** 宿主侧数据量，用于覆盖确认文案。 */
  readonly remoteSummary?: BackupPayloadSummary;
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
  readonly latencyMs: number;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 拉取宿主快照。
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
  },
  deps?: SnapshotSyncDeps,
): Promise<PushSnapshotResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const localSummary = summarizeBackupPayload(input.localPayload);
  const preserveReceiverSettings = input.preserveReceiverSettings !== false;

  let remoteSummaryBefore: BackupPayloadSummary | undefined;

  if (preserveReceiverSettings) {
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
    { ...deps, preserveReceiverSettings },
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
    latencyMs: elapsed(),
  };
}
