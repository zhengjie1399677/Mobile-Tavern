# Mobile Tavern

Mobile Tavern 是一款专为移动端打造的轻量级 AI 角色扮演客户端。

## 为什么开发这个应用？(Why Mobile Tavern?)

诞生初衷非常简单：虽然 **Silly Tavern** 在桌面端拥有无与伦比的丰富功能且体验极佳，但由于其设计过于庞大，导致在手机端浏览器上的操作体验非常糟糕。

对于很多只是想在手机上玩一玩简单的、轻量级的角色卡片的用户来说，Silly Tavern 显得过于笨重。因此，**Mobile Tavern** 诞生了。它并非旨在替代桌面端的 Silly Tavern，而是作为它在**移动设备上的轻量化互补方案**。

我们故意去除了对桌面端打包的支持，也没有过多臃肿的功能，优先保证**移动设备上的流畅度、触摸体验以及应用体积（性能优先）**。

## 核心特性 (Key Features)

*   **专为移动端优化的交互设计**：没有复杂的桌面级侧边栏和多级菜单，针对手机屏幕进行布局和触控优化。
*   **兼容 Tavern 角色卡**：支持导入标准的酒馆角色卡片（PNG / JSON），满足基础角色的游玩需求。
*   **轻量化与高性能**：舍弃了复杂的周边功能，专注于核心的对话引擎，让应用加载更快、响应更迅捷。
*   **原生 Android 体验**：使用 Tauri 构建为原生 Android APK 安装包，支持脱离浏览器并在后台维持更好的生命周期。

## 为什么要发安卓版？(Why Android Output?)

Silly Tavern 适合桌面。Mobile Tavern 适合便携。
通过 GitHub Actions 的自动化构建流程，我们可以直接打包生成原生的 Android APK 安装包 (`MobileTavern.apk`)，无需自己搭建复杂的安卓打包环境。你可以随时在 Github 仓库的 Releases 页面下载最新安装包构建。

---

## ⚡ 极速响应：上下文缓存与消息排列优化 (Context Caching)

### 1. 传统酒馆消息排布的缺陷
角色扮演（Roleplay）应用随着对话轮数的增加，发送给大模型的上下文体积会急速膨胀：
*   数千字的角色描述（Description）和性格设定（Personality）
*   大量由关键词触发的世界书设定（Lorebook）
*   冗长的历史聊天会话（History）

如果每次发送新消息，都将所有的内容乱序拼接发送，会导致大语言模型（如 DeepSeek, Gemini）的上下文缓存（Context Cache）频繁失效，导致**高昂的 API Token 消耗**与**响应首包延迟（TTFT）大幅增加**。

### 2. Mobile Tavern 的优化策略 (Message Ordering)
我们通过精细排列发送给 API 的消息数组结构，实现了针对 **DeepSeek (自动前缀缓存)** 与 **Gemini (前缀/显式缓存)** 的极致优化。

在 `src/utils/promptBuilder.ts` 中，发送的 `messages` 数组结构设计如下：
```typescript
messages: [
  // 1. 静态系统指令 (System Instruction)
  { role: "system", content: promptPayload.systemInstruction },
  
  // 2. 历史对话上下文 (Stable History Prefix)
  ...promptPayload.history.slice(0, -1).map((h) => ({
    role: h.role === "model" ? "assistant" : h.role,
    content: h.content,
  })),
  
  // 3. 动态扩展指令 (Dynamic Instruction)
  ...(promptPayload.dynamicInstruction
    ? [{ role: "system", content: promptPayload.dynamicInstruction }]
    : []),
  
  // 4. 最新一轮交互 (Last Turn)
  ...promptPayload.history.slice(-1).map((h) => ({
    role: h.role === "model" ? "assistant" : h.role,
    content: h.content,
  })),
]
```

