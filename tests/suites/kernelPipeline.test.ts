/**
 * 内核管道与硬化测试套件
 *
 * 覆盖：
 *  - testKernelFaultIsolation：服务注册/熔断/No-op SafeProxy 隔离
 *  - testKernelPipeline：洋葱模型与中间件优先级排序、阻断拦截
 *  - testKernelPipelineHardening：注销、unuse、异常隔离、遗忘 next() 处置
 *  - testKernelHardeningP0ToP3：消息总线/原子性/开发模式强抛/一键销毁
 */

import { Kernel, setKernelStrictMode } from "../../src/kernel/Kernel";
import { IKernelService } from "../../src/kernel/types";
import { assert } from "./testUtils";

export async function testKernelFaultIsolation() {
  console.log("\n--- Running Kernel Fault Isolation Verification ---");

  const testKernel = new Kernel();

  // 1. 测试正常的服务注册与获取
  const mockService: IKernelService = {
    name: "mock-normal",
    init(kernel) {
      (this as any).initialized = true;
    }
  };
  await testKernel.registerService("mock-normal", mockService);
  const retrieved = testKernel.getService<any>("mock-normal");
  assert(retrieved.name === "mock-normal", "Service retrieval name matches");
  assert(retrieved.initialized === true, "Service initialized correctly");

  // 2. 测试异步 init 初始化的微服务
  let asyncInitRun = false;
  const mockAsyncService: IKernelService = {
    name: "mock-async",
    async init(kernel) {
      await new Promise(resolve => setTimeout(resolve, 10));
      asyncInitRun = true;
    }
  };
  await testKernel.registerService("mock-async", mockAsyncService);
  assert((asyncInitRun as boolean) === true, "Async init resolves correctly before registration completes");

  // 3. 测试非致命初始化崩溃的服务隔离
  const badService: IKernelService = {
    name: "mock-bad",
    init(kernel) {
      throw new Error("Init crash simulated!");
    }
  };
  // 注册非致命崩溃服务，由于有 try-catch，这不应该向外抛出异常
  try {
    await testKernel.registerService("mock-bad", badService);
  } catch (err) {
    throw new Error("registerService should isolate non-critical initialization crashes");
  }

  // 4. 测试致命核心服务崩溃的主动熔断阻断
  const criticalService: IKernelService = {
    name: "mock-critical",
    isCritical: true,
    init(kernel) {
      throw new Error("Critical service loading error!");
    }
  };
  let criticalErrorThrown = false;
  try {
    await testKernel.registerService("mock-critical", criticalService);
  } catch (err: any) {
    assert(err.message.includes("Fatal") && err.message.includes("Critical service"), "Critical error propagates to host");
    criticalErrorThrown = true;
  }
  assert(criticalErrorThrown === true, "Fatal critical service initialization must halt kernel");

  // 5. 测试服务销毁生命周期 (destroy)
  let destroyRun = false;
  const mockDestroyService: IKernelService = {
    name: "mock-destroy",
    init(kernel) {},
    async destroy(kernel) {
      destroyRun = true;
    }
  };
  await testKernel.registerService("mock-destroy", mockDestroyService);
  await testKernel.destroyService("mock-destroy");
  assert((destroyRun as boolean) === true, "Destroy hook executed successfully");
  // 销毁后再次获取，应退化为 Safe Proxy
  const nullService = testKernel.getService<any>("mock-destroy");
  assert(nullService.name === "mock-destroy", "Destroyed service fallbacks to safe proxy");

  // 6. 测试获取不存在的（或者初始化崩掉而被剔除的）服务
  // 应该返回 No-op Safe Proxy，而不是抛出异常
  const proxyService = testKernel.getService<any>("mock-bad");
  assert(proxyService !== undefined, "Proxy service returned instead of throwing");
  assert(proxyService.name === "mock-bad", "Proxy service returns name property correctly");

  // 7. 测试 No-op Safe Proxy 的深度链式属性读取
  try {
    const val = proxyService.config.api.enabled;
    assert(typeof val === "function", "Proxy deep properties return proxy noop function");
  } catch (err) {
    throw new Error("Proxy should not throw on deep property access");
  }

  // 8. 测试 No-op Safe Proxy 的普通方法调用和链式方法调用
  try {
    proxyService.someMethod("arg1", 2).anotherMethod();
  } catch (err) {
    throw new Error("Proxy should not throw on arbitrary method calls");
  }

  // 9. 测试 No-op Safe Proxy 的 Promise await 链兼容性
  try {
    const p = proxyService.asyncSaveSession({ id: "session1" });
    const res = await p;
    assert(res === undefined, "Proxy await resolves to undefined");
  } catch (err) {
    throw new Error("Proxy should properly resolve Promise await chain");
  }

  console.log("✔ Kernel Fault Isolation and Safe No-op Proxy verified!");
}

