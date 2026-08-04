# Mobile Tavern v1.7.8 更新日志

发布日期：2026-08-05

## 稳定性修复

- 修复真机 LLM 流式响应中途断流（`error decoding response body`）后只能靠用户反复手动重发的问题：流式读取在未向界面输出任何内容时自动重试一次；已输出部分内容时保持"部分内容 + 连接中断"行为，不重试避免重复文本。
- 流式中断类错误信息现在带目标主机与已接收字节数（如 `[LLM 流式中断] 目标 api.deepseek.com，已接收 1234 字节`），便于区分"首包即断"与"读了大半才断"，非瞬态错误与用户手动中止保持原样透传。
- 修复仓库 `npm.bat` / `npx.bat` 包装脚本在 Windows 下执行 `npm run X && npm run Y` 链式脚本提前中断的环境问题（子批处理缺 `call` 导致 `&&` 链丢失）。
- 启用仓库 Git Hooks（`core.hooksPath=.githooks`），推送时自动执行完整质量门禁（lint、i18n、全量测试、构建）。

## 验证

- 新增 3 项 ChatStreamService 流式中断回归测试；lint、i18n、全量测试（87 项套件 + 622 项 vitest）与 Web/Node 构建全部通过。
