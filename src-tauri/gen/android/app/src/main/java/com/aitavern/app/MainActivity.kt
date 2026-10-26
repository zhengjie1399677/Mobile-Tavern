package com.aitavern.app

import android.os.Bundle
import android.os.SystemClock
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import com.aitavern.plugin.androidbridge.AndroidThemeBridge

class MainActivity : TauriActivity() {
  private var appWebView: WebView? = null
  private var lastBackPressedAt = 0L


  companion object {
    private const val PREFS_NAME = "AppThemePrefs"
    private const val KEY_THEME_DARK = "isDark"
    private const val KEY_THEME_COLOR = "themeColor"
    private const val BACK_EXIT_INTERVAL_MS = 2_000L
    private const val BRAND_SPLASH_COLOR = "#01091c"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 冷启动阶段固定使用品牌色；Web 首帧就绪后再恢复用户主题，避免系统 Splash 与 WebView 跳色。
    applyStatusBar(true, BRAND_SPLASH_COLOR)

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = appWebView
        if (webView == null) {
          handleUnconsumedBackPress()
          return
        }
        webView.evaluateJavascript(
          "(function(){try{return window.__mobileTavernHandleBack?.()===true;}catch(e){return false;}})();"
        ) { consumed ->
          if (consumed == "true") {
            lastBackPressedAt = 0L
          } else {
            handleUnconsumedBackPress()
          }
        }
      }
    })

    // 安全区域及软键盘 (IME) 避让内边距由 Tauri Android 插件 `AndroidBridgePlugin` 统一在
    // WebView 上监听并调度（见 AndroidThemeBridge.dispatchSafeAreasChanged），
    // 避免 decorView 与 webView 两个 listener 同时派发相互冲突的 androidSafeAreasChanged 事件。
  }

  private fun handleUnconsumedBackPress() {
    val now = SystemClock.elapsedRealtime()
    if (now - lastBackPressedAt <= BACK_EXIT_INTERVAL_MS) {
      finishAffinity()
      return
    }
    lastBackPressedAt = now
    Toast.makeText(
      this,
      getString(R.string.press_back_again_to_exit),
      Toast.LENGTH_SHORT
    ).show()
  }

  override fun onResume() {
    super.onResume()
    AndroidThemeBridge.notifyStoragePermissionStateOnResume()
    ViewCompat.requestApplyInsets(window.decorView)
    appWebView?.post {
      appWebView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('mobileTavernNativeResume'));",
        null
      )
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.appWebView = webView

    // Set WebView background color to match the theme background and prevent white flashes during load
    webView.setBackgroundColor(android.graphics.Color.parseColor(BRAND_SPLASH_COLOR))

    // 注意：`window.AndroidThemeBridge` JavascriptInterface 由 Tauri 插件
    // `tauri_plugin_android_bridge` 在 `AndroidBridgePlugin#load` 中统一注入
    // （见 src-tauri/plugins/android-bridge/android/.../AndroidBridgePlugin.kt）。
    //
    // 此前此处曾调用 `webView.addJavascriptInterface(ThemeBridgeInterface(), "AndroidThemeBridge")`
    // 用一个仅暴露 4 个方法的内部类覆盖了插件注入的完整 `AndroidThemeBridge` 对象，
    // 导致 `hasStoragePermission / scanGlobalCards / requestStoragePermission / readLocalFile`
    // 等方法在 JS 端不可见，抛出 `C.hasStoragePermission is not a function`。
    //
    // `AndroidThemeBridge` 类已是原有接口的严格超集（实现 getSafeAreas / setStatusBarStyle /
    // saveFile / saveFileBase64 以及文件权限扫描等能力，采用 MediaStore API），
    // 统一由 AndroidBridgePlugin 注入，无需在 MainActivity 内重复实现。
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
