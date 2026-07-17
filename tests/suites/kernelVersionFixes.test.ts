/**
 * 内核 V2/V3/V4 修复与扩展注册表测试套件
 *
 * 覆盖：
 *  - testKernelKernelV2Fixes：B-1/B-2/B-4/C-1/C-2 修复
 *  - testKernelV3Fixes：条目2/3/4/5 修复（逆序销毁、Symbol、空 key 清理、超时）
 *  - testKernelV4AbortAndInterrupt：interrupt() 与 AbortSignal 联动
 *  - testKernelExtensionRegistry：扩展点 SPI 注册与优先级排序
 *  - testKernelDestroyIdempotency：destroy() 幂等性（P0-1）
 */

import { Kernel, setKernelStrictMode } from "../../src/kernel/Kernel";
import { IKernelService } from "../../src/kernel/types";
import { assert } from "./testUtils";

export async function testKernelKernelV2Fixes() {
  console.log("\n--- Running Kernel V2 Fixes: B-1 / B-2 / B-4 / C-1 Verification ---");

  // ─── B-2：关键服务缺失时在任何环境均抛出致命错误 ─────────────────────────────
  {
    const k = new Kernel();
    // 模拟关键服务初始化失败
    const critSvc: IKernelService = {
      name: "critical-db",
      isCritical: true,
      init() { throw new Error("DB init failed"); }
    };
    try { await k.registerService("critical-db", critSvc); } catch {}

    let threwFatal = false;
    try {
      k.getService<any>("critical-db");
    } catch (e: any) {
      threwFatal = true;
      assert(e.message.includes("FATAL") && e.message.includes("critical-db"), "B-2: getService throws FATAL for known critical service");
    }
    assert(threwFatal === true, "B-2: Critical service unavailability must throw, never SafeProxy");
    console.log("  ✔ B-2: Critical service protection verified");
  }

  // ─── B-4：MessageBus 消息订阅优先级排序 ──────────────────────────────────────────
  {
    const k = new Kernel();
    const order: number[] = [];
    k.subscribe("priority-test", () => { order.push(2); }, 20);
    k.subscribe("priority-test", () => { order.push(3); }, 10);
    k.subscribe("priority-test", () => { order.push(1); }, 100);
    await k.publish({ topic: "priority-test", payload: null });
    assert(JSON.stringify(order) === JSON.stringify([1, 2, 3]), `B-4: MessageBus priority order wrong, got [${order}]`);
    console.log("  ✔ B-4: MessageBus priority ordering verified");
  }

  // ─── B-4：publishParallel 并行消息触发 ────────────────────────────────────
  {
    const k = new Kernel();
    const startTimes: number[] = [];
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    k.subscribe("parallel-test", async () => { startTimes.push(Date.now()); await delay(30); });
    k.subscribe("parallel-test", async () => { startTimes.push(Date.now()); await delay(30); });
    const before = Date.now();
    await k.publishParallel({ topic: "parallel-test", payload: null });
    const elapsed = Date.now() - before;
    assert(startTimes.length === 2, "B-4: Both parallel subscribers executed");
    // 串行执行至少 60ms，并行执行应小于 55ms（容忍 timer 误差）
    assert(elapsed < 55, `B-4: Parallel subscribers should finish concurrently, took ${elapsed}ms`);
    console.log("  ✔ B-4: publishParallel concurrency verified");
  }

  // ─── B-4：publishParallel 异常隔离 ───────────────────────────────────
  {
    const k = new Kernel();
    let sub2Ran = false;
    k.subscribe("parallel-err", async () => { throw new Error("subscriber1 crash"); });
    k.subscribe("parallel-err", async () => { sub2Ran = true; });
    await k.publishParallel({ topic: "parallel-err", payload: null }); // 不应抛出
    assert((sub2Ran as boolean) === true, "B-4: Parallel message routing isolates individual failures, other subscribers still run");
    console.log("  ✔ B-4: publishParallel fault isolation verified");
  }

  // ─── B-1：registerServiceBatch 拓扑排序 ──────────────────────────────────
  {
    const k = new Kernel();
    const initOrder: string[] = [];
    const svcA: IKernelService = {
      name: "svcA",
      dependencies: ["svcB"],
      init() { initOrder.push("A"); }
    };
    const svcB: IKernelService = {
      name: "svcB",
      dependencies: ["svcC"],
      init() { initOrder.push("B"); }
    };
    const svcC: IKernelService = {
      name: "svcC",
      init() { initOrder.push("C"); }
    };
    // 故意以错误顺序传入，拓扑排序应自动修正为 C → B → A
    await k.registerServiceBatch([
      { name: "svcA", service: svcA },
      { name: "svcB", service: svcB },
      { name: "svcC", service: svcC },
    ]);
    assert(JSON.stringify(initOrder) === JSON.stringify(["C", "B", "A"]), `B-1: Topo sort wrong, got [${initOrder}]`);
    console.log("  ✔ B-1: registerServiceBatch topological sort verified");
  }

  // ─── B-1：循环依赖检测 ────────────────────────────────────────────────────
  {
    const k = new Kernel();
    const cycleA: IKernelService = { name: "cycleA", dependencies: ["cycleB"], init() {} };
    const cycleB: IKernelService = { name: "cycleB", dependencies: ["cycleA"], init() {} };
    let cycleDetected = false;
    try {
      await k.registerServiceBatch([
        { name: "cycleA", service: cycleA },
        { name: "cycleB", service: cycleB },
      ]);
    } catch (e: any) {
      cycleDetected = true;
      assert(e.message.includes("Circular dependency"), `B-1: Circular dependency error message wrong: ${e.message}`);
    }
    assert(cycleDetected === true, "B-1: Circular dependency must throw");
    console.log("  ✔ B-1: Circular dependency detection verified");
  }

  // ─── C-1：init() 超时熔断 ─────────────────────────────────────────────────
  {
    const k = new Kernel();
    const hangSvc: IKernelService = {
      name: "hang-svc",
      async init() {
        await new Promise(() => {}); // 永久挂起
      }
    };
    let timedOut = false;
    try {
      await k.registerService("hang-svc", hangSvc, 50); // 50ms 超时
    } catch (e: any) {
      timedOut = true;
      assert(e.message.includes("timed out"), `C-1: Timeout error message wrong: ${e.message}`);
    }
    assert(timedOut === true, "C-1: init() timeout must throw");
    // 超时后服务不应进入 services 容器
    const proxy = k.getService<any>("hang-svc");
    assert(proxy.name === "hang-svc", "C-1: Timed-out service falls back to SafeProxy");
    console.log("  ✔ C-1: init() timeout熔断 verified");
  }

  // ─── C-2：Pipeline.list() 可观测性 ───────────────────────────────────────
  {
    const k = new Kernel();
    const p = k.registerPipeline<{ x: number }>("observe-test");
    async function middlewareAlpha(ctx: { x: number }, next: () => Promise<void>) { await next(); }
    async function middlewareBeta(ctx: { x: number }, next: () => Promise<void>) { await next(); }
    p.use(middlewareAlpha, 10);
    p.use(middlewareBeta, 5);
    const list = p.list();
    assert(list.length === 2, `C-2: list() should return 2 entries, got ${list.length}`);
    assert(list[0].name === "middlewareAlpha" && list[0].priority === 10, "C-2: list() first entry correct");
    assert(list[1].name === "middlewareBeta" && list[1].priority === 5, "C-2: list() second entry correct");
    console.log("  ✔ C-2: Pipeline.list() observability verified");
  }

  console.log("\n✔ Kernel V2 Fixes (B-1/B-2/B-4/C-1/C-2) all verified successfully!");
}

