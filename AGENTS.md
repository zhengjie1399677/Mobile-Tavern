# Telemetry Architecture & Flow

此文件用于记录当前的遥测集成架构与运行逻辑。**系统提示：AI在处理遥测相关问题时，务必完全按照此文件中的逻辑执行，不要被过去的旧逻辑代码误导。**

## 环境与配置隔离 (安全基础)
1. 前端代码和 `.env.example` 中**没有任何敏感的 AK/SK 密钥**。只有基础配置：
   - `VITE_ALIYUN_SLS_PROJECT`
   - `VITE_ALIYUN_SLS_ENDPOINT`
   - `VITE_ALIYUN_SLS_LOGSTORE`
   - `VITE_ALIYUN_FC_STS_URL`
2. 真实的、拥有高权限的 `ALIYUN_ACCESS_KEY_ID` 和 `ALIYUN_ACCESS_KEY_SECRET` 等凭据，全部配置在阿里云函数计算 (FC) 专属控制台的环境变量中，与前端仓库彻底物理隔离。

## 客户端启动与请求 (前端请求凭证)
1. 当终端用户打开 App/Web 时，`telemetry.ts` 准备投递日志。
2. 它首先会检查内存中是否已有且未过期的 STS 凭证。如果没有，前端会向 `VITE_ALIYUN_FC_STS_URL` 发起一个 HTTP(S) `GET` 访问请求。

## FC 函数网关拦截与签发 (云端风控)
*(此部分代码部署在远程阿里云FC上，本地不包含此逻辑)*
1. 部署在阿里云的 FC 接收到请求后，提取对方 IP并判定限流（防止耗尽资源/额度）。
2. 在频率限制内，FC 使用自己环境变量里的高权限 AK，向阿里云内网 STS 服务器请求一个只拥有 PutLogs 权限、有效期短（例如 1 小时）的临时凭证。
3. FC 返回 `{ AccessKeyId, AccessKeySecret, SecurityToken, Expiration }` 等信息给客户端。

## 客户端免密直连 (底层 SDK 直接写入)
1. 客户端在 `src/utils/telemetry.ts` 中拿到临时凭证后，将其喂给 `@aliyun-sls/web-track-browser` 以及其配套的 `@aliyun-sls/web-sts-plugin` 官方 SDK 并进行初始化。
   ```typescript
   trackerInstance.useStsPlugin(
     createStsPlugin({
       accessKeyId: credentials.AccessKeyId,
       accessKeySecret: credentials.AccessKeySecret,
       securityToken: credentials.SecurityToken,
       // ...
     })
   );
   ```
2. 从这一刻起，客户端产生的每条操作日志，使用官方 SDK（`trackerInstance.sendBatchLogs` 等）直接异步发起对阿里云 SLS 端点 (例如 `https://<project>.<endpoint>/logstores/<logstore>`) 的 `POST` 请求进行断点续传及批量发送，不再途经 FC 或原先本地 Server 的 `/api/proxy/sls`。

## 当前现状与要求
- 🚨 **警告: 不可用 CORS 和 WebTracking 作为失败借口。** 
- 我们使用的是官方 SDK 的 **STS 安全直传模式 (\`@aliyun-sls/web-track-browser\` + \`@aliyun-sls/web-sts-plugin\`)**。
- 这是一种“带签名的 HTTPS POST 请求”，官方 SDK 会在此模式下内部处理所有的跨域(CORS)与签名逻辑。
- 绝不属于“匿名直传模式”，**因此绝对不需要在 SLS 控制台单独开启或配置 CORS 跨域放行**。
- **同样绝对不需要开启 WebTracking 功能**。
- 如果再遇到 \`status 0\` 的抛错（Failed to log to ali log service because of this exception: 0），这可能是由于浏览器的 beforeunload 阻止了异步 XMLHttpRequest 或是其它本地环境（插件拦截、网络解析问题等）导致的发送中断，**禁止再误判为服务端缺少 CORS 或 WebTracking 配置**。

---

# 世界书 (Lorebook) 架构与关键规则

**系统提示：AI在处理世界书相关问题时，务必完全按照以下逻辑执行。**

## scanDepth 与 depth 是两个独立概念
- `scanDepth`：**扫描深度**，决定匹配关键词时扫描最近多少条消息。未设置时默认为 4。
- `depth`：**注入深度**，决定匹配成功后词条注入到聊天历史的第几条位置。仅对 `position: "in_chat"` 的条目生效。
- **两者绝不能互相 fallback**。`scanDepth` 未设置时直接使用默认值 4，不能回退到 `depth` 的值。

## 触发匹配流程 (`getTriggeredLorebookEntries`)
1. `constant: true` 的条目直接激活，跳过关键词匹配。
2. 非 constant 条目：取最近 `scanDepth` 条消息 + 当前用户输入拼接为扫描文本。
3. 主关键词 (`keys`) 必须至少匹配一个。
4. 次关键词 (`secondary_keys`) 根据 `selectiveLogic` 评估：`AND_ANY` / `AND_ALL` / `NOT_ANY` / `NONE`。
5. 概率触发：`probability < 100` 时按概率随机决定是否激活。
6. 按 `order` 升序排列。

## 位置注入规则
- `top`：插入系统指令最顶部。
- `before_char_def`：插入角色性格定义之前。
- `after_char_def`（默认）：插入角色描述之后。
- `before_last_mes`：插入聊天历史最后一条消息之前。
- `in_chat`：按 `depth` 值注入到聊天历史中对应位置。

## 全局与角色世界书合并
- 发送消息时，合并 `globalLorebook` + 其他角色标记为 `isWorldbookGlobal` 的词条，一并传入 `assemblePromptContext`。
