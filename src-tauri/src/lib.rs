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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // Register the local android-bridge plugin. On Android this injects the
        // `window.AndroidThemeBridge` JavascriptInterface into the WebView via
        // `AndroidBridgePlugin#onWebviewCreated`; on other platforms it is a
        // no-op so the desktop dev server keeps compiling.
        .plugin(tauri_plugin_android_bridge::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

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
        .invoke_handler(tauri::generate_handler![report_telemetry])
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
