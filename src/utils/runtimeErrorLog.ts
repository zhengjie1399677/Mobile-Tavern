/**
 * 运行期错误环缓冲：留住最近若干条 `window` 级错误，供系统报告取证。
 *
 * 为什么需要它：部分现场（整屏发暗、界面点不动、"文字消失"）属于渲染与合成层面的
 * 故障——计算样式与 DOM 全都"正常"，主题自检因此报平安，只有 JS 错误能留下线索。
 * 捕获点仍是唯一的一处（`utils/telemetry.ts` 的 `installGlobalErrorHandlers`），
 * 本模块只做缓冲与格式化：不落盘、不上报、不解释错误语义。
 * 与 `viewportDiagnostic` 同属"现场黑匣子"。
 */

export interface RuntimeErrorEntry {
  kind: "error" | "unhandledrejection";
  message: string;
  /** 出错位置（能取到才填，形如 `file:line`）。 */
  source?: string;
  at: number;
}

const MAX_RUNTIME_ERROR_ENTRIES = 20;

const entries: RuntimeErrorEntry[] = [];

/** 记录一条运行期错误；超过上限时丢弃最旧的。 */
export function recordRuntimeError(entry: RuntimeErrorEntry): void {
  entries.push(entry);
  if (entries.length > MAX_RUNTIME_ERROR_ENTRIES) {
    entries.splice(0, entries.length - MAX_RUNTIME_ERROR_ENTRIES);
  }
}

/** 最近若干条运行期错误（按发生顺序，最新在后）。 */
export function getRecentRuntimeErrors(): readonly RuntimeErrorEntry[] {
  return [...entries];
}

/** 单行文本，供系统报告直接输出。 */
export function formatRuntimeErrorEntry(entry: RuntimeErrorEntry): string {
  const time = new Date(entry.at).toISOString().slice(11, 19);
  const source = entry.source ? ` @${entry.source}` : "";
  return `[${time}] ${entry.kind}: ${entry.message}${source}`;
}

/** 仅测试用：清空缓冲，避免用例之间互相污染。 */
export function resetRuntimeErrorLogForTest(): void {
  entries.length = 0;
}
