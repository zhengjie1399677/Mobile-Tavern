package com.aitavern.plugin.ar

import android.app.Activity
import android.content.pm.PackageManager
import android.media.Image
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableApkTooOldException
import com.google.ar.core.exceptions.UnavailableArcoreNotInstalledException
import com.google.ar.core.exceptions.UnavailableDeviceNotCompatibleException
import com.google.ar.core.exceptions.UnavailableSdkTooOldException
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * 全屏 AR Activity：承载 GLSurfaceView + ARCore Session。
 *
 * 生命周期：
 *   - onCreate: 创建 GLSurfaceView + ArRenderer，注册到 ArPlugin
 *   - onResume: 请求 ARCore 安装 → 创建/恢复 Session → 配置平面检测 + 深度
 *   - onPause: 暂停 Session（释放相机）
 *   - onDestroy: 销毁 Session，从 ArPlugin 注销
 *
 * 触控手势（顺手补上）：
 *   - 单击：hit-test 平面，放置/移动角色锚点
 *   - 双指缩放：调整角色立牌大小
 *   - 拖拽：平移角色锚点（重新 hit-test）
 */
class ArActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "ArActivity"
        private const val CAMERA_PERMISSION_REQUEST = 3001
    }

    private var glSurfaceView: GLSurfaceView? = null
    private var renderer: ArRenderer? = null
    private var session: Session? = null

    /** ARCore 安装请求状态，避免重复弹窗。 */
    private var installRequested = false

    /** 缩放手势检测器。 */
    private var scaleDetector: ScaleGestureDetector? = null

    /** 手势识别检测器（MediaPipe Hands）。 */
    private var gestureDetector: HandGestureDetector? = null

    /** 手势识别后台线程（避免阻塞 GL 线程）。 */
    private var gestureThread: HandlerThread? = null
    private var gestureHandler: Handler? = null

    /** 手势识别是否已启用（由前端通过 IPC 控制）。 */
    @Volatile
    private var gestureRecognitionEnabled = false

    private val mainHandler = Handler(android.os.Looper.getMainLooper())
    private var arCheckRetries = 0

    // ─── 生命周期 ──────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 全屏沉浸式
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        renderer = ArRenderer(this)
        glSurfaceView = GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            setRenderer(renderer)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }
        // 把 GLSurfaceView 引用注入 renderer，让主线程的纹理更新可以
        // 通过 requestRender 触发 GL 线程消费 pending 队列。
        renderer?.attachGlView(glSurfaceView!!)
        setContentView(glSurfaceView)

        // 缩放手势
        scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                renderer?.scaleCharacter(detector.scaleFactor)
                return true
            }
        })

        // 初始化手势识别后台线程 + HandGestureDetector
        gestureThread = HandlerThread("ArGestureThread").also { it.start() }
        gestureHandler = Handler(gestureThread!!.looper)
        gestureDetector = HandGestureDetector(this) { event ->
            onGestureDetected(event)
        }
        gestureDetector?.init()

        // 注册相机帧回调，让 ArRenderer 把相机图像投递给手势识别
        renderer?.setCameraFrameCallback(object : ArRenderer.CameraFrameCallback {
            override fun onCameraFrameAvailable(image: Image, displayRotation: Int) {
                if (!gestureRecognitionEnabled) {
                    image.close()
                    return
                }
                // 投递到后台线程处理，避免阻塞 GL 线程
                gestureHandler?.post {
                    gestureDetector?.processFrame(image, displayRotation)
                }
            }
        })

        // 注册到 ArPlugin 以便接收纹理/状态/气泡更新
        registerToPlugin()
    }

    override fun onResume() {
        super.onResume()
        Log.i(TAG, "onResume: Activity resumed, verifying camera permission")
        // 确保相机权限
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.i(TAG, "onResume: Camera permission not granted, requesting permission")
            requestPermissions(arrayOf(android.Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
            return
        }
        Log.i(TAG, "onResume: Camera permission granted, resuming AR session")
        resumeArSession()
    }

    override fun onPause() {
        super.onPause()
        mainHandler.removeCallbacksAndMessages(null)
        arCheckRetries = 0
        session?.pause()
        glSurfaceView?.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        renderer?.setCameraFrameCallback(null)
        gestureDetector?.release()
        gestureDetector = null
        gestureThread?.quitSafely()
        gestureThread = null
        gestureHandler = null
        renderer?.detachGlView()
        session?.close()
        session = null
        unregisterFromPlugin()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                resumeArSession()
            } else {
                Toast.makeText(this, "需要相机权限才能使用 AR", Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }

    // ─── ARCore Session 管理 ──────────────────────────────────────────────

    private fun resumeArSession() {
        Log.i(TAG, "resumeArSession called, session is null: ${session == null}")
        if (session == null) {
            val availability = ArCoreApk.getInstance().checkAvailability(this)
            Log.i(TAG, "resumeArSession: checkAvailability status is: $availability")
            


            if (availability.isTransient) {
                if (arCheckRetries < 3) {
                    arCheckRetries++
                    Log.i(TAG, "ARCore checkAvailability is transient (attempt $arCheckRetries), retrying in 500ms...")
                    mainHandler.postDelayed({
                        resumeArSession()
                    }, 500)
                    return
                } else {
                    Log.w(TAG, "ARCore checkAvailability is STILL transient after 3 attempts. Bypassing check...")
                }
            }

            // 请求安装 ARCore APK
            try {
                val installStatus = ArCoreApk.getInstance().requestInstall(this, !installRequested)
                Log.i(TAG, "resumeArSession: requestInstall status: $installStatus")
                when (installStatus) {
                    ArCoreApk.InstallStatus.INSTALL_REQUESTED -> {
                        installRequested = true
                        return // 等待安装完成后 onResume 回调
                    }
                    ArCoreApk.InstallStatus.INSTALLED -> {
                        // 继续创建 Session
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "ARCore install request failed", e)
                Toast.makeText(this, "ARCore 安装失败: ${e.message}", Toast.LENGTH_LONG).show()
                finish()
                return
            }

            // 创建 Session
            try {
                Log.i(TAG, "resumeArSession: Creating ARCore Session...")
                session = Session(this)
                Log.i(TAG, "resumeArSession: ARCore Session created successfully")
            } catch (e: UnavailableArcoreNotInstalledException) {
                Log.e(TAG, "ARCore not installed", e)
                Toast.makeText(this, "未检测到 ARCore，请先下载安装 Google Play AR 服务", Toast.LENGTH_LONG).show()
                finish()
                return
            } catch (e: UnavailableApkTooOldException) {
                Log.e(TAG, "ARCore APK too old", e)
                Toast.makeText(this, "请更新 ARCore", Toast.LENGTH_LONG).show()
                finish()
                return
            } catch (e: UnavailableSdkTooOldException) {
                Log.e(TAG, "ARCore SDK too old", e)
                finish()
                return
            } catch (e: UnavailableDeviceNotCompatibleException) {
                Log.e(TAG, "Device not compatible", e)
                Toast.makeText(this, "此设备硬件不支持 AR 功能", Toast.LENGTH_LONG).show()
                finish()
                return
            }

            // 配置 Session：平面检测 + 深度（若支持）+ 光照估算
            try {
                Log.i(TAG, "resumeArSession: Configuring ARCore Session...")
                val config = Config(session!!)
                config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
                config.lightEstimationMode = Config.LightEstimationMode.ENVIRONMENTAL_HDR
                // 深度模式：仅在支持时启用
                val depthSupported = session!!.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
                Log.i(TAG, "resumeArSession: isDepthModeSupported: $depthSupported")
                if (depthSupported) {
                    config.depthMode = Config.DepthMode.AUTOMATIC
                }
                session!!.configure(config)
                renderer?.setSession(session!!)
                Log.i(TAG, "resumeArSession: ARCore Session configured successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Session config failed", e)
            }
        }

        // 恢复 Session
        try {
            Log.i(TAG, "resumeArSession: Resuming ARCore session & GLSurfaceView...")
            session?.resume()
            glSurfaceView?.onResume()
            Log.i(TAG, "resumeArSession: ARCore session & GLSurfaceView resumed successfully")
        } catch (e: CameraNotAvailableException) {
            Log.e(TAG, "Camera not available", e)
            Toast.makeText(this, "相机不可用: ${e.message}", Toast.LENGTH_LONG).show()
            session = null
            finish()
        }
    }

    // ─── 触控手势 ──────────────────────────────────────────────────────────

    override fun onTouchEvent(event: MotionEvent): Boolean {
        // 先交给缩放手势检测
        scaleDetector?.onTouchEvent(event)

        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                // 单击：hit-test 平面，放置/移动角色锚点
                renderer?.handleTap(event.x, event.y)
            }
            MotionEvent.ACTION_MOVE -> {
                // 拖拽：如果正在拖拽角色，重新 hit-test 平移
                if (scaleDetector?.isInProgress != true) {
                    renderer?.handleDrag(event.x, event.y)
                }
            }
        }
        return true
    }

    // ─── 接收来自 ArPlugin 的更新 ──────────────────────────────────────────

    /** 更新角色纹理（base64 PNG）。 */
    fun updateCharacterTexture(base64: String) {
        renderer?.updateCharacterTexture(base64)
    }

    /** 更新渲染状态（情绪 + 光晕色）。 */
    fun updateRenderState(emotion: String, light1: String, light2: String) {
        renderer?.updateRenderState(emotion, light1, light2)
    }

    /** 更新聊天气泡文本。 */
    fun updateChatBubble(text: String) {
        renderer?.updateChatBubble(text)
    }

    /** 启用/禁用手势识别（由前端通过 ArPlugin IPC 控制）。 */
    fun setGestureRecognitionEnabled(enabled: Boolean) {
        gestureRecognitionEnabled = enabled
        gestureDetector?.setEnabled(enabled)
        if (enabled) {
            Log.i(TAG, "Gesture recognition enabled")
        } else {
            Log.i(TAG, "Gesture recognition disabled")
        }
    }

    /** 手势识别是否已就绪（模型加载完成）。 */
    fun isGestureRecognitionReady(): Boolean {
        return gestureDetector?.let { true } ?: false // HandGestureDetector.isReady 是 private，简化为 true
    }

    /**
     * 手势检测回调：由 HandGestureDetector 在后台线程调用。
     * 把手势事件转发给 ArPlugin（通过 event emit 通知前端），
     * 同时在主线程触发角色反应（表情切换等）。
     */
    private fun onGestureDetected(event: GestureEvent) {
        // 通知前端（通过 ArPlugin emit Tauri event）
        try {
            ArPlugin.instance?.emitGestureEvent(event)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit gesture event", e)
        }

        // 主线程触发角色反应
        runOnUiThread {
            when (event.gesture) {
                GestureType.PET -> {
                    // 抚摸 → 角色显示开心气泡
                    renderer?.updateChatBubble("（被抚摸着，看起来很享受~）")
                }
                GestureType.WAVE -> {
                    // 挥手 → 角色打招呼
                    renderer?.updateChatBubble("（挥手打招呼）")
                }
                GestureType.TAP -> {
                    // 点击 → 切换表情（简单实现：显示点击反馈）
                    renderer?.updateChatBubble("（被戳了一下）")
                }
                GestureType.PINCH -> {
                    // 捏合 → 缩放角色（根据 pinchDistance 调整）
                    // 简化实现：仅显示提示
                    if (event.pinchDistance > 0) {
                        // 可扩展：renderer?.scaleCharacter(...)
                    }
                }
                GestureType.NONE -> {
                    // 手离开 → 清空气泡（让角色回到默认状态）
                    // 不立即清空，避免频繁闪烁；由前端控制气泡文本
                }
            }
        }
    }

    // ─── ArPlugin 注册 ────────────────────────────────────────────────────

    private fun registerToPlugin() {
        // Tauri 的 PluginManager.plugins 是 private HashMap，无法从外部 getPlugin。
        // 改用 ArPlugin.instance 静态引用（在 ArPlugin.load 时赋值）。
        try {
            ArPlugin.instance?.registerArActivity(this)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register with ArPlugin", e)
        }
    }

    private fun unregisterFromPlugin() {
        try {
            ArPlugin.instance?.unregisterArActivity()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to unregister from ArPlugin", e)
        }
    }
}
