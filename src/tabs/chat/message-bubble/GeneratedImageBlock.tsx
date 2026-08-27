import CloudLoader from "../../../components/CloudLoader";
import { useTranslation } from "../../../contexts/LanguageContext";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";
import { getErrorMessage } from "../../../utils/errorUtils";

interface AndroidThemeBridge {
  saveFile(fileName: string, content: string): string;
  saveFileBase64(fileName: string, base64Data: string, mimeType: string): string;
}

interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
}

interface GeneratedImageBlockProps {
  image?: string;
  isDrawing?: boolean;
  showCustomAlert: UnifiedAppContextProps["showCustomAlert"];
  showCustomConfirm: UnifiedAppContextProps["showCustomConfirm"];
}

export function GeneratedImageBlock({
  image,
  isDrawing,
  showCustomAlert,
  showCustomConfirm,
}: GeneratedImageBlockProps) {
  const { t } = useTranslation();

  const saveImage = async () => {
    if (!image) return;
    const confirmed = await showCustomConfirm(
      t("message_bubble.confirm_save_image"),
    );
    if (!confirmed) return;

    const filename = `draw_${Date.now()}.png`;
    const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
    if (bridge) {
      try {
        let savedPath: string | null = null;
        if (image.startsWith("data:")) {
          const commaIndex = image.indexOf(",");
          const mimeType =
            image.slice(5, commaIndex).split(";")[0] || "image/png";
          savedPath = bridge.saveFileBase64(
            filename,
            image.slice(commaIndex + 1),
            mimeType,
          );
        } else {
          savedPath = bridge.saveFile(filename, image);
        }

        if (savedPath && !savedPath.startsWith("error:")) {
          await showCustomAlert(
            t("message_bubble.image_save_success_msg"),
            t("message_bubble.image_save_success"),
          );
        } else {
          await showCustomAlert(
            t("message_bubble.image_save_failed_msg", {
              error: savedPath || "未知错误",
            }),
            t("message_bubble.image_save_failed"),
          );
        }
        return;
      } catch (error: unknown) {
        console.error("AndroidThemeBridge download failed:", error);
        await showCustomAlert(
          `❌ ${t("message_bubble.save_error")}: ${getErrorMessage(error) || String(error)}`,
          t("message_bubble.image_save_failed"),
        );
        return;
      }
    }

    const link = document.createElement("a");
    link.href = image;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    await showCustomAlert(
      `图片已成功导出！\n文件已触发浏览器或客户端下载，请前往您的系统“下载 (Downloads)”目录查找文件名：\n${filename}`,
      t("message_bubble.export_success"),
    );
  };

  return (
    <>
      {isDrawing && (
        <div className="mt-2 p-3 bg-muted/40 border border-dashed border-border rounded-xl flex items-center justify-center gap-2.5 text-xs text-muted-foreground animate-pulse">
          <CloudLoader size={30} />
          <span>{t("message_bubble.drawing_scene")}</span>
        </div>
      )}

      {image && (
        <div className="mt-2 rounded-xl overflow-hidden border border-border/80 bg-muted/30 shadow-md max-w-full group/image relative select-none">
          <img
            src={image}
            alt="Generated Scene"
            loading="lazy"
            decoding="async"
            className="w-full object-cover max-h-60 cursor-pointer hover:opacity-95 transition-opacity"
            onClick={(event) => {
              event.stopPropagation();
              void saveImage();
            }}
          />
          <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[8px] font-mono pointer-events-none opacity-0 group-hover/image:opacity-100 transition-opacity">
            {t("message_bubble.click_to_save")}
          </div>
        </div>
      )}
    </>
  );
}