#### 🛡️ 针对 DeepSeek V3/R1 的自动前缀缓存优化 (Cache Hit Mechanism)
*   **自动前缀匹配**：DeepSeek 会自动在后台将请求的 `messages` 数组从前往后转换为 Token 进行哈希，并自动缓存完全相同的最长前缀（最大 1024k Token，最高保留数天，缓存 Token 价格便宜 90%）。
*   **前缀保护**：我们将最稳定、体积最大的 `systemInstruction`（含角色设定、性格描写、开场白、背景等）放在首位，紧接着放入除了上一条之外的完整对话历史 `history.slice(0, -1)`。
*   **动态隔离**：因为用户的最新输入 `history.slice(-1)` 以及可能改变的世界书触发词 `dynamicInstruction` 被推到了**消息数组的尾部**，所以在新的一轮对话中，前面的 **[静态系统指令 + 大部分历史消息]** 保持 character-for-character 的完全一致。这确保了 DeepSeek 能 100% 命中该段超大前缀的缓存，极大降低了持续聊天的 Token 费用并大幅提升响应速度。

#### 💎 针对 Gemini 的上下文缓存适配
*   Gemini 1.5 Pro / Flash 支持将系统指令和历史前缀进行缓存（通常要求 32k tokens 以上起效）。
*   通过将系统指令与稳定历史连续存放在消息数组开头，一旦上下文长度满足阈值，即可对该前缀建立稳定的缓存块，后续追加的聊天仅需评估尾部差异部分，避免全文本重复计算。

---

## 🔒 遥测直传与数据隐私安全
> [!IMPORTANT]
> 本项目的遥测埋点直传逻辑，严格贯彻了**零敏感密钥暴露**的安全隔离原则。
```text
                               【安全隔离架构】
          ┌──────────────────────────────────┐          ┌──────────────────────────────────┐
          │    客户端 App (Mobile Tavern)   │          │    阿里云函数计算 (FC 网关)     │
          │                                  │          │                                  │
          │ 1. 仅持有公共公网 SLS Endpoint  │          │ 1. 在控制台持有高特权子账户 AK  │
          │ 2. 无任何 Aliyun AccessKey     │          │ 2. 不暴露给客户端，仅内网可用    │
          └────────────────┬─────────────────┘          └────────────────┬─────────────────┘
                           │                                             │
                           │                                             │
                           │ 1. GET 请求获取临时 STS                      │ 2. 扮演角色 (AssumeRole)
                           └────────────────────────────────────────────►│ 并签发 1 小时限权 STS Token
                                                                         │
                                                                         ◄───────────────────────────
                                                                         │
                           │ 3. 得到临时 Token ({AccessKeyId, AccessKeySecret, SecurityToken})
                           ▼
                           │ 4. 携带签名直传日志 (HTTPS POST)
                           ▼
               ┌────────────────────────┐
               │ 阿里云日志服务 SLS Log   │
               └────────────────────────┘
```

1.  **环境隔离**：前端代码和 `.env.example` 中**不包含任何敏感的 AK/SK 密钥**。只有基础配置：
    *   `VITE_ALIYUN_SLS_PROJECT`
    *   `VITE_ALIYUN_SLS_ENDPOINT`
    *   `VITE_ALIYUN_SLS_LOGSTORE`
    *   `VITE_ALIYUN_FC_STS_URL`
2.  **FC 网关拦截与签发**：客户端投递日志前，如果没有未过期的本地 STS 凭证，会发起 HTTP `GET` 请求到 `VITE_ALIYUN_FC_STS_URL`（阿里云函数计算）。FC 验证请求后，使用其安全环境变量里配置的高权限 AK/SK 向阿里云 STS 请求一个*只拥有 `PutLogs` 权限、且 1 小时有效*的临时凭证，返回给客户端。
3.  **STS 官方直传**：客户端获取凭证后，将其喂给 `@aliyun-sls/web-track-browser` 和 `@aliyun-sls/web-sts-plugin` 官方 SDK，直接通过**带签名的 HTTPS POST** 直连 SLS 公网端点写入日志，不经过 FC，更不需要在 SLS 控制台开启 CORS 跨域放行和 WebTracking 匿名写入功能。
4.  **警告**：网络断开和 visibilitychange 导致的 `status 0` 为浏览器发送中断的常态现象，禁止误判为服务端缺少 CORS 或 WebTracking 配置。

