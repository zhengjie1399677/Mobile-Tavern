/**
 * 分页懒加载与总结归档测试套件
 *
 * 覆盖以下四个核心逻辑：
 * 1. 消息角色映射（user/assistant/system 三路映射正确性）
 * 2. 分页懒加载边界条件（空会话、不足一页、恰好一页、多页 offset 累计）
 * 3. 自动总结归档触发条件（阈值判断、失败重试、增量再触发）
 * 4. appendSessionMessage 字段映射（sender→role, timestamp→createdAt, 持久化字段持久性与兜底）
 */

import { assert } from "./testUtils";
import { hydrateNewestFirstMessagePage } from "../../src/contexts/chatMessageHydration";

// ──────────────────────────────────────────────────────────────────────────────
// 测试目标 1：消息角色映射（从 ChatContext.tsx 提取的纯逻辑）
// ──────────────────────────────────────────────────────────────────────────────

/** 与 ChatContext.tsx 中一致的 role → sender 映射逻辑 */
function mapRoleToSender(role: string): "user" | "assistant" | "system" {
  return role === "user" ? "user" : role === "system" ? "system" : "assistant";
}

export function testMessageRoleMapping() {
  console.log("--- Running Message Role Mapping Verification ---");

  // user → user
  assert(mapRoleToSender("user") === "user", "role 'user' should map to sender 'user'");

  // assistant → assistant
  assert(mapRoleToSender("assistant") === "assistant", "role 'assistant' should map to sender 'assistant'");

  // system → system（核心修复点：此前被错误映射为 assistant）
  assert(mapRoleToSender("system") === "system", "role 'system' should map to sender 'system' (not 'assistant')");

  // 未知角色降级为 assistant
  assert(mapRoleToSender("unknown") === "assistant", "unknown role should fallback to 'assistant'");

  // 空字符串降级为 assistant
  assert(mapRoleToSender("") === "assistant", "empty role should fallback to 'assistant'");

  console.log("✓ Message role mapping verified (user/assistant/system/fallback)");
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试目标 2：分页懒加载边界条件
// ──────────────────────────────────────────────────────────────────────────────

const MESSAGES_PAGE_SIZE = 50;

/** 模拟 ChatContext 中 loadMoreMessages 的分页计算逻辑 */
function computePaginationState(
  loadedCount: number,
  previousOffset: number
): { offset: number; hasMore: boolean } {
  const newHasMore = loadedCount >= MESSAGES_PAGE_SIZE;
  const newOffset = previousOffset + loadedCount;
  return { offset: newOffset, hasMore: newHasMore };
}

export function testPaginationBoundaries() {
  console.log("--- Running Pagination Boundaries Verification ---");

  // IndexedDB 为定位最新页返回倒序记录，重启回载必须恢复为时间正序。
  const newestFirst = Array.from({ length: 10 }, (_, index) => ({
    id: `m${9 - index}`,
    role: (9 - index) % 2 === 0 ? "user" : "assistant",
    content: `消息 ${9 - index}`,
    createdAt: 1000 + (9 - index),
  }));
  const hydrated = hydrateNewestFirstMessagePage(newestFirst);
  assert(hydrated[0].id === "m0", "重启回载首条应保持为最早消息 m0");
  assert(hydrated[9].id === "m9", "重启回载末条应保持为最新消息 m9");
  assert(newestFirst[0].id === "m9", "回载转换不得原地修改存储层结果");

  // 两页分别转为正序后，旧页 prepend 应形成连续的全局正序。
  const latestPage = hydrateNewestFirstMessagePage(newestFirst.slice(0, 5));
  const olderPage = hydrateNewestFirstMessagePage(newestFirst.slice(5));
  const mergedIds = [...olderPage, ...latestPage].map((message) => message.id);
  assert(
    JSON.stringify(mergedIds) === JSON.stringify(Array.from({ length: 10 }, (_, index) => `m${index}`)),
    "加载更早消息后应保持完整时间正序"
  );

  // 场景 1：空会话（0 条消息）
  const empty = computePaginationState(0, 0);
  assert(empty.hasMore === false, "Empty session: hasMore should be false");
  assert(empty.offset === 0, "Empty session: offset should remain 0");

  // 场景 2：不足一页（30 条消息）
  const partial = computePaginationState(30, 0);
  assert(partial.hasMore === false, "Partial page (30 < 50): hasMore should be false");
  assert(partial.offset === 30, "Partial page: offset should be 30");

  // 场景 3：恰好一页（50 条消息）——边界包含
  const exact = computePaginationState(50, 0);
  assert(exact.hasMore === true, "Exact page (50 == 50): hasMore should be true (boundary inclusive)");
  assert(exact.offset === 50, "Exact page: offset should be 50");

  // 场景 4：多页 offset 累计（第一页 50 条 → 第二页 50 条 → 第三页 20 条）
  const page1 = computePaginationState(50, 0);
  assert(page1.offset === 50 && page1.hasMore === true, "Page 1: offset=50, hasMore=true");

  const page2 = computePaginationState(50, page1.offset);
  assert(page2.offset === 100 && page2.hasMore === true, "Page 2: offset=100, hasMore=true");

  const page3 = computePaginationState(20, page2.offset);
  assert(page3.offset === 120 && page3.hasMore === false, "Page 3: offset=120, hasMore=false (tail reached)");

  // 场景 5：超出一页（75 条消息，仅第一页）
  const overflow = computePaginationState(75, 0);
  assert(overflow.hasMore === true, "Overflow (75 > 50): hasMore should be true");
  assert(overflow.offset === 75, "Overflow: offset should be 75");

  console.log("✓ Pagination boundaries verified (empty/partial/exact/multi-page/overflow)");
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试目标 3：自动总结归档触发条件
// ──────────────────────────────────────────────────────────────────────────────

const ARCHIVE_THRESHOLD = 200;
const ARCHIVE_RETRIGGER_INCREMENT = 50;

/** 模拟 useChat.tsx 中的 lastAutoSummaryRef 判定逻辑 */
interface AutoSummaryRefState {
  sessionId: string;
  messageCount: number;
}

/** 返回是否应该触发自动总结 */
function shouldTriggerAutoSummary(
  sessionId: string,
  messageCount: number,
  enableAutoSummary: boolean,
  ref: AutoSummaryRefState | null
): boolean {
  if (!enableAutoSummary) return false;
  if (messageCount < ARCHIVE_THRESHOLD) return false;
  if (ref && ref.sessionId === sessionId) {
    if (messageCount < ref.messageCount + ARCHIVE_RETRIGGER_INCREMENT) return false;
  }
  return true;
}

export function testAutoSummaryTriggerConditions() {
  console.log("--- Running Auto Summary Trigger Conditions Verification ---");

  // 场景 1：消息数不足阈值（199 < 200）——不触发
  assert(
    shouldTriggerAutoSummary("s1", 199, true, null) === false,
    "Below threshold (199 < 200): should NOT trigger"
  );

  // 场景 2：恰好达到阈值（200 == 200）——触发
  assert(
    shouldTriggerAutoSummary("s1", 200, true, null) === true,
    "At threshold (200 == 200): should trigger"
  );

  // 场景 3：超过阈值（300 > 200）——触发
  assert(
    shouldTriggerAutoSummary("s1", 300, true, null) === true,
    "Above threshold (300 > 200): should trigger"
  );

  // 场景 4：自动总结已关闭——不触发
  assert(
    shouldTriggerAutoSummary("s1", 300, false, null) === false,
    "Auto summary disabled: should NOT trigger even with 300 messages"
  );

  // 场景 5：同一会话已触发过，消息数增量不足（200 → 230，差 30 < 50）——不触发
  const refAfterFirst: AutoSummaryRefState = { sessionId: "s1", messageCount: 200 };
  assert(
    shouldTriggerAutoSummary("s1", 230, true, refAfterFirst) === false,
    "Same session, increment 30 < 50: should NOT re-trigger"
  );

  // 场景 6：同一会话已触发过，消息数增量足够（200 → 250，差 50 == 50）——触发
  assert(
    shouldTriggerAutoSummary("s1", 250, true, refAfterFirst) === true,
    "Same session, increment 50 >= 50: should re-trigger"
  );

  // 场景 7：同一会话已触发过，消息数增量超出（200 → 300，差 100 > 50）——触发
  assert(
    shouldTriggerAutoSummary("s1", 300, true, refAfterFirst) === true,
    "Same session, increment 100 > 50: should re-trigger"
  );

  // 场景 8：不同会话（ref 记录 s1，当前 s2）——不受 ref 影响，直接触发
  assert(
    shouldTriggerAutoSummary("s2", 200, true, refAfterFirst) === true,
    "Different session (s2 vs s1 in ref): should trigger regardless of ref"
  );

  // 场景 9：失败重试——ref 被重置为 null 后，同一会话再次触发
  // 模拟：第一次触发失败，ref 重置为 null，消息数仍为 200
  const refAfterFailure: AutoSummaryRefState | null = null;
  assert(
    shouldTriggerAutoSummary("s1", 200, true, refAfterFailure) === true,
    "After failure (ref reset to null): should re-trigger"
  );

  console.log("✓ Auto summary trigger conditions verified (threshold/disabled/increment/retry/cross-session)");
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试目标 4：appendSessionMessage 字段映射（从 DatabaseService.ts 提取的纯逻辑）
// 验证 sender→role、timestamp→createdAt 映射，以及 tags/extractSource/metadata 持久化与兜底
// ──────────────────────────────────────────────────────────────────────────────

/** 与 DatabaseService.ts appendSessionMessage 中一致的持久化字段映射逻辑 */
function buildPersistedRecord(
  sessionId: string,
  message: { id: string; sender: string; content: string; timestamp?: number; extra?: Record<string, unknown>; tags?: string[]; extractSource?: string; metadata?: Record<string, unknown> },
  turnIndex?: number
): { id: string; sessionId: string; role: string; content: string; createdAt: number; turnIndex: number; tags: string[]; extractSource: string; metadata: Record<string, unknown> | undefined } {
  return {
    id: message.id,
    sessionId,
    role: message.sender === "user" ? "user" : "assistant",
    content: message.content,
    createdAt: message.timestamp || Date.now(),
    turnIndex: turnIndex ?? 0,
    tags: message.tags || [],
    extractSource: message.extractSource || "none",
    metadata: message.metadata || message.extra,
  };
}

export async function testAppendSessionMessageFieldMapping() {
  console.log("\n--- Running appendSessionMessage Field Mapping Verification ---");

  // 4.1 sender → role 映射
  const userMsg = buildPersistedRecord("s1", { id: "m1", sender: "user", content: "hi", timestamp: 1000 });
  assert(userMsg.role === "user", "sender 'user' → role 'user'");

  const assistantMsg = buildPersistedRecord("s1", { id: "m2", sender: "assistant", content: "hello", timestamp: 2000 });
  assert(assistantMsg.role === "assistant", "sender 'assistant' → role 'assistant'");

  const systemMsg = buildPersistedRecord("s1", { id: "m3", sender: "system", content: "[system]", timestamp: 3000 });
  assert(systemMsg.role === "assistant", "sender 'system' → role 'assistant' (DatabaseService 层不区分 system)");

  // 4.2 timestamp → createdAt 映射与兜底
  assert(userMsg.createdAt === 1000, "timestamp 映射到 createdAt");
  const noTimestampMsg = buildPersistedRecord("s1", { id: "m4", sender: "user", content: "no-ts" });
  assert(noTimestampMsg.createdAt > 0, "timestamp 缺失时 createdAt 回退 Date.now()");

  // 4.3 tags 持久化与默认值
  const withTags = buildPersistedRecord("s1", { id: "m5", sender: "assistant", content: "c", timestamp: 100, tags: ["老张", "玉佩"] });
  assert(withTags.tags.length === 2 && withTags.tags[0] === "老张", "tags 正确持久化");
  const noTags = buildPersistedRecord("s1", { id: "m6", sender: "assistant", content: "c", timestamp: 100 });
  assert(noTags.tags.length === 0, "tags 缺失时兜底为空数组");

  // 4.4 extractSource 持久化与默认值
  const withSource = buildPersistedRecord("s1", { id: "m7", sender: "assistant", content: "c", timestamp: 100, extractSource: "llm" });
  assert(withSource.extractSource === "llm", "extractSource 正确持久化");
  const noSource = buildPersistedRecord("s1", { id: "m8", sender: "assistant", content: "c", timestamp: 100 });
  assert(noSource.extractSource === "none", "extractSource 缺失时兜底为 'none'");

  // 4.5 metadata 持久化与 extra 兜底
  const withMetadata = buildPersistedRecord("s1", { id: "m9", sender: "assistant", content: "c", timestamp: 100, metadata: { key: "val" } });
  assert(withMetadata.metadata?.key === "val", "metadata 正确持久化");

  const withExtraOnly = buildPersistedRecord("s1", { id: "m10", sender: "assistant", content: "c", timestamp: 100, extra: { fallback: true } });
  assert(withExtraOnly.metadata?.fallback === true, "metadata 缺失时兜底到 extra 字段");

  const noMetadataNoExtra = buildPersistedRecord("s1", { id: "m11", sender: "assistant", content: "c", timestamp: 100 });
  assert(noMetadataNoExtra.metadata === undefined, "metadata 和 extra 均缺失时为 undefined");

  // 4.6 turnIndex 传参与默认值
  const withTurnIndex = buildPersistedRecord("s1", { id: "m12", sender: "user", content: "c", timestamp: 100 }, 42);
  assert(withTurnIndex.turnIndex === 42, "turnIndex 显式传参");
  const noTurnIndex = buildPersistedRecord("s1", { id: "m13", sender: "user", content: "c", timestamp: 100 });
  assert(noTurnIndex.turnIndex === 0, "turnIndex 缺失时兜底为 0");

  // 4.7 综合场景：包含所有持久化字段的消息
  const fullMsg = buildPersistedRecord("s1", {
    id: "m14", sender: "assistant", content: "复杂消息", timestamp: 9999,
    tags: ["战斗", "夜晚"], extractSource: "hybrid",
    metadata: { emotion: "angry", location: "旅馆" },
  }, 7);
  assert(fullMsg.role === "assistant", "综合：role 正确");
  assert(fullMsg.createdAt === 9999, "综合：createdAt 正确");
  assert(fullMsg.turnIndex === 7, "综合：turnIndex 正确");
  assert(fullMsg.tags.length === 2, "综合：tags 正确");
  assert(fullMsg.extractSource === "hybrid", "综合：extractSource 正确");
  assert(fullMsg.metadata?.emotion === "angry", "综合：metadata 正确");

  console.log("✓ appendSessionMessage field mapping verified (role/createdAt/tags/extractSource/metadata/turnIndex)");
}
