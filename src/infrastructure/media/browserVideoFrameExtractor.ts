const VIDEO_LOAD_TIMEOUT_MS = 15_000;

/** WebView 媒体适配器：从本地视频 Blob 抽取有限数量 JPEG 关键帧。 */
export async function extractVideoKeyframes(
  blob: Blob,
  requestedFrameCount = 4,
  signal?: AbortSignal,
): Promise<Blob[]> {
  if (!blob.type.startsWith("video/") || blob.size <= 0) {
    throw new Error("VIDEO_FRAME_SOURCE_INVALID");
  }
  if (!Number.isInteger(requestedFrameCount) || requestedFrameCount < 1 || requestedFrameCount > 8) {
    throw new Error("VIDEO_FRAME_COUNT_INVALID");
  }
  assertNotAborted(signal);

  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await waitForMediaEvent(video, "loadedmetadata", signal);
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("VIDEO_DURATION_INVALID");
    }
    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error("VIDEO_DIMENSIONS_INVALID");
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("VIDEO_CANVAS_UNAVAILABLE");

    const frames: Blob[] = [];
    for (let index = 0; index < requestedFrameCount; index += 1) {
      assertNotAborted(signal);
      const timestamp = video.duration * (index + 1) / (requestedFrameCount + 1);
      video.currentTime = timestamp;
      await waitForMediaEvent(video, "seeked", signal);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(await canvasToJpeg(canvas, signal));
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForMediaEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "seeked",
  signal?: AbortSignal,
): Promise<void> {
  assertNotAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`VIDEO_${eventName.toUpperCase()}_TIMEOUT`)), VIDEO_LOAD_TIMEOUT_MS);
    const onSuccess = () => finish();
    const onError = () => finish(new Error("VIDEO_DECODE_FAILED"));
    const onAbort = () => finish(signal?.reason ?? new DOMException("aborted", "AbortError"));
    const finish = (error?: unknown) => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error !== undefined) reject(error);
      else resolve();
    };
    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  assertNotAborted(signal);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (!blob) {
        reject(new Error("VIDEO_FRAME_ENCODE_FAILED"));
        return;
      }
      resolve(blob);
    }, "image/jpeg", 0.82);
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
}
