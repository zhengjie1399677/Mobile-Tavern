/**
 * 写入系统剪贴板。优先使用 Clipboard API；受限 WebView 下回退到选区复制。
 */
export async function writeTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Android WebView 或非安全上下文可能暴露 API 但拒绝调用，继续走兼容回退。
    }
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    throw new Error("CLIPBOARD_UNAVAILABLE");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    if (!document.execCommand("copy")) throw new Error("CLIPBOARD_COPY_REJECTED");
  } finally {
    document.body.removeChild(textarea);
  }
}
