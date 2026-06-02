# 阿里云函数计算 (Aliyun FC) - 使用指南与遥测后端部署示例

为了收集用户设备标识（匿名 UUID）、使用时长、发送消息次数等信息，我们需要一个可以接收 `POST` 请求并将数据持久化存储的后端。在大陆网络环境下，**阿里云函数计算 (Function Compute, FC)** + **阿里云表格存储 (OTS) 或 日志服务 (SLS)** 是一个非常轻量且免运维的选择。

客户端代码已经在 `src/utils/telemetry.ts` 中写好，并通过 `.env.example` 中的 `VITE_ALIYUN_FC_ENDPOINT` 来配置网关地址。

以下是实现目标（搭建遥测后端）的完整步骤：

---

## 步骤 1：开通与创建函数
1. 登录阿里云控制台，搜索 "**函数计算 FC**"。
2. 点击“**创建函数**”，选择“**Web 函数**”或“事件函数”（推荐 Web 函数）。
3. 运行环境选择 **Node.js 18** 或 **Node.js 20**。
4. "触发器配置" 中，勾选 **HTTP 触发器**（**千万不要选 OSS 触发器！**因为我们需要由前端页面通过 HTTP 请求主动调用这个接口，而不是由 OSS 触发它）。请求方法勾选 `POST` 和 `OPTIONS`，认证方式选择 **无认证**。

> **关于你遇到的 "实例启动失败" 或 "Fail to mount oss" 错误说明：**
> 1. **"Fail to mount oss"** 报错是因为你在控制台创建了“OSS 触发器”或“挂载了OSS目录”但权限不足。请删除 OSS 触发器或取消挂载，我们只需要最普通的 **HTTP 触发器**。
> 2. **"RuntimeInitializationError (实例启动失败)"** 是因为我们代码里引入了 `ali-oss` 依赖包，但你阿里云函数里面的 `package.json` 没有安装这个依赖。如果不安装依赖，Nodejs 运行报错就会导致启动失败。

## 步骤 2：在函数中配置代码和依赖

在阿里云函数计算的代码编辑器（Web IDE）中，你需要创建（或修改）两个文件：`package.json` 和 `index.js`（或 `server.js`）。

### 1. 修改 `package.json`
在函数计算根目录，找到或创建一个 `package.json` 文件，填入以下内容。我们加入了 `express` 和 `ali-oss` 依赖：

```json
{
  "name": "fc-telemetry",
  "version": "1.0.0",
  "description": "Telemetry backend",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "ali-oss": "^6.20.0",
    "express": "^4.18.2"
  }
}
```
*(注意：修改了 `package.json` 后，在 Web IDE 的终端里执行一下 `npm install` 来下载依赖，否则还是会启动失败)*

### 2. 编写后端代码 `index.js`
将函数的主入口文件（默认为 `index.js` 或 `server.js`）的内容全部替换为以下代码。这份代码不仅能将接收到的日志打印在控制台，还会**自动从函数计算请求头中读取临时凭证**（只要你在控制台配置了函数角色），从而安全地把日志保存成文件存入你的 OSS 数据库（Bucket）中：

