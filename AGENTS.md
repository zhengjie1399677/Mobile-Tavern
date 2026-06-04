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

# 角色卡扮演与游玩功能开发准则 (底层兼容性原则)

此准则用于约束所有关于角色卡扮演、主题视觉、交互游玩等功能的开发设计。**系统提示：AI在新增或优化任何游玩/扮演相关功能时，务必完全遵守此准则，严禁违背。**

## ⚠️【最高指令：纯底层兼容运行底座原则】
**本软件定位为纯粹的角色卡与世界设定兼容运行容器，严禁在系统代码内硬编码（写死）任何具体的行为引导（如剧情总结提示词）、对话前缀/后缀、安全破限（Jailbreak）提示词、分句前标、特定中英文动作/表情匹配正则等。**
1. **必须外部化**：所有这一类用以指导、引导或规范AI模型的生成指令，必须通过外部数据（如角色卡、世界书、用户自定义预设包、自定义指令模组）来导入。
2. **必须可调节/可关闭**：系统可以提供基于上述外部数据的默认行为，但所有此类机制必须在用户界面（UI）提供直观的开关、输入框或删除按钮，允许用户完全关闭、编辑或删除它们，严禁由系统代码强制生效且不可移除。

## 纯数据驱动与底层兼容原则
1. **系统仅做底层执行平台**：系统本身应作为一个通用的运行容器与渲染执行器。所有具体的扮演特性、主题样式、动作表情交互规则，均应通过读取角色卡（PNG卡/JSON卡）中的配置与数据来决定。
2. **严禁硬编码业务逻辑**：禁止在系统代码中硬编码任何特定角色专属的逻辑、中文词汇匹配过滤、特定名称的表情关联或写死样式数值。例如：
   - 严禁在系统代码内硬编码“笑了”、“哭泣”等特定情绪的中文判断正则来直接指定表情切换。
   - 应当由角色卡自身在扩展字段中定义 ExpressionRule（触发规则与图片强绑定），每个规则自带正则表达式匹配串（`triggers`）和对应的图片（`image`），系统只读取并使用 `new RegExp` 进行动态计算。

## 零侵入与平滑降级设计
1. **按需渲染 (Zero-Intrusion)**：若用户导入的角色卡不含任何自定义视觉（Expressions / custom style / background）扩展配置，系统对应的主题、立绘背景层等渲染容器必须完全隐藏不占位，确保回退到系统最干净、通用的默认聊天布局。
2. **安全兜底 (Fallback)**：
   - 在数据解析与图片选取逻辑中，若没有匹配到具体的规则，优先寻找角色卡内声明的 `"default"` 或 `"neutral"` 默认表情。
   - 若依然缺失，则平滑降级使用卡片的唯一主头像（`avatar`），严禁抛错或显示破碎图片的占位。
3. **保持高扩展性**：所有的接口与参数结构定义，必须预留良好的容错性，保证能够完美支持社区 SillyTavern 等各种未来新版本的扩展属性兼容。
4. **格式处理按需激活**：所有如动作/对话分色渲染等排版格式功能，同样属于卡片需求兼容的范畴。
   - 系统绝不在未经卡片明确要求的情况下，强行转换玩家的文本排版格式。
   - 默认情况下，文本解析器应执行标准 Markdown 渲染（如将星号 `*` 渲染为同色斜体文字，但不修改字体颜色）。
   - 只有当导入的角色卡在 `visualSettings` 或扩展配置中显式声明了格式要求（例如配置了 `enableAsteriskFormatting: true`）时，系统才激活分色渲染机制，将星号包围的文字转换为柔和的灰色斜体以突出对白，实现向后兼容。
