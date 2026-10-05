/**
 * 写队列合并语义回归。
 *
 * 背景：P1-11 引入「同 key 合并只落最新一次」用于省掉中间落盘，这对「整体保存最新状态」
 * 是对的（既有测试 database.test.ts::testWriteQueueKeyCoalescing 也在断言该语义）。
 * 但追加/提交类写入（按增量 upsert）一旦被合并，先到那批数据会被直接丢弃——
 * 例如 commitSessionTurn 的 messages。所以 mode 必须显式声明。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { __resetWriteQueueForTesting, enqueueWrite } from "@/src/infrastructure/storage/idbQueue";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("写队列合并语义", () => {
  beforeEach(() => {
    __resetWriteQueueForTesting();
  });

  it("coalesceable（默认）：同 key 排队只执行最后一次，先到者拿到后到者的结果", async () => {
    const blocker = gate();
    const executed: string[] = [];

    const holding = enqueueWrite(async () => {
      await blocker.promise;
    });
    const first = enqueueWrite(async () => {
      executed.push("first");
      return "first";
    }, "state:k");
    const second = enqueueWrite(async () => {
      executed.push("second");
      return "second";
    }, "state:k");

    blocker.open();
    await holding;

    expect(await first).toBe("second");
    expect(await second).toBe("second");
    expect(executed).toEqual(["second"]);
  });

  it("must-complete：同 key 也各自执行，各自拿到自己的结果（提交类不能再被合并）", async () => {
    const blocker = gate();
    const executed: string[] = [];

    const holding = enqueueWrite(async () => {
      await blocker.promise;
    });
    const first = enqueueWrite(async () => {
      executed.push("first");
      return "first";
    }, { key: "commit:turn", mode: "must-complete" });
    const second = enqueueWrite(async () => {
      executed.push("second");
      return "second";
    }, { key: "commit:turn", mode: "must-complete" });

    blocker.open();
    await holding;

    expect(await first).toBe("first");
    expect(await second).toBe("second");
    expect(executed).toEqual(["first", "second"]);
  });

  it("must-complete 不占合并槽位，随后的 coalesceable 同 key 写不会把它顶掉", async () => {
    const blocker = gate();
    const executed: string[] = [];

    const holding = enqueueWrite(async () => {
      await blocker.promise;
    });
    const commit = enqueueWrite(async () => {
      executed.push("commit");
      return "commit";
    }, { key: "same:key", mode: "must-complete" });
    const save = enqueueWrite(async () => {
      executed.push("save");
      return "save";
    }, { key: "same:key", mode: "coalesceable" });

    blocker.open();
    await holding;

    expect(await commit).toBe("commit");
    expect(await save).toBe("save");
    expect(executed).toEqual(["commit", "save"]);
  });

  it("位置参数写法（key, signal）保持既有 coalesceable 行为", async () => {
    const blocker = gate();
    const executed: string[] = [];

    const holding = enqueueWrite(async () => {
      await blocker.promise;
    });
    const first = enqueueWrite(async () => {
      executed.push("first");
      return "first";
    }, "legacy:key");
    const second = enqueueWrite(async () => {
      executed.push("second");
      return "second";
    }, "legacy:key");

    blocker.open();
    await holding;

    expect(await first).toBe("second");
    expect(await second).toBe("second");
    expect(executed).toEqual(["second"]);
  });
});
