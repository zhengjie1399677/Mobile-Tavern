const fs = require("fs");
const { spawnSync } = require("node:child_process");

// 1. 收集所有含 fixable 问题的文件
const out = spawnSync("npx", ["eslint", ".", "-f", "json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 128 * 1024 * 1024,
});
if (out.status !== 0) {
  console.error("eslint 扫描失败:", out.stderr);
  process.exit(1);
}
const data = JSON.parse(out.stdout);
const fixable = [];
for (const f of data) {
  if (f.messages.some((m) => m.fix)) fixable.push(f.filePath);
}
console.log(`共 ${fixable.length} 个文件含可自动修复问题`);

// 2. 逐个 --fix，跳过被锁定的文件
const failed = [];
for (const file of fixable) {
  const r = spawnSync("npx", ["eslint", file, "--fix"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    const msg = (r.stdout || "") + (r.stderr || "");
    if (msg.includes("EPERM")) failed.push(file);
    else console.log(`⚠️ ${file.replace(/\\/g, "/")} 失败: ${msg.slice(0, 120)}`);
  }
}
console.log(
  failed.length
    ? `已跳过 ${failed.length} 个被锁定文件:\n` + failed.map((f) => "  " + f.replace(/\\/g, "/")).join("\n")
    : "全部文件修复完成"
);
