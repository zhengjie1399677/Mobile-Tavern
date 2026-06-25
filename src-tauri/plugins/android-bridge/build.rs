fn main() {
    // Build the Tauri plugin for all platforms; the Android Kotlin sources
    // are only compiled when targeting Android via the tauri-build mobile hook.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .android()
            .build(),
    )
    .expect("failed to run tauri-build for android-bridge plugin");
}
