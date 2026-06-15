mod telemetry;

#[tauri::command]
fn report_telemetry(app_handle: tauri::AppHandle, log: telemetry::TelemetryLog) -> Result<(), String> {
  telemetry::enqueue_log(&app_handle, log)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
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
      tokio::spawn(async move {
        telemetry::start_telemetry_loop(handle).await;
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![report_telemetry])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
