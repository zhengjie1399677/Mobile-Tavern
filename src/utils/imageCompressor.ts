/**
 * Helper to compress and resize images client-side before saving them to IndexedDB.
 * Prevents UI lags and database bloat.
 */
export function compressImage(
  file: File | string,
  maxWidth: number,
  maxHeight: number,
  quality = 0.8,
  outputType = "image/jpeg"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Calculate new dimensions keeping aspect ratio
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(typeof file === "string" ? file : "");
        return;
      }

      // Draw and scale the image
      ctx.drawImage(img, 0, 0, width, height);

      // Export as base64 string
      const dataUrl = canvas.toDataURL(outputType, quality);

      // Cleanup DOM/VRAM references to prevent memory leaks
      canvas.width = 0;
      canvas.height = 0;
      img.onload = null;
      img.onerror = null;
      img.src = "";

      resolve(dataUrl);
    };

    img.onerror = (err) => {
      img.onload = null;
      img.onerror = null;
      img.src = "";
      reject(new Error("图片加载失败，请确保文件是有效的图像格式。"));
    };

    if (typeof file === "string") {
      img.src = file;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    }
  });
}
