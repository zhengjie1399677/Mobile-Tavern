# Mobile Tavern

Mobile Tavern 是一款专为移动端打造的轻量级 AI 角色扮演客户端。

## 为什么开发这个应用？(Why Mobile Tavern?)

诞生初衷非常简单：虽然 **Silly Tavern** 在桌面端拥有无与伦比的丰富功能且体验极佳，但由于其设计过于庞大臃肿，导致在手机端浏览器上的操作体验非常糟糕。

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

## 技术栈 (Technology Stack)

*   **前端框架**: React 18 + Vite + TypeScript
*   **构建配置**: Tauri v2 (专注 Android 构建 `aarch64`)
*   **样式库**: Tailwind CSS + shadcn/ui
*   **数据存储**: IndexedDB / localForage (完全本地，隐私安全)

