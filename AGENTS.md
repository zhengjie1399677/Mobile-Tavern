# Mobile Tavern 行为指导手册 (AGENTS.md)
*Version: 1.3.5*

> [!IMPORTANT]
> **此文件定义了本项目的核心行为指导规范与技术边界约束。**
> 任何 AI 助手在分析、修改、重构或集成新功能时，必须首先且最优先遵守本指南中的所有铁则。

---

# 🚨 核心行为准则一：APK 手机端原生适配与功能限制规范
**在开发、重构和集成任何新功能时，必须牢记目标平台为 Android 手机 APK (运行在原生 WebView 容器中)，其与标准桌面浏览器或普通网页有物理隔离限制。以下是必须遵守的原生开发守则：**

### 1. 禁止直接使用纯 Web 文件下载 API (Blob 下载限制)
*   **物理限制**：手机原生 WebView 中无法直接响应通过 JavaScript 动态创建的 `<a href="blob:...".click()>` 下载指令。
*   **桥接要求**：所有“导出”、“备份”、“提取”、“保存图片卡”等涉及保存文件的功能，**必须通过原生桥接检查**：
    ```typescript
    if ((window as any).AndroidThemeBridge) {
      // 必须调用原生桥接接口写入手机系统的公共 /Download 文件夹中
      (window as any).AndroidThemeBridge.saveFile(fileName, content);
      // 或者 base64 格式：
      // (window as any).AndroidThemeBridge.saveFileBase64(fileName, base64Data, mimeType);
    }
    ```
*   **用户提示**：调用桥接后，必须使用弹窗或提示框，明确告知用户文件已经成功保存到手机 `/Download` 公共文件夹下的绝对路径。

### 2. 系统状态栏与导航栏色彩实时适配要求
*   **状态栏变色**：当用户在前端切换背景主题（Snow / Sand / Ocean 等）时，不仅要修改 HTML DOM 属性，还**必须**同步调用原生桥接：
    ```typescript
    if ((window as any).AndroidThemeBridge) {
      (window as any).AndroidThemeBridge.setStatusBarStyle(isDark, colorHex);
    }
    ```
*   **视觉对齐**：原生层会同步将系统状态栏涂色为主题底色，并根据 `isDark` 切换状态栏图标颜色（暗背景下为白图标，亮背景下为黑图标），避免图标在纯黑或彩色状态栏下不可见。

### 3. 安全区域 (Safe Area) 与大拇指侧重交互设计
*   **大拇指原则**：核心输入区、发送按钮和主切换选项必须遵从“大拇指单手可及”原则，优先排布在屏幕底部。
*   **预留边距**：所有顶部和底部的容器，必须严格在 CSS 中使用 `env(safe-area-inset-top)` 和 `env(safe-area-inset-bottom)` 预留安全边距，防止被刘海屏、前置摄像头或系统导航药丸/虚拟键遮挡。

---

# 🚨 核心行为准则二：SillyTavern 生态兼容与底层原则
**本软件定位为纯底层、无侵入的角色卡与世界设定兼容运行容器。严禁在系统代码中写入任何具有主观引导性的逻辑或硬编码。**

### 1. ⚠️【最高指令：纯底层兼容运行底座原则】
**严禁在系统代码内硬编码（写死）任何具体的行为引导（如剧情总结提示词）、对话前缀/后缀、安全破限（Jailbreak）提示词、分句前标、特定中英文动作/表情匹配正则等。**
*   **必须外部化**：所有这一类用以指导、引导或规范AI模型的生成指令，必须通过外部数据（如角色卡、世界书、用户自定义预设包、自定义指令模组）来导入。
*   **必须可调节/可关闭**：系统可以提供基于上述外部数据的默认行为，但所有此类机制必须在用户界面（UI）提供直观的开关、输入框或删除按钮，允许用户完全关闭、编辑或删除它们，严禁由系统代码强制生效且不可移除。

