mod secrets;
mod telemetry;

use tauri::Manager;

struct TelemetryShutdown(tokio::sync::watch::Sender<bool>);

#[tauri::command]
fn report_telemetry(
    app_handle: tauri::AppHandle,
    log: telemetry::TelemetryLog,
) -> Result<(), String> {
    telemetry::enqueue_log(&app_handle, log)
}

const MAX_VOICE_CAPTURE_FILE_BYTES: u64 = 24 * 1024 * 1024 + 44;

/// 读取原生录音生成的临时 WAV 文件并以原始二进制 IPC 响应返回（零 Base64 / 零 `atob`）。
/// 严格限制只能读取应用 cache 目录下的 `tavern_voice_*.wav` 常规文件，防止任意路径读取。
#[tauri::command]
async fn read_voice_capture_file(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if path.trim().is_empty() {
        return Err("VOICE_CAPTURE_PATH_INVALID".to_string());
    }
    let cache_dir = app_handle
        .path()
        .cache_dir()
        .map_err(|e| format!("VOICE_CAPTURE_CACHE_DIR_ERROR:{e}"))?;
    let canonical_cache = tokio::fs::canonicalize(&cache_dir)
        .await
        .map_err(|e| format!("VOICE_CAPTURE_CACHE_DIR_ERROR:{e}"))?;
    let canonical_file = tokio::fs::canonicalize(&path)
        .await
        .map_err(|_| "VOICE_CAPTURE_FILE_NOT_FOUND".to_string())?;
    if !canonical_file.starts_with(&canonical_cache) {
        return Err("VOICE_CAPTURE_PATH_FORBIDDEN".to_string());
    }
    let file_name = canonical_file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "VOICE_CAPTURE_PATH_INVALID".to_string())?;
    if !file_name.starts_with("tavern_voice_") || !file_name.ends_with(".wav") {
        return Err("VOICE_CAPTURE_PATH_FORBIDDEN".to_string());
    }
    let metadata = tokio::fs::metadata(&canonical_file)
        .await
        .map_err(|_| "VOICE_CAPTURE_FILE_NOT_FOUND".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_VOICE_CAPTURE_FILE_BYTES {
        return Err("VOICE_CAPTURE_FILE_INVALID".to_string());
    }
    let bytes = tokio::fs::read(&canonical_file)
        .await
        .map_err(|e| format!("VOICE_CAPTURE_READ_ERROR:{e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // Register the local android-bridge plugin. On Android this injects the
        // `window.AndroidThemeBridge` JavascriptInterface into the WebView via
        // `AndroidBridgePlugin#onWebviewCreated`; on other platforms it is a
        // no-op so the desktop dev server keeps compiling.
        .plugin(tauri_plugin_android_bridge::init())
        // Register the local tavern-ar plugin. On Android this launches a
        // full-screen ArActivity backed by ARCore (plane detection + light
        // estimation + OES camera background + billboard + shadow + chat
        // bubble); on other platforms it is a no-op so the desktop dev server
        // keeps compiling.
        // 暂缓上线：在此注释以彻底从打包中剥离相机敏感权限。需要本地测试 AR 时请解开此注释。
        // .plugin(tauri_plugin_tavern_ar::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 安装 panic 钩子：release profile 配置 panic = "abort"，默认行为是直接终止无日志。
            // 此钩子在 abort 前做两件事：
            //   1. 将 panic 信息打印到 stderr（Tauri Android 重定向到 logcat，tag = RustStdoutStderr）
            //   2. 同步追加写入一行 action="rust_panic" 的 TelemetryLog 到 telemetry_queue.jsonl，
            //      由后台遥测线程上传 SLS，填补 Rust 侧崩溃可观测性盲区。
            // 注意：钩子内禁止任何可能再次 panic 的操作（如分配大量内存、获取已中毒锁）。
            //       enqueue_panic_log 内部用 try_lock + 静默失败保证不会二次 panic。
            std::panic::set_hook(Box::new(|info| {
                let location = info
                    .location()
                    .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                    .unwrap_or_else(|| "<unknown>".to_string());
                let payload = info
                    .payload()
                    .downcast_ref::<&str>()
                    .copied()
                    .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
                    .unwrap_or("<non-string panic payload>");
                eprintln!(
                    "[RUST_PANIC_ABORT] location={} payload={}",
                    location, payload
                );
                // 同步落盘到遥测队列（best-effort，失败静默）
                telemetry::enqueue_panic_log(&location, payload);
            }));

            // 初始化 panic 落盘路径：在 panic 钩子安装后立即注入 telemetry_queue.jsonl 路径，
            // 确保后续任意线程 panic 时钩子内能拿到路径写入。
            telemetry::init_panic_queue_path(&app.handle());

            // Start the background telemetry loop thread and retain a lifecycle shutdown sender.
            let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
            app.manage(TelemetryShutdown(shutdown_tx));
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new()
                    .expect("Failed to create Tokio runtime for telemetry");
                rt.block_on(async {
                    telemetry::start_telemetry_loop(handle, shutdown_rx).await;
                });
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            report_telemetry,
            read_voice_capture_file,
            secrets::decrypt_trial_key
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            let _ = app_handle.state::<TelemetryShutdown>().0.send(true);
        }
    });
}
