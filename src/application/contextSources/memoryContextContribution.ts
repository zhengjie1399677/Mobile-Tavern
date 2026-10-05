/**
 * 记忆召回的上下文贡献。
 *
 * 记忆是**调用方提供的贡献**而不是注册来源：它的 topK/超时/开关来自
 * `resolveAgentSessionSettings` 解析出的**本轮有效设置**，重发时还要带被重发消息的轮次；
 * 这些都不属于领域级来源能看到的东西，硬塞进 `ContextSourceRequest` 会把应用设置漏进契约。
 *
 * 关键：它与注册来源走**同一条通道、同一个类型**，只是取值来源不同，不是第二条路径。
 */
import type { ContextContribution } from "../../domain/contextSources/contracts";
import type { RecalledMessage } from "../services/memory/types";

export const MEMORY_RECALL_SOURCE_ID = "memory.recall";
/** 保留既有宏名：预设里引用的 `{{memory.recalled}}` 不允许被改名破坏。 */
export const MEMORY_RECALL_MACRO_NAME = "memory.recalled";

/** 与适配器 `formatRecalledMemory` 对 RecalledMessage 的处理保持逐字节一致。 */
function formatRecalledContent(recalled: readonly RecalledMessage[]): string {
  return recalled
    .map((item) => item.content)
    .filter((content) => Boolean(content))
    .join("\n\n");
}

export function buildMemoryContextContribution(
  recalled: readonly RecalledMessage[],
): ContextContribution {
  const content = formatRecalledContent(recalled);
  return Object.freeze({
    sourceId: MEMORY_RECALL_SOURCE_ID,
    macroName: MEMORY_RECALL_MACRO_NAME,
    content,
    status: content.trim().length === 0 ? "empty" : "ok",
    characters: content.length,
    // 审计数据供记忆抽屉使用（含 pin/mute 需要的 memoryId）；永不进入提示词。
    audit: Object.freeze({ recalled }),
  });
}