export async function testKernelPipeline() {
  console.log("\n--- Running Kernel Pipeline Middlewares Verification ---");

  const testKernel = new Kernel();

  // 1. 验证内置管道已预设
  const inputPipeline = testKernel.getPipeline("input");
  const outputPipeline = testKernel.getPipeline("output");
  const settingsPipeline = testKernel.getPipeline("settings");
  assert(inputPipeline !== undefined, "input pipeline preset");
  assert(outputPipeline !== undefined, "output pipeline preset");
  assert(settingsPipeline !== undefined, "settings pipeline preset");

  // 2. 验证防空自动注册
  const customPipeline = testKernel.getPipeline("my-custom-pipeline");
  assert(customPipeline !== undefined, "custom pipeline auto registered");
  const sameCustom = testKernel.getPipeline("my-custom-pipeline");
  assert(customPipeline === sameCustom, "subsequent get returns the same instance");

  // 3. 验证洋葱模型与优先级排序
  interface TestContext {
    logs: string[];
    value: number;
  }

  const pipeline = testKernel.registerPipeline<TestContext>("test-onion");

  // 注册中优先级中间件
  pipeline.use(async (ctx, next) => {
    ctx.logs.push("mid-start");
    ctx.value += 10;
    await next();
    ctx.logs.push("mid-end");
  }, 10);

  // 注册高优先级中间件
  pipeline.use(async (ctx, next) => {
    ctx.logs.push("high-start");
    ctx.value *= 2;
    await next();
    ctx.logs.push("high-end");
  }, 100);

  // 注册低优先级中间件
  pipeline.use((ctx, next) => {
    // 测试同步和默认优先级 (0)
    ctx.logs.push("low-start");
    ctx.value -= 5;
    // 尽管是同步，但也需要调用 next 以延续管道
    const p = next();
    ctx.logs.push("low-end");
    return p;
  });

  const context: TestContext = { logs: [], value: 5 };
  await pipeline.execute(context);

  // 预期执行流程:
  // 1. high-start (value = 5 * 2 = 10)
  // 2. mid-start  (value = 10 + 10 = 20)
  // 3. low-start  (value = 20 - 5 = 15)
  // 4. low-end
  // 5. mid-end
  // 6. high-end
  assert(context.value === 15, `Context final value should be 15, got: ${context.value}`);
  const expectedLogs = ["high-start", "mid-start", "low-start", "low-end", "mid-end", "high-end"];
  assert(JSON.stringify(context.logs) === JSON.stringify(expectedLogs), `Logs sequence is incorrect, got: ${JSON.stringify(context.logs)}`);

  // 4. 验证管道阻断拦截功能
  const interceptPipeline = testKernel.registerPipeline<TestContext>("test-intercept");
  interceptPipeline.use(async (ctx, next) => {
    ctx.logs.push("m1-start");
    await next();
    ctx.logs.push("m1-end");
  }, 20);

  // 阻断者：不调用 next()
  interceptPipeline.use(async (ctx, next) => {
    ctx.logs.push("blocker");
    (ctx as any).isInterrupted = true;
    // 不调用 next()
  }, 10);

  interceptPipeline.use(async (ctx, next) => {
    ctx.logs.push("m3");
    await next();
  }, 0);

  const blockContext: TestContext = { logs: [], value: 0 };
  await interceptPipeline.execute(blockContext);

  const expectedBlockLogs = ["m1-start", "blocker", "m1-end"];
  assert(JSON.stringify(blockContext.logs) === JSON.stringify(expectedBlockLogs), `Blocker did not stop pipeline correctly, got: ${JSON.stringify(blockContext.logs)}`);

  console.log("✔ Kernel Middleware Pipeline & onion composition verified successfully!");
}

