# Keep the Tauri Plugin entry point class; it is referenced by name from the
# Rust-generated plugin registration table and must not be renamed or removed.
-keep class com.aitavern.plugin.androidbridge.AndroidBridgePlugin { *; }

# Keep the JavascriptInterface bridge class and all its @JavascriptInterface
# annotated methods so they remain callable from the WebView JS context.
-keep class com.aitavern.plugin.androidbridge.AndroidThemeBridge {
    public *;
}

# Defensive: keep any class that exposes @JavascriptInterface methods.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
