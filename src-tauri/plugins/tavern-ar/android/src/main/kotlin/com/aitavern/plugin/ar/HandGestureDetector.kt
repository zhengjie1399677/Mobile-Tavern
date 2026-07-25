package com.aitavern.plugin.ar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.URL
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * 手势类型枚举。
 */
enum class GestureType {
    /** 无手势 / 手离开画面 */
    NONE,
    /** 抚摸：手掌在角色区域做缓慢往复运动 */
    PET,
    /** 挥手：手在画面上方快速左右摆动 */
    WAVE,
    /** 点击：食指尖快速触碰角色区域 */
    TAP,
    /** 捏合：拇指与食指距离很近（可用于缩放） */
    PINCH,
}

/**
 * 手势检测回调。
 *
 * @param gesture 识别到的手势类型
 * @param handCenterX 手掌中心 x 坐标（归一化 0-1，相对于画面宽度）
 * @param handCenterY 手掌中心 y 坐标（归一化 0-1，相对于画面高度）
 * @param pinchDistance 捏合时拇指与食指的距离（归一化 0-1），非捏合时为 0
 */
data class GestureEvent(
    val gesture: GestureType,
    val handCenterX: Float,
    val handCenterY: Float,
    val pinchDistance: Float,
)

/**
 * 基于 MediaPipe Hands 的手部手势检测器。
 *
 * 工作流程：
 *   1. [init]：异步下载/加载 hand_landmarker.task 模型文件，初始化 HandLandmarker
 *   2. [processFrame]：从 ARCore Frame 获取 YUV 相机帧 → 转 Bitmap → MediaPipe 检测 → 关键点
 *   3. [classifyGesture]：基于 21 个关键点的时序轨迹分类手势（抚摸/挥手/点击/捏合）
 *   4. 回调通知 [callback] 触发角色反应
 *
 * 性能策略：
 *   - 每 [DETECTION_INTERVAL] 帧检测一次（默认 3 帧，约 10-15fps 检测频率）
 *   - 模型加载和检测在后台线程执行，不阻塞 GL 渲染线程
 *   - 手势分类使用最近 [HISTORY_SIZE] 帧的关键点轨迹
 *
 * 模型加载策略：
 *   - 首次使用从官方 URL 下载 hand_landmarker.task 到 cacheDir
 *   - 后续从本地缓存加载
 *   - 下载失败时 [isReady] 返回 false，手势识别降级为不可用
 */
