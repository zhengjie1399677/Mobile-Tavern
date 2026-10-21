import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/src/components/ui/dialog";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";
import { ThemeStudioResourceView } from "./ThemeStudioResourceView";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";

interface MiniResourceManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  resourcePort: ThemeStudioResourcePort | undefined;
  onInsertCode?: (code: string) => void;
  onResourcesChanged?: () => void;
  showCustomAlert?: (msg: string, title?: string) => Promise<void>;
  showCustomConfirm?: (msg: string, title?: string) => Promise<boolean>;
}

export function MiniResourceManagerModal({
  isOpen,
  onClose,
  resourcePort,
  onInsertCode,
  onResourcesChanged,
  showCustomAlert,
  showCustomConfirm,
}: MiniResourceManagerModalProps) {
  // 移动端实体/手势返回键拦截，优先关闭素材库浮层，不退出主题工作室
  useMobileBackHandler(isOpen, () => {
    onClose();
    return true;
  }, 860);

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="z-[1050] bg-black/75"
        className="z-[1050] w-[94vw] max-w-2xl max-h-[88dvh] flex flex-col p-3 sm:p-4 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="sr-only">
          <DialogTitle>本地素材库 (短 ID)</DialogTitle>
          <DialogDescription>
            管理主题图片与音视频，提供 5 位短 ID 与一键插入 CSS
          </DialogDescription>
        </div>
        <ThemeStudioResourceView
          resourcePort={resourcePort}
          onInsertCode={onInsertCode}
          onResourcesChanged={onResourcesChanged}
          showCustomAlert={showCustomAlert}
          showCustomConfirm={showCustomConfirm}
          embedded={false}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
