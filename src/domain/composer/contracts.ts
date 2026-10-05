/**
 * 输入框斜杠命令（turn composer command）的中立契约。
 *
 * 这类命令的语义是：**由用户主动触发，把结果回填到输入框草稿，绝不自动发送**。
 * 宿主内置命令（`host.builtin`）、Tool Plugin 命令、外部能力源的提示词模板都注册到同一处，
 * 避免每个来源各自实现一套草稿插入（见 M3b 与 context_source_seam_design.md 的路径收敛）。
 */

export interface ComposerCommandDescriptor {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  /** 归属标识：`host.builtin`、`tool-plugin/<id>`、`external-source/<id>`。 */
  readonly owner: string;
  readonly acceptsArgument: boolean;
}

export interface ComposerCommandRequest {
  readonly profileId: string;
  readonly sessionId: string;
  readonly argument: string;
  readonly signal?: AbortSignal;
}

export interface ComposerCommandDefinition {
  readonly descriptor: ComposerCommandDescriptor;
  /** 可用 Profile；`["*"]` 表示全部 Profile。 */
  readonly profileIds: readonly string[];
  /** 返回回填到输入框草稿的文本。 */
  run(request: ComposerCommandRequest): Promise<string>;
}

/** 命令名规范化：去空格并小写，与既有 `/命令` 解析保持一致。 */
export function normalizeComposerCommandName(name: string): string {
  return name.trim().toLowerCase();
}
