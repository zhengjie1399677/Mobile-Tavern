# Android 调试与打包指南

> **用途**：Android 开发热重载调试 + 真机测试 APK 打包的完整流程。
> **AGENTS.md 的「Android 调试规范」已整合到本文档，AGENTS.md 仅保留引用链接。**
> **只在 Android 开发/测试时引用本文档。**

---

## Prompt 横屏工作台原生入口

自由 Prompt 模式在 Android 原生包内显示“进入横屏工作台”按钮。该入口通过 `window.AndroidThemeBridge.setScreenOrientation("landscape")` 锁定为传感器横屏，切换后按钮变为“恢复自动旋转”，并以 `setScreenOrientation("auto")` 把方向控制权交还给系统。前端按桥接方法是否存在进行能力检测，因此浏览器与其他平台不会显示该按钮。

Android `MainActivity` 已声明 `orientation|screenSize` 等 `configChanges`，旋转不会重建 WebView；当前 Prompt 编辑状态与已选区块可以继续保留。新增或调整方向桥接后，应至少执行一次下方 Gradle 调试构建并在真机验证锁定、左右横屏切换和恢复自动旋转。

---

## SDK 路径说明

本项目 Android SDK 优先使用 `E:\modules\ide\android-sdk`（若存在），否则回退到默认路径 `$env:USERPROFILE\AppData\Local\Android\Sdk`。下文命令中两种写法等价，按实际环境选择。

---

## 一、开发热重载调试（Dev Mode）

适用于：开发阶段在真机上实时预览代码改动（热重载），无需每次重新打包 APK。

### 端口与代理限制
- 必须绑定 `--host 127.0.0.1`，避免网络代理（TUN 模式）干扰
- 必须反向映射 `3000`（Vite dev server）与 `24678`（HMR WebSocket）端口，防止白屏与进程冲突

### 启动调试命令

```powershell
$env:ANDROID_HOME = "E:\modules\ide\android-sdk"
$env:PATH += ";$env:ANDROID_HOME\platform-tools"
adb reverse tcp:3000 tcp:3000
adb reverse tcp:24678 tcp:24678
npx tauri android dev --host 127.0.0.1
```

---

## 二、真机测试打包（Build & Install APK）

适用于：功能开发完成后，构建完整的 DEBUG APK 安装到真机做端到端验证。

### 为什么不能用 `npm run build:android`

`scripts/build-android.cjs` 在 Trae 沙盒环境中会遇到三个阻断性问题：

| 问题 | 原因 | 规避方式 |
|---|---|---|
| 脚本走 RELEASE 分支 | Trae IDE 设置了 `CI=true` 环境变量 | 直接调用 `npx tauri android build --debug` |
| Tauri 创建 symlink 失败 | Windows 无符号链接权限 | 手动拷贝 `.so` 到 jniLibs |
| Gradle daemon 日志被沙盒拦截 | `E:\modules\ide\.gradle` 不在允许列表 | 改用 `c:\users\20573\.gradle` |

### 前置条件

- 设备已开启 USB 调试并连接
- Rust 工具链 + `aarch64-linux-android` target 已安装
- 首次运行需完成下方「首次环境准备」

### 首次环境准备（仅一次）

把 Gradle 8.14.3 distribution 从沙盒外路径拷贝到允许列表内的路径，避免重新下载：

```powershell
$src = "E:\modules\ide\.gradle\wrapper\dists\gradle-8.14.3-bin"
$dst = "c:\users\20573\.gradle\wrapper\dists\gradle-8.14.3-bin"
if (-not (Test-Path $dst)) {
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    Copy-Item "$src\*" $dst -Recurse -Force
    Write-Host "Gradle distribution copied."
} else {
    Write-Host "Already exists, skip."
}
```

### 完整流程（每次打包执行）

#### 步骤 0：检查设备连接

```powershell
adb devices
```

确认设备出现在列表中且状态为 `device`（不是 `unauthorized` 或 `offline`）。

#### 步骤 1：构建前端 + Rust（容忍 symlink 失败）

```powershell
Set-Location "E:\modules\projects\Mobile-Tavern"
npx tauri android build --apk --debug --target aarch64 --verbose
```

**预期行为**：
1. 前端构建到 `dist/`（约 30s）
2. Rust 编译生成 `.so`（约 2 分钟）
3. 在 `Failed to create a symbolic link ... (os error 2)` 处退出 ← **正常，忽略**

成功标志：`src-tauri\target\aarch64-linux-android\debug\libapp_lib.so` 文件已生成（约 160-170 MB）。

#### 步骤 2：手动拷贝 .so 到 jniLibs

```powershell
$src = "E:\modules\projects\Mobile-Tavern\src-tauri\target\aarch64-linux-android\debug\libapp_lib.so"
$dst = "E:\modules\projects\Mobile-Tavern\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\libapp_lib.so"
$dstDir = Split-Path $dst -Parent
New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
if (Test-Path $dst) { Remove-Item $dst -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 200
Copy-Item $src $dst -Force
Write-Host "Copied .so size: $((Get-Item $dst).Length) bytes"
```

#### 步骤 3：用 Gradle 构建 APK（跳过 Rust 构建）

```powershell
$env:ANDROID_HOME = "E:\modules\ide\android-sdk"
$env:GRADLE_USER_HOME = "c:\users\20573\.gradle"
$env:PATH = "$env:ANDROID_HOME\platform-tools;" + $env:PATH
Set-Location "E:\modules\projects\Mobile-Tavern\src-tauri\gen\android"
.\gradlew.bat assembleArm64Debug --no-daemon -x rustBuildArm64Debug -x rustBuildArm64Release
```

