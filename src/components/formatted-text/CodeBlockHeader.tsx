import React from "react";
import { Copy, Check, Code2 } from "lucide-react";

interface CodeBlockHeaderProps {
  language?: string;
  code: string;
}

export function CodeBlockHeader({ language, code }: CodeBlockHeaderProps): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(15);
        } catch (_) {}
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code block:", err);
    }
  }, [code]);

  const displayLanguage = (language || "code").toLowerCase();

  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-muted/80 border-b border-border/40 text-muted-foreground text-xs font-mono select-none rounded-t-lg">
      <div className="flex items-center gap-1.5">
        <Code2 className="w-3.5 h-3.5 text-primary/70" />
        <span className="font-semibold text-[11px] uppercase tracking-wider text-foreground/80">
          {displayLanguage}
        </span>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-background/60 active:scale-95 transition text-[11px] font-sans font-medium text-foreground/80 hover:text-foreground border border-transparent hover:border-border/50"
        title="复制代码"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-emerald-500 font-semibold">已复制</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5 opacity-70" />
            <span>复制</span>
          </>
        )}
      </button>
    </div>
  );
}

export default React.memo(CodeBlockHeader);