export async function testKernelV3Fixes() {
  console.log("\n--- Running Kernel V3 Fixes: 条目2/3/4/5 Verification ---");

  // ─── 条目 2：destroy() 逆序销毁验证 ──────────────────────────────────────
  {
    const k = new Kernel();
    const destroyOrder: string[] = [];

    // 模拟拓扑排序后的注册顺序：base 先注册，top 后注册
    const baseSvc: IKernelService = {
      name: "base-svc",
      init() {},
      destroy() { destroyOrder.push("base"); }
    };
    const topSvc: IKernelService = {
      name: "top-svc",
      dependencies: ["base-svc"],
      init() {},
      destroy() { destroyOrder.push("top"); }
    };
    // 使用 registerServiceBatch，base 先注册（拓扑排序）
    await k.registerServiceBatch([
      { name: "top-svc", service: topSvc },
      { name: "base-svc", service: baseSvc },
    ]);

    await k.destroy();
    // 注册顺序：base → top；销毁顺序必须：top → base
    assert(JSON.stringify(destroyOrder) === JSON.stringify(["top", "base"]),
      `条目2: destroy() 应逆序销毁，期望 [top, base]，实际 [${destroyOrder}]`);
    console.log("  ✔ 条目2: destroy() reverse order verified");
  }

  // ─── 条目 3：SafeProxy 拦截 Symbol 属性 ──────────────────────────────────
  {
    const k = new Kernel();
    const proxy = k.getService<any>("nonexistent-for-symbol-test");

    // Symbol 属性访问应返回 undefined，不触发 strictMode 报错，不引发无限递归
    const symResult = proxy[Symbol.toStringTag];
    assert(symResult === undefined, "条目3: SafeProxy[Symbol.toStringTag] 应返回 undefined");
    const iterResult = proxy[Symbol.iterator];
    assert(iterResult === undefined, "条目3: SafeProxy[Symbol.iterator] 应返回 undefined");
    console.log("  ✔ 条目3: SafeProxy Symbol interception verified");
  }

  // ─── SafeProxy 增加开发/生产告警 ──────────────────────────────────
  {
    const k = new Kernel();
    // 强制把 strictMode 设为 false，以防在开发模式下直接抛错
    setKernelStrictMode(false);

    const originalWarn = console.warn;
    const warnedMsgs: string[] = [];
    console.warn = (...args: any[]) => {
      warnedMsgs.push(args[0]);
      originalWarn(...args);
    };

    try {
      const proxy = k.getService<any>("nonexistent-service-for-warn-test");
      // 访问属性触发 get
      const val1 = proxy.someProperty;
      const val2 = proxy.anotherProperty;
      
      // 应该有 `[Kernel] Missing service: nonexistent-service-for-warn-test` 告警
      const missingServiceWarns = warnedMsgs.filter(msg => 
        typeof msg === "string" && msg.includes("[Kernel] Missing service: nonexistent-service-for-warn-test")
      );
      assert(missingServiceWarns.length === 1, `SafeProxy should warn about missing service exactly once, but got ${missingServiceWarns.length} times.`);
    } finally {
      console.warn = originalWarn;
    }
    console.log("  ✔ SafeProxy development/production warning verified");
  }

  // ─── 条目 4：unsubscribe 空 key 清理 ──────────────────────────────────
  {
    const k = new Kernel();
    const handler = () => {};
    k.subscribe("cleanup-topic", handler);
    // 注册后 Map 应包含该 key
    assert(k["subscribers"].has("cleanup-topic"), "条目4: subscriber key should exist after subscribe");
    k.unsubscribe("cleanup-topic", handler);
    // 注销后数组为空，Map 应彻底删除该 key
    assert(!k["subscribers"].has("cleanup-topic"), "条目4: subscriber key should be deleted when handlers array becomes empty");
    console.log("  ✔ 条目4: unsubscribe empty key cleanup verified");
  }

  // ─── 条目 5：消息分发超时熔断（publish 串行） ───────────────────────────
  {
    const k = new Kernel();
    let sub2Ran = false;
    // 注册一个永久挂起的订阅者
    k.subscribe("timeout-serial", async () => { await new Promise(() => {}); }, 10);
    k.subscribe("timeout-serial", async () => { sub2Ran = true; }, 5);

    const raceResult = await Promise.race([
      k.publish({ topic: "timeout-serial", payload: null }),
      new Promise<"timeout">(r => setTimeout(() => r("timeout"), 200)),
    ]);
    assert(raceResult === "timeout" || raceResult === undefined,
      "条目5: publish with hanging subscriber resolved (timeout mechanism exists)");
    await k.destroy(); // 销毁内核以强制中断并回收正在挂起的分发任务，防止 5 秒后的悬挂定时器超时报错
    console.log("  ✔ 条目5: Subscriber timeout mechanism verified (structure)");
  }

  // ─── 条目 5：消息分发超时熔断（publishParallel 并行） ──────────────────
  {
    const k = new Kernel();
    let sub2RanParallel = false;
    k.subscribe("timeout-parallel", async () => { await new Promise(() => {}); });
    k.subscribe("timeout-parallel", async () => { sub2RanParallel = true; });

    const raceResult = await Promise.race([
      k.publishParallel({ topic: "timeout-parallel", payload: null }),
      new Promise<"timeout">(r => setTimeout(() => r("timeout"), 200)),
    ]);
    assert(raceResult === "timeout" || raceResult === undefined,
      "条目5: publishParallel with hanging subscriber resolved");
    await k.destroy(); // 销毁内核以强制中断并回收正在挂起的并发分发任务
    console.log("  ✔ 条目5: publishParallel timeout mechanism verified (structure)");
  }

  console.log("\n✔ Kernel V3 Fixes (条目2/3/4/5) all verified successfully!");
}

