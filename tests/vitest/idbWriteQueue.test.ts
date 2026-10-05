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

describe("写队列按聚合分片", () => {
  beforeEach(() => {
    __resetWriteQueueForTesting();
  });

  it("长写不阻塞无关聚合（②的核心诉求）", async () => {
    const blocker = gate();
    const order: string[] = [];

    const migration = enqueueWrite(async () => {
      order.push("migration:start");
      await blocker.promise;
      order.push("migration:end");
    }, { key: "data-migration:replace-all", scope: "data-migration" });
    const sessionWrite = enqueueWrite(async () => {
      order.push("session");
    }, "session:abc:turn");

    // 会话写在迁移仍挂起时就应完成：不同聚合不该互相等待。
    await sessionWrite;
    expect(order).toContain("session");
    expect(order).not.toContain("migration:end");

    blocker.open();
    await migration;
    expect(order).toContain("migration:end");
  });

  it("同聚合（同 key 前两段）保持严格有序", async () => {
    const order: string[] = [];
    const first = enqueueWrite(async () => {
      order.push("turn");
    }, "session:abc:turn");
    const second = enqueueWrite(async () => {
      order.push("metadata");
    }, "session:abc:metadata");

    await Promise.all([first, second]);
    expect(order).toEqual(["turn", "metadata"]);
  });

  it("不同聚合可并行（两个会话互不等待）", async () => {
    const blocker = gate();
    const started: string[] = [];

    const a = enqueueWrite(async () => {
      started.push("a:start");
      await blocker.promise;
    }, "session:a:turn");
    const b = enqueueWrite(async () => {
      started.push("b:start");
    }, "session:b:turn");

    await b;
    expect(started).toEqual(["a:start", "b:start"]);

    blocker.open();
    await a;
  });

  it("整库迁移共享分片：replace-all 与 merge 互相串行", async () => {
    const blocker = gate();
    const order: string[] = [];

    const replaceAll = enqueueWrite(async () => {
      order.push("replace-all:start");
      await blocker.promise;
      order.push("replace-all:end");
    }, { key: "data-migration:replace-all", scope: "data-migration" });
    const merge = enqueueWrite(async () => {
      order.push("merge:start");
    }, { key: "data-migration:merge", scope: "data-migration" });

    await Promise.resolve();
    expect(order).toEqual(["replace-all:start"]);

    blocker.open();
    await Promise.all([replaceAll, merge]);
    expect(order).toEqual(["replace-all:start", "replace-all:end", "merge:start"]);
  });
});
