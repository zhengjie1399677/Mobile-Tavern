/**
 * 流式 / 完整响应文本的纯函数解析工具。
 *
 * 从 useChat.tsx 抽离，遵循 AGENTS.md 核心行为准则一 §1（极致微服务与解耦）与
 * 准则八（AI 协作物理隔离开发铁律）：本文件仅包含无 React 依赖的纯函数，
 * 可被独立单兵测试，亦可随时抽离为独立的微模块。
 *
 * 对外导出与原 useChat.tsx 内部实现完全等价，不改变任何行为语义。
 */

/**
 * 从模型回复中分离 <think>...</think> 推理内容与正文。
 *
 * - 流式场景下若 <think> 未闭合，正文暂以 "💭..." 占位，避免渲染空白。
 * - 非流式场景下未闭合的 <think> 会被视为无正文（返回空串）。
 */
export function extractThinkContent(
  content: string,
  reasoningContent?: string,
  isStreaming: boolean = false
): { content: string; reasoningContent?: string } {
  if (!content) return { content, reasoningContent };

  const thinkStart = "<think>";
  const thinkEnd = "</think>";

  if (content.includes(thinkStart)) {
    const startIdx = content.indexOf(thinkStart);
    const endIdx = content.indexOf(thinkEnd);

    if (endIdx !== -1) {
      const extractedReasoning = content.substring(startIdx + thinkStart.length, endIdx).trim();
      const restContent = content.substring(endIdx + thinkEnd.length).trim();
      return {
        content: restContent,
        reasoningContent: extractedReasoning || reasoningContent
      };
    } else {
      const extractedReasoning = content.substring(startIdx + thinkStart.length).trim();
      return {
        content: isStreaming ? "💭..." : "",
        reasoningContent: extractedReasoning || reasoningContent
      };
    }
  }
  return { content, reasoningContent };
}

/**
 * 从正文中剥离 <suggestions>...</suggestions> 块，分离出干净正文与建议原始文本。
 */
export function cleanSuggestionsFromText(text: string): { content: string; suggestionsText?: string } {
  if (!text) return { content: text };

  const suggestionsStart = "<suggestions>";
  if (text.includes(suggestionsStart)) {
    const startIdx = text.indexOf(suggestionsStart);
    const suggestionsEnd = "</suggestions>";
    const endIdx = text.indexOf(suggestionsEnd);

    const cleanContent = text.substring(0, startIdx).trim();
    let suggestionsText = "";
    if (endIdx !== -1) {
      suggestionsText = text.substring(startIdx + suggestionsStart.length, endIdx).trim();
    } else {
      suggestionsText = text.substring(startIdx + suggestionsStart.length).trim();
    }
    return { content: cleanContent, suggestionsText };
  }
  return { content: text };
}

/**
 * 将单段文本拆分为多条目。
 * 优先按换行拆分；若只有一行则尝试按 "1. 2. 3." / "1、2、" 等编号模式拆分。
 */
export function splitTextIntoItems(text: string): string[] {
  let lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  const splitPattern = /\s+(?=\(?\d+[\.、．:]\s+)/g;
  const replaced = text.replace(splitPattern, "\n");
  lines = replaced.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines;
  }

  return [text];
}
