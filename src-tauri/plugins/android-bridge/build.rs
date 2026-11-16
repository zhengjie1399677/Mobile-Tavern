fn main() {
    tauri_plugin::Builder::new(&["stop_record_native"])
        .android_path("android")
        .build();
}
