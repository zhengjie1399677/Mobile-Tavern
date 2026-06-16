# 🐱 内置“猫娘机器人”助手技术方案建议书 (共识规格版)

本文件归档了经过 `/grill-me` 访谈后，双方针对 **Mobile Tavern** 中内置“猫娘助手”功能所达成的最终技术共识。该规格书为接下来的具体实施提供了底层设计指导。

---

## 🧭 共识核心设计（The Blueprint）

```mermaid
graph TD
    subgraph Client [Tauri 客户端]
        Event[应用事件: 切换页面/报错/深夜] -->|触发吐槽| Handler[吐槽处理器]
        UserIn[用户点击提问] -->|输入文本| Handler
        Handler -->|1. 请求 SLS/STS 鉴权签名| Signature[签名生成器]
        Handler -->|2. 发送 Payload (带签名)| API_Client[apiClient.ts]
        API_Client -->|3. 网络传输| FC[阿里云 FC 中转服务]
        
        FC -.->|通过 SLS 校验并执行 IP 限流| FC_Exec
        FC_Exec -->|携带环境变量 Key| Remote_LLM[大模型 API (Gemini/DeepSeek)]
        Remote_LLM -->|流式/单次文本| FC_Exec
        FC_Exec -->|回传响应| API_Client
        
        API_Client -->|4. 状态机驱动| PNG[本地多状态 WebP/PNG 立绘组件]
        API_Client -->|5. 气泡展示| Bubble[毛玻璃聊天气泡]
    end
    
    style Client fill:#f9f9f9,stroke:#333,stroke-width:1px
```

### 1. 展现形式：全局悬浮桌宠 (多状态 WebP/PNG 头像 + 贴边吸附)
*   **物理位置约束**：为了绝对不干扰核心主功能，猫娘桌宠将采用**“特定页面限时现身”**策略：
    *   **显示页面**：仅在“角色列表页 (CharactersTab)”与“配置设置页 (SettingsTab)”中挂载渲染。
    *   **隐藏页面**：一旦用户进入具体的“聊天会话页 (ChatTab)”，桌宠自动隐形并卸载，以防止遮挡软键盘或核心发送按钮。
*   **交互形态**：悬浮挂载在屏幕右侧中部，不占用大拇指主操作区域。

### 2. 气氛活跃：完全云端 LLM 动态吐槽
*   **触发事件流**：客户端在本地捕获特定生命周期事件，例如：
    *   `api_error`（API Key 报错或连接超时）
    *   `night_mode`（深夜 23:00 后打开 App）
    *   `character_imported`（成功导入新角色卡）
    *   `idle_state`（在列表页停顿超过 3 分钟未操作）
*   **动态生成逻辑**：客户端将这些行为事件作为环境上下文发送至云端，由云端 LLM 实时生成一句富有猫娘性格（带“喵~”、傲娇或可爱语气）的 30 字以内台词。

### 3. 安全防御：复用 SLS/STS 动态鉴权与云端限流
*   **安全认证**：复用 Mobile Tavern 现有的 **Tauri Rust 后端 SLS/STS 临时凭证与签名生成机制**。客户端向阿里云 FC 发送请求时，必须携带符合 STS 校验规则的签名凭证，防止外部直接抓包重放接口。
*   **云端限流防御**：
    *   在阿里云 FC 网关层启用单 IP 级 Rate Limit（例如：每个公网 IP 每分钟限制 5 次请求）。
    *   严格限制请求的最大 Token 数（MAX_TOKENS = 80），保障开发者的云端费用安全。

### 4. 视觉表现：本地多状态 PNG/WebP 立绘与状态机
*   **组件设计**：为了呈现高精度的猫娘动漫立绘，并严格遵守 `AGENTS.md` 对网络代理/CDN 依赖的物理隔离限制，猫娘形象将弃用简陋的 SVG 路径绘制，全面采用 **本地打包的轻量级 PNG/WebP 立绘图片 + CSS 物理动效**：
    *   **多状态表情切图**：在本地存放 4 张轻量级的表情立绘（如 `/public/assets/catgirl/`），对应猫娘的 4 种核心情绪状态：
        *   `idle.png`：闲置/待机状态（温和微笑着的猫娘）。
        *   `thinking.png`：思考/计算状态（微微歪头、作思考状）。
        *   `talking.png`：说话/吐槽状态（张嘴说话或活泼表情）。
        *   `sad.png`：难过/报错状态（委屈哭哭或眩晕表情）。
    *   **呼吸与动效**：React 状态机检测到状态变更时，自动切换 `<img>` 标签的 `src` 指向相应的本地图片，并在组件上叠加 CSS 物理微动画（例如：`idle` 状态下的上下缓动呼吸特效，`talking` 状态下的微小缩放抖动），使静态立绘富有生命力。

---

## 🛠️ 对现有项目的影响与可行性分析

### 1. 可行性评估：极高
*   **安全架构**：阿里云 FC 和 STS 在项目中已有成熟实现，可以直接参考并在 FC 上部署微服务。
*   **UI 逻辑**：SVG 微动画不依赖外部图片库，渲染开销在手机端几乎为 0，能在 React Concurrent Mode 下丝滑执行。
*   **低侵入性**：由于在 `ChatTab` 中完全不挂载，主聊天逻辑的代码不需要做任何大幅改动。

### 2. 物理修改范围规划
如果下一步启动开发，我们将主要涉及以下新建与改动路径：
*   **[NEW]** `src/components/FloatingCatgirl.tsx`：猫娘 SVG 动画与气泡组件。
*   **[MODIFY]`src/components/MainLayout.tsx`**：在顶层布局中，根据当前激活的 Tab 路由决定是否渲染 `FloatingCatgirl`。
*   **[NEW]`src/hooks/useCatgirl.ts`**：管理猫娘当前的状态机（情绪、文字队列、主动触发计时器）。
*   **[MODIFY]`src/utils/apiClient.ts`**：添加指向阿里云 FC 代理微服务的独立请求分支，接入 STS 签名头。
*   **[NEW]** 云端阿里云 FC 上的猫娘中转函数（独立于客户端仓库之外，独立部署）。
