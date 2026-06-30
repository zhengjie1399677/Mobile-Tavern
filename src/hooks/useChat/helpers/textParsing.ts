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

  // 极致视觉优化：流式传输时，若内容仅为未完整的 <think> 标签前缀（如 <, <t, <th 等），直接以 💭... 占位，防止标签闪烁
  if (isStreaming && content.length > 0 && thinkStart.startsWith(content)) {
    return { content: "💭...", reasoningContent };
  }

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

export function cleanAllMetadataFromText(text: string): { content: string; suggestionsText?: string } {
  if (!text) return { content: text };

  let suggestionsText = "";
  let cleanContent = text;

  // 1. 剥离 <memory_extraction> 和 <memory> 标签（包括已闭合和流式未闭合）
  const memoryTags = ["memory_extraction", "memory"];
  for (const tag of memoryTags) {
    const startRegex = new RegExp(`<${tag}\\s*>`, "i");
    const startMatch = cleanContent.match(startRegex);
    if (startMatch && startMatch.index !== undefined) {
      const startIdx = startMatch.index;
      const endRegex = new RegExp(`</${tag}\\s*>`, "i");
      const endMatch = cleanContent.match(endRegex);
      if (endMatch && endMatch.index !== undefined) {
        cleanContent = cleanContent.substring(0, startIdx).trim() + "\n" + cleanContent.substring(endMatch.index + endMatch[0].length).trim();
      } else {
        cleanContent = cleanContent.substring(0, startIdx).trim();
      }
    }
    // 处理末尾不完整的标签（如 <m, <me, <mem 等）
    for (let i = tag.length; i >= 1; i--) {
      const partial = `<${tag.substring(0, i)}`;
      if (cleanContent.endsWith(partial)) {
        cleanContent = cleanContent.substring(0, cleanContent.length - partial.length).trim();
        break;
      }
    }
  }

  // 2. 剥离 <suggestions> 标签
  const startRegex = /<suggestions\s*>/i;
  const startMatch = cleanContent.match(startRegex);

  if (!startMatch) {
    // 处理末尾不完整的 <suggestions> 标签
    const suggestionsTag = "suggestions";
    for (let i = suggestionsTag.length; i >= 1; i--) {
      const partial = `<${suggestionsTag.substring(0, i)}`;
      if (cleanContent.endsWith(partial)) {
        cleanContent = cleanContent.substring(0, cleanContent.length - partial.length).trim();
        break;
      }
    }
  } else if (startMatch && startMatch.index !== undefined) {
    const startIdx = startMatch.index;
    const endRegex = /<\/suggestions\s*>/i;
    const endMatch = cleanContent.match(endRegex);

    if (endMatch && endMatch.index !== undefined) {
      suggestionsText = cleanContent.substring(startIdx + startMatch[0].length, endMatch.index).trim();
      cleanContent = cleanContent.substring(0, startIdx).trim() + "\n" + cleanContent.substring(endMatch.index + endMatch[0].length).trim();
    } else {
      suggestionsText = cleanContent.substring(startIdx + startMatch[0].length).trim();
      cleanContent = cleanContent.substring(0, startIdx).trim();
    }
  }

  // 最后检查如果以单个 "<" 结尾，安全起见也做截断处理，防止闪烁
  if (cleanContent.endsWith("<")) {
    cleanContent = cleanContent.substring(0, cleanContent.length - 1).trim();
  }

  return { content: cleanContent.trim(), suggestionsText };
}

export function cleanSuggestionsFromText(text: string): { content: string; suggestionsText?: string } {
  return cleanAllMetadataFromText(text);
}

/**
 * 将单段文本拆分为多条目。
 * 优先按换行拆分；若只有一行则尝试按 "1. 2. 3." / "1、2、" 等编号模式拆分。
 * 新增备用逻辑：支持通过 /、|、、等常见单行分隔符进行拆分。
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

  // 备用单行分隔符拆分
  if (text.includes("/") || text.includes("|") || text.includes("、")) {
    const parts = text.split(/\s*[\/|、]\s*/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return parts;
    }
  }

  return [text];
}

