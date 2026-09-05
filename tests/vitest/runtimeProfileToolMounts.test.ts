import { describe, expect, it } from "vitest";
import {
  findUnavailableRuntimeProfileToolNames,
  mergeRuntimeProfileToolMounts,
} from "../../src/application/useCases/runtimeProfileToolMounts";

describe("Runtime Profile Tool 挂载", () => {
  it("合并编辑列表时使用当前版本并保留已缺失工具", () => {
    expect(mergeRuntimeProfileToolMounts(
      [{ name: "ext.weather", version: "2.0.0" }],
      [
        { name: "ext.weather", version: "1.0.0" },
        { name: "ext.missing", version: "1.0.0" },
      ],
    )).toEqual([
      { name: "ext.missing", version: "1.0.0" },
      { name: "ext.weather", version: "2.0.0" },
    ]);
  });

  it("把缺失工具与精确版本不匹配都标记为不可用", () => {
    expect(findUnavailableRuntimeProfileToolNames(
      [
        { name: "ext.weather", version: "1.0.0" },
        { name: "ext.current" },
        { name: "ext.missing", version: "1.0.0" },
      ],
      [
        { name: "ext.weather", version: "2.0.0" },
        { name: "ext.current", version: "3.0.0" },
      ],
    )).toEqual(["ext.weather", "ext.missing"]);
  });
});
