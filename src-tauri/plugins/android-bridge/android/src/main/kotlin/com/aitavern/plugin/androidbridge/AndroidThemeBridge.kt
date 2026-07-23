package com.aitavern.plugin.androidbridge

import android.app.Activity
import android.app.Application
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.MediaStore
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.lang.ref.WeakReference
import java.util.Locale

/**
 * Native bridge injected into the WebView as `window.AndroidThemeBridge`.
 *
 * The class is referenced from the frontend through
 * `(window as any).AndroidThemeBridge` and exposes synchronous
 * `@JavascriptInterface` methods. The call contract (method names, argument
 * order, return types) MUST stay backwards compatible with the existing
 * frontend code in `src/contexts/AppContext.tsx`, `src/hooks/useCharacters.ts`,
 * `src/hooks/useSettings.ts` and `src/tabs/GlobalWorldbookTab.tsx`.
 *
 * Fixes applied compared to the previous gen/android implementation:
 *  - CR-01: `saveFile` / `saveFileBase64` now use the `MediaStore.Downloads`
 *    API on Android 10+ (API 29+), which works under Scoped Storage without
 *    requiring `WRITE_EXTERNAL_STORAGE`. The legacy
 *    `Environment.getExternalStoragePublicDirectory()` path is kept only as a
 *    best-effort fallback for Android 9 and below (minSdk = 24).
 *  - `saveFile` / `saveFileBase64` now return a String path (or an `error:`
 *    prefixed message) instead of `void`, matching what the frontend expects.
 *  - `getSafeAreas` now also reports `left` / `right` insets in addition to
 *    `top` / `bottom`.
 */
