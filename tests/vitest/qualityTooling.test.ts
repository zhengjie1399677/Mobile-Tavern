import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

describe("质量门禁工具链", () => {
  it.runIf(process.platform === "win32")("npm.bat 透传失败退出码", () => {
    const wrapperPath = path.join(workspaceRoot, "npm.bat");
    const result = spawnSync(wrapperPath, ["run", "__missing_quality_script__"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      shell: true,
      timeout: 10_000,
    });

    expect(result.status).not.toBe(0);
  });

  it("quality:push 接入 watchdog 与 fail-fast 测试", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(workspaceRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts["quality:push"]).toContain("watchdog-run.mjs");
    expect(manifest.scripts["quality:push"]).toContain("--timeout 600000");
    expect(manifest.scripts["quality:push:inner"]).toContain("npm test -- --bail");
  });

  it("watchdog 透传子命令失败退出码", () => {
    const watchdogPath = path.join(workspaceRoot, "scripts", "watchdog-run.mjs");
    const failingCommand = `"${process.execPath}" -e "process.exit(7)"`;
    const result = spawnSync(
      process.execPath,
      [watchdogPath, "--cmd", failingCommand, "--timeout", "5000"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        timeout: 8_000,
      },
    );

    expect(result.status).toBe(7);
  });

  it("watchdog 超时后快速终止并返回 124", () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), "mobile-tavern-watchdog-"));
    const reportPath = path.join(tempDirectory, "report.json");
    const watchdogPath = path.join(workspaceRoot, "scripts", "watchdog-run.mjs");
    const hangingCommand = `"${process.execPath}" -e "setTimeout(() => {}, 10000)"`;

    try {
      const startedAt = Date.now();
      const result = spawnSync(
        process.execPath,
        [
          watchdogPath,
          "--cmd",
          hangingCommand,
          "--timeout",
          "250",
          "--report",
          reportPath,
          "--tail",
          "10",
        ],
        {
          cwd: workspaceRoot,
          encoding: "utf8",
          timeout: 8_000,
        },
      );

      expect(result.status).toBe(124);
      expect(Date.now() - startedAt).toBeLessThan(5_000);

      const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
        trigger: string;
        exitCode: number;
        processSnapshot: { rootPid: number };
      };
      expect(report.trigger).toBe("timeout");
      expect(report.exitCode).toBe(124);
      expect(report.processSnapshot.rootPid).toBeGreaterThan(0);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  }, 10_000);
});
