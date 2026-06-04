package com.aitavern.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.webkit.WebView
import android.view.ViewGroup
import android.view.View
import androidx.core.view.WindowCompat
import android.content.ContentValues
import android.provider.MediaStore
import android.os.Environment

class MainActivity : TauriActivity() {
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
    val savedIsDark = prefs.getBoolean(KEY_THEME_DARK, false)
    val savedColor = prefs.getString(KEY_THEME_COLOR, "#f5f0e8") ?: "#f5f0e8"
    applyStatusBar(savedIsDark, savedColor)

    val webView = findWebView(window.decorView)
    webView?.let {
      it.addJavascriptInterface(object {
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
      }, "AndroidThemeBridge")
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

  private fun findWebView(view: View): WebView? {
    if (view is WebView) {
      return view
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val child = view.getChildAt(i)
        val result = findWebView(child)
        if (result != null) {
          return result
        }
      }
    }
    return null
  }
}
