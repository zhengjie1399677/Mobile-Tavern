/**
 * 分页懒加载与总结归档测试套件
 *
 * 覆盖以下三个核心逻辑：
 * 1. 消息角色映射（user/assistant/system 三路映射正确性）
 * 2. 分页懒加载边界条件（空会话、不足一页、恰好一页、多页 offset 累计）
 * 3. 自动总结归档触发条件（阈值判断、失败重试、增量再触发）
 */

import { assert } from "./testUtils";

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
