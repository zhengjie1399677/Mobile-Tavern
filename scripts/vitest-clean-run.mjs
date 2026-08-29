#!/usr/bin/env node
/**
 * vitest-clean-run.mjs — Windows 下 vitest 测试完成后强制收尾的运行器。
 *
 * 背景：Windows 上 `vitest run` 测试全部通过后，worker 孙进程可能残留
 * （pipe 写端不释放），主进程永不退出，导致后台任务 / pre-push 门禁挂死。
 *
 * 策略（与 tests/run_all_tests.ts 的 runVitestSuite 一致，已验证）：
 *   1. spawn vitest，捕获 stdout（转发到父进程），剥离 ANSI 后检测完成汇总行
 *      （"Test Files ... passed" / "Tests ... passed" / "N failed"）；
 *   2. 出现完成标记后启动 5s 兜底定时器，等待 vitest 自然退出；
 *   3. 仍残留则先 `taskkill /F /T /PID` 杀整棵进程树（顺序必须先 taskkill
 *      后 kill，反了 PID 失效），再 kill 外壳兜底；
 *   4. 按输出中的失败计数判定退出码。
 *
 * 用法：node scripts/vitest-clean-run.mjs run [-- <filter> ...]
 * （package.json: "test:unit": "node scripts/vitest-clean-run.mjs run"）
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

// 直接调用 vitest 的 Node ESM 入口，避免 .cmd + shell 拼接参数的兼容问题
// 与 Node 24 的 deprecation 警告。
const bin = path.join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
// 默认静默：vitest.config.ts 的 QuietReporter 在非 TTY 下只输出失败与汇总，
// --silent 再抑制测试内 console；调用方显式传入 --reporter 可恢复完整输出。
const args = ["--silent", ...process.argv.slice(2)];

const child = spawn(process.execPath, [bin, ...args], {
  stdio: ["inherit", "pipe", "inherit"],
  cwd: process.cwd(),
});

let output = "";
let settled = false;
let fallback = null;

const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

// 只识别 vitest 官方汇总行（"Test Files  X passed/failed"、"Tests  X passed/failed"），
// 避免把测试内 console 日志中的 "N failed" 文本误判为测试失败。
const hasSummary = (text) =>
  /^Test Files\s+\d+\s+(passed|failed)|^Tests\s+\d+\s+(passed|failed)/m.test(stripAnsi(text));

// 取最后一个汇总行判定成败（vitest 失败行形如 "Tests  1 failed | 636 passed (637)"）。
const summaryHasFailure = (text) => {
  const lines = stripAnsi(text).split("\n");
  const summaryLines = lines.filter(
    (line) => /^Test Files\s+\d+/.test(line) || /^Tests\s+\d+/.test(line),
  );
  if (summaryLines.length === 0) return false;
  const last = summaryLines[summaryLines.length - 1];
  const failed = /(\d+)\s+failed/.exec(last);
  return !!failed && Number(failed[1]) > 0;
};

const settle = (code) => {
  if (settled) return;
  settled = true;
  if (fallback) clearTimeout(fallback);
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch { /* 进程可能已退出，忽略 */ }
  }
  try { child.kill("SIGKILL"); } catch { /* 忽略 */ }
  process.exit(code);
};

const scheduleFallback = () => {
  if (fallback || settled) return;
  fallback = setTimeout(() => {
    if (settled) return;
    if (summaryHasFailure(output)) {
      console.error("vitest-clean-run: tests failed, forcing exit 1");
      settle(1);
    } else {
      console.log("vitest-clean-run: tests completed (process cleanup fallback)");
      settle(0);
    }
  }, 5000);
};

child.stdout?.on("data", (chunk) => {
  process.stdout.write(chunk);
  output += chunk.toString();
  if (hasSummary(output)) {
    scheduleFallback();
  }
});

child.on("close", (code) => settle(code ?? 1));
child.on("error", (err) => {
  if (!settled) {
    console.error(`vitest-clean-run: failed to spawn vitest: ${err.message}`);
    process.exit(1);
  }
});