class HandGestureDetector(
    private val context: Context,
    private val callback: (GestureEvent) -> Unit,
) {
    companion object {
        private const val TAG = "HandGestureDetector"

        /** MediaPipe 官方 hand_landmarker 模型 URL */
        private const val MODEL_URL =
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

        /** 本地缓存模型文件名 */
        private const val MODEL_FILENAME = "hand_landmarker.task"

        /** 每隔多少帧检测一次（降低 CPU 负载） */
        private const val DETECTION_INTERVAL = 3

        /** 关键点历史轨迹长度（用于手势分类） */
        private const val HISTORY_SIZE = 10

        // ─── 手势分类阈值 ───────────────────────────────────────────────────

        /** 挥手：x 方向往复运动频率阈值（Hz） */
        private const val WAVE_MIN_FREQ_HZ = 1.5f
        /** 挥手：x 方向运动幅度阈值（归一化 0-1） */
        private const val WAVE_MIN_AMPLITUDE = 0.08f
        /** 挥手：手必须在画面上半部分 */
        private const val WAVE_MAX_Y = 0.5f

        /** 抚摸：y 方向往复运动频率阈值（Hz） */
        private const val PET_MIN_FREQ_HZ = 0.5f
        /** 抚摸：y 方向运动幅度阈值（归一化 0-1） */
        private const val PET_MIN_AMPLITUDE = 0.03f
        /** 抚摸：持续运动的最小帧数 */
        private const val PET_MIN_FRAMES = 5

        /** 捏合：拇指尖(4)与食指尖(8)的距离阈值（归一化 0-1） */
        private const val PINCH_DISTANCE_THRESHOLD = 0.05f

        /** 点击：食指尖速度阈值（归一化/帧） */
        private const val TAP_SPEED_THRESHOLD = 0.05f
    }

    /** MediaPipe HandLandmarker 实例，模型加载完成后非 null */
    @Volatile
    private var handLandmarker: HandLandmarker? = null

    /** 模型是否加载就绪 */
    @Volatile
    private var isReady = false

    /** 是否启用手势识别 */
    @Volatile
    private var isEnabled = false

    /** 帧计数器（用于控制检测频率） */
    private var frameCounter = 0

    /** 手掌中心历史轨迹（归一化坐标），用于手势分类 */
    private val handCenterHistory = mutableListOf<Pair<Float, Float>>()

    /** 时间戳历史（毫秒），配合坐标历史计算运动频率 */
    private val timestampHistory = mutableListOf<Long>()

    /** 上一次检测到的手势（用于去重，避免每帧回调） */
    private var lastGesture = GestureType.NONE

    /** 手势持续帧数（用于抚摸等需要持续判定的手势） */
    private var gestureDurationFrames = 0

    /**
     * 异步初始化：下载/加载模型并创建 HandLandmarker。
     * 在 IO 线程执行，完成后 [isReady] 置 true。
     */
    fun init() {
        Thread {
            try {
                val modelFile = ensureModelFile()
                if (modelFile == null) {
                    Log.e(TAG, "Failed to obtain model file, gesture recognition disabled")
                    return@Thread
                }

                val baseOptions = BaseOptions.builder()
                    .setModelAssetPath(modelFile.absolutePath)
                    .build()

                val options = HandLandmarker.HandLandmarkerOptions.builder()
                    .setBaseOptions(baseOptions)
                    .setRunningMode(RunningMode.IMAGE)
                    .setNumHands(1) // 只追踪一只手（降低负载）
                    .setMinHandDetectionConfidence(0.5f)
                    .setMinHandPresenceConfidence(0.5f)
                    .setMinTrackingConfidence(0.5f)
                    .build()

                handLandmarker = HandLandmarker.createFromOptions(context, options)
                isReady = true
                Log.i(TAG, "HandLandmarker initialized successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize HandLandmarker", e)
                isReady = false
            }
        }.also { it.isDaemon = true }.start()
    }

    /**
     * 启用/禁用手势识别。
     */
    fun setEnabled(enabled: Boolean) {
        isEnabled = enabled
        if (!enabled) {
            handCenterHistory.clear()
            timestampHistory.clear()
            lastGesture = GestureType.NONE
            gestureDurationFrames = 0
        }
    }

    /**
     * 处理一帧 ARCore 相机图像。
     *
     * 每 [DETECTION_INTERVAL] 帧执行一次 MediaPipe 检测。
     * 必须在 GL 线程之外调用（ArActivity 中通过 HandlerThread 调度）。
     *
     * @param image ARCore Frame.acquireCameraImage() 返回的 YUV_420_888 图像
     * @param displayRotation 屏幕旋转角度（0/90/180/270）
     */
    fun processFrame(image: Image, displayRotation: Int) {
        if (!isReady || !isEnabled || handLandmarker == null) {
            image.close()
            return
        }

        frameCounter++
        if (frameCounter % DETECTION_INTERVAL != 0) {
            image.close()
            return
        }

        try {
            val bitmap = yuvImageToBitmap(image, displayRotation)
            image.close()

            val mpImage: MPImage = BitmapImageBuilder(bitmap).build()
            val result = handLandmarker?.detect(mpImage)
            bitmap.recycle()

            processDetectionResult(result)
        } catch (e: Exception) {
            Log.e(TAG, "processFrame failed", e)
            try { image.close() } catch (_: Exception) {}
        }
    }

    /** 释放资源 */
    fun release() {
        try {
            handLandmarker?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing HandLandmarker", e)
        }
        handLandmarker = null
        isReady = false
        handCenterHistory.clear()
        timestampHistory.clear()
    }

    // ─── 内部实现 ──────────────────────────────────────────────────────────

    /**
     * 确保模型文件存在：检查 cacheDir，不存在则下载。
     * @return 模型文件，或 null（下载失败）
     */
    private fun ensureModelFile(): File? {
        val modelFile = File(context.cacheDir, MODEL_FILENAME)
        if (modelFile.exists() && modelFile.length() > 0) {
            Log.i(TAG, "Model file found in cache: ${modelFile.absolutePath}")
            return modelFile
        }

        Log.i(TAG, "Downloading hand_landmarker model from $MODEL_URL ...")
        return try {
            val url = URL(MODEL_URL)
            val connection = url.openConnection()
            connection.connectTimeout = 15000
            connection.readTimeout = 60000
            connection.getInputStream().use { input ->
                FileOutputStream(modelFile).use { output ->
                    input.copyTo(output)
                }
            }
            Log.i(TAG, "Model downloaded: ${modelFile.length()} bytes")
            modelFile
        } catch (e: Exception) {
            Log.e(TAG, "Failed to download model", e)
            if (modelFile.exists()) modelFile.delete()
            null
        }
    }

    /**
     * YUV_420_888 Image → Bitmap。
     * 利用 Android 自带的 YuvImage + JPEG 压缩解码（兼容性最好）。
     */
    private fun yuvImageToBitmap(image: Image, displayRotation: Int): Bitmap {
        val yBuffer = image.planes[0].buffer // Y
        val uBuffer = image.planes[1].buffer // U
        val vBuffer = image.planes[2].buffer // V

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)
        // U 和 V 交错
        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)

        val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 80, out)
        val jpegBytes = out.toByteArray()
        var bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)

        // 根据屏幕旋转角度旋转 Bitmap
        val matrix = android.graphics.Matrix()
        matrix.postRotate(displayRotation.toFloat())
        // MediaPipe 期望镜像视图（前置相机风格），水平翻转
        matrix.postScale(-1f, 1f)

        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (rotated != bitmap) {
            bitmap.recycle()
        }
        return rotated
    }

    /**
     * 处理 MediaPipe 检测结果：提取关键点 → 更新历史轨迹 → 分类手势 → 回调。
     */
    private fun processDetectionResult(result: HandLandmarkerResult?) {
        if (result == null || result.landmarks().isEmpty()) {
            // 没检测到手 → 清空历史，回调 NONE
            if (lastGesture != GestureType.NONE) {
                handCenterHistory.clear()
                timestampHistory.clear()
                lastGesture = GestureType.NONE
                gestureDurationFrames = 0
                callback(GestureEvent(GestureType.NONE, 0f, 0f, 0f))
            }
            return
        }

        val landmarks = result.landmarks()[0] // 第一只手的 21 个关键点
        if (landmarks.size < 21) return

        // 手掌中心 = 手腕(0) + 食指根(5) + 小指根(17) 的平均
        val wrist = landmarks[0]
        val indexMcp = landmarks[5]
        val pinkyMcp = landmarks[17]
        val palmCenterX = (wrist.x() + indexMcp.x() + pinkyMcp.x()) / 3f
        val palmCenterY = (wrist.y() + indexMcp.y() + pinkyMcp.y()) / 3f

        // 拇指尖(4) 与 食指尖(8) 距离
        val thumbTip = landmarks[4]
        val indexTip = landmarks[8]
        val pinchDist = hypot(thumbTip.x() - indexTip.x(), thumbTip.y() - indexTip.y())

        // 更新历史轨迹
        val now = System.currentTimeMillis()
        handCenterHistory.add(Pair(palmCenterX, palmCenterY))
        timestampHistory.add(now)
        while (handCenterHistory.size > HISTORY_SIZE) {
            handCenterHistory.removeAt(0)
            timestampHistory.removeAt(0)
        }

        // 分类手势
        val gesture = classifyGesture(palmCenterX, palmCenterY, pinchDist, indexTip)

        // 去重：只在手势变化时回调
        if (gesture != lastGesture) {
            lastGesture = gesture
            gestureDurationFrames = 1
            callback(GestureEvent(gesture, palmCenterX, palmCenterY, pinchDist))
        } else {
            gestureDurationFrames++
            // 持续手势定期回调（用于抚摸等连续手势的持续效果）
            if (gesture == GestureType.PET && gestureDurationFrames % 5 == 0) {
                callback(GestureEvent(gesture, palmCenterX, palmCenterY, pinchDist))
            }
        }
    }

    /**
     * 手势分类核心算法。
     *
     * 基于手掌中心的时序轨迹和关键点距离判断手势类型。
     * 优先级：捏合 > 挥手 > 抚摸 > 点击 > 无
     */
    private fun classifyGesture(
        palmX: Float,
        palmY: Float,
        pinchDist: Float,
        indexTip: com.google.mediapipe.tasks.components.containers.NormalizedLandmark,
    ): GestureType {
        if (handCenterHistory.size < 3) return GestureType.NONE

        // 1. 捏合检测（最高优先级）
        if (pinchDist < PINCH_DISTANCE_THRESHOLD) {
            return GestureType.PINCH
        }

        // 计算历史轨迹的运动特征
        val xs = handCenterHistory.map { it.first }
        val ys = handCenterHistory.map { it.second }
        val times = timestampHistory

        val timeSpanMs = if (times.size >= 2) (times.last() - times.first()).toFloat() else 0f
        if (timeSpanMs < 100f) return GestureType.NONE // 历史太短

        // 2. 挥手检测：x 方向快速往复，手在画面上半
        val xAmplitude = (xs.max() - xs.min())
        val xFreqHz = estimateFrequency(xs, times)
        if (palmY < WAVE_MAX_Y && xAmplitude > WAVE_MIN_AMPLITUDE && xFreqHz >= WAVE_MIN_FREQ_HZ) {
            return GestureType.WAVE
        }

        // 3. 抚摸检测：y 方向缓慢往复，持续时间足够
        val yAmplitude = (ys.max() - ys.min())
        val yFreqHz = estimateFrequency(ys, times)
        if (yAmplitude > PET_MIN_AMPLITUDE && yFreqHz in PET_MIN_FREQ_HZ..WAVE_MIN_FREQ_HZ
            && gestureDurationFrames >= PET_MIN_FRAMES
        ) {
            return GestureType.PET
        }

        // 4. 点击检测：食指尖有快速运动然后停住（基于速度）
        if (handCenterHistory.size >= 4) {
            val recent = handCenterHistory.takeLast(3)
            val prev = handCenterHistory[handCenterHistory.size - 4]
            val dx = abs(recent.last().first - prev.first)
            val dy = abs(recent.last().second - prev.second)
            val speed = hypot(dx, dy)
            if (speed > TAP_SPEED_THRESHOLD) {
                return GestureType.TAP
            }
        }

        return GestureType.NONE
    }

    /**
     * 估算时序数据的往复运动频率（Hz）。
     * 通过计算过零次数（零点为均值）来近似频率。
     */
    private fun estimateFrequency(values: List<Float>, timestamps: List<Long>): Float {
        if (values.size < 3) return 0f

        val mean = values.average().toFloat()
        var zeroCrossings = 0
        for (i in 1 until values.size) {
            val prev = values[i - 1] - mean
            val curr = values[i] - mean
            if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) {
                zeroCrossings++
            }
        }

        val timeSpanSec = if (timestamps.size >= 2) {
            (timestamps.last() - timestamps.first()) / 1000f
        } else 0f
        if (timeSpanSec <= 0f) return 0f

        // 频率 = 过零次数 / 2 / 时间（每次往复 = 2 次过零）
        return zeroCrossings / 2f / timeSpanSec
    }
}
