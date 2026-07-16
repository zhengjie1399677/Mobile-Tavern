# 纯移动端（Android/iOS）战略与原生适配规范

> [!IMPORTANT]
> **此文件为 Mobile Tavern 行为指导手册的子规范，定义了原生 WebView 桥接、状态栏、界面设计与服务安全防护的细则。**

---

### 开发与生产隔离
本地开发环境为了方便调试，允许运行基于 Node.js 的 Vite 开发服务或辅助调试服务器；但是在打包发布移动端生产安装包（APK/IPA）时，必须将所有 Node/Express 服务器代码（包括 `server.ts` 等）及其依赖彻底剥离，不得打包入客户端 assets 中。

### 物理隔离限制
App 运行在系统原生的 WebView 容器中，必须遵守以下原生开发守则：

### 1. 禁止直接使用纯 Web 文件下载 API (Blob 下载限制)
*   **物理限制**：手机原生 WebView 中无法直接响应通过 JavaScript 动态创建 of `<a href="blob:...".click()>` 下载指令。
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
*   **大拇指单手触达**：核心输入区、发送按钮和主切换选项必须遵从“大拇指单手可及”原则，优先排布在屏幕底部。
*   **安全边距预留**：所有顶部和底部的容器，必须严格在 CSS 中使用 `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` 预留安全边距，防止被刘海屏、前置摄像头或系统导航药丸/虚拟键遮挡。

### 4. 服务端安全防御准则 (CORS Proxy 与 SSRF 防范)
*   **开发与生产隔离**：本地开发环境使用的 Express 服务端代理（如 `server.ts`）在编译打包为客户端 APK/桌面包（Tauri/WebView）后**并不会运行在用户设备上**。客户端使用 Tauri 原生直连直接发起 HTTPS 请求，以避开浏览器 CORS。
*   **公网 SSRF 防御**：如果将来把项目作为 Web 在线版本部署且启用 Express 代理，必须在服务端对 `baseUrl` 的实际 DNS 解析 IP 进行合规验证，严禁请求指向 `localhost`、`127.0.0.1`、`169.254.169.254` 等本地及内网网段，防范 SSRF 漏洞。
