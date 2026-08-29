#!/usr/bin/env node
/**
 * watchdog-run.mjs — 进程级超时看门狗（零硬编码通用版）
 *
 * 用途：
 *   包裹任意命令，若在超时时间内未正常退出，则强制杀死整个进程树，
 *   并生成一份 JSON 现场报告（日志尾部 / 测试统计 / 残留进程快照 / CPU 增量）。
 *   专治「测试全部通过但 node 进程残留不退出」类挂起（vitest + tinypool/esbuild 常见）。
 *
 * 用法（全部参数化，脚本内不硬编码任何命令/项目/阈值）：
 *   node scripts/watchdog-run.mjs "npm test" [--timeout 60000] [--report ./watchdog-report.json] [--tail 50]
 *   node scripts/watchdog-run.mjs --cmd "npm test -- --run" --timeout 120000 --report /tmp/ei.json --tail 100
 *
 * 参数：
 *   位置参数或 --cmd    要执行的命令（必填；其余均为可选）
 *   --timeout <ms>      超时毫秒数（默认 60000；0 = 禁用超时）
 *   --report <path>     报告 JSON 输出路径（默认 ./watchdog-report.json；仅在超时/被杀时写入）
 *   --tail <lines>      报告保留日志尾部行数（默认 50）
 *
 * 退出码：
 *   子进程正常结束 → 透传其退出码（0 = 成功）
 *   超时被杀       → 124（与 GNU timeout 约定一致）
 *   参数缺失       → 2
 *   收到 SIGINT/SIGTERM → 130，并先尝试清理进程树
 *
 * 跨平台：Windows 用 taskkill /T /F 杀进程树，POSIX 用负 PID 信号；快照采集尽力而为，失败不影响主体。
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_KEEP_LINES = 2000;

function parseArgs(argv) {
  const opts = { cmd: null, timeout: 60000, report: "./watchdog-report.json", tail: 50, echo: "always", logFile: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cmd") opts.cmd = argv[++i];
    else if (a === "--timeout") opts.timeout = Number(argv[++i]);
    else if (a === "--report") opts.report = argv[++i];
    else if (a === "--tail") opts.tail = Number(argv[++i]);
    else if (a === "--echo") opts.echo = argv[++i];
    else if (a === "--log-file") opts.logFile = argv[++i];
    else if (a.startsWith("--")) {
      console.error(`[watchdog] 忽略未知参数: ${a}`);
    } else positional.push(a);
  }
  if (!opts.cmd && positional.length) opts.cmd = positional.join(" ");
  if (!Number.isFinite(opts.timeout) || opts.timeout < 0) opts.timeout = 60000;
  if (!Number.isFinite(opts.tail) || opts.tail < 1) opts.tail = 50;
  if (!["always", "on-failure", "never"].includes(opts.echo)) opts.echo = "always";
  return opts;
}

function usage() {
  console.error(
    [
      "用法: node watchdog-run.mjs <命令> [选项]",
      "  或  node watchdog-run.mjs --cmd \"<命令>\" [选项]",
      "选项:",
      "  --timeout <ms>    超时毫秒（默认 60000，0 = 禁用）",
      "  --report <path>   报告 JSON 路径（默认 ./watchdog-report.json）",
      "  --tail <lines>    报告保留日志尾部行数（默认 50）",
      "  --echo <mode>     输出模式：always（默认实时透传）/ on-failure（仅失败回显尾部）/ never（从不回显）",
      "  --log-file <path> 将完整输出写入文件，便于成功时复查",
      "退出码: 子进程退出码 / 124=超时 / 2=参数错误 / 130=信号中断",
    ].join("\n"),
  );
}

/** 只保留最近 MAX_KEEP_LINES 行，报告再按 --tail 截取 */
function pushLine(lines, chunk, keep) {
  const text = chunk.toString();
  const parts = text.split(/\r?\n/);
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (i < parts.length - 1 || line.length > 0) lines.push(line);
  }
  if (lines.length > keep) lines.splice(0, lines.length - keep);
}

