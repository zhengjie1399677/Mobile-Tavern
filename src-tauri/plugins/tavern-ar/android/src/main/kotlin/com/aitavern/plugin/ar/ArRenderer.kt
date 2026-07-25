package com.aitavern.plugin.ar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
import android.opengl.Matrix
import android.util.Base64
import android.util.Log
import com.google.ar.core.Anchor
import com.google.ar.core.Camera
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.sin

/**
 * AR OpenGL ES 2.0 渲染器。
 *
 * 渲染层级（从后到前）：
 *   1. ARCore 相机背景（GL_TEXTURE_EXTERNAL_OES，由 Session.setCameraTextureName 注入）
 *   2. 地面阴影（椭圆 alpha 混合，投射在锚点平面）
 *   3. 角色立牌（PNG billboard，billboard 朝向相机 + 微动画 + AR 光照）
 *   4. 聊天气泡（文字纹理 quad，贴在角色头顶）
 *
 * 程序化微动画：
 *   - 呼吸：scale = 1.0 + 0.01 * sin(time * 0.5Hz)
 *   - 摇摆：rotationZ = 0.5° * sin(time * 0.3Hz)
 *
 * AR 光照匹配：
 *   - 读取 LightEstimate.pixelIntensity 调整角色 ambient
 *   - 读取 LightEstimate.colorCorrection 调整角色色温
 *
 * 线程模型：
 *   - 所有 GL 调用必须在 GL 线程执行（onSurfaceCreated / onDrawFrame）。
 *   - 外部更新（updateCharacterTexture / updateChatBubble）在主线程被调用，
 *     通过 [glSurfaceView] 的 queueEvent 把 Bitmap 上传调度到 GL 线程。
 */
class ArRenderer(private val context: Context) : GLSurfaceView.Renderer {

    companion object {
        private const val TAG = "ArRenderer"
        private const val COORDS_PER_VERTEX = 3
        private const val TEX_COORDS_PER_VERTEX = 2
    }

    // ─── GLSurfaceView 引用（用于把外部调用调度回 GL 线程） ───────────────
    @Volatile
    private var glSurfaceView: GLSurfaceView? = null

    fun attachGlView(view: GLSurfaceView) {
        glSurfaceView = view
    }

    fun detachGlView() {
        glSurfaceView = null
    }

    // ─── ARCore 状态 ───────────────────────────────────────────────────────
    private var session: Session? = null
    private var frame: Frame? = null

    // ─── 渲染对象 ──────────────────────────────────────────────────────────
    private var characterAnchor: Anchor? = null
    private var characterScale = 1.0f
    private val pendingTaps = mutableListOf<Pair<Float, Float>>()
    private var isDragging = false

    // ─── 纹理 ──────────────────────────────────────────────────────────────
    private var characterTextureId = -1
    private var characterTextureWidth = 0
    private var characterTextureHeight = 0
    private var backgroundTextureId = -1
    private var shadowTextureId = -1
    private var bubbleTextureId = -1
    private var bubbleTextureWidth = 0
    private var bubbleTextureHeight = 0

    // ─── 渲染状态 ──────────────────────────────────────────────────────────
    private var emotion = "默认"
    private var glowLight1 = "rgba(167, 139, 250, 0.28)"
    private var glowLight2 = "rgba(34, 211, 238, 0.16)"
    private var chatBubbleText = ""
    /** 气泡出现时间戳（用于淡入动画）。0 表示气泡未显示。 */
    private var bubbleAppearTime = 0L

    /**
     * 相机帧回调接口。ArActivity 注册后，ArRenderer 每帧把相机 Image
     * 投递给回调（用于手势识别）。Image 所有权转移给回调方，必须自行 close()。
     */
    interface CameraFrameCallback {
        fun onCameraFrameAvailable(image: android.media.Image, displayRotation: Int)
    }

    @Volatile
    private var cameraFrameCallback: CameraFrameCallback? = null

    /** 注册/注销相机帧回调 */
    fun setCameraFrameCallback(callback: CameraFrameCallback?) {
        cameraFrameCallback = callback
    }

    /** 手势识别帧间隔（每 N 帧投递一次相机图像） */
    private val gestureFrameInterval = 3
    private var gestureFrameCounter = 0

    // ─── 待上传纹理队列（主线程入队，GL 线程出队） ────────────────────────
    private data class PendingTexture(val target: Int, val bitmap: Bitmap)
    private val pendingTextureUploads = mutableListOf<PendingTexture>()
    private val pendingLock = Any()

    // ─── 矩阵 ──────────────────────────────────────────────────────────────
    private val viewMatrix = FloatArray(16)
    private val projMatrix = FloatArray(16)
    private val viewProjMatrix = FloatArray(16)

    // ─── 着色器程序 ────────────────────────────────────────────────────────
    private var backgroundProgram = 0
    private var characterProgram = 0
    private var shadowProgram = 0
    private var bubbleProgram = 0

