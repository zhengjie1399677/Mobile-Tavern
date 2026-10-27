/**
 * 把 PromptBuilder 注册的分区按当前运行上下文编译成审计快照。
 *
 * 复用到编译阶段同一套 section.compile，避免 UI 展示的提示词与真正发送的
 * System Prompt 出现第二套拼接逻辑。分区编译失败只影响审计展示，不阻塞发送。
 */
import type { PromptSection, RuntimeContext } from "./types";
import type { PromptAuditSection } from "../../../domain/promptAudit";

export function collectPromptAuditSections(
  sections: readonly PromptSection[],
  context: RuntimeContext,
): PromptAuditSection[] {
  const collected: PromptAuditSection[] = [];
  for (const section of sections) {
    if (!section.enabled) continue;
    try {
      const node = section.compile(context);
      const content = typeof node?.content === "string" ? node.content : "";
      if (!content.trim()) continue;
      collected.push({
        id: node.id ?? section.id,
        title: node.title ?? node.id ?? section.id,
        phase: node.phase ?? section.phase,
        chars: content.length,
        content,
      });
    } catch {
      // 单个分区编译失败时跳过，保持与 PromptCompiler 一致的容错策略。
    }
  }
  return collected;
}