export async function testKernelPipelineHardening() {
  console.log("\n--- Running Kernel Pipeline Hardening (Recovery, Unsubscribe, Proxy Warning) Verification ---");

  const testKernel = new Kernel();

  // 1. 验证 Safe Proxy 双轨环境警告
  const originalWarn = console.warn;
  let warnMessage = "";
  console.warn = (msg: string, ...args: any[]) => {
    warnMessage = msg;
    originalWarn(msg, ...args);
  };

  try {
    const nonexistent = testKernel.getService<any>("nonexistent-service");
    // 读取属性触发警告
    const testVal = nonexistent.someConfig.api;
    assert(warnMessage.includes("Accessing property") && warnMessage.includes("SafeProxy"), "SafeProxy dev diagnostic outputs warning");
  } finally {
    console.warn = originalWarn; // 恢复 console.warn
  }

  // 2. 验证动态注销中间件 (use返回的注销函数及 unuse)
  interface HardContext {
    logs: string[];
    isInterrupted?: boolean;
  }

  const p1 = testKernel.registerPipeline<HardContext>("hardening-pipeline-cleanup");

  const mid1 = (ctx: HardContext, next: () => Promise<void>) => {
    ctx.logs.push("m1");
    return next();
  };

  const mid2 = (ctx: HardContext, next: () => Promise<void>) => {
    ctx.logs.push("m2");
    return next();
  };

  // 注册并获取注销器
  const unsubscribe = p1.use(mid1, 10);
  p1.use(mid2, 5);

  const ctx1: HardContext = { logs: [] };
  await p1.execute(ctx1);
  assert(JSON.stringify(ctx1.logs) === JSON.stringify(["m1", "m2"]), "Pipeline runs registered middlewares");

  // 执行注销函数注销 mid1
  unsubscribe();
  const ctx2: HardContext = { logs: [] };
  await p1.execute(ctx2);
  assert(JSON.stringify(ctx2.logs) === JSON.stringify(["m2"]), "Unsubscribed middleware does not run");

  // 使用 unuse 卸载 mid2
  p1.unuse(mid2);
  const ctx3: HardContext = { logs: [] };
  await p1.execute(ctx3);
  assert(JSON.stringify(ctx3.logs) === JSON.stringify([]), "unuse-d middleware does not run");

  // 3. 验证异常隔离：中间件崩溃后管道停止（B-3 修复：不再自动跳过）
  const p2 = testKernel.registerPipeline<HardContext>("hardening-pipeline-error");

  // 注册一个会崩溃抛错的中间件
  p2.use(async (ctx, next) => {
    ctx.logs.push("err-start");
    throw new Error("Simulated plugin crash!");
  }, 10);

  // 注册正常的后续中间件（B-3 修复后：异常后不再自动跳过，该中间件不应执行）
  p2.use(async (ctx, next) => {
    ctx.logs.push("should-not-run-after-crash");
    await next();
  }, 5);

  // 拦截 console.error 以防测试报告日志过于杂乱
  const originalError = console.error;
  let errorLogged = false;
  console.error = (...args: any[]) => {
    errorLogged = true;
    originalError(...args);
  };

  try {
    const errorCtx: HardContext = { logs: [] };
    await p2.execute(errorCtx);
    // B-3 修复：异常后管道在此终止，后续中间件不应执行
    assert(errorCtx.logs.includes("err-start"), "Error middleware ran before crash");
    assert(!errorCtx.logs.includes("should-not-run-after-crash"), "Pipeline halted at crash point, subsequent middleware did not run (B-3 fix)");
    assert((errorLogged as boolean) === true, "Pipeline logged the exception correctly");
  } finally {
    console.error = originalError;
  }

  // 4. 验证遗忘 next() 时管道停止（B-3 修复：不再自动穿透安全边界）
  const p3 = testKernel.registerPipeline<HardContext>("hardening-pipeline-hanging");

  // 中间件遗忘调用 next()，且没有设置 isInterrupted
  p3.use((ctx, _next) => {
    ctx.logs.push("forget-next");
    // 不调用 next()：在旧版本会自动跳过，B-3 修复后管道在此停止
  }, 10);

  p3.use(async (ctx, next) => {
    ctx.logs.push("should-not-run-without-next");
    await next();
  }, 5);

  const originalError2 = console.error;
  let forgotNextErrorLogged = false;
  console.error = (...args: any[]) => {
    forgotNextErrorLogged = true;
    originalError2(...args);
  };

  try {
    const hangCtx: HardContext = { logs: [] };
    await p3.execute(hangCtx);
    // B-3 修复：遗忘 next() 后记录错误但不穿透，后续中间件不执行
    assert(hangCtx.logs.includes("forget-next"), "Middleware ran before forgetting next()");
    assert(!hangCtx.logs.includes("should-not-run-without-next"), "Pipeline halted after forget-next, no bypass (B-3 fix)");
    assert((forgotNextErrorLogged as boolean) === true, "Pipeline logged forget-next error");
  } finally {
    console.error = originalError2;
  }

  // 5. 验证受控的阻断拦截 (isInterrupted)
  const p4 = testKernel.registerPipeline<HardContext>("hardening-pipeline-interrupt");

  // 敏感词/阻断中间件
  p4.use((ctx, next) => {
    ctx.logs.push("interrupt-middleware");
    ctx.isInterrupted = true;
    // 显式申请阻断，不调 next
  }, 10);

  p4.use(async (ctx, next) => {
    ctx.logs.push("should-not-run");
    await next();
  }, 5);

  const interruptCtx: HardContext = { logs: [] };
  await p4.execute(interruptCtx);
  assert(JSON.stringify(interruptCtx.logs) === JSON.stringify(["interrupt-middleware"]), "Pipeline was successfully halted explicitly via isInterrupted");

  console.log("✔ Kernel Pipeline Hardening & Self-healing features verified successfully!");
}

