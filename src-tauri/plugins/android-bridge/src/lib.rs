//! Tauri plugin that bridges the Mobile Tavern frontend with native Android
//! capabilities (safe-area insets, status-bar styling, screen orientation,
//! text sharing and public Download file saving via the MediaStore API).
//!
//! The frontend keeps calling `(window as any).AndroidThemeBridge.*` exactly
//! as before; this plugin simply makes sure that object is injected into the
//! WebView by the Kotlin side (`AndroidBridgePlugin#onWebviewCreated`) so the
//! existing call contract is preserved without any frontend change.
//!
//! All real work happens on the Kotlin side; the Rust entry point only
//! registers the plugin so Tauri wires it into the mobile build pipeline.

use tauri::plugin::{Builder, TauriPlugin};

/// Plugin identifier used by Tauri to match the Kotlin `AndroidBridgePlugin`.
const PLUGIN_NAME: &str = "AndroidBridge";

/// Initialise and return the `android-bridge` Tauri plugin.
///
/// The plugin has no Rust-side commands: every capability is exposed
/// synchronously through the `@JavascriptInterface`-annotated methods on the
/// Kotlin `AndroidThemeBridge` class, which is attached to the WebView as the
/// global `window.AndroidThemeBridge` object.
pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new(PLUGIN_NAME)
        .setup(|_app, _api| {
            // Android libraries are linked during the mobile build, but the
            // Kotlin Plugin is only instantiated after this explicit runtime
            // registration. Without it, `load(WebView)` never runs and the
            // JavascriptInterface remains absent from `window`.
            #[cfg(target_os = "android")]
            _api.register_android_plugin(
                "com.aitavern.plugin.androidbridge",
                "AndroidBridgePlugin",
            )?;

            Ok(())
        })
        .build()
}