class AndroidThemeBridge(
    private val activity: Activity,
    private val webView: WebView,
) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private var ttsInitialized = false
    @Volatile
    private var awaitingStoragePermissionResult = false

    init {
        activeStorageBridge = WeakReference(this)

        // Initialize TTS on the main thread
        activity.runOnUiThread {
            try {
                tts = TextToSpeech(activity, this)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to instantiate TextToSpeech", e)
            }
        }

        // Register activity lifecycle callback to shutdown TTS and avoid memory leaks
        activity.application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityDestroyed(act: Activity) {
                if (act === activity) {
                    activity.runOnUiThread {
                        try {
                            tts?.shutdown()
                            tts = null
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to shutdown TextToSpeech", e)
                        }
                    }
                    activity.application.unregisterActivityLifecycleCallbacks(this)
                    if (activeStorageBridge?.get() === this@AndroidThemeBridge) {
                        activeStorageBridge = null
                    }
                }
            }

            override fun onActivityCreated(act: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(act: Activity) {}
            override fun onActivityResumed(act: Activity) {}
            override fun onActivityPaused(act: Activity) {}
            override fun onActivityStopped(act: Activity) {}
            override fun onActivitySaveInstanceState(act: Activity, outState: Bundle) {}
        })
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            ttsInitialized = true
            activity.runOnUiThread {
                try {
                    val result = tts?.setLanguage(Locale.CHINESE)
                    if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                        Log.w(TAG, "Chinese language is not supported or missing data in system TTS, falling back to default")
                        tts?.language = Locale.getDefault()
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to set TTS language on init", e)
                }
            }
        } else {
            Log.e(TAG, "TextToSpeech initialization failed with status: $status")
        }
    }

    @JavascriptInterface
    fun speakNative(text: String, rate: Float, pitch: Float): Boolean {
        val currentTts = tts
        if (currentTts == null || !ttsInitialized) {
            Log.w(TAG, "TTS not initialized yet")
            return false
        }
        activity.runOnUiThread {
            try {
                currentTts.stop()
                currentTts.setSpeechRate(rate)
                currentTts.setPitch(pitch)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    currentTts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "tavern_tts_utterance")
                } else {
                    @Suppress("DEPRECATION")
                    currentTts.speak(text, TextToSpeech.QUEUE_FLUSH, null)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error playing native TTS", e)
            }
        }
        return true
    }

    @JavascriptInterface
    fun stopNative() {
        activity.runOnUiThread {
            try {
                tts?.stop()
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping native TTS", e)
            }
        }
    }

    @JavascriptInterface
    fun isSpeakingNative(): Boolean {
        return tts?.isSpeaking ?: false
    }

    companion object {
        private const val TAG = "TavernThemeBridge"
        private const val MAX_SCAN_DEPTH = 12
        private const val MAX_SCANNED_FILES = 5_000
        private const val MAX_SCANNED_DIRECTORIES = 20_000
        private const val MAX_IMPORT_BYTES = 64L * 1024L * 1024L
        private var activeStorageBridge: WeakReference<AndroidThemeBridge>? = null

        /**
         * Public Download relative path used by the MediaStore. Files written
         * through this collection appear in the user-visible
         * `/Download/Mobile Tavern/` folder, which is consistent with the
         * user-facing messages emitted by the frontend.
         */
        private const val DOWNLOAD_RELATIVE_SUBDIR = "Download/Mobile Tavern/"

        /** 宿主 Activity 返回前台时同步“所有文件访问权限”的最终状态。 */
        @JvmStatic
        fun notifyStoragePermissionStateOnResume() {
            activeStorageBridge?.get()?.completeStoragePermissionRequestIfPending()
        }
    }

    // ---------------------------------------------------------------------
    // Safe areas
    // ---------------------------------------------------------------------

    /**
     * Return the current stable system-bar insets (status bar + navigation
     * bar) in density-independent pixels as a JSON string of the shape:
     *
     *   { "top": <dp>, "bottom": <dp>, "left": <dp>, "right": <dp> }
     *
     * The frontend parses this with `JSON.parse` and applies the values to
     * CSS custom properties. `left` / `right` are added by this version of
     * the bridge to support landscape / foldable layouts.
     *
     * The method is synchronous (called directly from JS), so it must not
     * perform any long-running or blocking work.
     */
    @JavascriptInterface
    fun getSafeAreas(): String {
        val json = JSONObject()
        val density = activity.resources.displayMetrics.density
        if (density <= 0f) {
            // Defensive fallback: should never happen on a real device.
            json.put("top", 0)
            json.put("bottom", 0)
            json.put("left", 0)
            json.put("right", 0)
            return json.toString()
        }

        // 1. Status bar height via the official system resource. This is the
        //    most reliable source on every API level and matches what the
        //    previous implementation used.
        val statusResourceId = activity.resources.getIdentifier(
            "status_bar_height", "dimen", "android"
        )
        val topPx = if (statusResourceId > 0) {
            activity.resources.getDimensionPixelSize(statusResourceId)
        } else {
            0
        }

        // 2. Navigation bar / system gestures insets via WindowInsetsCompat.
        //    We read from the root view's stable insets to avoid being
        //    affected by the IME (keyboard) which is handled separately by
        //    the WebView's adjustResize mode.
        var bottomPx = 0
        var leftPx = 0
        var rightPx = 0
        var insetsResolved = false

        val rootView = activity.window.decorView.rootView
        val rawInsets = rootView.rootWindowInsets
        if (rawInsets != null) {
            val compatInsets = WindowInsetsCompat.toWindowInsetsCompat(rawInsets, rootView)
            val systemBars = compatInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
            )
            bottomPx = systemBars.bottom
            leftPx = systemBars.left
            rightPx = systemBars.right
            insetsResolved = bottomPx != 0 || leftPx != 0 || rightPx != 0
        }

        // 3. Fallback for the bottom inset on devices where the WindowInsets
        //    are not yet available (very early in the layout pass). We compute
        //    the difference between the real and usable display height.
        if (!insetsResolved) {
            try {
                @Suppress("DEPRECATION")
                val display = activity.windowManager.defaultDisplay
                @Suppress("DEPRECATION")
                val realMetrics = android.util.DisplayMetrics()
                @Suppress("DEPRECATION")
                display.getRealMetrics(realMetrics)
                @Suppress("DEPRECATION")
                val displayMetrics = android.util.DisplayMetrics()
                @Suppress("DEPRECATION")
                display.getMetrics(displayMetrics)
                bottomPx = Math.max(0, realMetrics.heightPixels - displayMetrics.heightPixels)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to compute fallback bottom inset", e)
            }
        }

        val topDp = (topPx / density).toInt()
        val bottomDp = (bottomPx / density).toInt()
        val leftDp = (leftPx / density).toInt()
        val rightDp = (rightPx / density).toInt()

        json.put("top", topDp)
        json.put("bottom", bottomDp)
        json.put("left", leftDp)
        json.put("right", rightDp)
        return json.toString()
    }

    /**
     * Push the current safe-area insets into the frontend by dispatching a
     * `androidSafeAreasChanged` CustomEvent on `window`. Called from the
     * WebView's `OnApplyWindowInsetsListener` installed by
     * [AndroidBridgePlugin].
     */
    fun dispatchSafeAreasChanged(view: View, insets: android.view.WindowInsets) {
        val density = activity.resources.displayMetrics.density
        if (density <= 0f) return

        val compatInsets = WindowInsetsCompat.toWindowInsetsCompat(insets, view)
        val systemBars = compatInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() or
                WindowInsetsCompat.Type.displayCutout()
        )

        val statusResourceId = activity.resources.getIdentifier(
            "status_bar_height", "dimen", "android"
        )
        val topPx = if (statusResourceId > 0) {
            activity.resources.getDimensionPixelSize(statusResourceId)
        } else {
            systemBars.top
        }

        val topDp = (topPx / density).toInt()
        val bottomDp = (systemBars.bottom / density).toInt()
        val leftDp = (systemBars.left / density).toInt()
        val rightDp = (systemBars.right / density).toInt()

        Log.d(
            TAG,
            "onApplyWindowInsets: topDp=$topDp, bottomDp=$bottomDp, leftDp=$leftDp, rightDp=$rightDp"
        )

        // The WebView padding is left at zero: the host app already configures
        // `android:windowSoftInputMode="adjustResize"` and applies its own
        // CSS safe-area insets, so adding padding here would double-shrink
        // the layout.
        view.setPadding(0, 0, 0, 0)

        val js = (
            "window.dispatchEvent(new CustomEvent('androidSafeAreasChanged', " +
                "{ detail: { top: $topDp, bottom: $bottomDp, left: $leftDp, right: $rightDp } }));"
            )
        webView.post {
            webView.evaluateJavascript(js, null)
        }
    }

    // ---------------------------------------------------------------------
    // Input method (IME) diagnostics
    // ---------------------------------------------------------------------

    /**
     * 返回当前系统默认输入法的诊断信息，用于排查"键盘遮挡输入框"等兼容性问题。
     *
     * 返回 JSON 结构：
     *   {
     *     "id": "com.sohu.inputmethod.sogou/.SogouIME",
     *     "package": "com.sohu.inputmethod.sogou",
     *     "label": "搜狗输入法",
     *     "is_system": false,
     *     "enabled_count": 3
     *   }
     *
     * 实现策略：
     *  1. 读取 Settings.Secure.DEFAULT_INPUT_METHOD 获取当前 IME 的 component flatten
     *  2. 通过 InputMethodManager.enabledInputMethodList 匹配并加载 label（不受包可见性限制）
     *  3. label 加载失败时回落到内置常见 IME 包名映射表，再回落到原始包名
     */
    @JavascriptInterface
    fun getActiveInputMethod(): String {
        val json = JSONObject()
        try {
            val imeId = Settings.Secure.getString(
                activity.contentResolver,
                Settings.Secure.DEFAULT_INPUT_METHOD
            ) ?: ""
            json.put("id", imeId)
            val pkg = imeId.substringBefore("/", "")
            json.put("package", pkg)

            val imm = activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)
                as? android.view.inputmethod.InputMethodManager
            val enabledList = imm?.enabledInputMethodList ?: emptyList()
            json.put("enabled_count", enabledList.size)

            val currentMethodInfo = enabledList.firstOrNull { it.id == imeId }
            val label = currentMethodInfo?.loadLabel(activity.packageManager)?.toString()
                ?: knownImeLabel(pkg)
                ?: pkg.ifEmpty { "(unknown)" }
            json.put("label", label)

            val systemImePrefixes = listOf(
                "com.android.inputmethod",
                "com.google.android.inputmethod",
                "com.samsung.android.inputmethod",
                "com.huawei.android.inputmethod",
                "com.miui.inputmethod"
            )
            json.put("is_system", systemImePrefixes.any { pkg.startsWith(it) })
        } catch (e: Exception) {
            Log.e(TAG, "Failed to query active input method", e)
            json.put("error", e.message ?: "Unknown error")
        }
        return json.toString()
    }

    /**
     * 常见第三方输入法包名到中文名称的映射，作为 [getActiveInputMethod] 在
     * InputMethodInfo.loadLabel 失败时的回落。仅覆盖主流中文输入法。
     */
    private fun knownImeLabel(pkg: String): String? {
        val p = pkg.lowercase(Locale.ROOT)
        return when {
            p.contains("sogou") -> "搜狗输入法"
            p.contains("baidu") -> "百度输入法"
            p.contains("iflytek") || p.contains("flyime") -> "讯飞输入法"
            p.contains("qq") && p.contains("inputmethod") -> "QQ输入法"
            p.contains("wetype") || p.contains("tencent.wetype") -> "微信输入法"
            p.contains("huawei") && p.contains("inputmethod") -> "华为输入法"
            p.contains("miui") || p.contains("xiaomi") -> "小米输入法"
            p.contains("samsung") && p.contains("inputmethod") -> "三星输入法"
            p.contains("google") && p.contains("inputmethod") -> "Gboard"
            p.contains("kika") -> "Kika键盘"
            p.contains("touchpal") -> "触宝输入法"
            p.contains("gboard") -> "Gboard"
            else -> null
        }
    }

    // ---------------------------------------------------------------------
    // Status bar styling
    // ---------------------------------------------------------------------

    /**
     * Update the system status bar (and navigation bar) background colour and
     * icon appearance.
     *
     * @param isDark when `true` the status bar icons are forced to be light
     *     (white) so they remain visible on dark backgrounds; when `false` the
     *     icons are forced to be dark (black).
     * @param colorHex the desired status bar background colour, e.g.
     *     `"#1a2040"`. Parsed via [Color.parseColor].
     */
    @JavascriptInterface
    fun setStatusBarStyle(isDark: Boolean, colorHex: String) {
        activity.runOnUiThread {
            try {
                val window = activity.window
                val color = Color.parseColor(colorHex)
                window.statusBarColor = color
                window.navigationBarColor = color

                val decorView = window.decorView
                val wic = WindowInsetsControllerCompat(window, decorView)
                // isAppearanceLightStatusBars = true  -> dark icons
                // isAppearanceLightStatusBars = false -> light icons
                // The frontend passes isDark = true for dark themes, which
                // means we want LIGHT (white) icons, i.e. false here.
                wic.isAppearanceLightStatusBars = !isDark
                wic.isAppearanceLightNavigationBars = !isDark
            } catch (e: Exception) {
                Log.e(TAG, "Failed to set status bar style", e)
            }
        }
    }

    /**
     * Lock the Activity to a sensor-aware landscape orientation, or return
     * orientation control to the manifest and system auto-rotate setting.
     *
     * @return `false` when [mode] is unsupported; otherwise `true` once the
     *     request has been accepted for dispatch on the Android UI thread.
     */
    @JavascriptInterface
    fun setScreenOrientation(mode: String): Boolean {
        val requestedOrientation = when (mode) {
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            "auto" -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            else -> {
                Log.w(TAG, "Unsupported screen orientation mode: $mode")
                return false
            }
        }

        activity.runOnUiThread {
            try {
                activity.requestedOrientation = requestedOrientation
            } catch (e: Exception) {
                Log.e(TAG, "Failed to set screen orientation: $mode", e)
            }
        }
        return true
    }

    /**
     * Enter or leave Android immersive mode for trusted host-owned full-screen surfaces.
     * System bars remain temporarily revealable with an edge swipe.
     */
    @JavascriptInterface
    fun setImmersiveMode(enabled: Boolean): Boolean {
        activity.runOnUiThread {
            try {
                val window = activity.window
                val controller = WindowInsetsControllerCompat(window, window.decorView)
                if (enabled) {
                    controller.systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    controller.hide(WindowInsetsCompat.Type.systemBars())
                } else {
                    controller.show(WindowInsetsCompat.Type.systemBars())
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update immersive mode: $enabled", e)
            }
        }
        return true
    }

    /** Emits bounded host-side diagnostics for full-screen plugin troubleshooting. */
    @JavascriptInterface
    fun logPluginDiagnostic(message: String) {
        Log.i("TavernPlugin", message.take(500))
    }

    /** Open the Android system share sheet with plain or JSON text content. */
    @JavascriptInterface
    fun shareText(title: String, text: String, mimeType: String): Boolean {
        if (text.isBlank()) return false
        activity.runOnUiThread {
            try {
                val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = mimeType.ifBlank { "text/plain" }
                    putExtra(android.content.Intent.EXTRA_SUBJECT, title)
                    putExtra(android.content.Intent.EXTRA_TEXT, text)
                }
                activity.startActivity(android.content.Intent.createChooser(intent, title))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to share text", e)
            }
        }
        return true
    }

    /**
     * Open a URL in the system default browser.
     */
    @JavascriptInterface
    fun openUrl(url: String) {
        activity.runOnUiThread {
            try {
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to open URL: $url", e)
                Toast.makeText(activity, "无法打开链接: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    // ---------------------------------------------------------------------
    // File saving (CR-01: MediaStore API)
    // ---------------------------------------------------------------------

    /**
     * Persist a UTF-8 text file (e.g. JSON character card, preset profile or
     * backup) into the public Download directory.
     *
     * @param fileName target file name, e.g. `"Character_ST_Card.json"`.
     * @param content  raw text content to write.
     * @return the absolute display path of the saved file (e.g.
     *     `"Download/Mobile Tavern/Character_ST_Card.json"`) on success, or a
     *     string prefixed with `"error:"` describing the failure.
     */
    @JavascriptInterface
    fun saveFile(fileName: String, content: String): String {
        return writeBytesToDownloads(
            fileName = sanitizeFileName(fileName),
            bytes = content.toByteArray(Charsets.UTF_8),
            mimeType = guessMimeType(fileName)
        )
    }

    /**
     * Persist a binary file (e.g. a PNG character card) into the public
     * Download directory.
     *
     * @param fileName   target file name, e.g. `"Character_SillyTavern.png"`.
     * @param base64Data  base64-encoded payload. A leading `data:...;base64,`
     *     prefix is tolerated and stripped automatically.
     * @param mimeType   MIME type for the MediaStore entry, e.g.
     *     `"image/png"`.
     * @return the absolute display path of the saved file on success, or a
     *     string prefixed with `"error:"` describing the failure.
     */
    @JavascriptInterface
    fun saveFileBase64(fileName: String, base64Data: String, mimeType: String): String {
        val cleanBase64 = if (base64Data.contains(",")) {
            base64Data.substringAfter(",")
        } else {
            base64Data
        }
        return try {
            val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
            writeBytesToDownloads(
                fileName = sanitizeFileName(fileName),
                bytes = bytes,
                mimeType = if (mimeType.isBlank()) guessMimeType(fileName) else mimeType
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode base64 payload for $fileName", e)
            "error:Failed to decode base64 payload: ${e.message}"
        }
    }

    /**
     * Shared implementation for [saveFile] / [saveFileBase64].
     *
     * On Android 10+ (API 29+) the file is written through
     * `MediaStore.Downloads`, which is permitted under Scoped Storage
     * without any storage permission. On Android 9 and below we fall back to
     * the legacy public Downloads directory; if that fails (e.g. because the
     * app does not hold `WRITE_EXTERNAL_STORAGE`) we surface a clear error
     * string to the user.
     */
    private fun writeBytesToDownloads(
        fileName: String,
        bytes: ByteArray,
        mimeType: String,
    ): String {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveViaMediaStore(fileName, bytes, mimeType)
            } else {
                saveViaLegacyPublicDirectory(fileName, bytes)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save file $fileName", e)
            "error:${e.message ?: "Unknown save error"}"
        }
    }

    /**
     * Android 10+ (API 29+) implementation using `MediaStore.Downloads`.
     *
     * No storage permission is required because the Download collection is
     * explicitly exempted from the Scoped Storage write restrictions.
     */
    private fun saveViaMediaStore(
        fileName: String,
        bytes: ByteArray,
        mimeType: String,
    ): String {
        val resolver = activity.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            // RELATIVE_PATH is only available on API 29+; we are already
            // inside the Build.VERSION.SDK_INT >= Q branch.
            put(MediaStore.MediaColumns.RELATIVE_PATH, DOWNLOAD_RELATIVE_SUBDIR)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Mark the file as pending so it is not visible to other apps
                // until we finish writing it.
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }

        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val uri: Uri = resolver.insert(collection, values)
            ?: return "error:Failed to create MediaStore entry for $fileName"

        try {
            resolver.openOutputStream(uri, "w")?.use { os: OutputStream ->
                os.write(bytes)
                os.flush()
            } ?: return "error:Failed to open output stream for $fileName"
        } catch (e: Exception) {
            // Best-effort cleanup of the half-written entry so we do not leave
            // empty files behind in the user's Download folder.
            runCatching { resolver.delete(uri, null, null) }
            throw e
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        }

        val displayPath = DOWNLOAD_RELATIVE_SUBDIR + fileName
        notifyUserSaved(displayPath)
        return displayPath
    }

    /**
     * Android 9 and below (API 24-28) fallback using the legacy
     * `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS)`.
     *
     * This path requires `WRITE_EXTERNAL_STORAGE` on API 23-28, which the host
     * app does not declare. The call will therefore fail gracefully on those
     * devices and surface an `error:` message to the user. This is acceptable
     * because the production target audience is on Android 10+.
     */
    private fun saveViaLegacyPublicDirectory(fileName: String, bytes: ByteArray): String {
        @Suppress("DEPRECATION", "UNUSED_VARIABLE")
        val deprecated = Environment.getExternalStoragePublicDirectory(
            Environment.DIRECTORY_DOWNLOADS
        )
        val downloadDir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "Mobile Tavern"
        )
        if (!downloadDir.exists() && !downloadDir.mkdirs()) {
            return "error:Failed to create Download/Mobile Tavern directory"
        }
        val file = File(downloadDir, fileName)
        FileOutputStream(file).use { fos ->
            fos.write(bytes)
            fos.flush()
        }
        val displayPath = "Download/Mobile Tavern/$fileName"
        notifyUserSaved(displayPath)
        return displayPath
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /**
     * Strip path separators from [fileName] so a malicious or malformed name
     * cannot escape the target Download subdirectory.
     */
    private fun sanitizeFileName(fileName: String): String {
        val trimmed = fileName.trim()
        if (trimmed.isEmpty()) return "export.bin"
        return trimmed.replace(Regex("[\\\\/]"), "_")
    }

    /**
     * Infer a reasonable MIME type from the file extension when the caller does
     * not provide one (e.g. the text [saveFile] path).
     */
    private fun guessMimeType(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "json" -> "application/json"
            "txt" -> "text/plain"
            "backup" -> "application/octet-stream"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "csv" -> "text/csv"
            else -> "application/octet-stream"
        }
    }

    /**
     * Show a Toast confirming the save location. Mirrors the previous
     * implementation's behaviour so users still get the on-device
     * confirmation in addition to the in-app alert.
     */
    private fun notifyUserSaved(displayPath: String) {
        activity.runOnUiThread {
            Toast.makeText(
                activity,
                "文件已成功保存到手机 /$displayPath",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    // ---------------------------------------------------------------------
    // Global Character Card Scanner & Reader
    // ---------------------------------------------------------------------

    private fun dispatchStoragePermissionResult(granted: Boolean) {
        webView.post {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('androidStoragePermissionResult', { detail: { granted: $granted } }));",
                null
            )
        }
    }

    private fun completeStoragePermissionRequestIfPending() {
        if (!awaitingStoragePermissionResult) return
        awaitingStoragePermissionResult = false
        dispatchStoragePermissionResult(hasStoragePermission())
    }

    @JavascriptInterface
    fun hasStoragePermission(): Boolean {
        return Environment.isExternalStorageManager()
    }

    @JavascriptInterface
    fun requestStoragePermission() {
        if (hasStoragePermission()) {
            dispatchStoragePermissionResult(true)
            return
        }

        awaitingStoragePermissionResult = true
        activity.runOnUiThread {
            val appPermissionIntent = Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:${activity.packageName}")
            )
            val opened = runCatching {
                activity.startActivity(appPermissionIntent)
            }.recoverCatching {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }.isSuccess

            if (!opened) {
                awaitingStoragePermissionResult = false
                Log.e(TAG, "Failed to open all-files access settings")
                dispatchStoragePermissionResult(false)
            }
        }
    }

    @JavascriptInterface
    fun scanGlobalCards(): String {
        val result = org.json.JSONArray()
        if (!hasStoragePermission()) return result.toString()
        val scanBudget = ScanBudget()
        scanRoots().forEach { root ->
            if (root.exists() && root.isDirectory) {
                scanDir(root, result, 0, scanBudget)
            }
        }
        return result.toString()
    }

    private class ScanBudget {
        val visitedDirectories = HashSet<String>()
    }

    private fun scanRoots(): List<File> {
        val storageManager = activity.getSystemService(StorageManager::class.java)
        return (listOf(Environment.getExternalStorageDirectory()) +
            storageManager.storageVolumes.mapNotNull { it.directory })
            .mapNotNull { runCatching { it.canonicalFile }.getOrNull() }
            .distinctBy { it.path }
    }

    private fun scanDir(
        directory: File,
        array: org.json.JSONArray,
        depth: Int,
        budget: ScanBudget,
    ) {
        if (depth > MAX_SCAN_DEPTH || array.length() >= MAX_SCANNED_FILES) return
        val canonicalPath = runCatching { directory.canonicalPath }.getOrNull() ?: return
        if (!budget.visitedDirectories.add(canonicalPath) ||
            budget.visitedDirectories.size > MAX_SCANNED_DIRECTORIES
        ) return
        val children = directory.listFiles() ?: return
        for (file in children) {
            if (array.length() >= MAX_SCANNED_FILES) return
            if (file.isDirectory) {
                if (!shouldSkipDirectory(file)) {
                    scanDir(file, array, depth + 1, budget)
                }
            } else {
                val name = file.name.lowercase(Locale.ROOT)
                if (name.endsWith(".json") || name.endsWith(".png")) {
                    val obj = JSONObject()
                    obj.put("name", file.name)
                    obj.put("path", file.absolutePath)
                    obj.put("size", file.length())
                    obj.put("lastModified", file.lastModified())
                    array.put(obj)
                }
            }
        }
    }

    private fun shouldSkipDirectory(directory: File): Boolean {
        if (directory.name.startsWith(".") || directory.name.equals("LOST.DIR", ignoreCase = true)) {
            return true
        }
        val parentName = directory.parentFile?.name ?: return false
        return parentName.equals("Android", ignoreCase = true) &&
            (directory.name.equals("data", ignoreCase = true) ||
                directory.name.equals("obb", ignoreCase = true))
    }

    private fun isBlockedAndroidPrivatePath(file: File): Boolean {
        return scanRoots().any { root ->
            val relative = runCatching { file.relativeTo(root).invariantSeparatorsPath }.getOrNull()
                ?: return@any false
            val segments = relative.split('/')
            val androidIndex = segments.indexOfFirst { it.equals("Android", ignoreCase = true) }
            val privateArea = segments.getOrNull(androidIndex + 1)
            androidIndex >= 0 &&
                (privateArea.equals("data", ignoreCase = true) ||
                    privateArea.equals("obb", ignoreCase = true))
        }
    }

    private fun isInsideScanRoots(file: File): Boolean {
        val filePath = file.canonicalFile.path
        return !isBlockedAndroidPrivatePath(file) && scanRoots().any { root ->
            val rootPath = root.canonicalFile.path
            filePath == rootPath || filePath.startsWith(rootPath + File.separator)
        }
    }

    @JavascriptInterface
    fun readLocalFile(path: String): String {
        return try {
            if (!hasStoragePermission()) return "error:Storage permission not granted"
            val file = File(path).canonicalFile
            val extension = file.extension.lowercase(Locale.ROOT)
            if (!isInsideScanRoots(file) || extension !in setOf("json", "png")) {
                return "error:Unsupported local file path"
            }
            if (!file.exists() || !file.isFile) return "error:File not found"
            if (file.length() > MAX_IMPORT_BYTES) return "error:File is too large"
            val bytes = file.readBytes()
            if (extension == "png") {
                val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                "data:image/png;base64,$base64"
            } else {
                String(bytes, Charsets.UTF_8)
            }
        } catch (e: Exception) {
            "error:${e.message}"
        }
    }
}
