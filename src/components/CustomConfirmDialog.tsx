import React, { useContext, useState, useEffect } from "react";
import { AppContext } from "../AppContext";

export default function CustomConfirmDialog() {
  const {
    customDialog,
  } = useContext(AppContext);

  const [localVal, setLocalVal] = useState("");

  useEffect(() => {
    if (customDialog && customDialog.isOpen && customDialog.type === "prompt") {
      setLocalVal(customDialog.defaultValue || "");
    }
  }, [customDialog]);

  if (!customDialog || !customDialog.isOpen) return null;

  return (
    <div
      className="absolute inset-0 bg-background/55 backdrop-blur-md flex items-center justify-center p-4 transition-all duration-300 z-50 animate-fadeIn"
      style={{ zIndex: 100 }}
    >
      <div className="glass-panel rounded-2xl max-w-sm w-full p-6 space-y-5 shadow-2xl border border-white/10 dark:border-white/5 text-foreground animate-fadeIn">
        <div className="space-y-2">
          <h4 className="font-bold text-foreground text-sm tracking-wide">
            {customDialog.title}
          </h4>
          <p className="text-xs text-muted-foreground/95 leading-relaxed font-light">
            {customDialog.message}
          </p>
          {customDialog.type === "prompt" && (
            <div className="pt-2">
              <input
                type="text"
                value={localVal}
                onChange={(e) => setLocalVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    customDialog.onConfirmPrompt?.(localVal);
                  }
                }}
                autoFocus
                className="w-full bg-input/80 text-xs text-foreground border border-border/70 rounded-xl px-3 py-2 focus:outline-none focus:border-primary/50 focus:bg-background/90 transition-all duration-300 shadow-inner"
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-1">
          {(customDialog.type === "confirm" ||
            customDialog.type === "prompt") && (
            <button
              onClick={() => customDialog.onCancel?.()}
              className="bg-muted/50 tap-scale text-muted-foreground px-4 py-2 rounded-xl text-xs font-semibold border border-border/60 hover:bg-muted transition-all duration-300"
            >
              取消
            </button>
          )}
          <button
            onClick={() => {
              if (customDialog.type === "prompt") {
                customDialog.onConfirmPrompt?.(localVal);
              } else {
                customDialog.onConfirm?.();
              }
            }}
            className="bg-primary tap-scale text-primary-foreground hover:bg-primary/95 px-5 py-2 rounded-xl text-xs font-bold transition-all duration-300 shadow-md hover:shadow-lg hover:shadow-primary/20"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
