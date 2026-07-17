/**
 * 流式 <memory> 标签解析器
 *
 * 用途：LLM 流式输出时，<memory>...</memory> 标签可能跨多个 SSE chunk 到达。
 *       本解析器以状态机方式逐步消费 chunk，剥离 <memory> 标签内容（不展示给用户），
 *       并在标签闭合时输出完整的 memory 内容供端侧解析。
 *
 * 状态机：
 *   OUTSIDE  ──遇到 <memory>──>  INSIDE
 *   INSIDE   ──遇到 </memory>──> OUTSIDE（同时输出 memoryContent）
 *
 * 关键设计：
 *   1. findSafeDisplayEnd() 避免在 buffer 末尾截断可能的开标签前缀（如 "<memo"）
 *   2. 用户看到的对话流完全不包含 <memory> 标签内容，体验无感
 *   3. onChunk 接收可选 AbortSignal，循环顶部插入 aborted 检查点（TODO #5）
 */

import type { StreamParserOutput } from './types';

const OPEN_TAG = '<memory>';
const CLOSE_TAG = '</memory>';
const OPEN_TAG_LEN = OPEN_TAG.length;  // 8
const CLOSE_TAG_LEN = CLOSE_TAG.length; // 9

export class MemoryStreamParser {
  /** 缓冲区（尚未决断的文本） */
  private buffer = '';
  /** 是否正在 <memory> 标签内部 */
  private inMemoryTag = false;
  /** 已积累的 memory 内容（标签未闭合时持续累积） */
  private memoryContent = '';

  /**
   * 处理一个流式 chunk。
   * @param chunk SSE 流式增量文本
   * @param signal 可选取消信号；若已 abort，循环顶部抛出 AbortError 终止解析
   * @returns displayText 应展示给用户的文本（已剥离 <memory> 标签）
   *          memoryContent 完整的 <memory> 内容（仅在标签闭合时返回）
   *
   * 实现说明：单次 chunk 可能包含 text + <memory>...</memory> + text 的完整序列，
   * 因此需要在状态转换后循环处理剩余 buffer，直到需要更多数据（找不到完整标签）时才返回。
   */
  onChunk(chunk: string, signal?: AbortSignal): StreamParserOutput {
    if (!chunk) return { displayText: '' };
    this.buffer += chunk;

    let displayText = '';
    let memoryContent: string | undefined;

    // 循环处理状态转换，直到需要更多数据或 buffer 耗尽
    while (this.buffer) {
      // 协作式中断检查点：外部 signal abort 时立即抛出，避免在恶意超长 buffer 上无限循环
      if (signal?.aborted) {
        const err = typeof DOMException !== "undefined"
          ? new DOMException("MemoryStreamParser aborted", "AbortError")
          : (() => {
              const e = new Error("MemoryStreamParser aborted");
              (e as { name?: string }).name = "AbortError";
              return e;
            })();
        throw err;
      }
      if (!this.inMemoryTag) {
        const result = this.processOutside();
        displayText += result.displayText;
        // 若未进入标签，说明 buffer 中无完整 <memory> 开标签，等待更多数据
        if (!this.inMemoryTag) break;
      } else {
        const result = this.processInside();
        if (result.memoryContent) {
          memoryContent = result.memoryContent;
        }
        // 若仍在标签内，说明 buffer 中无完整 </memory> 闭合标签，等待更多数据
        if (this.inMemoryTag) break;
      }
    }

    return { displayText, memoryContent };
  }

  /**
   * 流结束时调用，处理剩余缓冲。
   * 若仍在 <memory> 内部，返回已积累的 memoryContent（容错：LLM 可能漏闭合标签）。
   */
  finalize(): StreamParserOutput {
    if (this.inMemoryTag && this.memoryContent) {
      // 容错：流结束时标签未闭合，但已有内容，尝试解析
      const result: StreamParserOutput = {
        displayText: '',
        memoryContent: this.memoryContent,
      };
      this.reset();
      return result;
    }

    // 正常结束：剩余 buffer 全部展示
    const remaining = this.buffer;
    this.reset();
    return { displayText: remaining };
  }

  /**
   * 重置解析器状态（供复用或测试使用）。
   */
  reset(): void {
    this.buffer = '';
    this.inMemoryTag = false;
    this.memoryContent = '';
  }

  // ===== 内部方法 =====

  /** 处理标签外部的文本 */
  private processOutside(): StreamParserOutput {
    const openIdx = this.buffer.indexOf(OPEN_TAG);

    if (openIdx === -1) {
      // 还没遇到 <memory>，但需避免截断可能的开标签前缀
      const safeEnd = this.findSafeDisplayEnd();
      const displayText = this.buffer.slice(0, safeEnd);
      this.buffer = this.buffer.slice(safeEnd);
      return { displayText };
    }

    // 遇到 <memory>，展示之前的内容，进入标签内部
    const before = this.buffer.slice(0, openIdx);
    this.buffer = this.buffer.slice(openIdx + OPEN_TAG_LEN);
    this.inMemoryTag = true;
    return { displayText: before };
  }

  /** 处理标签内部的文本 */
  private processInside(): StreamParserOutput {
    const closeIdx = this.buffer.indexOf(CLOSE_TAG);

    if (closeIdx === -1) {
      // 还没遇到完整闭合标签，但需避免将部分闭合标签前缀（如 "</memo"）累积到 memoryContent
      const safeEnd = this.findSafeCloseEnd();
      this.memoryContent += this.buffer.slice(0, safeEnd);
      this.buffer = this.buffer.slice(safeEnd);
      return { displayText: '' };
    }

    // 提取完整 memory 内容，退出标签
    this.memoryContent += this.buffer.slice(0, closeIdx);
    this.buffer = this.buffer.slice(closeIdx + CLOSE_TAG_LEN);
    this.inMemoryTag = false;

    const memoryContent = this.memoryContent;
    this.memoryContent = '';
    return { displayText: '', memoryContent };
  }

  /**
   * 找到安全的展示截止位置。
   * 避免在 buffer 末尾截断可能的开标签前缀（如 "<memo"、"<!-..."）。
   */
  private findSafeDisplayEnd(): number {
    // 检查 buffer 末尾是否可能是 OPEN_TAG 的前缀
    const checkLen = Math.min(OPEN_TAG_LEN, this.buffer.length);
    for (let i = this.buffer.length - checkLen; i < this.buffer.length; i++) {
      if (i < 0) continue;
      if (this.buffer[i] === '<') {
        const tail = this.buffer.slice(i);
        if (OPEN_TAG.startsWith(tail)) {
          return i; // 截断到这里，剩余的留到下次
        }
      }
    }
    return this.buffer.length;
  }

  /**
   * 找到安全的 memory 内容累积截止位置。
   * 避免将 buffer 末尾的部分闭合标签前缀（如 "</memo"、"<!--..."）累积到 memoryContent。
   */
  private findSafeCloseEnd(): number {
    // 检查 buffer 末尾是否可能是 CLOSE_TAG 的前缀
    const checkLen = Math.min(CLOSE_TAG_LEN, this.buffer.length);
    for (let i = this.buffer.length - checkLen; i < this.buffer.length; i++) {
      if (i < 0) continue;
      if (this.buffer[i] === '<') {
        const tail = this.buffer.slice(i);
        if (CLOSE_TAG.startsWith(tail)) {
          return i; // 截断到这里，剩余的留到下次
        }
      }
    }
    return this.buffer.length;
  }
}
