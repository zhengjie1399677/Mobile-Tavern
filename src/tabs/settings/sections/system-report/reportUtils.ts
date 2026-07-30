export const isErrorLine = (line: string): boolean =>
    /\bERROR\b|\bCRITICAL\b/i.test(line);

export const isWarningLine = (line: string): boolean =>
    /\bWARNING\b|⚠️|⚠|\bmoderate\b|\bHIGH\b/i.test(line);

export function writeClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand("copy");
    } catch {
        // 忽略复制失败，调用方会继续保留可手动复制的报告文本。
    }
    document.body.removeChild(textarea);
}
