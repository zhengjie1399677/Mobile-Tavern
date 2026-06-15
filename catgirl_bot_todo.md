# 🐱 猫娘桌宠助手开发待办与技术总结 (2026-06-15)

本文件归档了关于在 **Mobile Tavern** 内置 AI 猫娘桌宠（以下简称“猫娘助手”）的云端及本地混合模式设计方案，并明确了后续的具体执行步骤。

---

## 📅 今日已完成整改项目（本地合规化）

- [x] **表情触发正则脱敏**：彻底清除了 [ChatTab.tsx](file:///e:/modules/projects/Mobile-Tavern/src/tabs/ChatTab.tsx#L362-L374) 内硬编码的中文情绪正则表达式。将表情匹配完全归于数据库 `settings.expressionTriggers` 进行动态计算。
- [x] **TS 源码提示词脱敏**：将 [useSettings.ts](file:///e:/modules/projects/Mobile-Tavern/src/hooks/useSettings.ts#L60-L177) 中硬编码的所有主扮演引导、尾置纪律、剧情归纳等非空系统 Prompt 彻底清空（置为 `""`），消除敏感词。
- [x] **外部预设与异步初始化**：创建了外部静态配置文件 [default_presets.json](file:///e:/modules/projects/Mobile-Tavern/public/default_presets.json)，并在 [useSettings.ts](file:///e:/modules/projects/Mobile-Tavern/src/hooks/useSettings.ts#L290-L338) 的冷启动逻辑中接入了异步 `fetch` 初始化写入本地 IndexedDB 的机制，实现“提示词保存在数据库中，不在代码中写死”的底座原则。
- [x] **安全破限外部化**：为方案 A 专门生成了外部的配置文件 [literary_realism_preset.json](file:///C:/Users/20573/.gemini/antigravity-ide/brain/69d56836-01cd-4bf3-8e49-0bf1995e7619/scratch/literary_realism_preset.json)，支持用户通过界面手动导入或在 UI 中安全编辑。

---

## 🏆 方案终期架构设计：双模混合模式

### 1. 业务逻辑分流
```
┌────────────────────────────────────────────────────────┐
│  模式 A：自带模式（默认开箱即用）                         │
│  → 请求走阿里云 FC 函数中转，免去用户配 Key 门槛         │
│  → 意图限流分类：技术/Bug 答疑（高上限）；日常闲聊（50句）│
│  → 安全策略：STS 签名头校验 + 第一层黑名单 + 通义千问自带审核│
│                                                        │
│  模式 B：自定义模式（高级酒馆模式）                        │
│  → 用户在设置页自行配置私人的 API Key 与 Base URL        │
│  → 无额度和意图限制，免去安全审核，用户责任自负           │
└────────────────────────────────────────────────────────┘
```

### 2. 本地桌宠交互设计（Zero-Intrusion）
*   **展现形式**：常驻右侧中部的全局悬浮桌宠，点击展开毛玻璃聊天气泡。
*   **限时现身避让**：桌宠**仅**在“角色列表页 (CharactersTab)”与“配置设置页 (SettingsTab)”中挂载渲染；**一旦用户进入“聊天会话页 (ChatTab)”，桌宠自动隐形并卸载**，以绝不干扰主键盘、发送按钮或核心聊天区。
*   **视觉驱动**：表情采用 React 控制的 **SVG 矢量微动画与 CSS 属性过渡**（闲置呼吸、思考眨眼、说话嘴动、难过报错），零网络图片加载，完全规避代理环境下 CDN 加载锁死崩溃风险。

---

## 📋 明日待办清单（TODOs）

### 1. 客户端 App 端开发 (Tauri + React)
- [ ] **设计并编写悬浮桌宠组件**：
  - 新建 `src/components/FloatingCatgirl.tsx`，包含基于 CSS/SVG 动效的猫耳看板娘头像以及毛玻璃弹出式气泡对话框。
  - 处理边缘贴边吸附与简单的手势拖拽计算。
- [ ] **主布局挂载与路由感知**：
  - 修改 `src/components/MainLayout.tsx`，监听当前 Tab 的切换状态，实现仅在列表页和设置页挂载该悬浮组件，进入聊天页自动卸载。
- [ ] **接口与状态管理集成**：
  - 新建 React Hook `src/hooks/useCatgirl.ts`，管理猫娘当前的对话历史、状态机表情级别（`idle`/`thinking`/`talking`/`sad`）以及输入状态。
  - 在 `src/utils/apiClient.ts` 中拦截针对猫娘助手的请求，调用阿里云 FC 中转接口，并自动携带 STS 临时凭证与签名。

### 2. 云端 FC 后端开发 (阿里云 Function Compute)
- [ ] **搭建 FC 函数中转逻辑**：
  - 实现 STS 临时凭证的合法性签名解析校验。
  - 实现防盗刷机制：IP 级 Rate Limiting（限制单个 IP 吐槽 + 闲聊每分钟不超过 3 次）。
  - 对接通义千问 DashScope API，通过 `qwen-turbo` 驱动交互。
- [ ] **意图识别与限流过滤**：
  - FC 解析模型返回结果中的特定标签（如 `[INTENT:tech]` 或 `[INTENT:chat]`）。如果属于 `chat`，进行日句数扣减限流；如果属于 `tech`，放宽限制，以保障答疑工具属性。
  - 接入基础的本地敏感词/关键词黑名单进行第一层物理过滤。

### 3. 文案与合规准备
- [ ] **准备猫娘专属 System Prompt**：
  - 约束猫娘的说话性格（喵娘人设），并硬性要求大模型必须在回答中包含特定意图分类标签，以及在捕获到“Bug/报错”语境时返回特定的标志符号以便客户端本地弹出诊断提醒。
- [ ] **隐私政策与合规补充**：
  - 在 App 隐私政策与服务条款中加入“AI 机器人生成内容”的免责说明、用户行为准则，并在 UI 端显式留出“AI生成，谨防误导”的提示标志与用户举报入口。