/** 从日志中尽力提取 vitest/jest 类测试统计，用于区分「执行中卡死」vs「测试完成但进程残留」 */
function extractTestSummary(lines) {
  const text = lines.join("\n");
  const files = text.match(/Test Files\s+(\d+)\s+passed\s*\((\d+)\)/);
  const tests = text.match(/Tests\s+(\d+)\s+passed\s*\((\d+)\)/);
  const failed = text.match(/(\d+)\s+failed/);
  return {
    testFiles: files ? { passed: Number(files[1]), total: Number(files[2]) } : null,
    tests: tests ? { passed: Number(tests[1]), total: Number(tests[2]) } : null,
    failedCount: failed ? Number(failed[1]) : 0,
  };
}

/** 尽力采集进程树快照（一次性取全量再本地建树，避免多次调用系统命令） */
function snapshotProcessTree(rootPid) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 3",
        ],
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
      let all;
      try {
        all = JSON.parse(out);
      } catch {
        all = [];
      }
      if (!Array.isArray(all)) all = all ? [all] : [];
      const byPid = new Map(all.map((p) => [Number(p.ProcessId), p]));
      const children = new Map();
      for (const p of all) {
        const pp = Number(p.ParentProcessId);
        if (!children.has(pp)) children.set(pp, []);
        children.get(pp).push(Number(p.ProcessId));
      }
      const visit = (pid, depth, acc) => {
        if (depth > 10) return;
        const p = byPid.get(pid);
        if (p) {
          acc.push({ pid, ppid: Number(p.ParentProcessId), name: p.Name, cmd: (p.CommandLine || "").slice(0, 220) });
        }
        for (const c of children.get(pid) || []) visit(c, depth + 1, acc);
      };
      const acc = [];
      visit(Number(rootPid), 0, acc);
      return acc;
    }
    // POSIX
    const out = execFileSync("ps", ["-eo", "pid=,ppid=,comm=,args="], { encoding: "utf8", timeout: 10000 });
    const rows = out
      .trim()
      .split("\n")
      .map((l) => {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        return m ? { pid: Number(m[1]), ppid: Number(m[2]), name: m[3], cmd: m[4].slice(0, 220) } : null;
      })
      .filter(Boolean);
    const children = new Map();
    for (const r of rows) {
      if (!children.has(r.ppid)) children.set(r.ppid, []);
      children.get(r.ppid).push(r);
    }
    const acc = [];
    const visit = (pid, depth) => {
      if (depth > 10) return;
      for (const c of children.get(pid) || []) {
        acc.push(c);
        visit(c.pid, depth + 1);
      }
    };
    visit(Number(rootPid), 0);
    return acc;
  } catch (err) {
    return { error: `快照采集失败: ${err.message}` };
  }
}