**关键点**：
- `GRADLE_USER_HOME` 必须改为 `c:\users\20573\.gradle`（Trae 沙盒允许列表内）
- `-x rustBuildArm64Debug` 跳过 Rust 构建（避免 tauri CLI 尝试连接 WebSocket dev server 失败）
- 构建产物路径：`app\build\outputs\apk\arm64\debug\app-arm64-debug.apk`

成功标志：`BUILD SUCCESSFUL`（约 2 分钟）。

#### 步骤 4：安装到设备

```powershell
$apk = "E:\modules\projects\Mobile-Tavern\src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk"
adb install -r $apk
```

成功标志：`Success`。

---

## 三、一键脚本（可选）

### 全量重建（前端 + Rust 有变更）

把步骤 1-4 合并执行：

```powershell
# === 配置 ===
$projectRoot = "E:\modules\projects\Mobile-Tavern"
$env:ANDROID_HOME = "E:\modules\ide\android-sdk"
$env:GRADLE_USER_HOME = "c:\users\20573\.gradle"
$env:PATH = "$env:ANDROID_HOME\platform-tools;" + $env:PATH

# === 步骤 1：构建前端 + Rust（容忍 symlink 失败）===
Set-Location $projectRoot
npx tauri android build --apk --debug --target aarch64 --verbose 2>&1 | Out-Null
Write-Host "[1/4] Rust build done (symlink error expected)"

# === 步骤 2：拷贝 .so ===
$soSrc = "$projectRoot\src-tauri\target\aarch64-linux-android\debug\libapp_lib.so"
$soDst = "$projectRoot\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\libapp_lib.so"
$soDstDir = Split-Path $soDst -Parent
New-Item -ItemType Directory -Path $soDstDir -Force | Out-Null
if (Test-Path $soDst) { Remove-Item $soDst -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 200
Copy-Item $soSrc $soDst -Force
Write-Host "[2/4] .so copied"

# === 步骤 3：Gradle 构建 APK ===
Set-Location "$projectRoot\src-tauri\gen\android"
.\gradlew.bat assembleArm64Debug --no-daemon -x rustBuildArm64Debug -x rustBuildArm64Release
if ($LASTEXITCODE -ne 0) { Write-Host "Gradle build failed"; exit 1 }
Write-Host "[3/4] APK built"

# === 步骤 4：安装到设备 ===
$apk = "$projectRoot\src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk"
adb install -r $apk
Write-Host "[4/4] Installed to device"
```

### 纯前端改动快速重建（Rust 未改）

如果只改了 TypeScript/React 代码，Rust 代码没动，可以跳过步骤 1 的 Rust 编译：

```powershell
$projectRoot = "E:\modules\projects\Mobile-Tavern"
$env:ANDROID_HOME = "E:\modules\ide\android-sdk"
$env:GRADLE_USER_HOME = "c:\users\20573\.gradle"
$env:PATH = "$env:ANDROID_HOME\platform-tools;" + $env:PATH

# 只重建前端
Set-Location $projectRoot
npm run build

# 拷贝已有 .so（如果 jniLibs 里已有则跳过）
$soDst = "$projectRoot\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\libapp_lib.so"
if (-not (Test-Path $soDst)) {
    $soSrc = "$projectRoot\src-tauri\target\aarch64-linux-android\debug\libapp_lib.so"
    $soDstDir = Split-Path $soDst -Parent
    New-Item -ItemType Directory -Path $soDstDir -Force | Out-Null
    Copy-Item $soSrc $soDst -Force
}

# Gradle 打包 + 安装
Set-Location "$projectRoot\src-tauri\gen\android"
.\gradlew.bat assembleArm64Debug --no-daemon -x rustBuildArm64Debug -x rustBuildArm64Release
adb install -r "$projectRoot\src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk"
```

---

## 四、故障排查

### Q1: `adb devices` 看不到设备
- 检查 USB 调试是否开启（设置 → 开发者选项）
- 检查 USB 驱动是否安装
- 尝试 `adb kill-server` 然后 `adb start-server`

### Q2: 步骤 1 报其他错误（不是 symlink 错误）
- 检查 Rust target 是否安装：`rustup target list --installed | findstr aarch64-linux-android`
- 如缺失：`rustup target add aarch64-linux-android`

### Q3: 步骤 3 报 `Unable to create daemon log file`
- 确认 `$env:GRADLE_USER_HOME` 已设为 `c:\users\20573\.gradle`
- 确认已完成「首次环境准备」

### Q4: 步骤 3 报 `:app:rustBuildArm64Debug FAILED`
- 确认命令包含 `-x rustBuildArm64Debug -x rustBuildArm64Release`
- 确认步骤 2 的 `.so` 已拷贝到 jniLibs

### Q5: 步骤 4 报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`
- 旧版本签名不同：先卸载 `adb uninstall com.aitavern.app` 再安装

### Q6: 构建很慢/卡住
- 首次构建需下载 AGP 依赖（约 200MB），耐心等待
- 后续构建会复用缓存，约 2 分钟完成

### Q7: 热重载调试白屏
- 确认已执行 `adb reverse tcp:3000 tcp:3000` 和 `adb reverse tcp:24678 tcp:24678`
- 确认 dev server 绑定 `--host 127.0.0.1`
- 检查开发者 TUN 代理是否干扰，必要时临时关闭代理
