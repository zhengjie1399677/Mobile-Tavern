/**
 * 回复建议（<suggestions>）解析的纯函数工具。
 *
 * 从 useChat.tsx 抽离，遵循 AGENTS.md 核心行为准则一 §1（极致微服务与解耦）。
 * 仅包含无 React 依赖的纯函数，可被独立单兵测试。
 *
 * 行为语义与原 useChat.tsx 内部实现完全等价。
 */

import { splitTextIntoItems } from "./textParsing";

/**
 * 解析 <suggestions> 标签内的原始文本，返回去重清洗后的建议条目数组。
 *
 * 解析策略（逐级降级）：
 *   1. 优先尝试 JSON.parse（对换行 / 制表符做转义预处理）；
 *   2. 失败则回退到正则提取所有双引号字符串；
 *   3. 单元素数组时按 splitTextIntoItems 二次拆分；
 *   4. 最后统一去除引号、编号前缀、"走向N/选项N" 等噪声。
 */
export function parseSuggestions(suggestionsText: string): string[] {
  if (!suggestionsText) return [];

  let rawList: string[] = [];
  const trimmed = suggestionsText.trim();

  try {
    const sanitized = trimmed
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    rawList = JSON.parse(sanitized);
  } catch (e) {
    console.warn("[parseSuggestions] JSON.parse failed, falling back to manual regex matching", e);
    try {
      const matches = trimmed.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
      if (matches) {
        rawList = matches.map(m => {
          let inner = m.slice(1, -1);
          return inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
        });
      }
    } catch (e2) {
      console.warn("[parseSuggestions] Manual regex matching failed", e2);
    }
  }

  let items: string[] = [];
  if (Array.isArray(rawList)) {
    if (rawList.length === 1) {
      const singleStr = rawList[0];
      items = splitTextIntoItems(singleStr);
    } else if (rawList.length > 1) {
      items = rawList;
    } else {
      items = splitTextIntoItems(trimmed);
    }
  } else {
    items = splitTextIntoItems(trimmed);
  }

  return items
    .map(item => {
      let cleaned = item.trim();
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      cleaned = cleaned.replace(/^(?:\(?\d+\)?[\.、．:\s\-~]+|\[\d+\]\s*)/g, "");
      cleaned = cleaned.replace(/^走向\d+[\.、．:\s\-]*|选项\d+[\.、．:\s\-]*/g, "");
      return cleaned.trim();
    })
    .filter(item => item.length > 0);
}