/** 尽力采样单进程 CPU 秒数（累计值，两次采样差 = 增量） */
function sampleCpuSeconds(pid) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue).CPU`],
        { encoding: "utf8", timeout: 10000, windowsHide: true },
      );
      const v = Number(out.trim());
      return Number.isFinite(v) ? v : null;
    }
    const out = execFileSync("ps", ["-o", "time=", "-p", String(Number(pid))], { encoding: "utf8", timeout: 5000 });
    const t = out.trim();
    if (!t) return null;
    const parts = t.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(t) || null;
  } catch {
    return null;
  }
}

function killProcessTree(pid) {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(Number(pid)), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      try {
        process.kill(-Number(pid), "SIGKILL");
      } catch {
        process.kill(Number(pid), "SIGKILL");
      }
    }
  } catch {
    /* 尽力而为 */
  }
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.cmd) {
  usage();
  process.exit(2);
}

const startedAt = Date.now();
const lines = [];
let timedOut = false;
let cpuBefore = null;

// 可选：把完整输出落盘（增量追加，避免占用大量内存）。
const logPath = opts.logFile ? path.resolve(opts.logFile) : null;
if (logPath) {
  try {
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(logPath, "");
  } catch (err) {
    console.error(`[watchdog] 无法初始化日志文件 ${logPath}: ${err.message}`);
  }
}

function appendLog(chunk) {
  if (!logPath) return;
  try { appendFileSync(logPath, chunk); } catch { /* 日志写入失败不影响主体 */ }
}

// 注意：Windows 上 detached:true 会导致子进程 stdout/stderr 管道失效（输出被丢弃），
// 因此仅 POSIX 平台启用 detached（配合负 PID 杀进程组）；Windows 用 taskkill /T 递归杀树。
const child = spawn(opts.cmd, {
  shell: true,
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

child.stdout.on("data", (d) => {
  if (opts.echo === "always") process.stdout.write(d);
  appendLog(d);
  pushLine(lines, d, MAX_KEEP_LINES);
});
child.stderr.on("data", (d) => {
  if (opts.echo === "always") process.stderr.write(d);
  appendLog(d);
  pushLine(lines, d, MAX_KEEP_LINES);
});

// 启动后尽早采一次 CPU 基线（异步，失败则忽略）
setTimeout(() => {
  cpuBefore = sampleCpuSeconds(child.pid);
}, 300);

function writeReport(reason, exitCode, diagnostics = {}) {
  const summary = extractTestSummary(lines);
  const testsDone = summary.tests && summary.tests.total > 0;
  const hint = testsDone
    ? "检测到测试统计已完成 → 疑似「测试通过但进程未退出」型挂起（残留子进程/句柄），非测试本身卡住"
    : "未检测到完整测试统计 → 疑似「执行中卡死」（单测死循环 / await 永不返回），可配合 --testTimeout 第一层防护";
  const skipLiveDiagnostics = diagnostics.skipLiveDiagnostics === true;
  const cpuAfter = skipLiveDiagnostics ? null : sampleCpuSeconds(child.pid);
  const processSnapshot = diagnostics.processSnapshot ?? snapshotProcessTree(child.pid);
  const report = {
    trigger: reason,
    command: opts.cmd,
    timeoutMs: opts.timeout,
    elapsedMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    exitCode: exitCode ?? null,
    summary,
    hint,
    cpuDeltaSeconds: cpuBefore != null && cpuAfter != null ? Math.round((cpuAfter - cpuBefore) * 1000) / 1000 : null,
    processSnapshot,
    logTail: lines.slice(-opts.tail),
  };
  const abs = path.resolve(opts.report);
  try {
    writeFileSync(abs, JSON.stringify(report, null, 2), "utf8");
    console.error(`\n[watchdog] ${reason}，现场报告已写入: ${abs}${logPath ? `，完整日志: ${logPath}` : ""}`);
  } catch (err) {
    console.error(`\n[watchdog] ${reason}，但报告写入失败: ${err.message}${logPath ? `，完整日志: ${logPath}` : ""}`);
  }
}

const timer = opts.timeout > 0
  ? setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
      writeReport("timeout", 124, {
        skipLiveDiagnostics: true,
        processSnapshot: {
          note: "为保证超时立即截断，进程树已在诊断采集前终止。",
          rootPid: child.pid,
        },
      });
      setTimeout(() => process.exit(124), 500);
    }, opts.timeout)
  : null;

child.on("close", (code, signal) => {
  if (timedOut) return; // 超时流程已接管
  if (timer) clearTimeout(timer);
  const finalCode = code ?? (signal ? 130 : 0);
  if (opts.echo !== "always") {
    const logRef = logPath ? `，完整日志: ${logPath}` : "";
    if (finalCode === 0) {
      console.log(`[watchdog] 命令成功（退出码 0），输出已抑制${logRef}`);
    } else {
      console.error(`[watchdog] 命令失败（退出码 ${finalCode}）${logRef}`);
      if (opts.echo === "on-failure" && lines.length > 0) {
        const tailLines = Math.min(opts.tail, lines.length);
        console.error(`[watchdog] 日志尾部 ${tailLines} 行:`);
        console.error(lines.slice(-tailLines).join("\n"));
      }
    }
  }
  process.exit(finalCode);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (timer) clearTimeout(timer);
    console.error(`\n[watchdog] 收到 ${sig}，清理进程树后退出`);
    killProcessTree(child.pid);
    writeReport(`signal:${sig}`, 130, {
      skipLiveDiagnostics: true,
      processSnapshot: {
        note: "为保证信号中断立即生效，进程树已在诊断采集前终止。",
        rootPid: child.pid,
      },
    });
    setTimeout(() => process.exit(130), 500);
  });
}
