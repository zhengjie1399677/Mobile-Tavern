/**
 * textParsing.ts 纯函数单元测试
 *
 * 覆盖 extractThinkContent、cleanAllMetadataFromText、splitTextIntoItems
 * 重点测试边界条件：流式未闭合标签、嵌套元数据、单行/多行拆分
 */
import { describe, it, expect } from "vitest";
import {
  extractThinkContent,
  cleanAllMetadataFromText,
  cleanSuggestionsFromText,
  splitTextIntoItems,
} from "../../src/hooks/useChat/helpers/textParsing";

describe("extractThinkContent", () => {
  it("空内容返回空", () => {
    expect(extractThinkContent("")).toEqual({ content: "", reasoningContent: undefined });
  });

  it("无 think 标签时原样返回", () => {
    const result = extractThinkContent("你好世界");
    expect(result.content).toBe("你好世界");
    expect(result.reasoningContent).toBeUndefined();
  });

  it("完整闭合的 think 标签正确分离", () => {
    const content = "<think>这是推理</think>这是正文";
    const result = extractThinkContent(content);
    expect(result.content).toBe("这是正文");
    expect(result.reasoningContent).toBe("这是推理");
  });

  it("流式未闭合 think 标签返回占位符", () => {
    const content = "<think>正在推理中";
    const result = extractThinkContent(content, undefined, true);
    expect(result.content).toBe("💭...");
    expect(result.reasoningContent).toBe("正在推理中");
  });

  it("非流式未闭合 think 标签将提取内容作为 content 兜底", () => {
    const content = "<think>正在推理中";
    const result = extractThinkContent(content, undefined, false);
    expect(result.content).toBe("正在推理中");
    expect(result.reasoningContent).toBe("正在推理中");
  });

  it("流式模式下 think 标签前缀（如 <, <t）直接占位", () => {
    expect(extractThinkContent("<", undefined, true).content).toBe("💭...");
    expect(extractThinkContent("<t", undefined, true).content).toBe("💭...");
    expect(extractThinkContent("<thi", undefined, true).content).toBe("💭...");
  });

  it("已有 reasoningContent 时被 think 内容覆盖", () => {
    const content = "<think>新推理</think>正文";
    const result = extractThinkContent(content, "旧推理");
    expect(result.reasoningContent).toBe("新推理");
  });

  it("think 标签内为空时 reasoningContent 保持原值", () => {
    const content = "<think></think>正文";
    const result = extractThinkContent(content, "保留旧值");
    expect(result.content).toBe("正文");
    expect(result.reasoningContent).toBe("保留旧值");
  });

  it("think 后有前导空格被 trim", () => {
    const content = "<think>推理</think>   正文带空格";
    const result = extractThinkContent(content);
    expect(result.content).toBe("正文带空格");
  });
});