export async function testKernelHardeningP0ToP3() {
  console.log("\n--- Running Kernel Hardening P0 to P3 Verification ---");

  // 临时开启严格开发校验模式
  setKernelStrictMode(true);

  try {
    // 1. 验证 消息总线订阅与注销 (P0)
    const testKernel = new Kernel();
    let msgRunCount = 0;
    const handler = (msg: any) => {
      assert(msg.payload === "hello-data", "Payload must match");
      msgRunCount++;
    };

    // 验证 subscribe 返回注销闭包
    const dispose = testKernel.subscribe("test:topic", handler);
    await testKernel.publish({ topic: "test:topic", payload: "hello-data" });
    assert(msgRunCount === 1, "Subscriber should be triggered once");

    // 执行注销
    dispose();
    await testKernel.publish({ topic: "test:topic", payload: "hello-data" });
    assert(msgRunCount === 1, "Subscriber should not trigger after dispose");

    // 验证 unsubscribe 显式销毁
    msgRunCount = 0;
    testKernel.subscribe("test:topic2", handler);
    await testKernel.publish({ topic: "test:topic2", payload: "hello-data" });
    assert(msgRunCount === 1, "Subscriber 2 should trigger once");

    testKernel.unsubscribe("test:topic2", handler);
    await testKernel.publish({ topic: "test:topic2", payload: "hello-data" });
    assert(msgRunCount === 1, "Subscriber 2 should not trigger after unsubscribe");

    // 2. 验证 Service 注册原子性 (P1)
    let serviceInitialized = false;
    let initPhaseGetServiceThrew = false;
    const initCrashService: IKernelService = {
      name: "crash-service",
      isCritical: true, // 致命关键服务，以验证报错向上传播与熔断
      async init(kernel) {
        serviceInitialized = true;
        // B-2 修复后的新语义：在 init() 过程中，criticalServiceNames 已包含本服务名称，
        // 因此 getService("crash-service") 会直接抛出 FATAL 而非返回 SafeProxy。
        // 这是正确行为：关键服务在任何阶段都不允许静默降级。
        try {
          kernel.getService("crash-service");
        } catch (e: any) {
          initPhaseGetServiceThrew = true;
          // 验证确实是 FATAL 错误而非 SafeProxy
          if (!e.message.includes("FATAL")) {
            throw e; // 不是预期的 FATAL，重新抛出
          }
        }
        throw new Error("Init crash simulated!");
      }
    };

    try {
      await testKernel.registerService("crash-service", initCrashService);
      throw new Error("Should have thrown error on registerService crash");
    } catch (err: any) {
      assert(err.message.includes("Init crash simulated!"), "Correct error thrown from init");
    }
    // 验证原子性：init 报错时，不可暴露实例在 services 容器中
    assert((serviceInitialized as boolean) === true, "Init function was run");
    // B-2 修复后：init 过程中关键服务 getService 调用应抛出 FATAL（不是 SafeProxy）
    assert((initPhaseGetServiceThrew as boolean) === true, "During init of critical service, getService(self) throws FATAL not SafeProxy (B-2 fix)");

    // 注册失败后，services 容器中不能存在该实例
    // B-2 修复后：关键服务注册失败后 getService 直接抛出 FATAL（而非返回 SafeProxy DevError）
    let threwOnAccess = false;
    try {
      const serviceAfterFail = testKernel.getService<any>("crash-service");
    } catch (e: any) {
      threwOnAccess = true;
      assert(e.message.includes("FATAL") && e.message.includes("crash-service"), "After failed critical service init, getService throws FATAL (B-2 fix)");
    }
    assert(threwOnAccess === true, "Critical service after failed init must throw FATAL on getService");


    // 3. 验证 Pipeline 开发模式漏调 next() / 报错强抛 (P1)
    interface DevCtx {
      logs: string[];
      isInterrupted?: boolean;
    }
    const pipeline = testKernel.registerPipeline<DevCtx>("dev-test-pipeline");

    // 3.1 验证漏调 next() 且没有 isInterrupted 标志时在开发环境下抛出强 Error
    pipeline.use((ctx, next) => {
      ctx.logs.push("m1");
      // 漏调 next()，且没有 ctx.isInterrupted = true
    }, 10);

    let hangErrorThrown = false;
    try {
      await pipeline.execute({ logs: [] });
    } catch (err: any) {
      assert(err.message.includes("without calling next()"), "Dev mode throws error when middleware leaks next()");
      hangErrorThrown = true;
    }
    assert(hangErrorThrown === true, "Pipeline hang error thrown in dev mode");

    // 清除刚才的漏调中间件，测试受控拦截
    pipeline.unuse(pipeline["middlewares"][0].fn); // 强行清除刚才挂载的漏调中间件

    // 3.2 验证中间件报错在开发环境下向上强抛，不加掩盖
    pipeline.use((ctx, next) => {
      throw new Error("User Code Error!");
    }, 20);

    let codeErrorThrown = false;
    try {
      await pipeline.execute({ logs: [] });
    } catch (err: any) {
      assert(err.message === "User Code Error!", "Dev mode throws original plugin exception upwards");
      codeErrorThrown = true;
    }
    assert(codeErrorThrown === true, "Plugin exception thrown directly to host in dev mode");

    // 4. 验证 SafeProxy 开发期抛错拦截 (P2)
    const nonexistent = testKernel.getService<any>("not-found-service");
    let proxyThrew = false;
    try {
      const testVal = nonexistent.api.url;
    } catch (err: any) {
      assert(err.message.includes("is not registered") && err.message.includes("SafeProxy"), "Dev mode block silent failures by throwing");
      proxyThrew = true;
    }
    assert(proxyThrew === true, "SafeProxy properties block access in dev mode");

    // 5. 验证一键销毁 destroy() (P3)
    const okService: IKernelService = {
      name: "ok-service",
      init(kernel) {},
      destroy(kernel) {
        (this as any).destroyed = true;
      }
    };
    await testKernel.registerService("ok-service", okService);

     // 注册一堆 pipelines 和 subscribers
     testKernel.subscribe("destroy-event", () => {});
     testKernel.registerPipeline("destroy-pipeline");

     // 一键销毁
     await testKernel.destroy();

     // 验证服务注销及 destroy 钩子触发
     assert(okService["destroyed"] === true, "Service destroy hook executed");
     assert(testKernel["services"].size === 0, "All services cleared");
     assert(testKernel["subscribers"].size === 0, "All subscribers cleared");
     assert(testKernel["pipelines"].size === 0, "All pipelines cleared");

    console.log("✔ Kernel Hardening P0 to P3 features verified successfully!");
  } finally {
    // 恢复为默认非严格的生产运行模式
    setKernelStrictMode(false);
  }
}
