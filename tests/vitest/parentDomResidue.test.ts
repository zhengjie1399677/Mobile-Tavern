import { beforeEach, describe, expect, it } from "vitest";
import { purgeCompatibilityDomResidue } from "../../src/compatibility/sillytavern/parentDomResidue";

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
});
