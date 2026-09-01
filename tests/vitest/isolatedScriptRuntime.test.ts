import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CompatibilityRendererDefinition } from "../../src/application/compatibility/contracts";
import { parseSafeHtmlToReact } from "../../src/components/formatted-text/renderingRuntime";
import {
  createIsolatedMessageIframeSrcDoc,
  createIsolatedScriptIframeSrcDoc,
} from "../../src/compatibility/sillytavern/isolatedScriptRuntime";
import { createIframeResourceCleanupBootstrap } from "../../src/utils/tavernHelper/iframeResourceCleanup";
import fs from "node:fs";
import path from "node:path";

describe("SillyTavern 隔离脚本运行时", () => {
  it("后台脚本只获得最小消息桥与无网络 CSP", () => {
    const srcDoc = createIsolatedScriptIframeSrcDoc(
      "window.__ran = getVariables().counter;",
      "card-script",
      { counter: 1 },
      false,
    );

    expect(srcDoc).toContain("connect-src 'none'");
    expect(srcDoc).toContain("form-action 'none'");
    expect(srcDoc).toContain("mtCompatIsolated: 1");
    expect(srcDoc).toContain("replaceVariables");
    expect(srcDoc).not.toContain("window.parent.TavernHelper");
    expect(srcDoc).not.toContain("window.parent.localStorage");
  });

  it("兼容 iframe 登记并回收 timeout、interval 与 animation frame", () => {
    const bootstrap = createIframeResourceCleanupBootstrap();

    expect(bootstrap).toContain("__MT_RESOURCE_CLEANUP__");
    expect(bootstrap).toContain("window.setTimeout = function");
    expect(bootstrap).toContain("window.setInterval = function");
    expect(bootstrap).toContain("window.requestAnimationFrame = function");
    expect(bootstrap).toContain("URL.createObjectURL");
    expect(bootstrap).toContain("audio,video");
    expect(bootstrap).toContain("dynamicStyles");
    expect(bootstrap).toContain("pagehide");
    expect(bootstrap).toContain("beforeunload");
  });

  it("后台脚本作用域随会话变化，并清理未就绪依赖的轮询句柄", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/tabs/chat/HiddenScriptLayer.tsx"),
      "utf8",
    );
    const renderingSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/formatted-text/renderingRuntime.tsx"),
      "utf8",
    );

    expect(source).toContain("activeSessionId");
    expect(source).toContain("runtimeScopeKey");
    expect(source).toContain("window.clearTimeout(pollTimer)");
    expect(renderingSource).toContain("createIframeScopeKey(sessionId)");
    expect(renderingSource).toContain("sessionScopeKey");
    expect(renderingSource).toContain('iframe.src = "about:blank"');
  });

  it("消息 HTML 在原有 head 最前部注入隔离策略", () => {
    const srcDoc = createIsolatedMessageIframeSrcDoc(
      "<html><head><title>x</title></head><body><script>window.x=1</script></body></html>",
      4,
      {},
    );

    expect(srcDoc.indexOf("Content-Security-Policy")).toBeLessThan(srcDoc.indexOf("<title>"));
    expect(srcDoc).toContain("message:4");
  });

  it("渲染层把隔离策略落实为不含同源权限的 sandbox", () => {
    const renderer = {
      getIframePolicy: () => ({ isolated: true, sandbox: "allow-scripts" }),
    } as unknown as CompatibilityRendererDefinition;
    const content = parseSafeHtmlToReact(
      "<iframe></iframe>",
      false,
      true,
      null,
      1,
      true,
      true,
      0,
      renderer,
      "isolated",
    );
    const { container } = render(React.createElement(React.Fragment, null, content));
    const iframe = container.querySelector("iframe");

    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe?.getAttribute("data-mt-compat-isolated")).toBe("true");
  });
});
