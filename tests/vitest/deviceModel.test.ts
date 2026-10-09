import { describe, expect, it } from "vitest";
import { parseAndroidDeviceModel } from "../../src/tabs/settings/utils";

/**
 * 回归背景：系统报告曾把所有 WebView 用户上报成"设备型号：wv"。
 * WebView UA 里机型在带 `Build/` 的那一段，而括号内最后一段是 WebView 标记 `wv`。
 */
describe("Android 机型解析", () => {
  it("从 Build 段取机型，而不是最后一段的 wv", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36";

    expect(parseAndroidDeviceModel(ua)).toBe("SM-G991B (Android 13)");
  });

  it("保留带空格的完整机型名", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 12; Redmi Note 8 Pro Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";

    expect(parseAndroidDeviceModel(ua)).toBe("Redmi Note 8 Pro (Android 12)");
  });

  it("没有 Build 段时取 Android 段之后的第一个真实段", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 11; V2049A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 Mobile Safari/537.36";

    expect(parseAndroidDeviceModel(ua)).toBe("V2049A (Android 11)");
  });

  it("只有 webview 标记时退化为 Android Device，而不是回显 wv", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36";

    expect(parseAndroidDeviceModel(ua)).toBe("Android Device (Android 13)");
  });

  it("Chrome UA Reduction 的占位机型 K 不当作机型", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36";

    expect(parseAndroidDeviceModel(ua)).toBe("Android Device (Android 10)");
  });

  it("非 Android UA 返回 null", () => {
    expect(
      parseAndroidDeviceModel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBeNull();
    expect(parseAndroidDeviceModel("")).toBeNull();
  });
});