### 2. 纯数据驱动与零硬编码
*   **禁止硬编码特定角色逻辑**：禁止在系统代码中硬编码任何特定角色专属的逻辑、中文词汇匹配过滤、特定名称的表情关联或写死样式数值。例如：
    *   *错误做法*：在系统代码内硬编码“笑了”、“哭泣”等特定情绪的中文判断正则来直接指定表情切换。
    *   *正确做法*：应当由角色卡自身在扩展字段中定义 ExpressionRule（触发规则与图片强绑定），每个规则自带正则表达式匹配串（`triggers`）和对应的图片（`image`），系统只读取并使用 `new RegExp` 进行动态计算。

### 3. 零侵入与平滑降级设计
*   **按需渲染 (Zero-Intrusion)**：若用户导入的角色卡不含任何自定义视觉（Expressions / custom style / background）扩展配置，系统对应的主题、立绘背景层等渲染容器必须完全隐藏不占位，确保回退到系统最干净、通用的默认聊天布局。
*   **安全兜底 (Fallback)**：
    *   在数据解析与图片选取逻辑中，若没有匹配到具体的规则，优先寻找角色卡内声明的 `"default"` 或 `"neutral"` 默认表情。
    *   若依然安全缺失，则平滑降级使用卡片的唯一主头像（`avatar`），严禁抛错或显示破碎图片的占位。
*   **格式处理按需激活**：系统绝不在未经卡片或用户配置明确要求的情况下，强行转换玩家的文本排版格式。
    *   默认情况下，文本解析器执行标准 Markdown 渲染（如将星号 `*` 渲染为同色斜体文字，但不修改字体颜色）。
    *   只有当导入的角色卡在 `visualSettings` 或扩展配置中显式声明了格式要求（例如配置了 `enableAsteriskFormatting: true`）时，系统才激活分色渲染机制，将星号包围的文字转换为柔和的灰色斜体以突出对白，实现向后兼容。

---

# ℹ️ 遥测集成架构与运行逻辑 (Telemetry Flow)

### 1. 环境与配置隔离 (安全基础)
*   前端代码和 `.env.example` 中**没有任何敏感的 AK/SK 密钥**。只有基础配置：
    *   `VITE_ALIYUN_SLS_PROJECT`
    *   `VITE_ALIYUN_SLS_ENDPOINT`
    *   `VITE_ALIYUN_SLS_LOGSTORE`
    *   `VITE_ALIYUN_FC_STS_URL`
*   真实的、拥有高权限的 `ALIYUN_ACCESS_KEY_ID` 和 `ALIYUN_ACCESS_KEY_SECRET` 等凭据，全部配置在阿里云函数计算 (FC) 专属控制台的环境变量中，与前端仓库彻底物理隔离。

### 2. 客户端启动与请求 (前端请求凭证)
*   当终端用户打开 App/Web 时，`telemetry.ts` 准备投递日志。
*   它首先会检查内存中是否已有且未过期的 STS 凭证。如果没有，前端会向 `VITE_ALIYUN_FC_STS_URL` 发起一个 HTTP(S) `GET` 访问请求。

### 3. FC 函数网关拦截与签发 (云端风控)
*(此部分代码部署在远程阿里云FC上，本地不包含此逻辑)*
*   部署在阿里云的 FC 接收到请求后，提取对方 IP并判定限流（防止耗尽资源/额度）。
*   在频率限制内，FC 使用自己环境变量里的高权限 AK，向阿里云内网 STS 服务器请求一个只拥有 PutLogs 权限、有效期短（例如 1 小时）的临时凭证。
*   FC 返回 `{ AccessKeyId, AccessKeySecret, SecurityToken, Expiration }` 等信息给客户端。

