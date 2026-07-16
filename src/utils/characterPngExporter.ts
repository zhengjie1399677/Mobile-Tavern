import { CharacterCard } from "../types";
import { injectPngMetadata } from "./cardParser";

/**
 * 角色卡 PNG 导出器（纯函数工具模块）
 *
 * 从 useCharacters.ts 抽离的 Canvas 渲染 + PNG 元数据注入逻辑。
 * 负责：绘制头像 / 文字兜底背景 → 生成 Blob → 注入 SillyTavern 元数据。
 * 不负责文件保存（由调用方通过原生桥接或下载链接触发）。
 */

/**
 * 原生 Android WebView 注入的桥接对象形状（仅声明本文件实际使用的方法子集）。
 * 完整定义见 src-tauri/plugins/android-bridge/guest-js/index.ts。
 */
interface AndroidThemeBridge {
  saveFileBase64?: (fileName: string, base64Data: string, mimeType: string) => string;
}

/**
 * 扩展 Window 以访问原生注入的 AndroidThemeBridge。
 * 字段可选，反映"运行时动态挂载到 window"的真实语义。
 */
interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
}

/**
 * 生成包含角色卡元数据的 PNG Blob。
 * - 若角色含 avatar：绘制头像
 * - 若头像加载失败或无 avatar：绘制渐变背景 + 角色名文字
 * - 最终注入 SillyTavern 标准 PNG 元数据
 */
export async function generateCharacterPngBlob(char: CharacterCard): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // 底色填充
  ctx.fillStyle = "#1e1e2e";
  ctx.fillRect(0, 0, 400, 400);

  let exportedWithAvatar = false;

  // 尝试绘制头像
  if (char.avatar) {
    try {
      const img = new Image();
      if (!char.avatar.startsWith("data:")) {
        img.crossOrigin = "anonymous";
      }
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (err) => reject(err);
        img.src = char.avatar || "";
      });
      ctx.drawImage(img, 0, 0, 400, 400);
      exportedWithAvatar = true;
    } catch (imgErr) {
      console.warn("Failed to load char avatar for PNG export, falling back to text avatar:", imgErr);
    }
  }

  // 头像路径：尝试生成 Blob
  let rawBlob: Blob | null = null;
  if (exportedWithAvatar) {
    try {
      rawBlob = await new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error("toBlob returned null"));
          }, "image/png");
        } catch (blobErr) {
          reject(blobErr);
        }
      });
    } catch (toBlobErr) {
      console.warn("Failed to export tainted canvas, falling back to text avatar:", toBlobErr);
      exportedWithAvatar = false;
    }
  }

  // 文字兜底路径：渐变背景 + 角色名
  if (!exportedWithAvatar) {
    ctx.fillStyle = "#1e1e2e";
    ctx.fillRect(0, 0, 400, 400);

    const gradient = ctx.createLinearGradient(40, 40, 360, 360);
    gradient.addColorStop(0, "#89b4fa");
    gradient.addColorStop(1, "#cba6f7");
    ctx.fillStyle = gradient;

    const x = 40, y = 40, w = 320, h = 320, r = 20;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#11111b";
    ctx.font = "bold 36px 'Outfit', 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const displayName = char.name.length > 8 ? char.name.slice(0, 8) + "..." : char.name;
    ctx.fillText(displayName, 200, 200);

    rawBlob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });
  }

  if (!rawBlob) throw new Error("Blob generation failed");

  // 注入 SillyTavern 标准 PNG 元数据
  const arrayBuffer = await rawBlob.arrayBuffer();
  return injectPngMetadata(arrayBuffer, char);
}

/**
 * 通过原生桥接（Android WebView）或浏览器下载保存文件。
 * 返回保存路径（原生）或 undefined（浏览器下载已触发）。
 */
export function saveBlobViaBridgeOrDownload(
  blob: Blob,
  fileName: string,
  mimeType: string,
  onSuccess: (path: string) => void,
  onError: (msg: string) => void
): void {
  // 原生桥接路径：转 base64 后调用 AndroidThemeBridge.saveFileBase64
  if ((window as WindowWithAndroidBridge).AndroidThemeBridge && typeof (window as WindowWithAndroidBridge).AndroidThemeBridge?.saveFileBase64 === "function") {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = (reader.result as string).split(",")[1];
      const path = (window as WindowWithAndroidBridge).AndroidThemeBridge!.saveFileBase64!(fileName, base64data, mimeType);
      if (path && !path.startsWith("error:")) {
        onSuccess(path);
      } else {
        onError(path || "未知错误");
      }
    };
    return;
  }

  // 浏览器下载路径
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
  onSuccess("");
}
