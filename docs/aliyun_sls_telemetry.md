# 阿里云 SLS (Simple Log Service) 直传方案指南

使用 SLS WebTracking 可以让前端直接将日志发送到阿里云 SLS，**既不需要部署云函数（FC），速度也更快，且成本极低**（对于小量级的 Web 埋点，基本上在 SLS 的免费额度内，或者花费只有几分钱）。

## 1. 为什么推荐 WebTracking直传？
- **成本更低**：省去了阿里云 FC 的请求费用和流转费用。100 个用户每个月产生的数据量即使按 10 万次事件发送计算，产生的数据量也在几MB到十几MB，使用计费通常为 0 元或者不超过 1 元，远比使用云函数/NAS划算。
- **配置更简单**：全托管、自带清洗、报表和数据查询监控界面。不需要自己再维护SQLite。

## 2. 操作指南：开启并配置 SLS WebTracking

1. **登录阿里云 SLS 控制台**：进入 [日志服务控制台](https://sls.console.aliyun.com/)。
2. **创建 Project**：
   - 如果没有，点击“创建 Project”（比如命名为 `my-ai-telemetry`），选择靠近您的地域（例如 `cn-hangzhou`）。
3. **创建 Logstore**：
   - 在进入 Project 后，新建 Logstore（例如叫 `app-logs`）。在创建页中，必须开启 **WebTracking** 这个选项开关（或创建后再在 Logstore 的设置里把 Web Tracking 开关打开）。
4. **⚠️ 配置 CORS (跨域请求) ⚠️（重要步骤）**:
   - WebTracking 开启后，虽然支持了以无鉴权的方式收集日志，但默认前端浏览器可能会拦截 POST 请求。
   - 打开您的 SLS Logstore，找到“数据接入” -> “WebTracking” 或者在存储库属性的“跨域CORS”中，**必须要为主域名配置 CORS 规则**：
     - **Allowed Origins**: 填写您托管应用程序的 URL（比如 `https://*.run.app` 或者是 `*`）。
     - **Allowed Methods**: 选择 `POST`, `OPTIONS`, `GET`。

## 3. 修改您的项目配置

前端代码已为您更新，支持自动向 SLS WebTracking 拉取。您需要在自己本地的 `.env.local` 或者平台部署环境变量中配置这三个参数：

```env
VITE_ALIYUN_SLS_PROJECT=（你的Project名称，例如 my-ai-telemetry）
VITE_ALIYUN_SLS_ENDPOINT=（你的所在地域域名，例如 cn-hangzhou.log.aliyuncs.com）
VITE_ALIYUN_SLS_LOGSTORE=（你的Logstore名称，例如 app-logs）

# 注意这行可以留空或者删掉，配置了SLS就会优先走SLS
VITE_ALIYUN_FC_ENDPOINT=
```

## 4. 日志格式与预览
接入后，SLS 界面上就能直接搜到日志。我们已经在前端对数据进行了清洗，在 SLS 里会自动解析成结构化的字段：

| 时间字段（时间） | 玩家名称 | 角色卡名称 | 使用模型 | 使用token | 使用总时间_秒 | 设备ID |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 2026/06/01 12:00:00 | 小王 | 霸道总裁 | gemini-3.5-flash | 1240 | 124 | dev_7f8x... |

你可以直接在 SLS 查语句，并且可以通过 SLS 生成仪表盘 (Dashboard) 查看大盘使用量或缓存命中占比，极大提高了运维分析效率。
