//! Tauri plugin that provides real ARCore spatial anchoring for Mobile Tavern.
//!
//! Architecture: AR runs in a full-screen Android Activity (not a system overlay
//! window) because ARCore Session lifecycle is bound to Activity context for
//! camera access. This is the Google-official ARCore integration path.
//!
//! All commands are handled on the Kotlin side (ArPlugin @Command methods);
//! Rust only registers the plugin so Tauri wires it into the mobile build.
//! The frontend calls `invoke("plugin:TavernAr|command_name", args)` which
//! Tauri routes to the matching Kotlin @Command handler.

use tauri::plugin::{Builder, TauriPlugin};

/// Plugin identifier used by Tauri to match the Kotlin `ArPlugin`.
const PLUGIN_NAME: &str = "TavernAr";

/// Initialise and return the `tavern-ar` Tauri plugin.
pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new(PLUGIN_NAME)
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(
                "com.aitavern.plugin.ar",
                "ArPlugin",
            )?;
            Ok(())
        })
        .build()
}
