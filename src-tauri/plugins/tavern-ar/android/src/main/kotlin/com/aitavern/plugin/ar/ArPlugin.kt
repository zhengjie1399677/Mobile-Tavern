package com.aitavern.plugin.ar

import android.app.Activity
import android.content.Intent
import android.util.Log
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Tauri plugin entry point for the AR feature.
 *
 * Exposes @Command methods for:
 *  - Checking ARCore availability
 *  - Launching/closing the full-screen ArActivity
 *  - Pushing character texture / render state / chat bubble updates to the active Activity
 *
 * All rendering happens in ArActivity + ArRenderer; this plugin is the IPC bridge.
 *
 * Activity ↔ Plugin 绑定方式：
 *   - Tauri 的 [app.tauri.plugin.PluginManager] 内部 `plugins` HashMap 是 private，
 *     无法从 ArActivity 通过 `getPlugin("TavernAr")` 获取本插件实例。
 *   - 改用 [instance] 静态引用：[load] 时赋值，[onDestroy] 时清除，
 *     ArActivity 通过 `ArPlugin.instance` 直接访问。
 *   - 这是 Tauri Android 生态中常见的 plugin ↔ Activity 通信模式，
 *     因为 plugin 生命周期与 MainActivity 绑定，ArActivity 是被启动的独立 Activity。
 */