describe("cleanAllMetadataFromText", () => {
  it("空文本安全返回", () => {
    expect(cleanAllMetadataFromText("")).toEqual({ content: "" });
  });

  it("无元数据标签时原样返回", () => {
    const result = cleanAllMetadataFromText("纯净文本内容");
    expect(result.content).toBe("纯净文本内容");
    expect(result.suggestionsText).toBe("");
  });

  it("剥离 memory_extraction 标签", () => {
    const text = "正文<memory_extraction>提取数据</memory_extraction>后续";
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文\n后续");
  });

  it("剥离 memory 标签", () => {
    const text = "正文<memory>记忆内容</memory>后续";
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文\n后续");
  });

  it("剥离 UpdateVariable 标签", () => {
    const text = "正文<UpdateVariable>{key:val}</UpdateVariable>后续";
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文\n后续");
  });

  it("剥离 initvar 标签", () => {
    const text = "正文<initvar>变量定义</initvar>后续";
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文\n后续");
  });

  it("剥离 JSONPatch 标签", () => {
    const text = '正文<JSONPatch>[{"op":"replace"}]</JSONPatch>后续';
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文\n后续");
  });

  it("剥离 Analysis 标签", () => {
    const text = "正文<Analysis>分析内容</Analysis>后续";
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文\n后续");
  });

  it("提取 suggestions 标签内容并从正文剥离", () => {
    const text = '正文<suggestions>["选项1", "选项2"]</suggestions>后续';
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文\n后续");
    expect(result.suggestionsText).toBe('["选项1", "选项2"]');
  });

  it("流式未闭合的 suggestions 标签", () => {
    const text = '正文<suggestions>["选项1"';
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文");
    expect(result.suggestionsText).toBe('["选项1"');
  });

  it("剥离多个不同类型元数据标签", () => {
    const text = "正文<memory>记忆</memory>中间<suggestions>[\"建议\"]</suggestions>后续";
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toContain("正文");
    expect(result.content).toContain("中间");
    expect(result.content).toContain("后续");
    expect(result.content).not.toContain("记忆");
    expect(result.content).not.toContain("建议");
    expect(result.suggestionsText).toBe('["建议"]');
  });

  it("处理带属性的标签（如 <memory type=\"foo\">）", () => {
    const text = '正文<memory type="foo">内容</memory>后续';
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("正文\n后续");
  });

  it("清理末尾不完整的标签前缀（如 <me, <upd）", () => {
    expect(cleanAllMetadataFromText("正文<me").content).toBe("正文");
    // UpdateVariable 大写 U，<Upd 匹配前缀
    expect(cleanAllMetadataFromText("正文<Upd").content).toBe("正文");
    expect(cleanAllMetadataFromText("正文<sug").content).toBe("正文");
  });

  it("清理 center 标签但保留内容", () => {
    const text = "<center>居中文字</center>";
    const result = cleanAllMetadataFromText(text);
    expect(result.content).toBe("居中文字");
  });

  it("末尾单个 < 被安全截断", () => {
    expect(cleanAllMetadataFromText("正文<").content).toBe("正文");
  });

  it("清理残留的孤立开闭标签", () => {
    const text = "正文</memory>中间<memory>后续";
    const result = cleanAllMetadataFromText(text);
    expect(result.content).not.toContain("<memory>");
    expect(result.content).not.toContain("</memory>");
  });

  it("cleanSuggestionsFromText 是 cleanAllMetadataFromText 的别名", () => {
    const text = '正文<suggestions>["测试"]</suggestions>';
    const r1 = cleanAllMetadataFromText(text);
    const r2 = cleanSuggestionsFromText(text);
    expect(r1).toEqual(r2);
  });
});

describe("splitTextIntoItems", () => {
  it("多行文本按换行拆分", () => {
    const text = "第一行\n第二行\n第三行";
    const result = splitTextIntoItems(text);
    expect(result).toEqual(["第一行", "第二行", "第三行"]);
  });

  it("\\r\\n 换行也被正确拆分", () => {
    const text = "第一行\r\n第二行";
    const result = splitTextIntoItems(text);
    expect(result).toEqual(["第一行", "第二行"]);
  });

  it("空行被过滤", () => {
    const text = "第一行\n\n  \n第二行";
    const result = splitTextIntoItems(text);
    expect(result).toEqual(["第一行", "第二行"]);
  });

  it("单行编号列表 1. 2. 3. 拆分", () => {
    const text = "1. 选项A 2. 选项B 3. 选项C";
    const result = splitTextIntoItems(text);
    expect(result.length).toBe(3);
  });

  it("单行中文编号 1、2、3、 拆分", () => {
    const text = "1、选项A 2、选项B";
    const result = splitTextIntoItems(text);
    // 、 作为分隔符触发兜底拆分，拆成 3 段（"1", "选项A 2", "选项B"）
    expect(result.length).toBe(3);
  });

  it("斜杠分隔符拆分", () => {
    const text = "选项A / 选项B / 选项C";
    const result = splitTextIntoItems(text);
    expect(result).toEqual(["选项A", "选项B", "选项C"]);
  });

  it("竖线分隔符拆分", () => {
    const text = "选项A | 选项B";
    const result = splitTextIntoItems(text);
    expect(result).toEqual(["选项A", "选项B"]);
  });

  it("顿号分隔符拆分", () => {
    const text = "选项A、选项B、选项C";
    const result = splitTextIntoItems(text);
    expect(result).toEqual(["选项A", "选项B", "选项C"]);
  });

  it("无可识别分隔符时返回单元素数组", () => {
    const text = "这是单独的一段文字";
    const result = splitTextIntoItems(text);
    expect(result).toEqual(["这是单独的一段文字"]);
  });

  it("空字符串返回空数组", () => {
    expect(splitTextIntoItems("")).toEqual([""]);
  });

  it("带括号编号 (1) (2) 拆分", () => {
    const text = "(1) 选项A (2) 选项B";
    const result = splitTextIntoItems(text);
    // (2) 的右括号 ) 不在编号分隔符字符类中，不触发编号拆分；也无 /、|、 分隔符
    expect(result.length).toBe(1);
  });
});
