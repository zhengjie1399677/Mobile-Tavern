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
  private var splashOverlay: FrameLayout? = null

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

    // Show native splash screen with logo for 1 second, then fade out
    val rootLayout = findViewById<ViewGroup>(android.R.id.content)
    if (rootLayout != null) {
      val splashView = FrameLayout(this).apply {
        layoutParams = ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
        setBackgroundColor(android.graphics.Color.parseColor("#0d1726"))
      }
      val logoView = ImageView(this).apply {
        val density = resources.displayMetrics.density
        val sizePx = (192 * density).toInt()
        val params = FrameLayout.LayoutParams(sizePx, sizePx).apply {
          gravity = Gravity.CENTER
        }
        layoutParams = params
        setImageResource(R.mipmap.ic_launcher)
      }
      splashView.addView(logoView)
      rootLayout.addView(splashView)
      this.splashOverlay = splashView

      splashView.postDelayed({
        splashView.animate()
          .alpha(0f)
          .setDuration(300)
          .withEndAction {
            rootLayout.removeView(splashView)
            if (this.splashOverlay == splashView) {
              this.splashOverlay = null
            }
          }
          .start()
      }, 1000)
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.appWebView = webView

    // Set WebView background color to match the theme background and prevent white flashes during load
    webView.setBackgroundColor(android.graphics.Color.parseColor("#0d1726"))

    // Bring the splash overlay to the front so it remains on top of the newly added WebView
    splashOverlay?.let {
      it.bringToFront()
      it.parent?.requestLayout()
    }

    webView.addJavascriptInterface(ThemeBridgeInterface(), "AndroidThemeBridge")
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