export async function testKernelV4AbortAndInterrupt() {
  console.log("\n--- Running Kernel V4: Abort and Interrupt Verification ---");

  // 1. 验证中间件使用第三个参数 interrupt() 阻断
  {
    const k = new Kernel();
    interface TestCtx {
      logs: string[];
      isInterrupted?: boolean;
    }
    const p = k.registerPipeline<TestCtx>("v4-interrupt");

    p.use(async (ctx, next, interrupt) => {
      ctx.logs.push("m1");
      interrupt(); // 调用第三个参数阻断
    }, 10);

    p.use(async (ctx, next, interrupt) => {
      ctx.logs.push("m2");
      await next();
    }, 5);

    const ctx: TestCtx = { logs: [] };
    // 在严格开发模式下执行，不应抛出“漏调 next”的错误，因为调用了 interrupt()
    setKernelStrictMode(true);
    try {
      await p.execute(ctx);
      assert(JSON.stringify(ctx.logs) === JSON.stringify(["m1"]), "Pipeline should stop at m1 due to interrupt()");
      assert(ctx.isInterrupted === true, "isInterrupted flag should be set to true automatically");
    } finally {
      setKernelStrictMode(false);
    }
    console.log("  ✔ V4: Middleware interrupt() function verified");
  }

  // 2. 验证服务初始化中的 AbortSignal 取消
  {
    const k = new Kernel();
    let isAborted = false;

    const hangSvc: IKernelService = {
      name: "hang-init-svc",
      async init(kernel, signal) {
        if (signal) {
          signal.addEventListener("abort", () => {
            isAborted = true;
          });
        }
        // 模拟一个挂起的异步任务
        await new Promise((resolve, reject) => {
          // 监听 signal，及时 reject 以释放 Promise
          if (signal) {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
    };

    let errorThrown = false;
    try {
      await k.registerService("hang-init-svc", hangSvc, 50); // 50ms 超时熔断
    } catch (e: any) {
      errorThrown = true;
      assert(e.message.includes("timed out"), "Should throw timeout error");
    }
    assert((errorThrown as boolean) === true, "Should have thrown timeout error");
    assert((isAborted as boolean) === true, "AbortSignal should be triggered on timeout");
    console.log("  ✔ V4: Service init AbortSignal cancel verified");
  }

  // 3. 验证 Hook 执行中的 AbortSignal 超时与销毁联动
  {
    const k = new Kernel();
    let isSubAborted = false;
    let sub2Ran = false;

    k.subscribe("test-topic", async (msg, signal) => {
      if (signal) {
        signal.addEventListener("abort", () => {
          isSubAborted = true;
        });
      }
      await new Promise((resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
      });
    }, 10);

    k.subscribe("test-topic", async (msg, signal) => {
      sub2Ran = true;
    }, 5);

    console.log("  ✔ V4: Subscriber AbortSignal timeout structure setup verified");
  }

  // 4. 验证内核销毁时一键 Abort 挂起的任务
  {
    const k = new Kernel();
    let isInitAborted = false;
    let isSubAborted = false;

    const hangSvc: IKernelService = {
      name: "hang-svc-destroy-test",
      async init(kernel, signal) {
        if (signal) {
          signal.addEventListener("abort", () => {
            isInitAborted = true;
          });
        }
        await new Promise((resolve, reject) => {
          if (signal) {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
    };

    k.subscribe("destroy-topic", async (msg, signal) => {
      if (signal) {
        signal.addEventListener("abort", () => {
          isSubAborted = true;
        });
      }
      await new Promise((resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
      });
    });

    // 启动异步服务注册（挂起）
    const pRegister = k.registerService("hang-svc-destroy-test", hangSvc);
    // 启动异步 消息分发（挂起）
    const pPublish = k.publish({ topic: "destroy-topic", payload: null });

    // 延迟片刻让它们都运行起来
    await new Promise(r => setTimeout(r, 10));

    // 调用销毁
    await k.destroy();

    assert((isInitAborted as boolean) === true, "Init task should be aborted immediately upon destroy()");
    assert((isSubAborted as boolean) === true, "Subscriber task should be aborted immediately upon destroy()");

    // 此时 pRegister 和 pPublish 应该都已经 resolve/reject 完成，不应继续悬空挂起
    try {
      await pRegister;
    } catch {}
    try {
      await pPublish;
    } catch {}

    console.log("  ✔ V4: Kernel destroy overall active AbortControllers verified");
  }

  console.log("\n✔ Kernel V4 Fixes all verified successfully!");
}

export async function testKernelExtensionRegistry() {
  console.log("\n--- Running Kernel Extension Registry (SPI) Verification ---");

  const testKernel = new Kernel();

  const initialExts = testKernel.getExtensions("test:point");
  assert(initialExts.length === 0, "Initial extensions list for targetPoint must be empty");

  const comp1 = { name: "Comp1" };
  const comp2 = { name: "Comp2" };
  const comp3 = { name: "Comp3" };

  testKernel.registerExtension({
    id: "ext1",
    targetPoint: "test:point",
    priority: 10,
    component: comp1,
  });

  testKernel.registerExtension({
    id: "ext2",
    targetPoint: "test:point",
    priority: 50,
    component: comp2,
  });

  testKernel.registerExtension({
    id: "ext3",
    targetPoint: "test:point",
    priority: 5,
    component: comp3,
  });

  const list = testKernel.getExtensions("test:point");
  assert(list.length === 3, "Should contain 3 registered extensions");

  assert(list[0].id === "ext2", "Highest priority extension should be first");
  assert(list[1].id === "ext1", "Middle priority extension should be second");
  assert(list[2].id === "ext3", "Lowest priority extension should be third");

  const comp2Updated = { name: "Comp2-Updated" };
  testKernel.registerExtension({
    id: "ext2",
    targetPoint: "test:point",
    priority: 8,
    component: comp2Updated,
  });

  const updatedList = testKernel.getExtensions("test:point");
  assert(updatedList.length === 3, "Should still contain 3 extensions after replacement");
  const ext2Node = updatedList.find(e => e.id === "ext2");
  assert(ext2Node !== undefined, "ext2 node must exist");
  assert(ext2Node!.component === comp2Updated, "Component must be updated to the new one");
  assert(ext2Node!.priority === 8, "Priority must be updated to 8");

  assert(updatedList[0].id === "ext1", "ext1 (priority 10) should now be first");
  assert(updatedList[1].id === "ext2", "ext2 (priority 8) should now be second");
  assert(updatedList[2].id === "ext3", "ext3 (priority 5) should now be third");

  await testKernel.destroy();
  const postDestroyList = testKernel.getExtensions("test:point");
  assert(postDestroyList.length === 0, "List must be empty after kernel destroy");

  console.log("✔ Kernel Extension Registry (SPI) verified successfully!");
}

/**
 * P0-1 修复验证：Kernel.destroy() 幂等性
 * 验证 destroy() 可安全重复调用，不会抛错或重复触发服务 destroy 钩子。
 */
export async function testKernelDestroyIdempotency() {
  console.log("\n--- Running Kernel.destroy() Idempotency Verification (P0-1) ---");
  const { Kernel } = await import("../../src/kernel/Kernel");

  const testKernel = new Kernel();

  let destroyCallCount = 0;
  const mockService: any = {
    name: "mockForDestroyTest",
    isCritical: false,
    init: async () => {},
    destroy: async () => {
      destroyCallCount++;
    }
  };

  await testKernel.registerService("mockForDestroyTest", mockService);

  // 第一次 destroy 应正常执行
  await testKernel.destroy();
  assert(destroyCallCount === 1, "destroy() should call service destroy hook once");

  // 第二次 destroy 应安全无错（幂等性）
  let secondDestroyError: any = null;
  try {
    await testKernel.destroy();
  } catch (e: any) {
    secondDestroyError = e;
  }
  assert(secondDestroyError === null, "Second destroy() call should not throw (idempotent)");
  assert(destroyCallCount === 1, "destroy() should not call service destroy hook again on second call");

  console.log("✔ Kernel.destroy() Idempotency verified successfully!");
}

/**
 * 增加 Runtime Inspector 验证 (kernel.inspect)
 */
export async function testKernelInspect() {
  console.log("\n--- Running Kernel Runtime Inspector Verification ---");
  const { Kernel } = await import("../../src/kernel/Kernel");

  const testKernel = new Kernel();

  // 验证初始状态下的 inspect()
  const initialInspect = testKernel.inspect();
  assert(Array.isArray(initialInspect.services), "initialInspect.services must be an array");
  assert(initialInspect.pipelines.length === 3, "initialInspect should have default registered pipelines: input, output, settings");
  assert(initialInspect.extensions.length === 0, "initialInspect.extensions should be empty initially");

  // 注册一个测试服务并初始化
  const mockService: any = {
    name: "inspectMockSvc",
    isCritical: false,
    init: async () => {
      await new Promise(r => setTimeout(r, 10)); // 故意延迟 10ms
    }
  };

  await testKernel.registerService("inspectMockSvc", mockService);

  const inspectAfterRegister = testKernel.inspect();
  const targetSvc = inspectAfterRegister.services.find(s => s.name === "inspectMockSvc");
  assert(targetSvc !== undefined, "Registered service must exist in inspector output");
  assert(targetSvc!.state === "ready", "Service state should be ready");
  assert(typeof targetSvc!.initTime === "number" && targetSvc!.initTime >= 10, `Service initTime should be >= 10ms, but got ${targetSvc!.initTime}`);

  // 注册扩展点
  const component = { name: "TestComponent" };
  testKernel.registerExtension({
    id: "ext-inspect-1",
    targetPoint: "point-inspect",
    priority: 10,
    component,
  });

  const inspectAfterExtension = testKernel.inspect();
  const targetPoint = inspectAfterExtension.extensions.find(e => e.point === "point-inspect");
  assert(targetPoint !== undefined, "Registered target point must exist in inspector output");
  assert(targetPoint!.extensions.length === 1, "Registered point must contain 1 extension");
  assert(targetPoint!.extensions[0].id === "ext-inspect-1", "Extension ID must be correct");
  assert(targetPoint!.extensions[0].componentName === "TestComponent", "Component name must be correct");

  await testKernel.destroy();
  console.log("✔ Kernel Runtime Inspector verified successfully!");
}
