/**
 * AI 建议解析鲁棒性测试套件
 *
 * 覆盖 testSuggestionsRobustness：
 *  - cleanSuggestionsFromText 大小写/未闭合标签容错
 *  - parseSuggestions 多种格式（JSON / markdown / 单引号 / 中文引号 / 斜杠 / 竖线 / 编号列表）
 *  - FormattedText.tsx 内置正则清洗
 */

import { cleanSuggestionsFromText, parseSuggestions } from "../../src/hooks/useChat/helpers/index";
import { assert } from "./testUtils";

export function testSuggestionsRobustness() {
  console.log("\n--- Running AI Suggestions Parsing Robustness Verification ---");

  // 1. cleanSuggestionsFromText 容错性测试
  // 标准与大小写混合/未闭合标签测试
  const text1 = "你好啊。<suggestions>[\"微笑着向她打招呼\"]</suggestions>";
  const res1 = cleanSuggestionsFromText(text1);
  assert(res1.content === "你好啊。", "Extract clean content");
  assert(res1.suggestionsText === "[\"微笑着向她打招呼\"]", "Extract suggestions content");

  const text2 = "今天天气不错。\n<Suggestions>[\"走向A\", \"走向B\"]";
  const res2 = cleanSuggestionsFromText(text2);
  assert(res2.content === "今天天气不错。", "Extract content case-insensitive unclosed tag");
  assert(res2.suggestionsText === "[\"走向A\", \"走向B\"]", "Extract suggestions case-insensitive unclosed tag");

  // 2. parseSuggestions 鲁棒性测试
  // 正常 JSON
  const s1 = "[\"微笑着向她打招呼\", \"警惕地打量她\"]";
  const parsed1 = parseSuggestions(s1);
  assert(parsed1.length === 2 && parsed1[0] === "微笑着向她打招呼", "Parse standard JSON suggestions");

  // 带 markdown code block
  const s2 = "```json\n[\"走向一\", \"走向二\"]\n```";
  const parsed2 = parseSuggestions(s2);
  assert(parsed2.length === 2 && parsed2[0] === "走向一", "Parse suggestions wrapped in markdown code blocks");

  // 带单引号
  const s3 = "['选项1', '选项2']";
  const parsed3 = parseSuggestions(s3);
  assert(parsed3.length === 2 && parsed3[0] === "选项1", "Parse single-quoted array");

  // 带中文引号
  const s4 = "[“走向A”, “走向B”]";
  const parsed4 = parseSuggestions(s4);
  assert(parsed4.length === 2 && parsed4[0] === "走向A", "Parse Chinese-quoted array");

  // 纯文本单行斜杠分隔符
  const s5 = "微笑着向她打招呼 / 警惕地打量她 / 开个玩笑打破尴尬";
  const parsed5 = parseSuggestions(s5);
  assert(parsed5.length === 3 && parsed5[0] === "微笑着向她打招呼" && parsed5[2] === "开个玩笑打破尴尬", "Parse slash-separated single line suggestions");

  // 纯文本单行竖线分隔符
  const s6 = "微笑着向她打招呼 | 警惕地打量她 | 开个玩笑打破尴尬";
  const parsed6 = parseSuggestions(s6);
  assert(parsed6.length === 3 && parsed6[0] === "微笑着向她打招呼" && parsed6[1] === "警惕地打量她", "Parse vertical-bar-separated single line suggestions");

  // 带有编号前缀的列表
  const s7 = "1. 走向一\n2. 走向二\n3. 选项三";
  const parsed7 = parseSuggestions(s7);
  assert(parsed7.length === 3 && parsed7[0] === "走向一" && parsed7[2] === "选项三", "Parse numbered list suggestions");

  // 3. FormattedText.tsx 内置正则清洗测试
  const suggestionsRegex = /<suggestions\s*>[\s\S]*?<\/suggestions\s*>/gi;
  const stripSuggestions = (text: string) => {
    let t = text.replace(suggestionsRegex, "");
    return t.replace(/<suggestions\s*>[\s\S]*$/gi, "").trim();
  };

  const textClosed = "你好啊。<suggestions>[\"选项1\"]</suggestions>祝你有美好的一天。";
  assert(stripSuggestions(textClosed) === "你好啊。祝你有美好的一天。", "Strip closed suggestions tag");

  const textUnclosed = "你好啊。<Suggestions>[\"选项1\"";
  assert(stripSuggestions(textUnclosed) === "你好啊。", "Strip unclosed suggestions tag");

  console.log("✔ AI Suggestions robust parsing and FormattedText stripping verified successfully!");
}
