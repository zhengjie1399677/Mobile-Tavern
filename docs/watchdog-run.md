# watchdog-run — 进程级超时看门狗

> 零硬编码通用版：命令、超时、报告路径全部由参数传入，脚本内不写死任何项目/命令/阈值。

## 解决什么问题

vitest 在**后台 / 非交互 shell** 环境下（如 CI、自动化、超时自动后台化）测试全部通过后，
node 进程可能不主动退出（残留 esbuild / tinypool worker 子进程），表现为"看似卡住"。
本脚本为任意命令加一层进程级超时保险：超时即杀进程树，并生成 JSON 现场报告。

`npm run quality:push` 已接入本脚本，整条推送质量门禁硬上限为 10 分钟；门禁内部使用
fail-fast 测试模式，首个测试失败会立即停止，不会继续等待剩余测试与构建。
门禁输出默认抑制（`--echo on-failure`）：成功时只回显一行结果，完整输出写入
`node_modules/.cache/quality-push.log`；失败时回显日志尾部 100 行，避免全量测试
输出刷屏。

**不是**替代 vitest 单测超时（`--testTimeout`）——那是第一层（抓单测死循环），
本脚本是第二层（抓"测试完成但进程残留"），两层互补。

## 用法

```bash
# 基本用法（命令位置参数 + 可选参数）
node scripts/watchdog-run.mjs "npm test" --timeout 60000 --report ./watchdog-report.json --tail 50

# 或显式 --cmd
node scripts/watchdog-run.mjs --cmd "npm test -- --run" --timeout 120000 --report /tmp/ei.json --tail 100

# 任何命令都可以包裹
node scripts/watchdog-run.mjs "npm run quality:push" --timeout 300000 --report /tmp/mt.json

# 成功不刷屏、失败才回显尾部，同时保留完整日志
node scripts/watchdog-run.mjs --cmd "npm test" --timeout 600000 --echo on-failure --log-file /tmp/test.log --tail 100
```

| 参数 | 说明 | 默认 |
|---|---|---|
| `--cmd <cmd>` 或位置参数 | 要执行的命令（必填） | — |
| `--timeout <ms>` | 超时毫秒；`0` = 禁用超时 | `60000` |
| `--report <path>` | 报告 JSON 输出路径（仅超时/被杀时写入） | `./watchdog-report.json` |
| `--tail <lines>` | 报告保留日志尾部行数 | `50` |
| `--echo <mode>` | `always` 实时透传（默认）/ `on-failure` 仅失败回显尾部 / `never` 从不回显 | `always` |
| `--log-file <path>` | 把完整输出增量写入文件（成功时便于复查） | 不写 |

## 退出码

| 情况 | 退出码 |
|---|---|
| 子进程正常结束 | 透传子进程退出码（0 = 成功） |
| 超时被杀 | `124`（与 GNU timeout 一致） |
| 参数缺失 | `2` |
| 收到 SIGINT/SIGTERM | `130`（先清理进程树） |

## 报告字段

| 字段 | 含义 |
|---|---|
| `trigger` | `timeout` 或 `signal:SIGINT` |
| `summary` | 从日志提取的测试统计（`testFiles` / `tests` / `failedCount`） |
| `hint` | 自动判定：**残留型挂起**（测试统计完整）vs **执行中卡死**（统计缺失） |
| `logTail` | 日志尾部 N 行（定位卡点第一手证据） |
| `processSnapshot` | 残留进程树（PID / 父 PID / 命令），识别 esbuild/worker 残留 |
| `cpuDeltaSeconds` | 子进程 CPU 增量，区分"真卡死"与"死循环烧 CPU" |

## 跨平台

- **Windows**：`taskkill /pid <pid> /T /F` 递归杀进程树
- **POSIX**：`detached: true` + 负 PID `SIGKILL` 杀进程组
- 注意：Windows 上禁用 `detached`（会导致子进程 stdout/stderr 管道失效，输出被丢弃）

## 验证过的场景

| 场景 | 结果 |
|---|---|
| 正常退出 | 退出码透传，不写报告；默认实时透传，`--echo on-failure` 时成功仅一行提示、失败回显日志尾部 |
| 超时 | 124，杀净进程树，报告记录终止原因与根 PID |
| 模拟"测试通过但进程残留" | 正确提取统计并判定为残留型挂起 |
| 参数缺失 | 退出码 2 + 用法提示 |

超时与信号中断路径优先终止进程树，再写报告，避免 Windows 进程快照采集反过来延迟截断。
因此这两类报告的 `processSnapshot` 会记录被终止的根 PID 与说明，而不是终止前的完整进程树。
