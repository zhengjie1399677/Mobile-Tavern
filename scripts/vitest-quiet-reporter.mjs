/**
 * vitest-quiet-reporter.mjs — 非 TTY 环境下的静默 reporter。
 *
 * 背景：vitest 内置 dot reporter 在非 TTY（管道 / CI / 自动化）下仍会逐文件
 * 打印通过列表（BaseReporter.onTaskUpdate），全量 130+ 文件的输出会完整进入
 * 调用方上下文，是推送/审查任务 token 消耗的主要来源之一。
 *
 * 行为：
 * - TTY（交互终端）：完整委托 DefaultReporter，交互体验不变。
 * - 非 TTY：不打印每个任务的通过行，不打印测试内 console；
 *   成功只输出一行提示 + 官方汇总行；失败输出失败用例名、错误消息与堆栈前三行。
 *
 * 用法：在 vitest.config.ts 中 `reporters: [new QuietReporter()]`。
 * 调用方可用 `--reporter=default|verbose` 覆盖回完整输出。
 */
import { DefaultReporter } from "vitest/reporters";

function flattenTasks(tasks, out = []) {
  for (const task of tasks) {
    out.push(task);
    if (Array.isArray(task.tasks)) {
      flattenTasks(task.tasks, out);
    }
  }
  return out;
}

export class QuietReporter extends DefaultReporter {
  onTaskUpdate() {
    // 非 TTY：不逐任务打印；TTY 下 DefaultReporter 本来也只走渲染器，无需处理。
  }

  onUserConsoleLog() {
    // 非 TTY：抑制测试内 console 噪声；失败详情统一由 onFinished 输出。
  }

  async onFinished(
    files = this.ctx?.state?.getFiles() ?? [],
    errors = this.ctx?.state?.getUnhandledErrors() ?? [],
  ) {
    if (this.isTTY) {
      return super.onFinished(files, errors);
    }

    this.end = performance.now();
    let printed = false;

    for (const file of files) {
      const failed = flattenTasks(file.tasks ?? []).filter(
        (task) => task.result?.state === "fail",
      );
      for (const task of failed) {
        printed = true;
        const err = task.result?.errors?.[0];
        this.ctx.logger.error(`✗ ${task.name}`);
        if (err?.message) {
          this.ctx.logger.error(`  ${err.message}`);
        }
        if (err?.stack) {
          for (const line of err.stack.split("\n").slice(1, 4)) {
            this.ctx.logger.error(`  ${line}`);
          }
        }
      }
      if (file.result?.state === "fail" && failed.length === 0) {
        printed = true;
        this.ctx.logger.error(`✗ ${file.name}`);
        for (const err of file.result.errors ?? []) {
          this.ctx.logger.error(`  ${err?.message ?? String(err)}`);
        }
      }
    }

    for (const err of errors ?? []) {
      printed = true;
      this.ctx.logger.error(`✗ Unhandled error: ${err?.message ?? String(err)}`);
    }

    if (!printed) {
      this.ctx.logger.log("✓ 全部测试通过（详细列表已省略，加 --verbose 查看）");
    }

    super.reportSummary(files, errors);
  }
}
