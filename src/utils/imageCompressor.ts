/**
 * 客户端图片压缩与调整尺寸辅助函数。
 * 在保存到 IndexedDB 前压缩图片，防止界面卡顿和数据库膨胀。
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

      // 保持长宽比计算新尺寸
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

      // 绘制并缩放图像
      ctx.drawImage(img, 0, 0, width, height);

      // 导出为 base64 字符串
      const dataUrl = canvas.toDataURL(outputType, quality);

      // 清理 DOM/显存引用以防止内存泄漏
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