---

## 📁 本地数据库设计 (IndexedDB Schema)

应用基于原生 IndexedDB 创建了名为 `MobileTavernLiteDB` 的本地非关系型数据库。包含三个核心的对象仓库 (Object Stores)：

### 1. `characters` (角色卡仓库)
*   **KeyPath**: `id` (UUID string)
*   **数据结构**：
```typescript
interface CharacterCard {
  id: string;
  name: string;
  avatar?: string;                  // 角色卡头像的 base64 字符串
  description: string;              // {{char}} 的详细描述背景 (Description)
  personality: string;              // {{char}} 的性格设定 (Personality)
  scenario: string;                 // 当前的设定场景 (Scenario)
  first_mes: string;                // 第一句问候语 (First Message)
  mes_example: string;              // 对话例句 (Message Examples)
  system_prompt?: string;           // 针对当前角色绑定的独立 System Prompt 约束
  lorebookEntries?: LorebookEntry[]; // 当前角色绑定的局部世界书设定词
  isWorldbookGlobal?: boolean;      // 该世界书是否对其他所有角色卡也全局生效
}
```

### 2. `sessions` (聊天会话与历史分支)
*   **KeyPath**: `id` (UUID string)
*   **索引**: `characterId` (用于快速检索某一角色下的全部历史会话)
*   **数据结构**：
```typescript
interface ChatSession {
  id: string;
  characterId: string;              // 绑定的角色 ID
  title: string;                    // 会话自定义标题
  createdAt: number;                // 创建时间戳
  messages: Message[];              // 对话消息数组
  summaries: SummaryCard[];         // 该会话下绑定的“故事年表/故事大纲”数据
  lastSummarizedMessageId?: string; // 已处理剧情摘要的最后一条消息 ID
}

interface Message {
  id: string;
  sender: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  generationTime?: number;          // 消息生成所消耗的时间 (秒)
  tokenCount?: number;              // 本次生成消耗的 Completion Tokens
  promptTokenCount?: number;        // 本次发送消耗的 Prompt Tokens
}

interface SummaryCard {
  id: string;
  timeTag: string;                  // 时间标签（例如："第二天清晨"）
  location: string;                 // 地点（例如："小木屋"）
  content: string;                  // 剧情提炼总结文本
}
```

### 3. `settings` (全局系统配置与偏好)
*   **KeyPath**: `key` (常驻 key: `"user_settings"`)
*   **数据结构**：
```typescript
interface UserSettings {
  api: {
    type: "openai-compat";
    baseUrl: string;                // 大模型 API 端点 Base URL
    apiKey: string;                 // 大模型 API 密钥 (完全本地存储加密)
    modelName: string;              // 激活的模型名称
  };
  preset: {
    temperature: number;
    topP: number;
    repetitionPenalty: number;
    maxTokens: number;
  };
  memory: {
    recentTurns: number;            // 实际发送给大模型的历史对话轮数上限
    summaryTriggerTurns: number;    // 自动总结触发阈值
    summaryLength: number;          // 总结文本期望的长度
  };
  promptConfig: {
    roleplayMode?: boolean;         // 是否启用酒馆 RP 人设模板和 Jailbreak 越狱指令
    mainPrompt: string;             // 主系统指令 (mainPrompt)
    jailbreakPrompt: string;        // 越狱提示词
    useJailbreak: boolean;
    postHistoryPrompt: string;      // 消息历史后置的纪律约束提示词
    usePostHistory: boolean;
    instructTemplate: "default" | "alpaca" | "chatml" | "llama3" | "custom";
    storyString?: string;           // 故事描述的物理拼接顺序模板
  };
  userName: string;                 // 用户代称（{{user}} 宏替换内容）
  userInfo?: string;                // 用户人设/Persona
  enableHtmlRendering?: boolean;    // 是否渲染 AI 输出中的 HTML/CSS 标记
}
```

---

## 🔌 API 接口与代理服务文档

