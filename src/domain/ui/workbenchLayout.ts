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
 * 把一张卡片移动到目标下标（越界自动夹取；卡片不存在时原样返回）。
 * 长按拖动与键盘排序都只需要消费这个纯函数的结果。
 */
export function moveWorkbenchCardTo(
  order: readonly string[],
  cardId: string,
  targetIndex: number,
): string[] {
  const fromIndex = order.indexOf(cardId);
  if (fromIndex < 0) return [...order];
  const clamped = Math.max(0, Math.min(order.length - 1, Math.trunc(targetIndex)));
  if (clamped === fromIndex) return [...order];
  const next = [...order];
  next.splice(fromIndex, 1);
  next.splice(clamped, 0, cardId);
  return next;
}
