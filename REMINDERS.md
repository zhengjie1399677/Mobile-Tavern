# 开发备忘录 (REMINDERS.md)

- **NDK 版本升级**：若升级编译链后 CI 报错，需同步更新 `.github/workflows/tauri-android.yml` 中的 `ndk;25.2.9519653` 和 `NDK_HOME` 里的路径版本号。
- **Keystore 签名**：CI 正式打包需配置 GitHub Secrets `SIGNING_KEY` (Base64)、`KEYSTORE_PASSWORD` 和 `ALIAS`，否则默认降级打包未签名版本。
- **WebView 下载限制**：导出与备份文件禁止使用 Web 端 Blob 下载，必须调用原生 `AndroidThemeBridge.saveFile(fileName, content)` 保存至 `/Download`。
- **状态栏图标同步**：前端切主题时必须调用 `AndroidThemeBridge.setStatusBarStyle(isDark, colorHex)`，防止电量/时间图标因底色冲突不可见。
- **全面屏刘海遮挡**：顶部/底部布局须加 CSS 安全边距：`env(safe-area-inset-top)` 和 `env(safe-area-inset-bottom)`。
- **真机调试白屏**：运行调试前须执行端口映射：`adb reverse tcp:3000 tcp:3000` 与 `adb reverse tcp:24678 tcp:24678` (HMR 端口)。
- **SLS 密钥安全**：严禁提交 AK/SK。STS 临时凭证直传**不需要**在 SLS 控制台开启 WebTracking 或跨域放行。
