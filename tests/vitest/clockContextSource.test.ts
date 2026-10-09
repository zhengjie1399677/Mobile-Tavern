/**
 * C4 回归：SillyTavern 日期/时间宏作为注册来源接入通用上下文来源缝。
 * 格式对齐上游 public/scripts/macros.js（release 分支）：
 * time -> LT、date -> LL、weekday -> dddd、isotime -> HH:mm、isodate -> YYYY-MM-DD
 */
import { describe, expect, it } from "vitest";
import { createClockContextSources } from "@/src/application/contextSources/clockContextSource";
import { createContextSourceRegistry } from "@/src/application/contextSources/contextSourceRegistry";
import { createContextSourceDefinition } from "@/src/domain/contextSources/contracts";

const fixedNow = () => new Date(2026, 9, 5, 14, 7, 9);
const zhLocale = () => "zh-CN";

describe("日期/时间上下文来源", () => {
  it("五个宏的格式与上游 SillyTavern 对齐", async () => {
    const registry = createContextSourceRegistry();
    for (const definition of createClockContextSources({ now: fixedNow, locale: zhLocale })) {
      registry.register(definition);
    }

    const contributions = await registry.readAll({ sessionId: "s", userInput: "" });
    const byMacro = new Map(contributions.map((item) => [item.macroName, item.content]));

    expect(byMacro.get("isotime")).toBe("14:07");
    expect(byMacro.get("isodate")).toBe("2026-10-05");
    expect(byMacro.get("weekday")).toBe("星期一");
    expect(byMacro.get("time")).toBe("14:07");
    expect(byMacro.get("date")).toContain("2026");
    expect([...byMacro.keys()].sort()).toEqual(["date", "isodate", "isotime", "time", "weekday"]);
  });

  it("按 id 稳定排序且声明为 volatile", () => {
    const definitions = createClockContextSources({ now: fixedNow, locale: zhLocale });
    expect(definitions.map((item) => item.id)).toEqual([
      "clock.time",
      "clock.date",
      "clock.weekday",
      "clock.isotime",
      "clock.isodate",
    ]);
    for (const definition of definitions) {
      expect(createContextSourceDefinition(definition).determinism).toBe("volatile");
    }
  });
});
