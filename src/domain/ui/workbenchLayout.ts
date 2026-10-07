/**
 * 工作台卡片布局（顺序 + 显示）的解析规则。
 *
 * 纯函数，无 React 依赖：卡片清单（id/标题）由界面层提供，这里只负责"用户存下来的顺序"
 * 与"当前版本实际存在的卡片"求交。规则遵循 `CHANGE-SAFE`：
 *   - 未知 id 忽略（用户降级回旧版本或卡片被移除时不炸）；
 *   - 未列入顺序的卡片追加在末尾（新版本新增卡片默认可见，不会被旧布局藏掉）；
 *   - 隐藏清单同样只保留仍然存在的卡片。
 */

export interface WorkbenchCardLayout {
  /** 用户自定义顺序；未列出的卡片按清单顺序追加在末尾。 */
  readonly order?: readonly string[];
  /** 被隐藏的卡片 id。 */
  readonly hidden?: readonly string[];
}

/** 归一化顺序：已知 id 去重保留用户顺序，剩余卡片按清单顺序补齐。 */
export function resolveWorkbenchCardOrder(
  catalogIds: readonly string[],
  layout?: WorkbenchCardLayout | null,
): string[] {
  const known = new Set(catalogIds);
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const id of layout?.order ?? []) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  for (const id of catalogIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  return resolved;
}

/** 归一化隐藏清单：只保留仍然存在的卡片 id。 */
export function resolveHiddenWorkbenchCards(
  catalogIds: readonly string[],
  layout?: WorkbenchCardLayout | null,
): string[] {
  const known = new Set(catalogIds);
  const resolved: string[] = [];
  for (const id of layout?.hidden ?? []) {
    if (known.has(id) && !resolved.includes(id)) resolved.push(id);
  }
  return resolved;
}

/**
 * 移动一张卡片：返回新的顺序数组（越界时原样返回）。
 * 界面层的上移/下移按钮与拖拽都只需要消费这个结果。
 */
export function moveWorkbenchCard(
  order: readonly string[],
  cardId: string,
  direction: -1 | 1,
): string[] {
  const index = order.indexOf(cardId);
  if (index < 0) return [...order];
  const target = index + direction;
  if (target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
