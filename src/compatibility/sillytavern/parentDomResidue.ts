/**
 * 卡片脚本留下的「父页面 DOM 残留」清理。
 *
 * 兼容 iframe 里的角色卡脚本（MVU 状态栏、前端 HUD 等）经常把节点直接挂到父页面：
 * `$('body').append(...)` / `document.body.appendChild(...)` / `window.parent.document...`。
 * iframe 销毁时这些节点不会随之消失——表现就是"退出会话后卡片前端仍悬浮在屏幕上、
 * 甚至出现在别的会话里，只能大退应用才消失"。
 *
 * 这里按 SillyTavern / MVU 的命名约定收拾这类残留，并且**只处理挂在 body /
 * documentElement 顶层的节点**，同时显式跳过应用自身的节点（#root、Base UI portal 容器等），
 * 避免误删 React 管理的 UI。
 */

/** 残留节点常见的 id / class 关键字（含 SillyTavern 扩展面板容器 id）。 */
const RESIDUE_NAME_PATTERN = /(tavern|mvu|sillytavern|status_?placeholder|status_?bar|extensions_settings|movingdivs|movingui)/i;
/** 兼容层自己会写上的属性；带这些属性的一定是脚本产物。 */
const RESIDUE_ATTRIBUTE_MARKERS = [
  "data-script-id",
  "data-mt-compat-script",
  "data-th-srcdoc-id",
];
/** 应用自身节点：命中即跳过，绝不清理。 */
const PROTECTED_SELECTOR = "#root, [data-mt-app-portal], [data-base-ui-portal], [data-slot], [role='dialog'], [role='alertdialog']";

function isResidueElement(element: Element): boolean {
  if (RESIDUE_ATTRIBUTE_MARKERS.some((attribute) => element.hasAttribute(attribute))) return true;
  const haystack = `${element.id} ${typeof element.className === "string" ? element.className : ""}`;
  return RESIDUE_NAME_PATTERN.test(haystack);
}

function topLevelElements(doc: Document): Element[] {
  return [
    ...Array.from(doc.body?.children ?? []),
    ...Array.from(doc.documentElement?.children ?? []),
  ];
}

/**
 * 清理兼容脚本留下的父页面顶层节点，返回清理数量。
 *
 * 调用时机：兼容脚本层卸载（切换角色 / 会话 / 退出聊天）之后，或用户手动触发。
 */
export function purgeCompatibilityDomResidue(doc: Document = document): number {
  let removed = 0;
  for (const element of topLevelElements(doc)) {
    if (element.nodeType !== 1) continue;
    if (element.id === "root") continue;
    try {
      if (element.matches(PROTECTED_SELECTOR)) continue;
    } catch {
      // 选择器异常时保守跳过，绝不误删
      continue;
    }
    if (!isResidueElement(element)) continue;
    element.remove();
    removed += 1;
  }
  return removed;
}
