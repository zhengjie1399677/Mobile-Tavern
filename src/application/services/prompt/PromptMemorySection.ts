/**
 * 旧路径（非自由编排）下召回记忆区块的格式化。
 *
 * 从 PromptService 抽出：该文件已贴近 QUALITY-TYPES 的 1000 行硬上限，
 * 而 C1b/C4 还会继续在该文件接线通用上下文来源，因此先把这块独立职责分离。
 */

interface RecalledMemoryEntry {
  kind?: "fact" | "event";
  turnIndex?: number;
  content?: string;
  role?: "user" | "assistant" | string;
}

/** 把召回记忆格式化为 Relevant Memories 区块内容；空输入返回空字符串。 */
export function formatRecalledMemoriesSection(recalledMemories: readonly unknown[]): string {
  if (recalledMemories.length === 0) return "";
  return recalledMemories
    .map((item: unknown) => {
      const entry = item as RecalledMemoryEntry;
      return entry.kind === "fact"
        ? `[当前事实｜第 ${entry.turnIndex} 轮起]: ${entry.content}`
        : `[第 ${entry.turnIndex} 轮 - ${entry.role === "user" ? "用户" : "角色"}]: ${entry.content}`;
    })
    .join("\n");
}
