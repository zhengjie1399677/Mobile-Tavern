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
      className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 transition-all duration-200"
      style={{ zIndex: 100 }}
    >
      <div className="bg-card border border-border rounded-xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-foreground">
        <div className="space-y-1.5">
          <h4 className="font-bold text-foreground text-sm tracking-wide">
            {customDialog.title}
          </h4>
          <p className="text-[11.5px] text-muted-foreground leading-relaxed font-light">
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
                className="w-full bg-input text-xs text-foreground border border-border rounded px-2.5 py-1.5 focus:outline-none focus:border-primary transition"
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-1">
          {(customDialog.type === "confirm" ||
            customDialog.type === "prompt") && (
            <button
              onClick={() => customDialog.onCancel?.()}
              className="bg-muted active:scale-[0.98] text-muted-foreground hover:text-muted-foreground px-3.5 py-1.5 rounded text-xs font-semibold border border-border transition shadow"
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
            className="bg-primary hover:bg-primary text-primary-foreground px-4 py-1.5 rounded text-xs font-bold transition shadow"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
