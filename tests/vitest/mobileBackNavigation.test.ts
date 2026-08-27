import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchMobileBack,
  installMobileBackBridge,
  registerMobileBackHandler,
  resetMobileBackHandlersForTest,
} from "../../src/infrastructure/native/mobileBackNavigation";

describe("Android WebView 返回键栈", () => {
  beforeEach(() => resetMobileBackHandlersForTest());

  it("优先由最高层且最新注册的处理器消费", () => {
    const page = vi.fn(() => true);
    const sheet = vi.fn(() => true);
    registerMobileBackHandler(page, 0);
    registerMobileBackHandler(sheet, 900);

    expect(dispatchMobileBack()).toBe(true);
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
  });

  it("未消费时继续向下查找并向原生层返回 false", () => {
    const cleanup = registerMobileBackHandler(() => false, 900);
    expect(dispatchMobileBack()).toBe(false);
    cleanup();
    expect(dispatchMobileBack()).toBe(false);
  });

  it("向 WebView 暴露同步返回值函数", () => {
    registerMobileBackHandler(() => true, 0);
    installMobileBackBridge();

    const bridgeWindow = window as Window & { __mobileTavernHandleBack?: () => boolean };
    expect(bridgeWindow.__mobileTavernHandleBack?.()).toBe(true);
  });
});
