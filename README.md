# 📱 Mobile Tavern 

[![Version](https://img.shields.io/badge/version-1.7.1-blue.svg?style=for-the-badge)](https://github.com/zhengjie1399677/Mobile-Tavern)
[![Tauri](https://img.shields.io/badge/Tauri-v2-green.svg?style=for-the-badge&logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-v19-blue.svg?style=for-the-badge&logo=react)](https://react.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-06B6D4.svg?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=for-the-badge)](LICENSE)

Mobile Tavern 是一款专为移动端设备（如智能手机、平板等）深度定制的、高性能且轻量级的 AI 角色扮演（Roleplay）客户端。它并非旨在成为桌面端 Silly Tavern 的全盘替代品，而是作为其在**移动设备上的轻量化互补方案**。

在桌面端酒馆应用直接运行在手机浏览器中时，用户常常会遇到输入法键盘拉起遮挡聊天框、后台运行长连接中断、Blob 导出文件受限、手势触控缺失以及安全区被刘海屏遮挡等痛点。Mobile Tavern 聚焦于移动端手势触控、屏幕安全区自适应、底层高性能数据本地存储以及极致的上下文缓存优化，为用户在指尖提供媲美原生 App 的沉浸式人设扮演互动体验。

本软件推崇“无偏向、零侵入、数据驱动”的设计理念。系统内部绝不硬编码任何剧情总结提示词、破限 (Jailbreak) 引导词或分句符号，所有排版和生成行为完全由导入的角色卡、设定集及用户自定义的预设包来驱动。如果导入的角色卡不含自定义视觉扩展，系统将平滑退回最干净、利落的通用聊天布局，以实现极简主义与深度客制化的完美平衡。


> [!NOTE]
> * **功能与技术细节归档**：
>   * 关于 Android 手机真机调试、网络映射配置、原生 bridge 状态栏同步等原生端适配细则，请直接查阅：[AGENTS.md](AGENTS.md)。
>   * 关于 用户操作步骤、雪团客服挂件说明以及知识库整理，请直接查阅：[KNOWLEDGE.md](KNOWLEDGE.md)。
>   * 关于 Prefix Cache 缓存优化、项目架构职责、数据库设计以及源码模块剖析等底层技术细节，请直接查阅：[TECHNICAL.md](TECHNICAL.md)。

---

## 🌟 核心功能特性 (Key Features)

### 1. 📱 移动端极致原生适配 (Deep Mobile Adaptation)
* **大拇指交互设计**：核心控制 Tab、输入区与发送操作被均匀放置于屏幕最底端，完美符合单手持机时“大拇指轻松覆盖”的黄金交互区域。
* **安全区域预留**：全界面自适应 Android 刘海屏、前置摄像头以及底部虚拟导航条（虚拟药丸），在 CSS 中使用 `env(safe-area-inset-top)` 和 `env(safe-area-inset-bottom)` 预留安全边距，绝不遮挡重要内容。
* **状态栏变色同步**：前端切换背景主题时，自动通过原生桥接修改手机系统状态栏底色，并根据亮/暗主题智能变换状态栏图标颜色，保证视觉一致性。
* **快捷对话与继续工具栏**：支持一键“重载上一段剧情”（擦除并重新生成）和“继续”（替用户自动发送继续指令），方便在移动端单手掌控故事走向。

### 2. 🧬 SillyTavern 角色卡无损导入 (Tavern PNG Card Support)
* 支持标准的酒馆角色卡 PNG 图像直接导入。
* 纯本地无服务器解码：前端自动提取 PNG `tEXt` 数据块中的 `chara` 元数据，本地进行 Zlib 解压还原为 JSON 人设设定，并自动将 Base64 头像落库。

### 3. 🧩 自由 Prompt 编排与兼容层 (Free Prompt Composition)
* 用户可以自由创建、删除、排序任意数量的 `system`、`user`、`assistant` 消息，决定角色卡、世界书、记忆和聊天历史出现的位置；每个历史区块可独立选择全部或最近若干条消息、是否保留欢迎消息，深度注入也可指定目标历史区块。相同角色消息不会被底层强制合并。
* 编译器没有固定 Prompt、锁定区块或隐藏追加逻辑；空编排是合法状态。现有 Prompt 仅作为可编辑、可删除的基础示例，旧编译路径默认保留用于平滑迁移。
* SillyTavern Prompt Manager 预设通过 `infrastructure/compat` 防腐适配器导入导出；未知字段隔离保留，无法无损表达的能力生成显式兼容警告，不进入中立领域模型。

### 4. ⏳ 智能故事时间线与多维 RPG 状态追踪 (Story Timeline & RPG Tracking)
* **剧情故事年表**：根据对话内容自动定时提炼历史剧情大纲，并在会话中以优美的垂直时间轴卡片呈现，帮助用户随时回忆前情提要。
* **游戏化状态追踪**：非侵入式解析大模型输出，自动提取并追踪角色的好感度变化 (Bonding)、道具装备变动 (Inventory) 以及生理/心理心境状态 (Condition)，完美兼容非 RPG 角色卡的平滑降级。
* **可编程状态 Schema**：状态表字段支持 `text`、`number`、`date`、`enum` 类型、默认值和枚举选项；列重命名凭稳定 ID 保留历史数据，旧会话自动按 `text` 降级。用户可通过 `.tavern-schema.json` 导入导出不含会话行数据的 Schema 模板，在不同会话和角色间复用。

### 5. 🌿 多会话平行分支管理 (Multi-session Branching)
* 支持对同一个角色开辟多条完全独立的聊天会话（平行宇宙）。
* 提供极速克隆、重命名和物理删除操作。克隆时会自动完整复制原分支的所有消息树与剧情总结年表。
* 重发采用同步事务锁与 IndexedDB 跨 Store 原子替换；存储事务按 `turnIndex` 分支起点清理整个旧尾部，即使折叠边界存在孤儿旧回复也只会保留一条新回复，失败或取消时不会留下半截分支。

### 6. 🔒 本地 IndexedDB 离线持久化 (100% Offline Storage)
* 所有导入的角色设定、全局预设及聊天会话记录均存储在用户本机的 IndexedDB 数据库中，100% 离线，完全保护隐私，响应时间达到毫秒级。
* 会话元数据与消息正文物理分轨，长期记忆通过领域端口访问存储适配器，业务召回与摘要规则不会污染通用数据库底座。
* 关闭应用后重新进入会话时，最新优先的存储分页会在 Context 适配层恢复为时间正序；加载更早页同样先正序化再合并，避免首条消息被显示为最新内容。

### 7. 🚀 运行沙盒与可视化拓扑 (Interactive Sandbox)
* 内置可视化数据流拓扑图，能够直观展示用户输入、世界书匹配、Prompt 组装以及网络流接收的全链路流转，并提供独立的防坍塌宏替换和缓存分流测试台。

### 8. 🧭 模块化微内核与洋葱拦截管道 (Modular Kernel & Onion Pipeline)
* 采用 DI/IOC 控制反转设计构建解耦底座，将数据持久化、大模型流式通信、Prompt 编译等核心逻辑全部下沉为独立的微服务。
* 引入洋葱模型中间件管道（Pipeline）与具备优先级排序、并行分发和异常隔离的高能消息总线（MessageBus）。支持服务超时 Abort 熔断与非关键服务崩溃时返回 SafeProxy 的容错自愈。
* 未注册 Pipeline 会立即报错，Kernel 通过 Provider 显式注入；React 视图统一以 selector 订阅最小状态切片，架构守卫持续阻止业务层反向依赖底座实现。

### 9. 🧪 自动化集成测试套件 (Comprehensive Test Suite)
* 当前主测试链包含 80 组功能套件与 333 项 Vitest 断言，覆盖物理 PNG 解码、SSRF 防御、自由 Prompt 编排与兼容防腐、状态 Schema 迁移、重启消息顺序、IndexedDB 分支尾部原子替换、十轮折叠边界重发、SafeProxy、洋葱管道严格模式及架构依赖边界。

### 10. 🌐 多语言国际化 (i18n Multi-language)
* 内置 8 种语言完整翻译：简体中文、繁体中文、English、日本語、Русский、Español、한국어、Português (BR)。
* 自动检测系统默认语言，支持运行时无缝切换。三级回退链保障无翻译 key 时降级显示。

---

## 🚀 快速上手与本地测试 (Quick Start & Testing)

### 1. 本地开发调试
安装项目依赖并运行 Express 中转代理服务器：
```powershell
npm install
npm run dev
```
打开浏览器访问控制台提示的本地服务地址即可。

### 2. 原生安卓调试
如需在安卓真机/模拟器中挂载前端热重载（端口反向映射）：
```powershell
adb reverse tcp:3000 tcp:3000
adb reverse tcp:24678 tcp:24678
npx tauri android dev --host 127.0.0.1
```

### 3. 运行自动化测试与类型检查
在本地一键运行所有核心测试用例以验证代码安全性：
```powershell
# 执行静态 TS 类型校验
npm run lint

# 执行自动化测试用例
npm run test
```

---

## 📁 源码目录结构简览 (Directory Structure)

本工程采用严格的模块化组织结构，项目根目录下仅保留核心 Markdown 配置文件以保证工程整洁：
```text
Mobile-Tavern
├── server.ts                             # 本地 Express 流代理服务 (CORS 转发)
├── AGENTS.md                             # APK 原生适配、遥测上报与调试白屏排查指南
├── TECHNICAL.md                          # 技术架构细节、项目源码架构树、缓存优化及源码剖析
├── KNOWLEDGE.md                          # 项目知识库，包含用户操作指南、挂件雪团说明与常用解答
├── src-tauri                             # Tauri 原生容器构建模块 (Rust 侧，包含本地落盘与 STS 遥测同步引擎)
└── src                                   # 前端 React 业务代码
    ├── App.tsx                           # 启动流程管理与基础预设包定义
    ├── UnifiedAppContext.tsx             # 统一状态选择器入口
    ├── composition                       # 应用装配与扩展注册
    ├── components                        # 共享 UI 容器 (自适应安全区、拇指布局等，含雪团客服)
    ├── domain                            # 与 React、IndexedDB 无关的纯业务规则
    ├── hooks                             # 核心状态钩子 (useChat, useCharacters, useSettings, useCatbot)
    ├── kernel                            # 微内核切面底座 (包含 IOC 容器、Pipeline 及 17 个官方微服务)
    ├── infrastructure                    # IndexedDB 等物理基础设施适配器
    ├── tabs                              # 各功能大版块 Tab 页 (包含调试沙盒)
    └── utils                             # 底层计算工具 (cardParser, db, promptBuilder, telemetry)
```

---

## 📄 开源许可协议 (License)

本项目基于 **Apache License 2.0** 开源协议发行。

### Apache 2.0 协议许可声明 (Apache 2.0 License Summary)
* **商业友好**：允许任何人免费用于个人、内部或商业目的，包括修改、分发及再授权。
* **商标与专利保护**：授予用户免费、全球性、不可撤销的专利许可，同时明确规定本许可协议不授予任何使用项目贡献者商标、商品名称的权利。
* **责任限制**：本软件按“原样”提供，在任何情况下均不对由于使用本软件而导致的任何损害承担责任，且修改过的文件必须带有显著的修改声明。

关于更完整的许可内容，请查阅项目根目录下的 [LICENSE](LICENSE) 文件。
