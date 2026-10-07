import { beforeEach, describe, expect, it } from "vitest";
import {
  purgeCompatibilityDomResidue,
  startCompatibilityDomResidueGuard,
} from "../../src/compatibility/sillytavern/parentDomResidue";

describe("兼容脚本父页面 DOM 残留清理", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("清理 MVU / Tavern 命名约定留下的顶层节点", () => {
    document.body.innerHTML = `
      <div id="root"></div>
      <div id="extensions_settings2">MVU 面板</div>
      <div class="mvu-status-bar">状态栏残留</div>
      <div data-script-id="card-script">脚本产物</div>
    `;

    expect(purgeCompatibilityDomResidue(document)).toBe(3);
    expect(document.getElementById("root")).not.toBeNull();
    expect(document.querySelector("#extensions_settings2")).toBeNull();
    expect(document.querySelector(".mvu-status-bar")).toBeNull();
  });

  it("绝不清理应用自身节点（React 根与 portal 容器）", () => {
    document.body.innerHTML = `
      <div id="root"></div>
      <div data-mt-app-portal="1" class="tavern-look-alike">应用弹窗容器</div>
      <div role="dialog" class="mvu-dialog">应用对话框</div>
      <div class="ordinary-card">普通节点</div>
    `;

    expect(purgeCompatibilityDomResidue(document)).toBe(0);
    expect(document.querySelector("[data-mt-app-portal]")).not.toBeNull();
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    expect(document.querySelector(".ordinary-card")).not.toBeNull();
  });

  it("守卫回收挂在 #root 内部的脚本悬浮节点，但不碰 React 管理节点", async () => {
    document.body.innerHTML = `<div id="root"><div id="react-child">React 节点</div></div>`;
    // 模拟 React 宿主节点的自有标记；脚本 createElement 的节点没有。
    const reactChild = document.getElementById("react-child") as HTMLElement & { __reactFiber$test?: unknown };
    reactChild.__reactFiber$test = {};
    const root = document.getElementById("root") as HTMLElement;

    const guard = startCompatibilityDomResidueGuard(document);
    // 卡片脚本把无 id / 无 class 的星形 HUD 直接塞进应用容器
    const hud = document.createElement("div");
    hud.style.cssText = "position:fixed;top:30%;right:0";
    root.appendChild(hud);
    // 应用自己通过 React 新渲染的节点（带标记）必须保留
    const lateReact = document.createElement("div") as HTMLDivElement & { __reactProps$test?: unknown };
    lateReact.__reactProps$test = {};
    root.appendChild(lateReact);

    // MutationObserver 回调在微任务里派发，等一拍再 dispose。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guard.dispose()).toBe(1);
    expect(hud.isConnected).toBe(false);
    expect(lateReact.isConnected).toBe(true);
    expect(reactChild.isConnected).toBe(true);
  });
});
