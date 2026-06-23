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

  let trimmed = suggestionsText.trim();

  // 1. 剥离 Markdown 代码块标记（如 ```json ... ``` 或 ``` ... ```）
  if (trimmed.includes("```")) {
    trimmed = trimmed
      .replace(/^```[a-zA-Z0-9]*\s*/, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  // 2. 尝试 JSON.parse，并在失败时尝试引号规格化和正则回退
  let rawList: string[] = [];
  try {
    const sanitized = trimmed
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    rawList = JSON.parse(sanitized);
  } catch (e) {
    console.warn("[parseSuggestions] JSON.parse failed, attempting quote normalization and regex fallbacks", e);

    try {
      let normalized = trimmed
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();

      // 将单引号包裹的数组转换为双引号以尝试二次 JSON 解析: ['A', 'B'] -> ["A", "B"]
      if (normalized.startsWith('[') && normalized.endsWith(']')) {
        normalized = normalized.replace(/'([^']*)'/g, '"$1"');
      }

      const sanitized = normalized
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      rawList = JSON.parse(sanitized);
    } catch (e2) {
      // 提取所有带引号的子字符串（兼容英文双/单引号、中文双/单引号）
      try {
        const matches = trimmed.match(/(?:"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|“[^”]*”|‘[^’]*’)/g);
        if (matches && matches.length > 0) {
          rawList = matches.map(m => {
            let inner = m.slice(1, -1);
            return inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
          });
        }
      } catch (e3) {
        console.warn("[parseSuggestions] Manual regex matching failed", e3);
      }
    }
  }

  // 3. 结果提取与二次分隔符切分
  let items: string[] = [];
  if (Array.isArray(rawList) && rawList.length > 0) {
    if (rawList.length === 1) {
      const singleStr = rawList[0];
      items = splitTextIntoItems(singleStr);
    } else {
      items = rawList;
    }
  } else {
    // 剥离非标外层中括号（例如 [走向一, 走向二]）
    let cleanText = trimmed;
    if (cleanText.startsWith('[') && cleanText.endsWith(']')) {
      cleanText = cleanText.slice(1, -1).trim();
    }
    items = splitTextIntoItems(cleanText);
  }

  return items
    .map(item => {
      let cleaned = item.trim();
      // 剥离各种类型的两侧引号
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      if (cleaned.startsWith("“") && cleaned.endsWith("”")) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      if (cleaned.startsWith("‘") && cleaned.endsWith("’")) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      // 剥离行首列表前缀（如 1.、(2)、[3]、1、- 等）
      cleaned = cleaned.replace(/^(?:\(?\d+\)?[\.、．:：\s\-~]+|\[\d+\]\s*|[\-\s]+)/g, "");
      // 剥离走向、选项等描述词前缀（必须包含后续的分隔符，避免将单纯的 "选项1" 误抹除）
      cleaned = cleaned.replace(/^(?:走向|选项)\d+(?:[\.、．:：\s\-~]+)/g, "");
      return cleaned.trim();
    })
    .filter(item => item.length > 0 && item.toLowerCase() !== "json");
}

