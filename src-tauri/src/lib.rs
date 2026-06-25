mod telemetry;

#[tauri::command]
fn report_telemetry(app_handle: tauri::AppHandle, log: telemetry::TelemetryLog) -> Result<(), String> {
  telemetry::enqueue_log(&app_handle, log)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
      
      // Start the background telemetry loop thread
      let handle = app.handle().clone();
      std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime for telemetry");
        rt.block_on(async {
          telemetry::start_telemetry_loop(handle).await;
        });
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![report_telemetry])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