@TauriPlugin(
    permissions = [
        Permission(strings = ["android.permission.CAMERA"], alias = "camera"),
    ]
)
class ArPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "ArPlugin"

        /**
         * 当前 ArPlugin 单例引用，由 ArActivity 在 onCreate 时通过 [registerArActivity]
         * 注册自身。ArActivity 关闭时通过 [unregisterArActivity] 清除。
         *
         * 注：此引用不是 plugin 单例本身（plugin 由 Tauri PluginManager 管理），
         * 而是当前活跃的 ArActivity 引用，让本插件能向前端推送更新。
         */
        @Volatile
        private var activeArActivity: ArActivity? = null

        /**
         * 全局 ArPlugin 单例引用，ArActivity 通过它在 onCreate 时调用
         * [registerArActivity] 把自己注册给插件。
         *
         * Tauri Plugin 生命周期与 MainActivity 绑定，[load] 在 WebView 创建后被调用，
         * 此时 plugin 实例已存在；[onDestroy] 时清除避免泄漏。
         */
        @Volatile
        internal var instance: ArPlugin? = null
    }

    override fun load(webView: WebView) {
        super.load(webView)
        instance = this
    }

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        activeArActivity = null
        instance = null
        super.onDestroy(activity)
    }

    @Deprecated("use onDestroy(activity: AppCompatActivity) instead")
    override fun onDestroy() {
        activeArActivity = null
        instance = null
        super.onDestroy()
    }

    /** Register an active ArActivity so we can push updates to it. */
    fun registerArActivity(arActivity: ArActivity) {
        activeArActivity = arActivity
    }

    /** Unregister the ArActivity when it's destroyed. */
    fun unregisterArActivity() {
        activeArActivity = null
    }

    /** Check whether ARCore is available and installed on this device. */
    @Command
    fun checkArAvailability(invoke: Invoke) {
        try {
            val availability = com.google.ar.core.ArCoreApk.getInstance().checkAvailability(activity)
            Log.i(TAG, "checkArAvailability: raw availability = $availability")
            val finalResult = when {
                availability.isTransient -> "unknown"
                availability == com.google.ar.core.ArCoreApk.Availability.SUPPORTED_INSTALLED -> "supported-installed"
                availability.isSupported -> "supported-not-installed"
                else -> "unsupported"
            }
            Log.i(TAG, "checkArAvailability: mapped final result = $finalResult")
            val ret = JSObject()
            ret.put("availability", finalResult)
            invoke.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "checkArAvailability failed", e)
            val ret = JSObject()
            ret.put("availability", "unknown")
            invoke.resolve(ret)
        }
    }

    /** Launch the full-screen AR Activity. */
    @Command
    fun launchAr(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                if (!hasCameraPermission()) {
                    // 通过 Tauri 标准权限请求流程：requestPermissionForAlias 需要
                    // invoke + callbackName，回调必须是 @ActivityCallback 注解的方法。
                    requestPermissionForAlias("camera", invoke, "onCameraPermissionResult")
                } else {
                    startArActivity()
                    invoke.resolve()
                }
            } catch (e: Exception) {
                Log.e(TAG, "launchAr failed", e)
                val ret = JSObject()
                ret.put("error", e.message ?: "unknown")
                invoke.resolve(ret)
            }
        }
    }

    /**
     * 相机权限请求回调。由 Tauri PluginManager 在权限请求完成后调用。
     * 必须使用 @ActivityCallback 注解，且方法签名匹配 Tauri 期望的回调契约。
     */
    @ActivityCallback
    fun onCameraPermissionResult(invoke: Invoke, grantResults: IntArray) {
        val granted = grantResults.isNotEmpty() && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
        activity.runOnUiThread {
            if (granted) {
                try {
                    startArActivity()
                    invoke.resolve()
                } catch (e: Exception) {
                    Log.e(TAG, "startArActivity after permission grant failed", e)
                    val ret = JSObject()
                    ret.put("error", e.message ?: "unknown")
                    invoke.resolve(ret)
                }
            } else {
                val ret = JSObject()
                ret.put("error", "camera_permission_denied")
                invoke.resolve(ret)
            }
        }
    }

    /** Close the AR Activity and return to the chat. */
    @Command
    fun closeAr(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                activeArActivity?.finish()
                invoke.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "closeAr failed", e)
                invoke.resolve()
            }
        }
    }

    /** Push an updated character texture (base64 PNG) to the active AR Activity. */
    @Command
    fun updateCharacterTexture(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateTextureArgs::class.java)
            activeArActivity?.updateCharacterTexture(args.base64)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "updateCharacterTexture failed", e)
            invoke.resolve()
        }
    }

    /** Push updated render state (emotion + glow colors) to the AR Activity. */
    @Command
    fun updateRenderState(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateRenderStateArgs::class.java)
            activeArActivity?.updateRenderState(args.emotion, args.light1, args.light2)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "updateRenderState failed", e)
            invoke.resolve()
        }
    }

    /** Push chat bubble text to the AR Activity. */
    @Command
    fun updateChatBubble(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateChatBubbleArgs::class.java)
            activeArActivity?.updateChatBubble(args.text)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "updateChatBubble failed", e)
            invoke.resolve()
        }
    }

    /**
     * 启用/禁用摄像头视觉手势识别（MediaPipe Hands）。
     * 启用后，AR Activity 会从相机帧检测手部关键点，识别抚摸/挥手/点击/捏合手势。
     * 手势事件通过 `ar-gesture` Tauri event 推送到前端。
     */
    @Command
    fun setGestureRecognition(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SetGestureRecognitionArgs::class.java)
            activeArActivity?.setGestureRecognitionEnabled(args.enabled)
            invoke.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "setGestureRecognition failed", e)
            invoke.resolve()
        }
    }

    /**
     * 检查手势识别是否就绪（模型加载完成）。
     * 返回 { ready: boolean }。
     */
    @Command
    fun checkGestureRecognitionReady(invoke: Invoke) {
        try {
            val ready = activeArActivity?.isGestureRecognitionReady() ?: false
            val ret = JSObject()
            ret.put("ready", ready)
            invoke.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "checkGestureRecognitionReady failed", e)
            val ret = JSObject()
            ret.put("ready", false)
            invoke.resolve(ret)
        }
    }

    /**
     * 由 ArActivity 调用，把手势事件通过 Tauri event 推送到前端。
     * 前端通过 `listen("ar-gesture")` 监听。
     */
    internal fun emitGestureEvent(event: GestureEvent) {
        try {
            val data = JSObject().apply {
                put("gesture", event.gesture.name)
                put("handCenterX", event.handCenterX.toDouble())
                put("handCenterY", event.handCenterY.toDouble())
                put("pinchDistance", event.pinchDistance.toDouble())
            }
            // Tauri plugin event：event 名为 "ar-gesture"，前端通过 listen("plugin:TavernAr://ar-gesture") 监听
            trigger("ar-gesture", data)
        } catch (e: Exception) {
            Log.w(TAG, "emitGestureEvent failed", e)
        }
    }

    // ─── Internal helpers ──────────────────────────────────────────────────

    private fun startArActivity() {
        val intent = Intent(activity, ArActivity::class.java)
        // FLAG_ACTIVITY_NEW_TASK：因为从 Plugin（非 Activity Context）启动
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            android.Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }
}

/** Parsed args for `update_character_texture`. */
@app.tauri.annotation.InvokeArg
data class UpdateTextureArgs(val base64: String)

/** Parsed args for `update_render_state`. */
@app.tauri.annotation.InvokeArg
data class UpdateRenderStateArgs(
    val emotion: String,
    val light1: String,
    val light2: String,
)

/** Parsed args for `update_chat_bubble`. */
@app.tauri.annotation.InvokeArg
data class UpdateChatBubbleArgs(val text: String)

/** Parsed args for `set_gesture_recognition`. */
@app.tauri.annotation.InvokeArg
data class SetGestureRecognitionArgs(val enabled: Boolean)