### 1. 本地 Express 代理路由设计 (`server.ts`)
当应用以**网页/浏览器模式**运行时，浏览器由于安全同源策略（CORS）会拦截直接向第三方 API 发送的非跨域友好请求。为此，本地提供了一个反向代理服务：

#### 📡 测试 API 连接是否可用
*   **接口地址**：`POST /api/test-connection`
*   **请求体参数 (JSON)**：
    ```json
    {
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "sk-xxxxxx",
      "modelName": "deepseek-chat"
    }
    ```
*   **响应体数据 (JSON)**：
    *   **成功 (HTTP 200)**:
        ```json
        {
          "success": true,
          "message": "Connected successfully!",
          "data": { ...openaiResponse... }
        }
        ```
    *   **失败 (HTTP 200)**:
        ```json
        {
          "success": false,
          "error": "HTTP 401: Unauthorized"
        }
        ```

#### 📡 LLM 聊天 completions 代理 (支持 SSE 流式返回)
*   **接口地址**：`POST /api/proxy/openai`
*   **请求体参数 (JSON)**：
    ```json
    {
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "sk-xxxxxx",
      "reqBody": {
        "model": "deepseek-chat",
        "messages": [ ... ],
        "stream": true,
        "temperature": 0.7
      }
    }
    ```
*   **响应体数据**：
    *   若 `stream: true`，响应头设置为 `text/event-stream`，并建立长连接实时推送 chunk：
        ```text
        data: {"choices": [{"delta": {"content": "你好"}}]}
        
        data: [DONE]
        ```
    *   若非流式，返回完整 JSON 响应体。

#### 📡 获取服务商模型列表
*   **接口地址**：`POST /api/proxy/models`
*   **请求体参数 (JSON)**：
    ```json
    {
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "sk-xxxxxx"
    }
    ```
*   **响应体数据 (JSON)**：
    ```json
    {
      "success": true,
      "models": [
        { "id": "deepseek-chat" },
        { "id": "deepseek-coder" }
      ]
    }
    ```

### 2. 跨平台 API 调用选择器 (`apiClient.ts`)
在客户端底层，系统会通过调用 `isClientMode()` 来智能决定请求链路：
*   **Client Mode (Tauri Android/Desktop)**:
    由于 Tauri 容器的客户端底层为原生 WebView，发起 fetch 不受浏览器 CORS 跨域安全策略约束。因此，系统会**绕过本地 Server，直接直连目标 API URL**（例如直接向 `https://api.deepseek.com/v1/chat/completions` 发起 fetch）。
*   **Browser Mode (标准网页)**:
    直接通过 Axios/Fetch 请求本地同源的反向代理端口（例如 `http://localhost:3000/api/proxy/openai`），由 Express 后端转发请求给服务商，以彻底规避 CORS。

---

## 🎨 视觉与交互美学设计 (Aesthetics & Status Bar Sync)

为了给用户提供最顶尖的视觉品质，应用采用了高度响应式的多维美学方案：
1.  **OKLCH 动态调色体系**：采用最新的 OKLCH 色彩模式，相比传统的 HEX 和 HSL，在色彩亮度和色相的渐变过渡上更加平滑且符合人眼视觉感官。
2.  **三大沉浸式主题**：
    *   `极简纯白 (Snow)`：干净利落的纯白性冷淡风，采用轻微的 OKLCH 浅灰。
    *   `浅沙暮色 (Sand)`：经典的泛黄古旧羊皮纸底色与暖橙红配字，营造最舒适的角色扮演沉浸感。
    *   `荧光深海 (Ocean)`：深邃的科技蓝黑调，搭配高对比度的荧光青色，打造极客气息。
