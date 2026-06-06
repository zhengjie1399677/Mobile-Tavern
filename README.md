# 📱 Mobile Tavern 

[![Version](https://img.shields.io/badge/version-1.3.7-blue.svg?style=for-the-badge)](https://github.com/zhengjie1399677/Mobile-Tavern)
[![Tauri](https://img.shields.io/badge/Tauri-v2-green.svg?style=for-the-badge&logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-v19-blue.svg?style=for-the-badge&logo=react)](https://react.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-06B6D4.svg?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=for-the-badge)](LICENSE)

Mobile Tavern 是一款专为移动端设备（如智能手机、平板等）深度定制的、高性能且轻量级的 AI 角色扮演（Roleplay）客户端。它并非旨在成为桌面端 Silly Tavern 的全盘替代品，而是作为其在**移动设备上的轻量化互补方案**。

在桌面端酒馆应用直接运行在手机浏览器中时，用户常常会遇到输入法键盘拉起遮挡聊天框、后台运行长连接中断、Blob 导出文件受限、手势触控缺失以及安全区被刘海屏遮挡等痛点。Mobile Tavern 聚焦于移动端手势触控、屏幕安全区自适应、底层高性能数据本地存储以及极致的上下文缓存优化，为用户在指尖提供媲美原生 App 的沉浸式人设扮演互动体验。

本软件推崇“无偏向、零侵入、数据驱动”的设计理念。系统内部绝不硬编码任何剧情总结提示词、破限 (Jailbreak) 引导词或分句符号，所有排版和生成行为完全由导入的角色卡、设定集及用户自定义的预设包来驱动。如果导入的角色卡不含自定义视觉扩展，系统将平滑退回最干净、利落的通用聊天布局，以实现极简主义与深度客制化的完美平衡。


> [!NOTE]
> * **功能与技术细节归档**：
>   * 关于 Android 手机真机调试、网络映射配置、原生 bridge 状态栏同步等原生端适配细则，请直接查阅：[AGENTS.md](file:///d:/projects/Mobile-Tavern/AGENTS.md)。
>   * 关于 Prompt 上下文分区的作用、标头过滤机制及最终发送给 API 的消息数组格式示例，请直接查阅：[presets_prompts_guide.md](file:///d:/projects/Mobile-Tavern/presets_prompts_guide.md)。
>   * 关于 Prefix Cache 缓存优化、数据库设计、PNG 二进制解码机制、源码模块剖析等底层技术细节，请直接查阅：[TECHNICAL.md](file:///d:/projects/Mobile-Tavern/TECHNICAL.md)。

---

## 🌟 核心功能特性 (Key Features)

### 1. 📱 移动端极致原生适配 (Deep Mobile Adaptation)
* **大拇指交互设计**：核心控制 Tab、输入区与发送操作被均匀放置于屏幕最底端，完美符合单手持机时“大拇指轻松覆盖”的黄金交互区域。
* **安全区域预留**：全界面自适应 Android 刘海屏、前置摄像头以及底部虚拟导航条（虚拟药丸），在 CSS 中使用 `env(safe-area-inset-top)` 和 `env(safe-area-inset-bottom)` 预留安全边距，绝不遮挡重要内容。
* **状态栏变色同步**：前端切换背景主题时，自动通过原生桥接修改手机系统状态栏底色，并根据亮/暗主题智能变换状态栏图标颜色，保证视觉一致性。

### 2. 🧬 SillyTavern 角色卡无损导入 (Tavern PNG Card Support)
* 支持标准的酒馆角色卡 PNG 图像直接导入。
* 纯本地无服务器解码：前端自动提取 PNG `tEXt` 数据块中的 `chara` 元数据，本地进行 Zlib 解压还原为 JSON 人设设定，并自动将 Base64 头像落库。

### 3. ⏳ 智能故事时间线与多维 RPG 状态追踪 (Story Timeline & RPG Tracking)
* **剧情故事年表**：根据对话内容自动定时提炼历史剧情大纲，并在会话中以优美的垂直时间轴卡片呈现，帮助用户随时回忆前情提要。
* **游戏化状态追踪**：非侵入式解析大模型输出，自动提取并追踪角色的好感度变化 (Bonding)、道具装备变动 (Inventory) 以及生理/心理心境状态 (Condition)，完美兼容非 RPG 角色卡的平滑降级。

### 4. 🌿 多会话平行分支管理 (Multi-session Branching)
* 支持对同一个角色开辟多条完全独立的聊天会话（平行宇宙）。
* 提供极速克隆、重命名和物理删除操作。克隆时会自动完整复制原分支的所有消息树与剧情总结年表。

### 5. 🔒 本地 IndexedDB 离线持久化 (100% Offline Storage)
* 所有导入的角色设定、全局预设及聊天会话记录均存储在用户本机的 IndexedDB 数据库中，100% 离线，完全保护隐私，响应时间达到毫秒级。

### 6. 🚀 运行沙盒与可视化拓扑 (Interactive Sandbox)
* 内置可视化数据流拓扑图，能够直观展示用户输入、世界书匹配、Prompt 组装以及网络流接收的全链路流转，并提供独立的防坍塌宏替换和缓存分流测试台。

---

---

## 📁 源码目录结构简览 (Directory Structure)

本工程采用严格的模块化组织结构：
```text
Mobile-Tavern
├── server.ts                             # 本地 Express 流代理服务 (CORS 转发)
├── AGENTS.md                             # APK 原生适配、遥测上报与调试白屏排查指南
├── TECHNICAL.md                          # 技术架构细节、缓存优化、数据库设计及源码剖析
├── presets_prompts_guide.md              # 预设 Prompt 上下文分区逻辑说明
├── src-tauri                             # Tauri 原生容器构建模块 (Rust & Android native)
└── src                                   # 前端 React 业务代码
    ├── App.tsx                           # 启动流程管理与基础预设包定义
    ├── AppContext.tsx                    # 全局状态管理 Context
    ├── components                        # 共享 UI 容器 (自适应安全区、拇指布局等)
    ├── hooks                             # 核心状态钩子 (useChat, useCharacters, useSettings)
    ├── tabs                              # 各功能大版块 Tab 页 (包含调试沙盒)
    └── utils                             # 底层计算工具 (cardParser, db, promptBuilder)
```

---

## 📄 开源许可协议 (License)

本项目基于 **Apache License 2.0** 开源协议发行。

### Apache 2.0 协议许可声明 (Apache 2.0 License Summary)
* **商业友好**：允许任何人免费用于个人、内部或商业目的，包括修改、分发及再授权。
* **商标与专利保护**：授予用户免费、全球性、不可撤销的专利许可，同时明确规定本许可协议不授予任何使用项目贡献者商标、商品名称的权利。
* **责任限制**：本软件按“原样”提供，在任何情况下均不对由于使用本软件而导致的任何损害承担责任，且修改过的文件必须带有显著的修改声明。

关于更完整的许可内容，请查阅项目根目录下的 [LICENSE](file:///d:/projects/Mobile-Tavern/LICENSE) 文件。