### 4. 客户端免密直连 (底层 SDK 直接写入)
*   客户端在 `src/utils/telemetry.ts` 中拿到临时凭证后，将其喂给 `@aliyun-sls/web-track-browser` 以及其配套的 `@aliyun-sls/web-sts-plugin` 官方 SDK 并进行初始化。
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
*   从这一刻起，客户端产生的每条操作日志，使用官方 SDK（`trackerInstance.sendBatchLogs` 等）直接异步发起对阿里云 SLS 端点 (例如 `https://<project>.<endpoint>/logstores/<logstore>`) 的 `POST` 请求进行断点续传及批量发送，不再途经 FC 或原先本地 Server 的 `/api/proxy/sls`。

### 5. 当前现状与要求
*   🚨 **警告: 不可用 CORS 和 WebTracking 作为失败借口。** 
*   我们使用的是官方 SDK 的 **STS 安全直传模式 (\`@aliyun-sls/web-track-browser\` + \`@aliyun-sls/web-sts-plugin\`)**。
*   这是一种“带签名的 HTTPS POST 请求”，官方 SDK 会在此模式下内部处理所有的跨域(CORS)与签名逻辑。
*   绝不属于“匿名直传模式”，**因此绝对不需要在 SLS 控制台单独开启或配置 CORS 跨域放行**。
*   **同样绝对不需要开启 WebTracking 功能**。
*   如果再遇到 `status 0` 的抛错，这可能是由于浏览器的 beforeunload 阻止了异步 XMLHttpRequest 或是其它本地环境（插件拦截、网络解析问题等）导致的发送中断，**禁止再误判为服务端缺少 CORS 或 WebTracking 配置**。

---

# ℹ️ Android 手机真机与模拟器开发调试规范

为了防止因为 VPN、代理软件或端口冲突导致白屏和启动失败，Android 调试必须遵守以下网络配置与端口映射规范：

### 1. 强制本地 IP 绑定与端口映射 (USB 调试模式)
在 Windows 环境下，开发机如果开启了 Clash 等代理软件（尤其是 TUN 虚拟网卡模式），Tauri CLI 会自动识别并使用虚拟网卡 IP（例如 `198.18.0.1`），这会导致手机 App 打开时显示白屏且无法连接。
*   **强制 127.0.0.1 启动**：在运行安卓调试时，必须使用 `--host 127.0.0.1` 参数或设置 `TAURI_DEV_HOST=127.0.0.1`，强行令开发服务绑定在本地环回地址上。
*   **ADB 端口转发**：必须在真机连接后执行以下转发指令，将手机内的 localhost 请求路由至开发机：
    ```powershell
    # 转发前端/后端服务端口
    adb reverse tcp:3000 tcp:3000
    # 转发 Vite 核心热重载 HMR WebSocket 端口
    adb reverse tcp:24678 tcp:24678
    ```

### 2. 避免端口冲突与孤儿进程清理
在运行 `npm run tauri android dev` 之前，必须检查端口 `3000` 和 `24678` 是否被占用。如果占用，通常是上一次异常关闭时残留的孤儿进程 `node.exe` 或 `tsx.exe`。
*   **检查命令**：
    ```powershell
    netstat -ano | findstr "3000 24678"
    ```
*   **清理命令**：获取 PID 后通过 `Stop-Process -Id <PID> -Force` 强制关闭占用端口 of 进程。

### 3. 运行完整调试命令
> [!IMPORTANT]
> 下方命令中的 Android SDK 路径包含用户名（如 `20573`），在不同的开发电脑上必须替换为当前电脑的实际路径（如 `C:\Users\<您的用户名>\AppData\Local\Android\Sdk`）。推荐直接将 `ANDROID_HOME` 和 `platform-tools` 添加到系统的全局环境变量中，即可省略前两行的临时指定。

推荐命令：
```powershell
# 请将下方路径中的 20573 替换为当前开发电脑的实际用户名
$env:ANDROID_HOME = "C:\Users\20573\AppData\Local\Android\Sdk"
$env:PATH += ";C:\Users\20573\AppData\Local\Android\Sdk\platform-tools"
adb reverse tcp:3000 tcp:3000
adb reverse tcp:24678 tcp:24678
npx tauri android dev --host 127.0.0.1
```