    // ─── 时间（微动画） ────────────────────────────────────────────────────
    private var startTime = System.currentTimeMillis()

    // ─── 顶点数据（单位 quad，[-0.5, 0.5]） ────────────────────────────────
    private val quadVertices = floatArrayOf(
        -0.5f, -0.5f, 0.0f,  // bottom left
         0.5f, -0.5f, 0.0f,  // bottom right
        -0.5f,  0.5f, 0.0f,  // top left
         0.5f,  0.5f, 0.0f,  // top right
    )
    private val quadTexCoords = floatArrayOf(
        0.0f, 1.0f,  // bottom left
        1.0f, 1.0f,  // bottom right
        0.0f, 0.0f,  // top left
        1.0f, 0.0f,  // top right
    )
    private val quadDrawOrder = shortArrayOf(0, 1, 2, 1, 3, 2)

    // ─── GLSurfaceView.Renderer 接口 ───────────────────────────────────────

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0.0f, 0.0f, 0.0f, 1.0f)
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)

        // 编译着色器（背景使用 OES sampler，其它使用普通 2D sampler）
        backgroundProgram = createProgram(BACKGROUND_VERTEX_SHADER, BACKGROUND_FRAGMENT_SHADER)
        characterProgram = createProgram(CHARACTER_VERTEX_SHADER, CHARACTER_FRAGMENT_SHADER)
        shadowProgram = createProgram(SHADOW_VERTEX_SHADER, SHADOW_FRAGMENT_SHADER)
        bubbleProgram = characterProgram // 复用角色着色器

        // 创建 OES 纹理（相机背景）
        val bgTex = IntArray(1)
        GLES20.glGenTextures(1, bgTex, 0)
        backgroundTextureId = bgTex[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, backgroundTextureId)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        // 把 OES 纹理交给 ARCore，每帧 Session.update() 会写入最新相机帧
        session?.setCameraTextureName(backgroundTextureId)

        // 生成空纹理占位（角色 / 阴影 / 气泡）
        val texIds = IntArray(3)
        GLES20.glGenTextures(3, texIds, 0)
        characterTextureId = texIds[0]
        shadowTextureId = texIds[1]
        bubbleTextureId = texIds[2]

        // 创建默认阴影纹理（椭圆渐变）
        createShadowTexture()
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
    }

    override fun onDrawFrame(gl: GL10?) {
        // 清屏
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)

        val sess = session ?: return
        val currentFrame = try {
            sess.update()
        } catch (e: Exception) {
            Log.e(TAG, "Session.update failed", e)
            return
        }
        frame = currentFrame

        // 处理待上传纹理（GL 线程消费主线程入队的 Bitmap）
        drainPendingTextures()

        // 投递相机帧给手势识别（每 N 帧一次，避免 CPU 过载）
        val callback = cameraFrameCallback
        if (callback != null) {
            gestureFrameCounter++
            if (gestureFrameCounter % gestureFrameInterval == 0) {
                try {
                    val cameraImage = currentFrame.acquireCameraImage()
                    val rotation = session?.displayRotation ?: 0
                    callback.onCameraFrameAvailable(cameraImage, rotation)
                } catch (e: Exception) {
                    // acquireCameraImage 偶尔失败（帧被占用），静默忽略
                }
            }
        }

        // 处理待处理的点击事件（hit-test）
        processPendingTaps(currentFrame)

        // 绘制相机背景（OES 纹理）
        drawCameraBackground(currentFrame)

        // 获取相机矩阵
        currentFrame.camera.getViewMatrix(viewMatrix, 0)
        currentFrame.camera.getProjectionMatrix(projMatrix, 0, 0.1f, 100.0f)
        Matrix.multiplyMM(viewProjMatrix, 0, projMatrix, 0, viewMatrix, 0)

        // 如果有锚点，绘制角色 + 阴影 + 气泡
        val anchor = characterAnchor
        if (anchor != null && anchor.trackingState == TrackingState.TRACKING) {
            // 计算光照
            val lightIntensity = currentFrame.lightEstimate?.pixelIntensity ?: 1.0f
            val lightColor = currentFrame.lightEstimate?.colorCorrection
                ?: floatArrayOf(1.0f, 1.0f, 1.0f, 1.0f)

            drawShadow(anchor, lightIntensity)
            drawCharacter(anchor, currentFrame.camera, lightIntensity, lightColor)
            if (chatBubbleText.isNotEmpty()) {
                drawChatBubble(anchor, currentFrame.camera)
            }
        }
    }

    // ─── Session 设置 ─────────────────────────────────────────────────────

    fun setSession(session: Session) {
        this.session = session
        // 如果 GL 上下文已创建，立即把背景纹理交给 Session
        if (backgroundTextureId >= 0) {
            session.setCameraTextureName(backgroundTextureId)
        }
    }

    // ─── 纹理更新（主线程入口，调度到 GL 线程） ──────────────────────────

    /** 更新角色纹理（base64 PNG 或 data URL）。 */
    fun updateCharacterTexture(base64: String) {
        val cleanBase64 = if (base64.startsWith("data:")) {
            base64.substringAfter("base64,")
        } else {
            base64
        }
        try {
            val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: run {
                Log.e(TAG, "decodeByteArray returned null bitmap")
                return
            }
            characterTextureWidth = bitmap.width
            characterTextureHeight = bitmap.height
            enqueueTextureUpload(characterTextureId, bitmap)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode character texture", e)
        }
    }

    /** 更新渲染状态（情绪 + 光晕色）。 */
    fun updateRenderState(emotion: String, light1: String, light2: String) {
        this.emotion = emotion
        this.glowLight1 = light1
        this.glowLight2 = light2
    }

    /** 更新聊天气泡文本。空字符串隐藏气泡；非空文本触发淡入动画。 */
    fun updateChatBubble(text: String) {
        if (text == chatBubbleText) return
        chatBubbleText = text
        if (text.isEmpty()) {
            bubbleAppearTime = 0L
            return
        }
        // 设置出现时间戳，drawChatBubble 会据此计算淡入 alpha
        bubbleAppearTime = System.currentTimeMillis()
        val bitmap = renderTextToBitmap(text)
        bubbleTextureWidth = bitmap.width
        bubbleTextureHeight = bitmap.height
        enqueueTextureUpload(bubbleTextureId, bitmap)
    }

    private fun enqueueTextureUpload(target: Int, bitmap: Bitmap) {
        synchronized(pendingLock) {
            pendingTextureUploads.add(PendingTexture(target, bitmap))
        }
        // 唤醒 GL 线程：RENDERMODE_CONTINUOUSLY 模式下不需要主动 requestRender，
        // 但若改为 dirty render 则需要。这里防御性调用一次。
        glSurfaceView?.requestRender()
    }

    private fun drainPendingTextures() {
        val toUpload: List<PendingTexture> = synchronized(pendingLock) {
            if (pendingTextureUploads.isEmpty()) return
            val drained = pendingTextureUploads.toList()
            pendingTextureUploads.clear()
            drained
        }
        for (item in toUpload) {
            try {
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, item.target)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
                GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, item.bitmap, 0)
                item.bitmap.recycle()
            } catch (e: Exception) {
                Log.e(TAG, "Texture upload failed for target=${item.target}", e)
            }
        }
    }

    // ─── 触控处理 ──────────────────────────────────────────────────────────

    /** 处理点击：hit-test 平面，放置/移动角色锚点。 */
    fun handleTap(x: Float, y: Float) {
        pendingTaps.add(Pair(x, y))
    }

    /** 处理拖拽：重新 hit-test 平移锚点。 */
    fun handleDrag(x: Float, y: Float) {
        if (characterAnchor != null) {
            pendingTaps.add(Pair(x, y))
            isDragging = true
        }
    }

    /** 缩放角色。 */
    fun scaleCharacter(scaleFactor: Float) {
        characterScale = (characterScale / scaleFactor).coerceIn(0.3f, 3.0f)
    }

    // ─── 内部渲染 ──────────────────────────────────────────────────────────

    private fun processPendingTaps(frame: Frame) {
        if (pendingTaps.isEmpty()) return

        val camera = frame.camera
        if (camera.trackingState != TrackingState.TRACKING) {
            pendingTaps.clear()
            return
        }

        for ((x, y) in pendingTaps) {
            val hitResults = frame.hitTest(x, y)
            for (hit in hitResults) {
                val trackable = hit.trackable
                if (trackable is Plane && trackable.isPoseInPolygon(hit.hitPose)) {
                    // 创建新锚点（先释放旧的）
                    characterAnchor?.detach()
                    characterAnchor = hit.createAnchor()
                    break
                }
            }
        }
        pendingTaps.clear()
        isDragging = false
    }

    /**
     * 绘制 ARCore 相机背景：使用 OES 纹理 + ARCore 提供的 displayRotation / uvTransform。
     * 必须每帧调用 [Frame.transformDisplayUvCoords] 计算 UV 变换，以匹配屏幕旋转。
     */
    private fun drawCameraBackground(frame: Frame) {
        if (backgroundTextureId < 0) return

        // 处理 display rotation 变化（屏幕旋转）
        if (frame.hasDisplayRotationChanged()) {
            // ARCore 内部已更新 texture transform，无需额外操作
        }

        // 计算 UV 变换矩阵：把 [-0.5,0.5] 的 quad 坐标映射到 OES 纹理
        // ARCore 提供的 transformDisplayUvCoords 接受 normalized [0,1] UV
        val originalUvs = quadTexCoords
        val transformedUvs = FloatArray(originalUvs.size)
        frame.transformDisplayUvCoords(originalUvs, transformedUvs)

        GLES20.glDepthMask(false)
        GLES20.glUseProgram(backgroundProgram)

        // 全屏 quad：直接用 NDC 坐标（-1..1）
        val ndcVerts = floatArrayOf(
            -1.0f, -1.0f, 0.0f,
             1.0f, -1.0f, 0.0f,
            -1.0f,  1.0f, 0.0f,
             1.0f,  1.0f, 0.0f,
        )
        val positionLoc = GLES20.glGetAttribLocation(backgroundProgram, "a_Position")
        GLES20.glEnableVertexAttribArray(positionLoc)
        GLES20.glVertexAttribPointer(positionLoc, COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, ndcVerts.toFloatBuffer())

        val texCoordLoc = GLES20.glGetAttribLocation(backgroundProgram, "a_TexCoord")
        GLES20.glEnableVertexAttribArray(texCoordLoc)
        GLES20.glVertexAttribPointer(texCoordLoc, TEX_COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, transformedUvs.toFloatBuffer())

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, backgroundTextureId)
        val texLoc = GLES20.glGetUniformLocation(backgroundProgram, "s_Texture")
        GLES20.glUniform1i(texLoc, 0)

        val indexBuffer = quadDrawOrder.toShortBuffer()
        GLES20.glDrawElements(GLES20.GL_TRIANGLES, quadDrawOrder.size, GLES20.GL_UNSIGNED_SHORT, indexBuffer)

        GLES20.glDisableVertexAttribArray(positionLoc)
        GLES20.glDisableVertexAttribArray(texCoordLoc)
        GLES20.glDepthMask(true)
    }

    private fun drawCharacter(anchor: Anchor, camera: Camera, lightIntensity: Float, lightColor: FloatArray) {
        if (characterTextureId < 0) return

        GLES20.glUseProgram(characterProgram)

        // 计算锚点世界矩阵
        val anchorMatrix = FloatArray(16)
        anchor.pose.toMatrix(anchorMatrix, 0)

        // Billboard：让 quad 始终朝向相机（仅 Y 轴旋转）
        val cameraPos = FloatArray(3)
        camera.pose.getTranslation(cameraPos, 0)
        val anchorPos = FloatArray(3)
        anchor.pose.getTranslation(anchorPos, 0)

        // 计算从锚点到相机的方向角（Y 轴旋转）
        val dx = cameraPos[0] - anchorPos[0]
        val dz = cameraPos[2] - anchorPos[2]
        val angle = Math.atan2(dx.toDouble(), dz.toDouble()).toFloat()

        // 应用旋转 + 平移 + 缩放
        val modelMatrix = FloatArray(16)
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.translateM(modelMatrix, 0, anchorPos[0], anchorPos[1], anchorPos[2])
        Matrix.rotateM(modelMatrix, 0, Math.toDegrees(angle.toDouble()).toFloat(), 0f, 1f, 0f)

        // 程序化微动画
        val time = (System.currentTimeMillis() - startTime) / 1000.0f
        val breathScale = 1.0f + 0.01f * sin(time * 0.5f * 2.0f * Math.PI.toFloat())
        val swayAngle = 0.5f * sin(time * 0.3f * 2.0f * Math.PI.toFloat())
        Matrix.rotateM(modelMatrix, 0, swayAngle, 0f, 0f, 1f)

        // 缩放：角色高度默认 1.5m × characterScale × breathScale
        val heightScale = 1.5f * characterScale * breathScale
        val aspectRatio = if (characterTextureHeight > 0) {
            characterTextureWidth.toFloat() / characterTextureHeight.toFloat()
        } else {
            1.0f
        }
        Matrix.scaleM(modelMatrix, 0, heightScale * aspectRatio, heightScale, 1.0f)

        // MVP 矩阵
        val mvpMatrix = FloatArray(16)
        Matrix.multiplyMM(mvpMatrix, 0, viewProjMatrix, 0, modelMatrix, 0)

        // 传递 uniform
        val mvpLoc = GLES20.glGetUniformLocation(characterProgram, "u_MVPMatrix")
        GLES20.glUniformMatrix4fv(mvpLoc, 1, false, mvpMatrix, 0)

        // 时间 uniform（用于 vertex shader 伪 2D 骨骼变形：头部摆动 + 局部呼吸）
        val timeLoc = GLES20.glGetUniformLocation(characterProgram, "u_Time")
        val timeSec = (System.currentTimeMillis() - startTime) / 1000.0f
        GLES20.glUniform1f(timeLoc, timeSec)

        val lightIntLoc = GLES20.glGetUniformLocation(characterProgram, "u_LightIntensity")
        GLES20.glUniform1f(lightIntLoc, lightIntensity)

        val lightColorLoc = GLES20.glGetUniformLocation(characterProgram, "u_LightColor")
        GLES20.glUniform3f(lightColorLoc, lightColor[0], lightColor[1], lightColor[2])

        val alphaLoc = GLES20.glGetUniformLocation(characterProgram, "u_Alpha")
        GLES20.glUniform1f(alphaLoc, 1.0f)

        // 传递顶点
        val positionLoc = GLES20.glGetAttribLocation(characterProgram, "a_Position")
        GLES20.glEnableVertexAttribArray(positionLoc)
        GLES20.glVertexAttribPointer(positionLoc, COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, quadVertices.toFloatBuffer())

        val texCoordLoc = GLES20.glGetAttribLocation(characterProgram, "a_TexCoord")
        GLES20.glEnableVertexAttribArray(texCoordLoc)
        GLES20.glVertexAttribPointer(texCoordLoc, TEX_COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, quadTexCoords.toFloatBuffer())

        // 绑定纹理
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, characterTextureId)
        val texLoc = GLES20.glGetUniformLocation(characterProgram, "u_Texture")
        GLES20.glUniform1i(texLoc, 0)

        // 绘制
        val indexBuffer = quadDrawOrder.toShortBuffer()
        GLES20.glDrawElements(GLES20.GL_TRIANGLES, quadDrawOrder.size, GLES20.GL_UNSIGNED_SHORT, indexBuffer)

        // 清理
        GLES20.glDisableVertexAttribArray(positionLoc)
        GLES20.glDisableVertexAttribArray(texCoordLoc)
    }

    private fun drawShadow(anchor: Anchor, lightIntensity: Float) {
        if (shadowTextureId < 0) return

        GLES20.glUseProgram(shadowProgram)

        // 阴影投射在锚点正下方平面
        val anchorPos = FloatArray(3)
        anchor.pose.getTranslation(anchorPos, 0)

        val modelMatrix = FloatArray(16)
        Matrix.setIdentityM(modelMatrix, 0)
        Matrix.translateM(modelMatrix, 0, anchorPos[0], anchorPos[1] + 0.01f, anchorPos[2]) // 略高于平面避免 z-fight
        Matrix.rotateM(modelMatrix, 0, -90f, 1f, 0f, 0f) // 平铺在水平面

        // 阴影大小与角色缩放成正比
        val shadowSize = 0.8f * characterScale
        Matrix.scaleM(modelMatrix, 0, shadowSize, shadowSize, 1.0f)

        val mvpMatrix = FloatArray(16)
        Matrix.multiplyMM(mvpMatrix, 0, viewProjMatrix, 0, modelMatrix, 0)

        val mvpLoc = GLES20.glGetUniformLocation(shadowProgram, "u_MVPMatrix")
        GLES20.glUniformMatrix4fv(mvpLoc, 1, false, mvpMatrix, 0)

        // 阴影强度随环境光减弱（暗环境阴影更淡）
        val shadowAlpha = 0.4f * lightIntensity.coerceIn(0.3f, 1.0f)
        val alphaLoc = GLES20.glGetUniformLocation(shadowProgram, "u_Alpha")
        GLES20.glUniform1f(alphaLoc, shadowAlpha)

        // 顶点
        val positionLoc = GLES20.glGetAttribLocation(shadowProgram, "a_Position")
        GLES20.glEnableVertexAttribArray(positionLoc)
        GLES20.glVertexAttribPointer(positionLoc, COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, quadVertices.toFloatBuffer())

        val texCoordLoc = GLES20.glGetAttribLocation(shadowProgram, "a_TexCoord")
        GLES20.glEnableVertexAttribArray(texCoordLoc)
        GLES20.glVertexAttribPointer(texCoordLoc, TEX_COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, quadTexCoords.toFloatBuffer())

        // 纹理
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, shadowTextureId)
        val texLoc = GLES20.glGetUniformLocation(shadowProgram, "u_Texture")
        GLES20.glUniform1i(texLoc, 0)

        val indexBuffer = quadDrawOrder.toShortBuffer()
        GLES20.glDrawElements(GLES20.GL_TRIANGLES, quadDrawOrder.size, GLES20.GL_UNSIGNED_SHORT, indexBuffer)

        GLES20.glDisableVertexAttribArray(positionLoc)
        GLES20.glDisableVertexAttribArray(texCoordLoc)
    }

    private fun drawChatBubble(anchor: Anchor, camera: Camera) {
        if (bubbleTextureId < 0 || bubbleTextureWidth == 0) return

        GLES20.glUseProgram(bubbleProgram)

        val anchorPos = FloatArray(3)
        anchor.pose.getTranslation(anchorPos, 0)

        // Billboard 朝向相机
        val cameraPos = FloatArray(3)
        camera.pose.getTranslation(cameraPos, 0)
        val dx = cameraPos[0] - anchorPos[0]
        val dz = cameraPos[2] - anchorPos[2]
        val angle = Math.atan2(dx.toDouble(), dz.toDouble()).toFloat()

        val modelMatrix = FloatArray(16)
        Matrix.setIdentityM(modelMatrix, 0)
        // 气泡在角色头顶上方 1.8m
        Matrix.translateM(modelMatrix, 0, anchorPos[0], anchorPos[1] + 1.8f * characterScale, anchorPos[2])
        Matrix.rotateM(modelMatrix, 0, Math.toDegrees(angle.toDouble()).toFloat(), 0f, 1f, 0f)

        // 气泡大小
        val bubbleWidth = 1.0f * characterScale
        val bubbleHeight = bubbleWidth * bubbleTextureHeight.toFloat() / bubbleTextureWidth.toFloat()
        Matrix.scaleM(modelMatrix, 0, bubbleWidth, bubbleHeight, 1.0f)

        val mvpMatrix = FloatArray(16)
        Matrix.multiplyMM(mvpMatrix, 0, viewProjMatrix, 0, modelMatrix, 0)

        val mvpLoc = GLES20.glGetUniformLocation(bubbleProgram, "u_MVPMatrix")
        GLES20.glUniformMatrix4fv(mvpLoc, 1, false, mvpMatrix, 0)

        // 气泡不参与 2D 骨骼变形，u_Time 传 0 禁用摆动和呼吸
        val timeLoc = GLES20.glGetUniformLocation(bubbleProgram, "u_Time")
        GLES20.glUniform1f(timeLoc, 0.0f)

        val lightIntLoc = GLES20.glGetUniformLocation(bubbleProgram, "u_LightIntensity")
        GLES20.glUniform1f(lightIntLoc, 1.0f)

        val lightColorLoc = GLES20.glGetUniformLocation(bubbleProgram, "u_LightColor")
        GLES20.glUniform3f(lightColorLoc, 1.0f, 1.0f, 1.0f)

        // 淡入动画：300ms ease-out，从 0 到 1
        val bubbleAlpha = if (bubbleAppearTime > 0) {
            val elapsed = (System.currentTimeMillis() - bubbleAppearTime).toFloat()
            val duration = 300f
            if (elapsed >= duration) {
                1.0f
            } else {
                val progress = elapsed / duration
                // ease-out: 1 - (1 - t)^2
                1.0f - (1.0f - progress) * (1.0f - progress)
            }
        } else {
            0f
        }
        val alphaLoc = GLES20.glGetUniformLocation(bubbleProgram, "u_Alpha")
        GLES20.glUniform1f(alphaLoc, bubbleAlpha)

        val positionLoc = GLES20.glGetAttribLocation(bubbleProgram, "a_Position")
        GLES20.glEnableVertexAttribArray(positionLoc)
        GLES20.glVertexAttribPointer(positionLoc, COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, quadVertices.toFloatBuffer())

        val texCoordLoc = GLES20.glGetAttribLocation(bubbleProgram, "a_TexCoord")
        GLES20.glEnableVertexAttribArray(texCoordLoc)
        GLES20.glVertexAttribPointer(texCoordLoc, TEX_COORDS_PER_VERTEX, GLES20.GL_FLOAT, false, 0, quadTexCoords.toFloatBuffer())

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, bubbleTextureId)
        val texLoc = GLES20.glGetUniformLocation(bubbleProgram, "u_Texture")
        GLES20.glUniform1i(texLoc, 0)

        val indexBuffer = quadDrawOrder.toShortBuffer()
        GLES20.glDrawElements(GLES20.GL_TRIANGLES, quadDrawOrder.size, GLES20.GL_UNSIGNED_SHORT, indexBuffer)

        GLES20.glDisableVertexAttribArray(positionLoc)
        GLES20.glDisableVertexAttribArray(texCoordLoc)
    }

    // ─── 纹理辅助 ──────────────────────────────────────────────────────────

    private fun createShadowTexture() {
        // 创建椭圆渐变阴影 Bitmap (128x128)
        val size = 128
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.TRANSPARENT)

        val paint = Paint().apply {
            isAntiAlias = true
            color = Color.argb(180, 0, 0, 0)
        }
        // 径向渐变：中心深、边缘淡
        val cx = size / 2f
        val cy = size / 2f
        val radius = size / 2f
        val shader = android.graphics.RadialGradient(
            cx, cy, radius,
            intArrayOf(Color.argb(200, 0, 0, 0), Color.argb(100, 0, 0, 0), Color.argb(0, 0, 0, 0)),
            floatArrayOf(0.0f, 0.6f, 1.0f),
            android.graphics.Shader.TileMode.CLAMP
        )
        paint.shader = shader
        canvas.drawCircle(cx, cy, radius, paint)

        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, shadowTextureId)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
    }

    private fun renderTextToBitmap(text: String): Bitmap {
        val maxWidth = 512
        val padding = 24
        val textSize = 36f
        val tailHeight = 18 // 尾尖高度
        val maxLines = 3    // 最多 3 行，超过截断

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            this.textSize = textSize
            setShadowLayer(4f, 2f, 2f, Color.argb(180, 0, 0, 0))
        }

        // 测量文字换行
        val allLines = mutableListOf<String>()
        val words = text.split(" ", "\n")
        var currentLine = StringBuilder()
        for (word in words) {
            val testLine = if (currentLine.isEmpty()) word else "$currentLine $word"
            if (paint.measureText(testLine) > maxWidth - 2 * padding) {
                if (currentLine.isNotEmpty()) {
                    allLines.add(currentLine.toString())
                }
                currentLine = StringBuilder(word)
            } else {
                currentLine = StringBuilder(testLine)
            }
        }
        if (currentLine.isNotEmpty()) allLines.add(currentLine.toString())

        // 截断超过 maxLines 的行，最后一行追加 "…"
        val truncated = allLines.size > maxLines
        val lines = if (truncated) {
            val result = allLines.take(maxLines).toMutableList()
            val last = result.last()
            result[result.lastIndex] = if (last.length > 20) last.substring(0, 20) + "…" else last + "…"
            result
        } else {
            allLines
        }

        val width = maxWidth
        val contentHeight = (lines.size * (textSize + 6) + 2 * padding).toInt()
        val height = contentHeight + tailHeight
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.TRANSPARENT)

        // 渐变背景圆角矩形（深色到稍浅，从上到下）
        val bgPaint = Paint().apply {
            isAntiAlias = true
            val shader = android.graphics.LinearGradient(
                0f, 0f, 0f, contentHeight.toFloat(),
                intArrayOf(
                    Color.argb(210, 30, 30, 45),
                    Color.argb(200, 45, 45, 65)
                ),
                floatArrayOf(0.0f, 1.0f),
                android.graphics.Shader.TileMode.CLAMP
            )
            this.shader = shader
        }
        val rect = android.graphics.RectF(0f, 0f, width.toFloat(), contentHeight.toFloat())
        canvas.drawRoundRect(rect, 18f, 18f, bgPaint)

        // 边框（半透明亮色描边，增强对比度）
        val borderPaint = Paint().apply {
            isAntiAlias = true
            color = Color.argb(80, 0, 219, 233) // 主题色 #00dbe9
            style = Paint.Style.STROKE
            strokeWidth = 1.5f
        }
        canvas.drawRoundRect(rect, 18f, 18f, borderPaint)

        // 尾尖（底部居中三角形，指向角色方向）
        val tailPaint = Paint().apply {
            isAntiAlias = true
            color = Color.argb(205, 45, 45, 65) // 与渐变底部色一致
        }
        val tailCenterX = width / 2f
        val tailPath = android.graphics.Path().apply {
            moveTo(tailCenterX - 12f, contentHeight - 2f)
            lineTo(tailCenterX + 12f, contentHeight - 2f)
            lineTo(tailCenterX, contentHeight + tailHeight.toFloat())
            close()
        }
        canvas.drawPath(tailPath, tailPaint)

        // 绘制文字
        var y = padding + textSize
        for (line in lines) {
            canvas.drawText(line, padding.toFloat(), y, paint)
            y += textSize + 6
        }

        return bitmap
    }

    // ─── 着色器编译辅助 ────────────────────────────────────────────────────

    private fun createProgram(vertexShader: String, fragmentShader: String): Int {
        val vs = compileShader(GLES20.GL_VERTEX_SHADER, vertexShader)
        val fs = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentShader)
        val program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vs)
        GLES20.glAttachShader(program, fs)
        GLES20.glLinkProgram(program)
        val linkStatus = IntArray(1)
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linkStatus, 0)
        if (linkStatus[0] != GLES20.GL_TRUE) {
            Log.e(TAG, "Could not link program: ${GLES20.glGetProgramInfoLog(program)}")
            GLES20.glDeleteProgram(program)
            return 0
        }
        return program
    }

    private fun compileShader(type: Int, shaderCode: String): Int {
        val shader = GLES20.glCreateShader(type)
        GLES20.glShaderSource(shader, shaderCode)
        GLES20.glCompileShader(shader)
        val compileStatus = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compileStatus, 0)
        if (compileStatus[0] != GLES20.GL_TRUE) {
            Log.e(TAG, "Shader compile error: ${GLES20.glGetShaderInfoLog(shader)}")
            GLES20.glDeleteShader(shader)
            return 0
        }
        return shader
    }

    // ─── 着色器源码 ────────────────────────────────────────────────────────

    /** 相机背景顶点着色器：直接用 NDC 坐标，UV 由 ARCore transformDisplayUvCoords 计算 */
    private val BACKGROUND_VERTEX_SHADER = """
        attribute vec4 a_Position;
        attribute vec2 a_TexCoord;
        varying vec2 v_TexCoord;
        void main() {
            v_TexCoord = a_TexCoord;
            gl_Position = a_Position;
        }
    """.trimIndent()

    /**
     * 相机背景片段着色器：必须使用 GL_TEXTURE_EXTERNAL_OES 的 sampler2D 扩展。
     * ARCore 把相机帧写入 OES 纹理，无法用普通 sampler2D 采样。
     */
    private val BACKGROUND_FRAGMENT_SHADER = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;
        uniform samplerExternalOES s_Texture;
        varying vec2 v_TexCoord;
        void main() {
            gl_FragColor = texture2D(s_Texture, v_TexCoord);
        }
    """.trimIndent()

    /**
     * 角色立牌顶点着色器：伪 2D 骨骼变形。
     *
     * 通过顶点 y 坐标区分头部/身体区域，实现局部变形：
     *   - 头部区域（y > 0.2）：左右摆动（sin 周期 ~4s，幅度 2%）
     *   - 颈部过渡区（0.0 ~ 0.2）：smoothstep 权重过渡，避免硬切
     *   - 身体区域（y < 0.0）：固定，仅受 CPU 端整体呼吸影响
     *   - 局部呼吸：整体 y scale 微变化（~0.8%），叠加在 CPU 端呼吸之上
     *
     * 这是简化版 2D 骨骼，不需要 Live2D 模型文件或额外纹理。
     * 真正的 Live2D 需要 Cubism SDK + .moc3 模型，成本极高，暂不实现。
     */
    private val CHARACTER_VERTEX_SHADER = """
        uniform mat4 u_MVPMatrix;
        uniform float u_Time;
        attribute vec4 a_Position;
        attribute vec2 a_TexCoord;
        varying vec2 v_TexCoord;
        void main() {
            v_TexCoord = a_TexCoord;
            vec4 pos = a_Position;

            // 头部摆动权重：y > 0.2 时为 1.0，y < 0.0 时为 0.0，中间平滑过渡
            float headWeight = smoothstep(0.0, 0.2, pos.y);
            // 摆动幅度 2%，周期 ~4s（0.25Hz * 2π）
            float sway = sin(u_Time * 1.5708) * 0.02 * headWeight;
            pos.x += sway;

            // 局部呼吸：整体 y scale 微变化 0.8%，周期 ~3s
            float breath = 1.0 + sin(u_Time * 2.0944) * 0.008;
            pos.y *= breath;

            gl_Position = u_MVPMatrix * pos;
        }
    """.trimIndent()

    private val CHARACTER_FRAGMENT_SHADER = """
        precision mediump float;
        uniform sampler2D u_Texture;
        uniform float u_LightIntensity;
        uniform vec3 u_LightColor;
        uniform float u_Alpha;
        varying vec2 v_TexCoord;
        void main() {
            vec4 texColor = texture2D(u_Texture, v_TexCoord);
            // 应用 AR 光照：纹理色 × 光强 × 光色
            vec3 litColor = texColor.rgb * u_LightIntensity * u_LightColor;
            gl_FragColor = vec4(litColor, texColor.a * u_Alpha);
        }
    """.trimIndent()

    /** 阴影着色器：椭圆 alpha 渐变 */
    private val SHADOW_VERTEX_SHADER = """
        uniform mat4 u_MVPMatrix;
        attribute vec4 a_Position;
        attribute vec2 a_TexCoord;
        varying vec2 v_TexCoord;
        void main() {
            v_TexCoord = a_TexCoord;
            gl_Position = u_MVPMatrix * a_Position;
        }
    """.trimIndent()

    private val SHADOW_FRAGMENT_SHADER = """
        precision mediump float;
        uniform sampler2D u_Texture;
        uniform float u_Alpha;
        varying vec2 v_TexCoord;
        void main() {
            vec4 texColor = texture2D(u_Texture, v_TexCoord);
            gl_FragColor = vec4(0.0, 0.0, 0.0, texColor.a * u_Alpha);
        }
    """.trimIndent()
}

// ─── FloatArray 扩展：转 ByteBuffer ────────────────────────────────────────

private fun FloatArray.toFloatBuffer(): java.nio.FloatBuffer {
    val buffer = java.nio.ByteBuffer.allocateDirect(this.size * 4)
        .order(java.nio.ByteOrder.nativeOrder())
        .asFloatBuffer()
    buffer.put(this)
    buffer.position(0)
    return buffer
}

private fun ShortArray.toShortBuffer(): java.nio.ShortBuffer {
    val buffer = java.nio.ByteBuffer.allocateDirect(this.size * 2)
        .order(java.nio.ByteOrder.nativeOrder())
        .asShortBuffer()
    buffer.put(this)
    buffer.position(0)
    return buffer
}
