# Mobile Tavern Lite

A lightweight, local-first, mobile-optimized frontend for AI role-playing and chat. This project runs entirely in your browser using IndexedDB for storage and connects to Gemini models for generating character responses.

## 项目概览 (Project Overview)

本项目是一个功能完整的纯前端 AI 角色扮演对话应用。它将用户数据完全存储在本地（隐私友好），并且对移动端界面的操作体验做了深度优化。

### 核心功能 (Core Features)

1. **角色馆 (Character Management)**
   - 支持主流的 Tavern 格式人物卡（PNG 或 JSON 格式）导入和导出。
   - 自定义角色的各类设定，包括姓名、头像、人物描述、对话风格、系统级别的自定义约束。
2. **对话流 (Chat & Sessions)**
   - 每个角色可以拥有多个独立分支对话（Session）。
   - 支持回退（Backtrack）、重摇（Reroll）、编辑、删除对话。
   - 自动在后台进行上下文总结（Summarization）以节省长文本时的 Token 开销。
3. **世界书 (Lorebook)**
   - 全局世界书与单角色世界书：可在对话中根据玩家或 AI 提到的关键字自动注入设定背景。
4. **端控制 (System Settings)**
   - 提供给高级玩家的高度自定义空间，包含采样设置（Top-P, Top-K, Repetition Penalty等）。
   - 可视化的 Prompt 组件定制器，可自定义 AI 接收到的具体系统提示词和对话格式。
5. **本地存储与备份 (Local Storage & Backups)**
   - 免除部署数据库的麻烦。使用 LocalForage 和 IndexedDB 来存储全部的聊天进度。
   - 支持基于 JSON 的完整设定打包导出，甚至可选密码加密。

## 技术栈 (Technology Stack)

应用采用了现代化的全栈前端框架与库进行构建，确保了性能、开发体验和响应式特性：

- **核心框架**: [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **构建工具**: [Vite](https://vitejs.dev/) - 极速的热更新体验和打包器。
- **样式方案**: [Tailwind CSS](https://tailwindcss.com/) - 实用优先的原子级 CSS 框架。
- **UI 组件库**: 基于 [shadcn/ui](https://ui.shadcn.com/) 与 Radix UI 的无障碍组件体系。
- **图标集**: [lucide-react](https://lucide.dev/) - 简约、风格一致的现代化图标库。
- **本地存储**: [localforage](https://localforage.github.io/localForage/) - 封装 IndexedDB 的 API 库。
- **大模型通信**: AI Studio Gemini 代理或第三方 OpenAI 兼容 API / Gemini 原生 API。
- **数据与图片处理**: `png-text`, `msgpackr`, `base64-js` (实现酒馆 V2+ PNG 元数据的解析与注入).

***

如果您有其中任何感兴趣的模块，可以随时向我提出，我会立即帮您开始构建！
