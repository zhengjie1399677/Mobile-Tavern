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
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val webView = findWebView(window.decorView)
    webView?.let {
      it.addJavascriptInterface(object {
        @android.webkit.JavascriptInterface
        fun setStatusBarStyle(dark: Boolean, colorHex: String) {
          runOnUiThread {
            try {
              window.statusBarColor = android.graphics.Color.parseColor(colorHex)
              val windowInsetsController = WindowCompat.getInsetsController(window, window.decorView)
              windowInsetsController.isAppearanceLightStatusBars = !dark
            } catch (e: Exception) {
              e.printStackTrace()
            }
          }
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

