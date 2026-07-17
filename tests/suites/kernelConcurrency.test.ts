import { Kernel } from "../../src/kernel/Kernel";
import type { IMessage } from "../../src/kernel/types";
import { assert } from "./testUtils";

/**
 * 验证 publish 入口快照订阅者列表：
 * 迭代期间并发 subscribe 不影响本轮发布语义（快照在入口已固化），
 * 但下一轮 publish 反映最新订阅者集合。
 *
 * 不快照的隐患：subscribe 内部会 list.push(entry) + list.sort()，
 * for...of 期间触发 sort 会导致迭代行为未定义（可能跳过/重复元素或抛错）。
 */
export async function testPublishSnapshotDuringConcurrentSubscribe() {
  console.log("\n--- Running publish subscriber list snapshot verification ---");

  const kernel = new Kernel();
  const topic = "test:publish-snapshot";
  const called: string[] = [];

  const handlerC = () => { called.push("C"); };
  const handlerA = async () => {
    called.push("A");
    // A 在迭代期间订阅 C：未快照时 C 可能被本轮调用（push 进原数组后被 for-of 遍历到）
    kernel.subscribe(topic, handlerC, 0);
    // 让出微任务，使后续迭代有机会受 push+sort 影响
    await new Promise((r) => setTimeout(r, 0));
  };
  const handlerB = () => { called.push("B"); };

  kernel.subscribe(topic, handlerA, 10);
  kernel.subscribe(topic, handlerB, 5);

  await kernel.publish({ topic, payload: {} });

  // 快照生效：C 不应被本轮调用
  assert(
    !called.includes("C"),
    `C should NOT be called in this round (snapshot taken before subscribe), got: ${called.join(",")}`
  );
  assert(called.includes("A"), `A should be called, got: ${called.join(",")}`);
  assert(called.includes("B"), `B should be called, got: ${called.join(",")}`);

  // 下一轮 publish 应包含 C（订阅在新一轮入口快照时已存在）
  called.length = 0;
  await kernel.publish({ topic, payload: {} });
  assert(
    called.includes("C"),
    `C should be called in next round (subscribe took effect), got: ${called.join(",")}`
  );

  await kernel.destroy();
  console.log("✔ publish subscriber list snapshot verified!");
}

/**
 * 验证 destroy 在有多个活跃 controller 时安全：
 * 触发 publishParallel（不 await 完成）挂起多个长任务 controller，
 * 立即 destroy，验证所有 controller 被 abort、不抛错、不挂死。
 *
 * 回归覆盖 destroy 入口快照 [...activeControllers]：当前 JS 微任务模型下
 * .finally 中的 delete 不会在 destroy 同步遍历期间触发，但快照为未来同步
 * abort 回调路径与引擎差异提供防御性保障。
 */
export async function testDestroyWithMultipleActiveControllers() {
  console.log("\n--- Running destroy with multiple active controllers verification ---");

  const kernel = new Kernel();
  const topic = "test:destroy-active";
  const abortCount: number[] = [];

  // 注册 3 个长任务订阅者，每个创建独立 controller
  for (let i = 0; i < 3; i++) {
    const idx = i;
    kernel.subscribe(topic, (_msg, signal) => {
      return new Promise<void>((resolve) => {
        const onAbort = () => { abortCount.push(idx); resolve(); };
        if (signal?.aborted) { abortCount.push(idx); resolve(); return; }
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }, 10 - idx);
  }

  // 不 await，让 publishParallel 在后台挂起 3 个 controller
  const publishPromise = kernel.publishParallel({ topic, payload: {} });
  // 让出微任务，确保 publishParallel 已注册所有 controller 到 activeControllers
  await new Promise((r) => setTimeout(r, 0));

  // destroy 应 abort 所有 activeControllers，使 3 个 handler 退出
  await kernel.destroy();
  // publishPromise 应已 settle（handler 因 abort 退出，allSettled 吞掉 "aborted" reject）
  await publishPromise.catch(() => { /* 预期内的 abort reject，忽略 */ });

  assert(
    abortCount.length === 3,
    `All 3 subscribers should be aborted, got: ${abortCount.length} (indices: ${abortCount.join(",")})`
  );

  console.log("✔ destroy with multiple active controllers verified!");
}
