import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("AppContext Provider 稳定性", () => {
  afterEach(() => {
    cleanup();
  });

  it("模块重新加载后仍能读取既有 AppProvider", async () => {
    const providerModule = await import("../../src/contexts/AppContext");
    vi.resetModules();
    const consumerModule = await import("../../src/contexts/AppContext");

    function Consumer() {
      const { activeTab } = consumerModule.useApp();
      return <span>{activeTab}</span>;
    }

    render(
      <providerModule.AppProvider>
        <Consumer />
      </providerModule.AppProvider>,
    );

    expect(screen.getByText("characters")).toBeTruthy();
  });
});
