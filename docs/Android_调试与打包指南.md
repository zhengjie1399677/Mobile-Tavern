# Android 调试、打包与验收指南

> 本项目当前只维护 Android 移动端流程，iOS 不在当前开发与验收范围内。

## 测试分层

现有自动化已经覆盖大部分稳定且适合自动执行的内容：

- `npm run lint`：类型与接口边界。
- `npm test`：内核、存储、Prompt、记忆、分页、流式发送、中止、重发与弱网恢复。
- `npm run test:e2e`：桌面和 Pixel 5 尺寸下的受控浏览器回归。
- `.github/workflows/tauri-android.yml`：正式 Android 构建、签名、证书校验与产物上传。

Android 原生层只保留一组薄冒烟验收，不建设大而脆弱的全页面坐标脚本。需要真实设备或模拟器确认的边界包括：冷启动、屏幕旋转、系统返回、文件导出、软键盘与安全区。业务页面内容继续优先由单元测试和受控浏览器测试覆盖。

## 开发热重载

启动前必须清理占用 `3000`、`24678` 端口的残留进程，然后反向映射端口：

```powershell
$sdkRoot = if (Test-Path -LiteralPath "E:\modules\ide\android-sdk") {
    "E:\modules\ide\android-sdk"
} else {
    Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
$env:ANDROID_HOME = $sdkRoot
$env:PATH = (Join-Path $sdkRoot "platform-tools") + ";" + $env:PATH
adb reverse tcp:3000 tcp:3000
adb reverse tcp:24678 tcp:24678
npm run dev:android
```

热重载必须绑定 `127.0.0.1`，不能改成局域网地址，以免 TUN 代理干扰 WebView 和热更新连接。

## 全新调试包

发布前真机验收使用 DEBUG APK，但必须从干净状态构建：

1. 确认 `adb devices -l` 中设备状态为 `device`。
2. 卸载 `com.aitavern.app.debug`，同时清除旧应用数据和 WebView 缓存。
3. 只删除工作区内明确的构建产物：`dist/`、`src-tauri/target/`、`src-tauri/gen/android/.gradle/`、`src-tauri/gen/android/build/`、`src-tauri/gen/android/app/build/` 和旧的 `jniLibs/arm64-v8a/libapp_lib.so`。
4. 执行全量构建：

```powershell
$env:ANDROID_HOME = "E:\modules\ide\android-sdk"
$env:GRADLE_USER_HOME = "C:\Users\20573\.gradle"
npx tauri android build --apk --debug --target aarch64 --verbose
```

若 Windows 符号链接步骤失败，但 `src-tauri/target/aarch64-linux-android/debug/libapp_lib.so` 已生成，则将该文件复制到 `src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libapp_lib.so`，再执行：

```powershell
Set-Location "D:\projects\Mobile-Tavern\src-tauri\gen\android"
.\gradlew.bat assembleArm64Debug --no-daemon -x rustBuildArm64Debug -x rustBuildArm64Release
```

最终 APK 位于 `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`。使用 `adb install` 安装，不使用 `-r` 覆盖旧包，以保证验收的是全新数据状态。

## 真机冒烟验收矩阵

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 1 | 冷启动与首次切换 | 首屏稳定；首次进入任何分类不闪回首页，不出现长时间白屏 |
| 2 | 四个主标签 | 高度一致；主标题层级明确；设置底栏与其余标签一致 |
| 3 | 记忆与状态中心 | 首次打开可接受；四个标签内容完整；JSON 与表单控件可读可操作 |
| 4 | 自由编排 | 竖屏内容不截断；进入横屏后只显示编排工作台；文本长度与滚动正常 |
| 5 | 故事年表 | 长内容可以持续下滑并展示全文，返回对话位置正确 |
| 6 | 文件能力 | Prompt 模板和记忆词典可保存到公共下载目录，并显示实际保存路径 |
| 7 | 软键盘与安全区 | 输入框不被键盘、状态栏或导航栏遮挡，收起键盘后布局恢复 |
| 8 | 系统返回 | 第一次返回提示再次返回退出；两秒内第二次返回结束应用任务 |
| 9 | 本地角色卡扫描 | 点击授权后进入本应用的“所有文件访问权限”设置；允许后自动扫描可访问的共享与外置存储，拒绝或返回时不扫描 |

弱网发送由自动化测试验证事务语义：首包失败保留用户消息、显式重发不复制用户消息、部分回复断线保留内容并显示中断标记、主动停止不显示弱网标记。真机只需抽查一次断网后的界面反馈。

## Prompt 横屏与原生桥接

自由编排通过 `AndroidThemeBridge.setScreenOrientation("landscape")` 进入传感器横屏，通过 `setScreenOrientation("auto")` 恢复系统旋转。`MainActivity` 已处理 `orientation|screenSize`，旋转不应重建 WebView 或丢失编辑状态。

模板和词典导出优先调用 `AndroidThemeBridge.saveFile`，分享调用 `AndroidThemeBridge.shareText`。浏览器环境没有原生桥接时应安全降级，不得伪装为 Android 保存成功。

## 本地角色卡扫描权限

本项目的 Android 包不经应用商店分发，本地角色卡扫描使用 `MANAGE_EXTERNAL_STORAGE`。用户点击授权按钮后，原生桥接必须打开 `ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` 对应的应用专属系统设置页；返回应用后由 `MainActivity.onResume` 检查 `Environment.isExternalStorageManager()` 并通知前端。用户拒绝、关闭或直接返回时不报错、不扫描。

扫描范围覆盖主共享存储、系统报告的外置存储卷和 `Android/media`，以兼容 QQ、微信、Telegram 等应用可公开访问的接收目录；最多递归十二层、访问两万个目录、返回五千个 PNG/JSON 文件，并跳过隐藏目录、`LOST.DIR`、`Android/data` 与 `Android/obb`。后两者属于 Android 隔离区，即使获得所有文件访问权限也不能读取其他应用的私有目录。导入时再次校验规范路径位于已登记存储卷、未进入私有区、扩展名合法且不超过 64 MB。

## 正式签名

本地调试不使用正式签名。GitHub 工作流从以下仓库机密读取签名材料：

- `SIGNING_KEY`：Base64 编码的密钥库。
- `KEYSTORE_PASSWORD`：密钥库与密钥密码。
- `ALIAS`：密钥别名。

任一机密缺失、找不到 release APK、密钥库解码为空或 `apksigner verify` 失败时，工作流必须失败，不能降级上传未签名 APK。

## 常见故障

- `unauthorized`：在手机上重新确认 USB 调试授权。
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE`：卸载签名不同的旧包后再安装。
- `Unable to create daemon log file`：确认 `GRADLE_USER_HOME` 为可写目录。
- `rustBuildArm64Debug FAILED`：确认 Rust 目标已安装，或按上面的符号链接兜底流程复制 `.so` 后跳过 Rust Gradle 任务。
- 热重载白屏：检查 `3000`、`24678` 反向映射、残留监听进程与 TUN 代理。
