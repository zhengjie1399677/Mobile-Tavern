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
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.lang.ref.WeakReference
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale

/**
 * 注入到 WebView 的 Android 原生桥接类 (`window.AndroidThemeBridge`)。
 *
 * 前端通过 `(window as any).AndroidThemeBridge` 调用暴露的 `@JavascriptInterface` 方法。
 * 提供安全区域（Safe Area）计算、沉浸式状态栏与屏幕方向控制、系统 TTS 朗诵、原生 AudioRecord
 * 16 kHz 单声道 WAV 语音录制与触觉振动反馈、Scoped Storage 文件导出、全盘角色卡扫描与安全读取等核心原生能力。
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

        // 在主线程初始化系统 TTS 引擎
        activity.runOnUiThread {
            try {
                tts = TextToSpeech(activity, this)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to instantiate TextToSpeech", e)
            }
        }

        // 注册 Activity 生命周期监听，在销毁时安全释放 TTS 与录音资源，杜绝内存泄漏
        activity.application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityDestroyed(act: Activity) {
                if (act === activity) {
                    discardPreviousRecord(joinWorker = false)
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

    /** 调用系统 TTS 朗读文本。 */
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

    /** 停止当前正在播放的原生 TTS 朗读。 */
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

    /** 查询原生 TTS 当前是否正在朗读。 */
    @JavascriptInterface
    fun isSpeakingNative(): Boolean {
        // TTS 引擎未成功初始化时直接返回 false，
        // 避免调用 tts?.isSpeaking 触发 "not bound to TTS engine" 警告刷屏
        if (!ttsInitialized) return false
        return tts?.isSpeaking ?: false
    }

    // ---------------------------------------------------------------------
    // 原生音频录制（AudioRecord 直录 16 kHz 单声道 PCM16 WAV）与振动反馈
    // ---------------------------------------------------------------------

    private val recordLock = Any()
    private var audioRecord: AudioRecord? = null
    private var recordThread: Thread? = null
    private var currentRecordFile: File? = null
    private var recordMaxDataBytes = 0L
    /** 完成结果缓存：使 stopRecordNative 幂等，并在下一次 start / cancel 时清除。 */
    private var cachedRecordResult: String? = null
    /** 每次采集自增：让仍在收尾的旧循环无法把结果写回新一次采集的状态。 */
    private var recordGeneration = 0
    @Volatile
    private var isRecordingNative = false
    @Volatile
    private var stopRequested = false
    @Volatile
    private var recordAmplitude = 0

    /** 触发短促触觉振动反馈（长按开始录音、松手结束提示）。 */
    private fun triggerHapticFeedback() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(35)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Haptic feedback ignored", e)
        }
    }

    /** 检查应用是否已获得麦克风录音权限。 */
    @JavascriptInterface
    fun hasRecordAudioPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** 动态申请麦克风录音权限。 */
    @JavascriptInterface
    fun requestRecordAudioPermission() {
        if (!hasRecordAudioPermission()) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                1002
            )
        }
    }

    /**
     * 启动原生麦克风录制：AudioRecord 直录 16 kHz 单声道 PCM16，边录边写 WAV。
     *
     * 输出 `audio/wav` 是刻意的：它既能通过前端附件签名检测，又落在 OpenAI 兼容接口
     * 的 `input_audio.format` 枚举（wav|mp3）内。最大时长受 maxDurationMs 限制（默认 180s）。
     */
    @JavascriptInterface
    fun startRecordNative(maxDurationMs: Long): String {
        if (!hasRecordAudioPermission()) {
            requestRecordAudioPermission()
            return "error:PERMISSION_DENIED"
        }

        discardPreviousRecord()

        synchronized(recordLock) {
            recordGeneration += 1
            val generation = recordGeneration
            stopRequested = false
            recordAmplitude = 0

            val minBuffer = AudioRecord.getMinBufferSize(
                RECORD_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            if (minBuffer <= 0) {
                Log.e(TAG, "Unsupported AudioRecord format, minBuffer=$minBuffer")
                return "error:UNSUPPORTED_AUDIO_FORMAT"
            }

            var releaseOnFailure: AudioRecord? = null
            var closeOnFailure: FileOutputStream? = null
            var deleteOnFailure: File? = null
            try {
                val activeRecorder = AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.MIC)
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(RECORD_SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                            .build()
                    )
                    .setBufferSizeInBytes(maxOf(minBuffer * 2, RECORD_READ_BYTES * 4))
                    .build()
                releaseOnFailure = activeRecorder
                if (activeRecorder.state != AudioRecord.STATE_INITIALIZED) {
                    runCatching { activeRecorder.release() }
                    return "error:AUDIO_RECORD_INIT_FAILED"
                }

                val file = File(activity.cacheDir, "tavern_voice_${System.currentTimeMillis()}.wav")
                deleteOnFailure = file
                val activeSink = FileOutputStream(file, false)
                closeOnFailure = activeSink
                activeSink.write(wavHeader(RECORD_SAMPLE_RATE, 0L))
                activeSink.flush()

                activeRecorder.startRecording()
                if (activeRecorder.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                    runCatching { activeSink.close() }
                    runCatching { activeRecorder.release() }
                    runCatching { if (file.exists()) file.delete() }
                    return "error:AUDIO_RECORD_START_FAILED"
                }

                val durationMs = if (maxDurationMs in MIN_RECORD_MS..MAX_RECORD_MS) {
                    maxDurationMs
                } else {
                    DEFAULT_RECORD_MS
                }
                recordMaxDataBytes = RECORD_SAMPLE_RATE.toLong() * RECORD_BYTES_PER_SAMPLE * durationMs / 1000L

                audioRecord = activeRecorder
                currentRecordFile = file
                isRecordingNative = true
                recordThread = Thread(
                    { runRecordLoop(activeRecorder, activeSink, file, generation) },
                    RECORD_THREAD_NAME
                ).also { it.start() }
                triggerHapticFeedback()
                return "OK"
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start native audio recording", e)
                runCatching { closeOnFailure?.close() }
                runCatching { releaseOnFailure?.release() }
                runCatching { deleteOnFailure?.let { if (it.exists()) it.delete() } }
                audioRecord = null
                currentRecordFile = null
                isRecordingNative = false
                return "error:${e.message ?: "UNKNOWN"}"
            }
        }
    }

    /**
     * 停止录音并把结果打包成 Base64 JSON 返回。
     *
     * 幂等：重复调用返回同一份结果，直到下一次 start 或 cancel；停止失败**不会**删除已录到的音频。
     * 三段式是为了避免死锁 —— 读取循环的收尾要拿同一把锁，持锁 join 会与它互等，
     * 所以先在锁内决策、解锁后再停线程、最后在锁内读缓存。
     */
    @JavascriptInterface
    fun stopRecordNative(): String {
        val claimed = synchronized(recordLock) {
            cachedRecordResult?.let { return it }
            if (audioRecord == null && recordThread == null) return "error:NOT_RECORDING"
            stopRequested = true
            audioRecord to recordThread
        }

        runCatching { claimed.first?.stop() }
        val stopTarget = claimed.second
        if (stopTarget != null && stopTarget !== Thread.currentThread()) {
            runCatching { stopTarget.join(RECORD_JOIN_TIMEOUT_MS) }
        }

        synchronized(recordLock) {
            cachedRecordResult?.let { return it }
            return "error:STOP_INCOMPLETE"
        }
    }

    /** 取消录音：作废本次采集并删除临时文件，结果不会被复活。 */
    @JavascriptInterface
    fun cancelRecordNative(): Boolean {
        discardPreviousRecord()
        return true
    }

    /**
     * 丢弃上一次录音的残留：作废旧循环、摘除状态、删除临时文件与缓存结果。
     *
     * **不得在持锁状态下调用 join** —— 读取循环的收尾也要拿同一把锁，持锁 join 会死锁；
     * 因此这里分三段：锁内作废并摘除状态 → 解锁停线程 → 锁内清文件。
     *
     * @param joinWorker 宿主销毁时传 false：那是在主线程上调用，不值得为了等线程结束阻塞 UI。
     *   此时循环已经看到 generation 失效，会自行删除自己的临时文件。
     */
    private fun discardPreviousRecord(joinWorker: Boolean = true) {
        val discarded = synchronized(recordLock) {
            recordGeneration += 1
            stopRequested = true
            val snapshot = audioRecord to recordThread
            audioRecord = null
            recordThread = null
            isRecordingNative = false
            recordAmplitude = 0
            cachedRecordResult = null
            snapshot
        }

        runCatching { discarded.first?.stop() }
        val discardTarget = discarded.second
        if (joinWorker && discardTarget != null && discardTarget !== Thread.currentThread()) {
            runCatching { discardTarget.join(RECORD_JOIN_TIMEOUT_MS) }
        }

        synchronized(recordLock) {
            currentRecordFile?.let { file -> runCatching { if (file.exists()) file.delete() } }
            currentRecordFile = null
        }
    }

    /**
     * 读取循环：写 PCM、更新峰值振幅、到点自行收尾。
     *
     * 收尾（回填 WAV 头、打包 Base64、发布缓存）都在这里完成，`stopRecordNative` 只负责置位并等待。
     */
    private fun runRecordLoop(
        recorder: AudioRecord,
        sink: FileOutputStream,
        outputFile: File,
        generation: Int,
    ) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
        val buffer = ByteArray(RECORD_READ_BYTES)
        var dataBytes = 0L
        var zeroReads = 0
        try {
            while (!stopRequested && dataBytes < recordMaxDataBytes) {
                val want = minOf(buffer.size.toLong(), recordMaxDataBytes - dataBytes).toInt()
                val read = recorder.read(buffer, 0, want, AudioRecord.READ_BLOCKING)
                if (read > 0) {
                    zeroReads = 0
                    sink.write(buffer, 0, read)
                    dataBytes += read
                    recordAmplitude = peakAmplitude(buffer, read)
                } else if (read == AudioRecord.ERROR_INVALID_OPERATION || read == AudioRecord.ERROR_BAD_VALUE) {
                    break
                } else if (read == AudioRecord.ERROR_DEAD_OBJECT) {
                    // 音频服务已死：保住已经录到的内容，不要连录音一起丢
                    Log.w(TAG, "AudioRecord dead object, finalizing with captured audio")
                    break
                } else if (++zeroReads > MAX_ZERO_READS) {
                    Log.w(TAG, "AudioRecord returned no data repeatedly, finalizing")
                    break
                }
            }
            sink.flush()
        } catch (e: Exception) {
            Log.e(TAG, "Native WAV record loop failed", e)
        } finally {
            runCatching { sink.close() }
            runCatching { recorder.release() }
            patchWavHeader(outputFile, RECORD_SAMPLE_RATE, dataBytes)

            // 文件 I/O 放在锁外，避免拖住 stopRecordNative 的第三段。
            val result = when {
                dataBytes <= 0L -> "error:EMPTY_AUDIO"
                else -> buildRecordResult(outputFile, dataBytes)
            }

            synchronized(recordLock) {
                if (generation != recordGeneration) {
                    // 已开始新一次采集（或已取消）：本次结果作废，只清理自己的临时文件。
                    runCatching { if (outputFile.exists()) outputFile.delete() }
                } else {
                    isRecordingNative = false
                    audioRecord = null
                    recordThread = null
                    recordAmplitude = 0
                    if (currentRecordFile === outputFile) currentRecordFile = null
                    cachedRecordResult = result
                }
            }
            triggerHapticFeedback()
        }
    }

    /** 读取临时文件并打包成前端约定的 JSON，随后删除临时文件。 */
    private fun buildRecordResult(file: File, dataBytes: Long): String {
        if (dataBytes > MAX_RECORD_BYTES) {
            runCatching { if (file.exists()) file.delete() }
            return "error:AUDIO_TOO_LARGE"
        }
        return try {
            val bytes = file.readBytes()
            runCatching { file.delete() }
            val json = JSONObject().apply {
                put("success", true)
                put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                put("mimeType", "audio/wav")
                put("format", "wav")
                // 由实际字节数反算，保证与音频长度一致（循环可能略晚于 JS 定时器收尾）。
                put("durationMs", dataBytes * 1000L / (RECORD_SAMPLE_RATE.toLong() * RECORD_BYTES_PER_SAMPLE))
                put("sizeBytes", bytes.size)
            }
            json.toString()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to package native recording", e)
            "error:${e.message ?: "UNKNOWN"}"
        }
    }

    /** 读取当前录音峰值振幅（0..32767），用于驱动前端实时波形跳动动效。 */
    @JavascriptInterface
    fun getRecordAmplitudeNative(): Int {
        if (!isRecordingNative) return 0
        return recordAmplitude
    }

    /** 从 16-bit little-endian PCM 求峰值振幅，量纲与旧的 MediaRecorder.maxAmplitude 一致。 */
    private fun peakAmplitude(buffer: ByteArray, length: Int): Int {
        var peak = 0
        var index = 0
        while (index + 1 < length) {
            val raw = (buffer[index].toInt() and 0xFF) or (buffer[index + 1].toInt() shl 8)
            val magnitude = if (raw >= 0x8000) 0x10000 - raw else raw
            if (magnitude > peak) peak = magnitude
            index += RECORD_BYTES_PER_SAMPLE
        }
        return peak
    }

    /** 生成 44 字节 RIFF/WAVE 头，字段顺序与取值和前端 encodePcm16Wav 保持一致。 */
    private fun wavHeader(sampleRate: Int, dataBytes: Long): ByteArray {
        val header = ByteBuffer.allocate(WAV_HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt((36L + dataBytes).toInt())
        header.put("WAVE".toByteArray(Charsets.US_ASCII))
        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(16)
        header.putShort(1) // PCM
        header.putShort(RECORD_CHANNELS.toShort())
        header.putInt(sampleRate)
        header.putInt(sampleRate * RECORD_BYTES_PER_SAMPLE)
        header.putShort(RECORD_BYTES_PER_SAMPLE.toShort())
        header.putShort(16) // bits per sample
        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(dataBytes.toInt())
        return header.array()
    }

    /**
     * 回填 RIFF/data 长度。失败时文件仍是 `dataBytes=0` 的合法空 WAV，
     * 依然能被前端识别为 audio/wav，不会产生损坏文件。
     */
    private fun patchWavHeader(file: File, sampleRate: Int, dataBytes: Long) {
        try {
            RandomAccessFile(file, "rw").use { access ->
                access.seek(0L)
                access.write(wavHeader(sampleRate, dataBytes))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to patch WAV header", e)
        }
    }

    companion object {
        private const val TAG = "TavernThemeBridge"
        /** 键盘「吸底」判定容差：部分 OEM 在收起动画期间 inset 仍保留，用一段余量兜住中间态。 */
        private const val IME_DOCK_TOLERANCE_DP = 40f
        private const val MAX_SCAN_DEPTH = 12
        private const val MAX_SCANNED_FILES = 5_000
        private const val MAX_SCANNED_DIRECTORIES = 20_000
        private const val MAX_IMPORT_BYTES = 64L * 1024L * 1024L

        // 原生语音录制：16 kHz 单声道 PCM16 直写 WAV。
        private const val RECORD_SAMPLE_RATE = 16_000
        private const val RECORD_CHANNELS = 1
        private const val RECORD_BYTES_PER_SAMPLE = 2
        private const val WAV_HEADER_BYTES = 44
        /** 每次读取 100ms 音频，与前端振幅轮询节奏对齐。 */
        private const val RECORD_READ_BYTES = 3_200
        private const val DEFAULT_RECORD_MS = 180_000L
        private const val MIN_RECORD_MS = 1_000L
        private const val MAX_RECORD_MS = 600_000L
        private const val RECORD_JOIN_TIMEOUT_MS = 1_500L
        /** 3 分钟 16 kHz 单声道约 5.8MB；上限用于挡住异常时长导致的超大 base64。 */
        private const val MAX_RECORD_BYTES = 24L * 1024L * 1024L
        private const val MAX_ZERO_READS = 50
        private const val RECORD_THREAD_NAME = "TavernVoiceRecord"

        private var activeStorageBridge: WeakReference<AndroidThemeBridge>? = null

        /**
         * MediaStore 公共 Download 相对子路径，与前端导出提示目录保持一致。
         */
        private const val DOWNLOAD_RELATIVE_SUBDIR = "Download/Mobile Tavern/"

        /** 宿主 Activity 返回前台时同步“所有文件访问权限”的最终状态。 */
        @JvmStatic
        fun notifyStoragePermissionStateOnResume() {
            activeStorageBridge?.get()?.completeStoragePermissionRequestIfPending()
        }
    }

    // ---------------------------------------------------------------------
    // 安全区域与视口内边距计算
    // ---------------------------------------------------------------------

    /**
     * 软键盘是否真正吸底显示。
     *
     * 悬浮/分体键盘不占底部空间，不能当作「键盘顶起页面」处理；部分 OEM 在收起动画期间
     * `isVisible(ime)` 会先变 false 而 inset 仍保留，故用 [IME_DOCK_TOLERANCE_DP] 兜住中间状态。
     */
    private fun isImeDocked(
        imeBottomPx: Int,
        navigationBottomPx: Int,
        imeVisible: Boolean,
        density: Float,
    ): Boolean {
        if (imeBottomPx <= navigationBottomPx) return false
        return imeVisible || imeBottomPx > navigationBottomPx + IME_DOCK_TOLERANCE_DP * density
    }

    /**
     * 顶部安全区的唯一口径。
     *
     * 优先使用系统栏 / 挖孔 inset；只有在拿不到 inset（早期布局阶段返回 0）时才回退到
     * `status_bar_height` 资源值。同步取值 [getSafeAreas] 与推送 [dispatchSafeAreasChanged]
     * 必须共用这里，否则会出现「首次取值与后续推送不一致」的顶栏跳动。
     */
    private fun resolveTopInsetPx(systemBarsTopPx: Int): Int {
        if (systemBarsTopPx > 0) return systemBarsTopPx
        val statusResourceId = activity.resources.getIdentifier(
            "status_bar_height", "dimen", "android"
        )
        return if (statusResourceId > 0) {
            activity.resources.getDimensionPixelSize(statusResourceId)
        } else {
            0
        }
    }

    /**
     * 以设备独立像素（dp）返回当前系统栏（状态栏与导航栏）安全区域内边距。
     * 返回 JSON 格式：`{ "top": <dp>, "bottom": <dp>, "left": <dp>, "right": <dp> }`
     *
     * 前端解析后应用到 CSS 根变量。此方法为 JS 同步调用，不得执行任何长耗时或阻塞操作。
     */
    @JavascriptInterface
    fun getSafeAreas(): String {
        val json = JSONObject()
        val density = activity.resources.displayMetrics.density
        if (density <= 0f) {
            // 防御性兜底：密度异常时回退为全 0
            json.put("top", 0)
            json.put("bottom", 0)
            json.put("left", 0)
            json.put("right", 0)
            return json.toString()
        }

        // 1. 顶部安全区与 dispatchSafeAreasChanged 共用同一口径，避免两条入口给出不同高度。
        var topPx = 0

        // 2. 通过 WindowInsetsCompat 获取导航栏与系统手势内边距
        var bottomPx = 0
        var leftPx = 0
        var rightPx = 0
        var insetsResolved = false
        var imeVisible = false

        val rootView = activity.window.decorView.rootView
        val rawInsets = rootView.rootWindowInsets
        if (rawInsets != null) {
            val compatInsets = WindowInsetsCompat.toWindowInsetsCompat(rawInsets, rootView)
            val systemBars = compatInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
            )
            // 底部只认导航栏 / 手势条。systemBars 的联合结果在部分 ROM（MIUI 等）
            // 上会把输入法高度一起算进来，键盘弹起时底栏就会被顶到页面中间。
            val navigationBars = compatInsets.getInsets(WindowInsetsCompat.Type.navigationBars())
            val imeInsets = compatInsets.getInsets(WindowInsetsCompat.Type.ime())
            imeVisible = compatInsets.isVisible(WindowInsetsCompat.Type.ime())
            val imeDocked = isImeDocked(imeInsets.bottom, navigationBars.bottom, imeVisible, density)
            topPx = resolveTopInsetPx(systemBars.top)
            bottomPx = if (imeDocked) 0 else navigationBars.bottom
            leftPx = systemBars.left
            rightPx = systemBars.right
            insetsResolved = bottomPx != 0 || leftPx != 0 || rightPx != 0
        }

        // 2b. 拿不到 WindowInsets（早期布局）时，顶部回退到资源值，与推送口径保持一致。
        if (topPx == 0) {
            topPx = resolveTopInsetPx(0)
        }

        // 3. 早期布局阶段 WindowInsets 尚未就绪时的底部安全区兜底计算
        //    注意：adjustResize 下这个差值正好等于输入法高度，键盘可见时绝不能
        //    把它当作底部安全区，否则底栏和固定底部操作会被整体顶起一个键盘高度。
        if (!insetsResolved && !imeVisible) {
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
     * 将当前最新安全区内边距通过 CustomEvent ('androidSafeAreasChanged') 主动推送到前端。
     * 由 WebView 容器的 OnApplyWindowInsetsListener 调用。
     */
    fun dispatchSafeAreasChanged(view: View, insets: android.view.WindowInsets) {
        val density = activity.resources.displayMetrics.density
        if (density <= 0f) return

        val compatInsets = WindowInsetsCompat.toWindowInsetsCompat(insets, view)
        val systemBars = compatInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() or
                WindowInsetsCompat.Type.displayCutout()
        )
        val navigationBars = compatInsets.getInsets(WindowInsetsCompat.Type.navigationBars())
        val imeInsets = compatInsets.getInsets(WindowInsetsCompat.Type.ime())
        val imeVisible = compatInsets.isVisible(WindowInsetsCompat.Type.ime())

        // 顶部与同步入口 getSafeAreas 共用同一口径（systemBars 已包含 displayCutout）。
        val topPx = resolveTopInsetPx(systemBars.top)

        // 判定软键盘是否真正附着在屏幕底部（悬浮/分体键盘不占底部；OEM 收起动画的中间态由容差兜住）
        val imeDocked = isImeDocked(imeInsets.bottom, navigationBars.bottom, imeVisible, density)
        val imeBottomPx = if (imeDocked) imeInsets.bottom else 0

        val topDp = (topPx / density).toInt()
        // 软键盘弹起吸底时，底部导航栏安全区传 0，避免底部元素在被 WebView 垫起后又叠加一层导航栏留白
        val bottomDp = if (imeDocked) 0 else (navigationBars.bottom / density).toInt()
        val leftDp = (systemBars.left / density).toInt()
        val rightDp = (systemBars.right / density).toInt()

        Log.d(
            TAG,
            "onApplyWindowInsets: topDp=$topDp, bottomDp=$bottomDp, leftDp=$leftDp, rightDp=$rightDp, imeBottomPx=$imeBottomPx"
        )

        // 核心修复（Android 12 ~ 17 全版本兼容）：
        // 在 Android 15+ (API 35+) 及 Android 16/17 中，enableEdgeToEdge 强制全屏沉浸绘制，
        // 传统的 windowSoftInputMode="adjustResize" 不再自动压缩根窗口/WebView。
        // 当软键盘弹起时，必须通过 padding 将 WebView 的内容绘制区域垫高，
        // 从而直接触发 Chromium 内部视口收缩并触发 resize 事件，彻底解决输入框被键盘遮挡的问题；
        // 当软键盘收起时，padding 恢复为 0，继续保持底部手势栏的无缝穿透沉浸。
        if (view.paddingBottom != imeBottomPx) {
            view.setPadding(0, 0, 0, imeBottomPx)
        }

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
     * 更新系统状态栏与导航栏的背景色与图标明暗。
     *
     * @param isDark 为 true 时表示深色主题，使用浅色（白）图标；为 false 时使用深色（黑）图标。
     * @param colorHex 目标背景色十六进制字符串，如 "#1a2040"。
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
                // isAppearanceLightStatusBars = true 表示深色图标；
                // 前端传入 isDark = true 表示深色背景主题，因此需要浅色（白色）图标，取反传 false。
                wic.isAppearanceLightStatusBars = !isDark
                wic.isAppearanceLightNavigationBars = !isDark
            } catch (e: Exception) {
                Log.e(TAG, "Failed to set status bar style", e)
            }
        }
    }

    /**
     * 设置 Activity 屏幕方向：锁定为传感器横屏，或恢复为系统自动旋转控制。
     *
     * @param mode 模式："landscape" 锁定横屏，"auto" 自动旋转。
     * @return 请求是否成功派发到 Android UI 线程。
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
     * 进入或退出全屏沉浸模式（隐藏系统状态栏与导航栏，边缘滑动呼出）。
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

    /** 输出全屏插件宿主侧诊断日志。 */
    @JavascriptInterface
    fun logPluginDiagnostic(message: String) {
        Log.i("TavernPlugin", message.take(500))
    }

    /** 调用 Android 系统原生分享面板分享文本或 JSON 内容。 */
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

    /** 在系统默认浏览器中打开指定链接。 */
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
    // 文件保存与公共存储管理
    // ---------------------------------------------------------------------

    /**
     * 将 UTF-8 文本内容（如角色卡 JSON、预设配置或备份）保存到公共 Download 目录。
     *
     * @param fileName 目标文件名，如 "Character_ST_Card.json"。
     * @param content 要写入的文本内容。
     * @return 成功时返回保存路径（如 "Download/Mobile Tavern/Character_ST_Card.json"），失败返回以 "error:" 开头的错误信息。
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
     * 将二进制文件（如 PNG 角色卡）保存到公共 Download 目录。
     *
     * @param fileName 目标文件名，如 "Character_SillyTavern.png"。
     * @param base64Data Base64 编码数据（自动兼容并剥离 "data:...;base64," 前缀）。
     * @param mimeType 媒体类型，如 "image/png"。
     * @return 成功时返回保存路径，失败返回以 "error:" 开头的错误信息。
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
     * 诊断测试导出 IO 链路的读写与校验能力，写入临时文件后读取比对并自动删除，不在 Download 目录残留冗余数据。
     */
    @JavascriptInterface
    fun verifyFileIo(): String {
        val payload = "MobileTavernDiag:${System.currentTimeMillis()}".toByteArray(Charsets.UTF_8)
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                verifyMediaStoreFileIo(payload)
            } else {
                verifyLegacyFileIo(payload)
            }
            "OK"
        } catch (e: Exception) {
            Log.e(TAG, "Native file IO verification failed", e)
            "error:${e.message ?: "Unknown file IO verification error"}"
        }
    }

    private fun verifyMediaStoreFileIo(payload: ByteArray) {
        val resolver = activity.contentResolver
        var uri: Uri? = null
        try {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, ".mobile_tavern_io_probe_${System.currentTimeMillis()}.tmp")
                put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream")
                put(MediaStore.MediaColumns.RELATIVE_PATH, DOWNLOAD_RELATIVE_SUBDIR)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
            }
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Failed to create temporary MediaStore entry")
            resolver.openOutputStream(uri, "w")?.use { stream ->
                stream.write(payload)
                stream.flush()
            } ?: throw IllegalStateException("Failed to open temporary MediaStore output stream")

            val restored = resolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("Failed to open temporary MediaStore input stream")
            if (!restored.contentEquals(payload)) {
                throw IllegalStateException("Temporary MediaStore content mismatch")
            }
        } finally {
            uri?.let { runCatching { resolver.delete(it, null, null) } }
        }
    }

    private fun verifyLegacyFileIo(payload: ByteArray) {
        val downloadDir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "Mobile Tavern"
        )
        if (!downloadDir.exists() && !downloadDir.mkdirs()) {
            throw IllegalStateException("Failed to create Download/Mobile Tavern directory")
        }
        val file = File(downloadDir, ".mobile_tavern_io_probe_${System.currentTimeMillis()}.tmp")
        try {
            FileOutputStream(file).use { stream ->
                stream.write(payload)
                stream.flush()
            }
            if (!file.readBytes().contentEquals(payload)) {
                throw IllegalStateException("Temporary legacy file content mismatch")
            }
        } finally {
            runCatching { file.delete() }
        }
    }

    /**
     * [saveFile] 与 [saveFileBase64] 的统一写入入口。
     *
     * Android 10+ (API 29+) 走 MediaStore.Downloads（受 Scoped Storage 保护且无需外部存储写入权限）；
     * Android 9 及以下回退到传统公共 Downloads 目录。
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
     * Android 10+ (API 29+) 采用 MediaStore.Downloads 写入文件。
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
            // RELATIVE_PATH 仅在 API 29+ 可用
            put(MediaStore.MediaColumns.RELATIVE_PATH, DOWNLOAD_RELATIVE_SUBDIR)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // 标记为正在写入（IS_PENDING=1），在写入完成前对其他应用隐藏
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
            // 尽最大努力清理半成品条目，避免在 Download 目录遗留空文件
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
     * Android 9 及以下（API 24-28）回退写入公共 Download 目录。
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
    // 内部辅助函数
    // ---------------------------------------------------------------------

    /**
     * 清理文件名中的路径分隔符，防止非法字符或目录穿越。
     */
    private fun sanitizeFileName(fileName: String): String {
        val trimmed = fileName.trim()
        if (trimmed.isEmpty()) return "export.bin"
        return trimmed.replace(Regex("[\\\\/]"), "_")
    }

    /**
     * 当未显式指定时，根据扩展名推断合理的 MIME 类型。
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
     * 弹出系统 Toast 提示用户文件已保存到的相对路径。
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
    // 全盘角色卡扫描与安全读取
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

    /** 检查是否具备全盘存储访问权限（MANAGE_EXTERNAL_STORAGE）。 */
    @JavascriptInterface
    fun hasStoragePermission(): Boolean {
        return Environment.isExternalStorageManager()
    }

    /** 跳转系统设置页面申请全盘存储访问权限。 */
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

    /** 扫描全盘受支持的角色卡文件（.json 与 .png），受深度与扫描预算上限保护。 */
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

    /**
     * 安全读取扫描到的本地角色卡文件内容（仅限受白名单保护目录内的 .json 或 .png 文件）。
     * PNG 文件以 "data:image/png;base64,..." 格式返回，JSON 文件以 UTF-8 文本返回。
     */
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
