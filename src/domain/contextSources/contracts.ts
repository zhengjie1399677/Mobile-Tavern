/**
 * 通用上下文来源缝的中立契约（C0，暂不接线）。
 *
 * 来源只负责「给出一段内容」：不决定消息角色、位置或包装文案，那些属于预设编排。
 * 设计依据见 `docs/agents/context_source_seam_design.md`。
 */

const CONTEXT_SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;
/** 与 Prompt 宏名实际用法对齐：`memory.recalled`、`worldbook.triggered`、`char` 都必须合法。 */
const CONTEXT_MACRO_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

const MAX_CHARACTERS_LIMIT = 200_000;
const MAX_TIMEOUT_MS = 60_000;

export interface ContextSourceRequest {
  readonly sessionId: string;
  readonly userInput: string;
  /** 本轮对应的消息轮次（重发时指向被重发的消息）；与来源无关的通用定位信息。 */
  readonly turnIndex?: number;
  readonly signal: AbortSignal;
}

/**
 * 来源的读取结果。
 *
 * `content` 是唯一会进入提示词的部分；`audit` 是**仅供审计与诊断**的结构化数据
 * （例如本轮命中了哪些记忆片段、为什么丢弃），永不进入提示词，也不得包含秘密。
 * 体积由来源负责约束，只允许放小的标识与统计。
 */
export interface ContextSourceReadResult {
  readonly content: string;
  readonly audit?: unknown;
}

/**
 * 确定性声明：deterministic 表示相同输入必得相同输出（重生成可复现）；
 * volatile 表示依赖时间/网络/随机，重生成可能不同，必须显式声明以便诊断。
 */
export type ContextSourceDeterminism = "deterministic" | "volatile";

export interface ContextSourceDefinition {
  readonly id: string;
  readonly version: string;
  /** 宏名。新来源用 `context.<id>`；迁移既有来源时保留旧宏名以免破坏现存预设。 */
  readonly macroName: string;
  readonly determinism: ContextSourceDeterminism;
  /** 单来源内容上限；真正的取舍仍由 Prompt 编译器按 Token 预算裁决。 */
  readonly maxCharacters: number;
  readonly timeoutMs: number;
  /** 允许直接返回字符串（无审计数据）；需要审计时返回 {@link ContextSourceReadResult}。 */
  read(request: ContextSourceRequest): Promise<string | ContextSourceReadResult>;
}

export type ContextContributionStatus = "ok" | "empty" | "failed" | "timeout" | "truncated";

export interface ContextContribution {
  readonly sourceId: string;
  readonly macroName: string;
  readonly content: string;
  readonly status: ContextContributionStatus;
  readonly characters: number;
  readonly detail?: string;
  /** 审计专用结构化数据；调用方（诊断/审计 UI）消费，绝不进入提示词。 */
  readonly audit?: unknown;
}

export function contextSourceError(code: string, detail: string): Error {
  return new Error(`${code}:${detail}`);
}

/**
 * 校验并冻结一个来源定义。
 *
 * 注册表必须为**每个已注册来源**产出一条贡献（即使内容为空），否则用户预设里引用的宏会
 * 以字面量 `{{...}}` 漏进提示词——这是本缝最容易踩的坑，故在契约层就固定下来。
 */
export function createContextSourceDefinition(
  definition: ContextSourceDefinition,
): ContextSourceDefinition {
  if (!CONTEXT_SOURCE_ID_PATTERN.test(definition.id)) {
    throw contextSourceError("CONTEXT_SOURCE_ID_INVALID", definition.id);
  }
  if (!CONTEXT_MACRO_NAME_PATTERN.test(definition.macroName)) {
    throw contextSourceError("CONTEXT_SOURCE_MACRO_NAME_INVALID", definition.macroName);
  }
  if (!definition.version.trim()) {
    throw contextSourceError("CONTEXT_SOURCE_VERSION_INVALID", definition.id);
  }
  if (
    !Number.isInteger(definition.maxCharacters)
    || definition.maxCharacters <= 0
    || definition.maxCharacters > MAX_CHARACTERS_LIMIT
  ) {
    throw contextSourceError(
      "CONTEXT_SOURCE_MAX_CHARACTERS_INVALID",
      `${definition.id}:${definition.maxCharacters}`,
    );
  }
  if (
    !Number.isInteger(definition.timeoutMs)
    || definition.timeoutMs <= 0
    || definition.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw contextSourceError(
      "CONTEXT_SOURCE_TIMEOUT_INVALID",
      `${definition.id}:${definition.timeoutMs}`,
    );
  }
  return Object.freeze({ ...definition });
}
