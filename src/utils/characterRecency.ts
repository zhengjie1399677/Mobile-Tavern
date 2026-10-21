/**
 * 角色卡的"最近打开时间"记录。
 *
 * 用户定稿（2026-10-22）：角色卡列表按"我点过它的时间"排序，而不是按最后一条消息时间。
 * 这样刚点开看一眼、但没聊天的角色也会回到最前面。
 *
 * 只保存小型 `{ charId: timestamp }`，限制条数，损坏时退回空表；不进入统一备份
 * （属于设备本地使用习惯，不是用户内容）。
 */
const STORAGE_KEY = "mobile_tavern_character_recency";
const MAX_ENTRIES = 300;

/** 记录变化时派发的窗口事件，供排序侧即时刷新。 */
export const CHARACTER_RECENCY_EVENT = "mobile-tavern:character-recent";

export function readCharacterRecency(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** 记录一次角色卡点击，返回该时间戳；写入失败不影响交互。 */
export function markCharacterOpened(characterId: string, now = Date.now()): number {
  if (!characterId) return now;
  try {
    const current = readCharacterRecency();
    current[characterId] = now;
    const entries = Object.entries(current)
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 私密模式或存储配额失败：排序退回默认策略，不阻塞打开角色。
  }
  try {
    window.dispatchEvent(new Event(CHARACTER_RECENCY_EVENT));
  } catch {
    // 非浏览器环境（测试）忽略事件派发失败。
  }
  return now;
}
