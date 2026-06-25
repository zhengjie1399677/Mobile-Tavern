package com.aitavern.plugin.androidbridge

import android.webkit.WebView
import app.tauri.plugin.Plugin

/**
 * Tauri Android plugin entry point for the Mobile Tavern native bridge.
 *
 * Responsibilities:
 *  - Inject the [AndroidThemeBridge] JavascriptInterface into the WebView as
 *    the global `window.AndroidThemeBridge` object right after the WebView is
 *    created. This preserves the existing frontend call contract
 *    `(window as any).AndroidThemeBridge.*` without any frontend change.
 *  - Register a live WindowInsets listener on the WebView so that safe-area
 *    changes (keyboard, rotation, gesture insets) are dispatched to the
 *    frontend via the `androidSafeAreasChanged` CustomEvent, including the new
 *    `left` / `right` insets required by the extended contract.
 *
 * The plugin is wired up automatically by the Tauri mobile build pipeline
 * once it is registered on the Rust side via
 * `Builder::default().plugin(tauri_plugin_android_bridge::init())`.
 *
 * No Tauri commands are declared on the Kotlin side: every capability is
 * exposed synchronously through `@JavascriptInterface` methods so the
 * frontend's synchronous `bridge.saveFile(...)` / `bridge.getSafeAreas()`
 * calls keep working unchanged.
 */
class AndroidBridgePlugin : Plugin() {

    /**
     * Cached reference to the bridge instance so we can re-dispatch inset
     * updates to it from the WebView's WindowInsets listener.
     */
    private var themeBridge: AndroidThemeBridge? = null

    override fun onWebviewCreated(webView: WebView) {
        super.onWebviewCreated(webView)

        val activity = getActivity()
        val bridge = AndroidThemeBridge(activity, webView)
        themeBridge = bridge

        // Attach the bridge as a global JS object. The name MUST stay
        // "AndroidThemeBridge" to match the existing frontend contract.
        webView.addJavascriptInterface(bridge, "AndroidThemeBridge")

        // Install a live WindowInsets listener on the WebView so the frontend
        // receives `androidSafeAreasChanged` events whenever the system bars,
        // IME or display cutout insets change. This mirrors the behaviour of
        // the previous gen/android MainActivity implementation but also emits
        // the new left/right insets.
        webView.post {
            webView.setOnApplyWindowInsetsListener { view, insets ->
                bridge.dispatchSafeAreasChanged(view, insets)
                view.onApplyWindowInsets(insets)
            }
            webView.requestApplyInsets()
        }
    }
}