```javascript
const express = require('express');
const app = express();

// 支持解析较大的 JSON 请求体
app.use(express.json({ limit: '10mb' }));

// 1. 处理跨域 (CORS) - 允许客户端发请求
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-fc-access-key-id, x-fc-access-key-secret, x-fc-security-token');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

// 2. 接收遥测数据的 POST 接口
app.post('/*', async (req, res) => {
    try {
        const payload = req.body;
        const deviceId = payload.deviceId || 'unknown';
        
        console.log(`\n=== 收到用户数据上报 | 设备号: ${deviceId} ===`);
        
        // ---------- 写入数据到 OSS ----------
        // 从请求头获取函数计算注入的临时授权凭证（需已在函数计算配置中绑定有 OSS 权限的角色）
        const akId = req.header('x-fc-access-key-id') || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const akSecret = req.header('x-fc-access-key-secret') || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        const stsToken = req.header('x-fc-security-token') || process.env.ALIBABA_CLOUD_SECURITY_TOKEN;
        
        // 获取 Bucket 信息（建议在环境变量中配置，或者直接在代码里写死）
        const region = process.env.OSS_REGION || 'oss-cn-hangzhou'; // 【重要】你的 OSS 地域
        const bucket = process.env.OSS_BUCKET || 'oss-pai-g1oykgf91pjv949k4u-cn-hangzhou';     // 【重要】替换你的 Bucket 名称

        if (akId && akSecret && bucket) {
            const OSS = require('ali-oss');
            const store = new OSS({
                region: region,
                bucket: bucket,
                accessKeyId: akId,
                accessKeySecret: akSecret,
                stsToken: stsToken, // 临时凭证必须传 token
                secure: true
            });

            // 以日期为目录，设备号和时间戳为文件名
            const dateStr = new Date().toISOString().split('T')[0];
            const fileName = `telemetry-logs/${dateStr}/${deviceId}-${Date.now()}.json`;
            
            // 为了满足您所需的精准日志格式，我们将在此处对数据进行清洗和格式化
            // 提取：玩家名称，调用时间，打开时间，使用总时间，角色卡名称，使用token，模型，会话ID
            const events = payload.events || [];
            
            const formattedLogs = events.map(evt => {
                const extra = evt.extraData || {};
                return {
                    "事件类型": evt.action,
                    "玩家名称": extra.playerName || "未知",
                    "角色卡名称": extra.characterName || "未知",
                    "调用时间": new Date(evt.timestamp).toLocaleString(),
                    "打开时间": payload.sessionStartTime ? new Date(payload.sessionStartTime).toLocaleString() : "未知",
                    "使用总时间": payload.sessionDurationMs ? Math.round(payload.sessionDurationMs / 1000) + "秒" : "未知",
                    "使用模型": extra.modelName || "未知",
                    "使用token": extra.totalTokens || 0,
                    "会话ID": extra.sessionId || "未知序列"
                };
            });
            
            // 将客户端传来的 JSON 对象转成 Buffer 保存成文件 (这里我们同时保存简化格式和原始完整格式)
            const finalDataToSave = {
               summary: formattedLogs,
               rawPayload: payload 
            };
            
            const buffer = Buffer.from(JSON.stringify(finalDataToSave, null, 2));

            const result = await store.put(fileName, buffer);
            console.log(`[OSS] ✅ 成功保存日志到 OSS 文件: ${result.name}`);
        } else {
            console.log(`[OSS] ⚠️ 未读取到凭证或未配置 Bucket，跳过写入 OSS。建议检查函数是否配置了有 OSS 权限的"服务角色"`);
        }
        // ------------------------------------
        
        res.status(200).json({ success: true, message: 'Telemetry received and saved' });
    } catch (e) {
        console.error("❌ 写入异常:", e.message);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// 阿里云自定义运行时的默认监听端口是 9000
const port = 9000;
app.listen(port, "0.0.0.0", () => {
    console.log(`🚀 Telemetry backend listening on port ${port}`);
});
```

## 步骤 3：部署与获取 URL
1. 在函数详情页的右上角，点击 **“部署代码”**。
2. 部署完成后，在页面上方或对应的 **触发器管理 (Triggers)** 标签页中找到 **公网访问地址**。
3. 复制该 URL。

## 步骤 4：客户端配置
在你的应用程序环境变量配置中（或在你的 `.env` / 客户构建配置中）：
将 `VITE_ALIYUN_FC_ENDPOINT` 的值填为上一步获取的公网访问地址。

```env
VITE_ALIYUN_FC_ENDPOINT="https://your-function-name-id.cn-hangzhou.fcapp.run"
```

## 如果要实现“赠送额度”功能怎么做？
你以后可以基于上面这个 HTTP 触发器，暴露两个接口路由：
1. `POST /api/telemetry` 收取使用次数
2. `GET /api/quota?deviceId=xxx` 返回此设备ID还剩多少免费使用次数。

在 `App.tsx` 中的 `handleSendMessage` 方法中，发送请求前，先请求 `/api/quota` 进行校验，如果次数不足，则阻止发送并弹出提示 "免费额度已耗尽，请绑定 xxx 获取更多额度"。