3.  **安卓系统状态栏/虚拟键适配**：
    *   **安全区域自适应**：在 [MainLayout.tsx](file:///e:/modules/projects/Mobile-Tavern/src/components/MainLayout.tsx) 中，底栏的 Padding 与 Height 统一使用 `max(env(safe-area-inset-bottom), 16px)` 进行自适应。这有效解决了手机虚拟导航键遮挡或挤压底部 UI 按钮和输入框的物理缺陷。
    *   **状态栏主题同步**：在全局 [AppContext.tsx](file:///e:/modules/projects/Mobile-Tavern/src/contexts/AppContext.tsx) 的主题变更副作用（useEffect）中，程序会动态提取当前激活主题 of CSS 变量，并在 HTML `<head>` 中动态插入并更新 `<meta name="theme-color" content="...">`。当用户切换深色或浅沙主题时，手机系统顶部的状态栏背景和文字颜色会自动实时同步适配，杜绝了白底白字无法看清系统通知的情况。

---

## 🚀 本地开发与打包指南

### 1. 环境准备
确保您的计算机上已安装以下工具：
*   **Node.js** (v18+)
*   **Rust** 与 **Cargo** (Tauri 编译后端所需)
*   **Android SDK & NDK** (若需要编译 Android APK)

### 2. 本地调试 (Web + Dev Server)
1.  复制环境变量配置文件并修改（可不配置 SLS 遥测）：
    ```bash
    cp .env.example .env
    ```
2.  安装依赖：
    ```bash
    npm install
    ```
3.  启动开发服务器：
    ```bash
    npm run dev
    ```
    此命令会同时启动 Vite 前端服务与 Express 后端反向代理。可在浏览器访问 `http://localhost:3000`。

### 3. Tauri 原生客户端运行
*   **桌面端预览**（若 Tauri 配置中包含桌面对齐）：
    ```bash
    npx tauri dev
    ```
*   **安卓模拟器/真机联调运行**：
    ```bash
    npx tauri android dev
    ```

### 4. 安卓打包 (Build Android APK)
确保 Android 编译链就绪后，执行以下命令：
```bash
npm run build:android
```
生成的 APK 文件将保存在 `src-tauri/gen/android/app/build/outputs/apk/release/` 路径下。

---

## 📝 备份与数据互通性 (Compatibility)
*   **酒馆数据导入/导出**：支持导出包含 character json 的 `.png` 格式卡片，也支持直接导出 `.json` 角色文件。
*   **SillyTavern 兼容度**：
    *   导入：支持解析 SillyTavern 导出的标准角色 PNG 图片（tEXt Chunk 中的 `chara` 字段）。
    *   导出：导出的 PNG 图像格式 100% 遵守酒馆协议规范，能在 SillyTavern 官方网页端被直接拖拽识别导入，保证了数据无缝互通。

---

## 最近更新 (Recent Updates - v1.3.5)

*   **Reroll 机制增强与信号控制**：修复了在重新生成聊天文本时 `AbortController` 绑定失效的缺陷。现在用户可以随心物理中止任何对话生成过程，且不会引起文本覆写异常或连接泄漏。
*   **本地代理与内网安全增强**：将本地开发/生产 Express 服务器的监听绑定由局域网全暴露 `0.0.0.0` 默认收缩为本机回环 `127.0.0.1`，极大加强了本地配置秘钥与数据库资产在局域网下的隐私和抗御安全；同时添加了 URL 协议验证防范 protocol smuggling。
*   **高性能 Context 优化**：为全局状态上下文的 monolithic 对象执行了完整的 `useMemo` 缓存策略，并将各类动作函数 override 以 `useCallback` 拦截，杜绝了流式响应字符生成时因状态高频改变所引发的渲染层级全应用强制重绘卡顿。
*   **弹窗输入实时流畅体验**：移除了弹窗对话框（如新建分支、输入密码等）中对全局 context 的实时 keypress 同步逻辑，改为局部状态缓冲提交，打字体验实现零卡顿、无漏键。
*   **IndexedDB 批量导入提速**：在数据恢复中引入了 `bulkSave` 批量单事务写入支持，彻底取代了原先循环中多次串行提交事务造成的磁盘 I/O 排队卡死，大数据量备份还原操作效率飙升数十倍。
*   **宏替换正则边界修饰保护**：优化了 bracket macros 符号转义替换处理，防范由于起名符号或特殊后缀字符带来的 LLM 提示词模板破损。
