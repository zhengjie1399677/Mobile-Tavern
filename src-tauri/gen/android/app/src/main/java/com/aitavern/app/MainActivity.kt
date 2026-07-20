package com.aitavern.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.webkit.WebView
import android.view.ViewGroup
import android.view.View
import androidx.core.view.WindowCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import android.content.ContentValues
import android.provider.MediaStore
import android.os.Environment
import android.widget.FrameLayout
import android.widget.ImageView
import android.view.Gravity

class MainActivity : TauriActivity() {
  private var appWebView: WebView? = null


  companion object {
    private const val PREFS_NAME = "AppThemePrefs"
    private const val KEY_THEME_DARK = "isDark"
    private const val KEY_THEME_COLOR = "themeColor"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Apply saved status bar style immediately on launch (before JS bridge is ready)
    val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
    val savedIsDark = prefs.getBoolean(KEY_THEME_DARK, true)
    val savedColor = prefs.getString(KEY_THEME_COLOR, "#15171e") ?: "#15171e"
    applyStatusBar(savedIsDark, savedColor)

    // Listen for window inset changes (e.g. orientation changes, navigation bar toggles)
    val decorView = window.decorView
    ViewCompat.setOnApplyWindowInsetsListener(decorView) { view, windowInsets ->
      val statusBarHeight = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars()).top
      val navigationBarHeight = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      
      val density = view.resources.displayMetrics.density
      val statusBarDp = statusBarHeight / density
      val navigationBarDp = navigationBarHeight / density

      appWebView?.let { webView ->
        webView.post {
          webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('androidSafeAreasChanged', { detail: { top: $statusBarDp, bottom: $navigationBarDp } }));",
            null
          )
        }
      }

      windowInsets
    }


  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.appWebView = webView

    // Set WebView background color to match the theme background and prevent white flashes during load
    webView.setBackgroundColor(android.graphics.Color.parseColor("#0d1726"))

    // 注意：`window.AndroidThemeBridge` JavascriptInterface 由 Tauri 插件
    // `tauri_plugin_android_bridge` 在 `AndroidBridgePlugin#load` 中统一注入
    // （见 src-tauri/plugins/android-bridge/android/.../AndroidBridgePlugin.kt）。
    //
    // 此前此处曾调用 `webView.addJavascriptInterface(ThemeBridgeInterface(), "AndroidThemeBridge")`
    // 用一个仅暴露 4 个方法的内部类覆盖了插件注入的完整 `AndroidThemeBridge` 对象，
    // 导致 `hasStoragePermission / scanGlobalCards / requestStoragePermission / readLocalFile`
    // 等方法在 JS 端不可见，抛出 `C.hasStoragePermission is not a function`。
    //
    // `AndroidThemeBridge` 类已是 `ThemeBridgeInterface` 的严格超集（同样实现
    // getSafeAreas / setStatusBarStyle / saveFile / saveFileBase64，且采用 MediaStore API
    // 而非已废弃的 WRITE_EXTERNAL_STORAGE 路径），因此无需再在 MainActivity 内重复注入。
  }

  inner class ThemeBridgeInterface {
    @android.webkit.JavascriptInterface
    fun getSafeAreas(): String {
      val decorView = window.decorView
      val insets = ViewCompat.getRootWindowInsets(decorView)
      var statusBarDp = 0f
      var navigationBarDp = 0f
      if (insets != null) {
        val statusBarHeight = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
        val navigationBarHeight = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
        val density = decorView.resources.displayMetrics.density
        statusBarDp = statusBarHeight / density
        navigationBarDp = navigationBarHeight / density
      }
      return "{\"top\": $statusBarDp, \"bottom\": $navigationBarDp}"
    }

    @android.webkit.JavascriptInterface
    fun setStatusBarStyle(dark: Boolean, colorHex: String) {
      // Persist so next cold start reads the correct theme
      getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_THEME_DARK, dark)
        .putString(KEY_THEME_COLOR, colorHex)
        .apply()

      runOnUiThread { applyStatusBar(dark, colorHex) }
    }

    @android.webkit.JavascriptInterface
    fun saveFile(fileName: String, content: String): String {
      try {
        val resolver = contentResolver
        val contentValues = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
          put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
          put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
        if (uri != null) {
          val outputStream = resolver.openOutputStream(uri)
          outputStream?.use { stream ->
            stream.write(content.toByteArray())
          }
          return "内部存储/Download/" + fileName
        }
      } catch (e: Exception) {
        e.printStackTrace()
        return "error: " + e.message
      }
      return "error: Failed to create file"
    }

    @android.webkit.JavascriptInterface
    fun saveFileBase64(fileName: String, base64Content: String, mimeType: String): String {
      try {
        val bytes = android.util.Base64.decode(base64Content, android.util.Base64.DEFAULT)
        val resolver = contentResolver
        val contentValues = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
          put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
          put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
        if (uri != null) {
          val outputStream = resolver.openOutputStream(uri)
          outputStream?.use { stream ->
            stream.write(bytes)
          }
          return "内部存储/Download/" + fileName
        }
      } catch (e: Exception) {
        e.printStackTrace()
        return "error: " + e.message
      }
      return "error: Failed to create file"
    }
  }

  private fun applyStatusBar(isDark: Boolean, colorHex: String) {
    try {
      window.statusBarColor = android.graphics.Color.parseColor(colorHex)
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = !isDark
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }
}
