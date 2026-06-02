# 阿里云 SLS (Simple Log Service) & STS 安全代理高级整合指南 (v1.1.0)

本篇文档在 [原 SLS WebTracking 指南](./aliyun_sls_telemetry.md) 之上，重点指导如何通过服务端 STS 临时鉴权代理与 SDK 进行高安全、低延时、具备抗 D 频控的日志采集。

---

## 🚀 架构设计一览：为什么使用云端 STS 代理？

原有配置（WebTracking）存在的主要痛点是限制于“无鉴权”只读或由于网络直接向外部 IP 发生 CORS 跨域拦截。此外，如果直接在移动客户端/前端写入 RAM 长期密钥（AccessKey），会存在极大的安全隐患及凭证泄露风险。

**v1.1.0 升级架构：**

```
[前端/移动端 (Client)]
       │
       ├─► (携带日志负载) ─► [Node.js 遥测代理 (/api/proxy/sls) ] 
       │                         │ (若本地无缓存，请求凭证 Role ARN)
       │                         ├─► AssumeRole ─► [阿里云 STS 核心]
       │                         ◄─ (返回临时 Token) ◄─────┘
       │                         │
       │                         ▼ (使用临时 STS 凭据，SDK 底层实名鉴权写入)
       └──────────────────────► [阿里云 SLS Logstore (app-logs)] (100% 安全)
```

### 云端代理的三大王牌优势
1. **零密钥泄露风险**：真实的 RAM 子账户鉴权凭证（AccessKey/Secret）锁死在 Node.js 云端安全环境变量中，前端和网络链路只传输毫秒级高防请求或动态短效临时凭据。
2. **极速滑窗缓存拦截器**：云端通过 `getSTSCredentials()` 对 STS 凭证进行 1 小时带滑窗的（提前 5 分钟更新）本地内存缓存。**拒绝由于高并发客户端疯狂请求导致 STS 调用频率受限与卡顿**。
3. **CORS 无缝抗干扰**：所有的上报动作通过本地同源的 `/api/proxy/sls` 进行托管，不再由于网络运营商代理或浏览器自身的跨域 CORS 头而造成小概率日志丢失。
4. **单 IP 智能频控拦截**：自带 1 分钟累计限额 100 次限温保护，防止恶意刷单、API 轰炸和日志灌入。

---

## 🛠️ 云端环境变量配置表

若要使此安全代理机制和 STS 动态派生机制完全工作，您需要在全局 `.env` 文件或容器控制台中补充以下环境变量：

```env
# 核心访问凭证 (RAM 子账户，需拥有 SLS 写权限和 STS AssumeRole 权限)
ALIYUN_ACCESS_KEY_ID="LTAI5t********************"
ALIYUN_ACCESS_KEY_SECRET="eunv**************************"

# STS 扮演角色 (ARN 地址)
ALIYUN_ROLE_ARN="acs:ram::1362007603262188:role/sls-telemetry-proxy-role"
ALIYUN_STS_ENDPOINT="sts.aliyuncs.com"

# 目标 SLS 项目靶点
ALIYUN_SLS_PROJECT="my-ai-telemetry"
ALIYUN_SLS_ENDPOINT="cn-beijing.log.aliyuncs.com"
ALIYUN_SLS_LOGSTORE="app-logs"
```

> **注意：** 
> 1. 即使不配置 `ALIYUN_ROLE_ARN`，系统也会尝试动态回退、退火并直传。
> 2. 如果服务端未检测到相关的 RAM 根 AccessKey 配置，代理请求会自动且安全地降级为 **不带签名的 WebTracking 自送机制（Fallback）**，保证无论如何都不影响线上玩家的流畅体验。

---

## 💻 补充代码审查与调用样例

### 1. 服务端上报方法：`POST /api/proxy/sls`
调用时通过合规的 JSON Payload 上传，如：

```json
{
  "payload": {
    "__logs__": [
      {
        "action": "click_button",
        "playerName": "小李",
        "characterName": "神秘女仆",
        "modelName": "gemini-3.5-flash",
        "totalTokens": "1280",
        "sessionDurationMs": "24000"
      }
    ],
    "__source__": "my-client-v1.1",
    "__tags__": {
      "platform": "mobile-android"
    }
  }
}
```

### 2. 客户端接入样例
前端/移动端可直接向您的后端网关异步发起投递：

```typescript
import { getDeviceId } from "./telemetry-helpers";

async function reportTelemetry(eventName: string, extraData: Record<string, any>) {
  const payload = {
    __logs__: [{
      action: eventName,
      deviceId: getDeviceId(),
      timestamp: Date.now(),
      ...extraData
    }],
    __source__: "web-client"
  };

  try {
    const res = await fetch("/api/proxy/sls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload })
    });
    const result = await res.json();
    if (result.success) {
      console.log("遥测日志上传成功");
    }
  } catch (err) {
    console.error("遥测日志发送异常 (CORS-Free 模式):", err);
  }
}
```

---

## 📈 RAM 策略配置建议 (最小特权模板)

为了确保子用户的最佳安全性，请在阿里云 RAM 控制台按以下策略分配权限：

### 角色信任策略 (Trust Policy)
允许函数计算/您的云应用扮演本角色：

```json
{
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Effect": "Allow",
      "Principal": {
        "RAM": [
          "acs:ram::1362007603262188:root"
        ]
      }
    }
  ],
  "Version": "1"
}
```

### 角色权限策略 (Role Access Policy)
保证该角色仅能对目标遥测 Logstore 拥有单向写日志（`PostLogStoreLogs`）的权限：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "log:PostLogStoreLogs"
      ],
      "Resource": [
        "acs:log:*:*:project/my-ai-telemetry/logstore/app-logs"
      ]
    }
  ]
}
```
通过这样严密的极简鉴权模型，即使 Token 意外在前端被截获或丢失，对方也完全无法读取、窥探、修改或擦除任何其他数据资产。
