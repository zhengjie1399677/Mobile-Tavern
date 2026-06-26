# 安全策略 (SECURITY)

## 报告安全漏洞

如果你发现了一个安全漏洞，请**不要**通过公开 Issue 报告。
请通过以下方式私下报告：

1. 在 GitHub 仓库创建 **Security Advisory**（私密报告）
2. 或发送邮件至项目维护者

请在报告中包含：
- 漏洞的详细描述
- 复现步骤
- 影响范围评估
- 建议的修复方案（如有）

## 响应时间

- **确认接收**：48 小时内
- **初步评估**：5 个工作日内
- **修复发布**：根据严重程度，7-30 天内

## 安全架构概述

本项目（Mobile Tavern）的安全防护体系包括：

### 客户端
- **API Key 加密**：AES-GCM 加密后存储于 IndexedDB，加密失败清空 apiKey 防明文落库
- **SSRF 防御**：私网/回环/IPv4-mapped IPv6/八进制/十六进制/十进制全格式拦截
- **接口防腐层**：cleanRequestPayload（请求字段白名单）+ cleanLLMResponse（响应字段白名单）
- **原型污染清洗**：角色卡 extensions 递归过滤 `__proto__`/`constructor`/`prototype`
- **CSS 消毒**：script 标签剥离、url() 阻断、@import 阻断、position:fixed 降级

### 服务端
- **更新检查防刷**：IP 速率限制（10 次/分钟）+ 时间戳防重放（5 分钟有效期）
- **日志脱敏**：sk-/sk-ant-/Authorization Bearer 掩码

### 已知例外
- `apiClient.ts` 中的 `TRIAL_OPENROUTER_KEY` 为无余额的免费试用 Key，不涉及资产泄露（参见 AGENTS.md 特有例外说明）
