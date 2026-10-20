import React from "react";
import { ArrowLeft, CheckCircle2, Eye, Save, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/src/components/ui/dialog";
import {
  buildThemeDocumentCandidate,
  createThemeDocumentDraft,
  isThemeDocumentDirty,
  markThemeDocumentSaved,
  type ThemeDocumentDraft,
} from "../domain/themes/themeDocumentDraft";
import {
  createThemeDocumentDraftFromTemplate,
  type ThemeStartPointKind,
} from "../domain/themes/themeStartPoints";
import {
  getDefaultThemeStateTokens,
  parseThemeInteractionSource,
} from "../domain/themes/themeInteractionDraft";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { detectCriticalNavigationHiding, type CustomThemePackage } from "../utils/themePackage";
import { AppearanceSection } from "./theme-studio/AppearanceSection";
import { ColorsSection } from "./theme-studio/ColorsSection";
import { CssSection } from "./theme-studio/CssSection";
import { InteractionsSection } from "./theme-studio/InteractionsSection";
import { SECTION_ITEMS, ThemeStudioNavigation } from "./theme-studio/ThemeStudioNavigation";
import ThemeDraftPreview from "./theme-studio/ThemeDraftPreview";
import { StudioOverviewSection } from "./theme-studio/StudioOverviewSection";
import { ThemePreviewSceneSwitcher } from "./theme-studio/preview/ThemePreviewSceneSwitcher";
import type {
  SaveState,
  StudioSection,
  ThemeStudioPreviewScene,
} from "./theme-studio/themeStudioTypes";
import type { ThemeStudioResourcePort } from "./theme-studio/themeStudioResourcePort";

interface ThemeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  themeToEdit: CustomThemePackage | null;
  customThemes: CustomThemePackage[];
  onSave: (pkg: CustomThemePackage, applyAfterSave: boolean) => Promise<void>;
  showCustomAlert: (msg: string, title?: string) => Promise<void>;
  showCustomConfirm: (msg: string, title?: string) => Promise<boolean>;
  /** 主题工作室访问本地音视频资源的端口；缺省时只保留 JSON 编辑。 */
  resourcePort?: ThemeStudioResourcePort;
  /** 用户是否已在设置中允许主题播放媒体。 */
  mediaPermissionEnabled?: boolean;
}

export default function ThemeEditorModal({
  isOpen,
  onClose,
  themeToEdit,
  customThemes,
  onSave,
  showCustomAlert,
  showCustomConfirm,
  resourcePort,
  mediaPermissionEnabled = false,
}: ThemeEditorModalProps) {
  const [draft, setDraft] = React.useState<ThemeDocumentDraft>(() => createThemeDocumentDraft(themeToEdit));
  const [section, setSection] = React.useState<StudioSection>("overview");
  const [sectionHistory, setSectionHistory] = React.useState<StudioSection[]>([]);
  const [saveState, setSaveState] = React.useState<SaveState>("editing");
  const [previewScene, setPreviewScene] = React.useState<ThemeStudioPreviewScene>("chat");
  const [startPointKind, setStartPointKind] = React.useState<ThemeStartPointKind | null>(
    themeToEdit ? null : "blank-dark",
  );
  const closingRef = React.useRef(false);
  const dirty = isThemeDocumentDirty(draft);
  const canGoBack = section !== "overview" || sectionHistory.length > 0;
  const previewStateTokens = React.useMemo(() => {
    const parsed = parseThemeInteractionSource(draft.interactionSource);
    return parsed.config ? getDefaultThemeStateTokens(parsed.config) : [];
  }, [draft.interactionSource]);

  React.useEffect(() => {
    if (!isOpen) return;
    setDraft(createThemeDocumentDraft(themeToEdit));
    setSection("overview");
    setSectionHistory([]);
    setSaveState("editing");
    setPreviewScene("chat");
    setStartPointKind(themeToEdit ? null : "blank-dark");
    closingRef.current = false;
  }, [isOpen, themeToEdit]);

  const navigateToSection = React.useCallback((next: StudioSection) => {
    if (next === section) return;
    setSectionHistory(history => [...history, section]);
    setSection(next);
  }, [section]);

  const goBack = React.useCallback(() => {
    if (sectionHistory.length === 0) {
      if (section !== "overview") setSection("overview");
      return;
    }
    setSection(sectionHistory[sectionHistory.length - 1]);
    setSectionHistory(sectionHistory.slice(0, -1));
  }, [section, sectionHistory]);

  const updateTheme = React.useCallback((updater: (theme: CustomThemePackage) => CustomThemePackage) => {
    setDraft(current => {
      const next = {
        ...current,
        theme: updater(current.theme),
      };
      return next;
    });
    setSaveState("editing");
  }, []);

  const updateVariable = React.useCallback((key: string, value: string) => {
    updateTheme(theme => ({ ...theme, variables: { ...theme.variables, [key]: value } }));
  }, [updateTheme]);

  const applyStartPoint = React.useCallback(async (
    kind: ThemeStartPointKind,
    template: CustomThemePackage,
    name: string,
  ) => {
    if (isThemeDocumentDirty(draft)) {
      const confirmed = await showCustomConfirm(
        "当前草稿有未保存修改。切换起点会丢弃这些修改，继续吗？",
        "切换主题起点",
      );
      if (!confirmed) return;
    }
    setDraft(createThemeDocumentDraftFromTemplate(template, name));
    setStartPointKind(kind);
    setSaveState("editing");
  }, [draft, showCustomConfirm]);

  const requestClose = React.useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      if (isThemeDocumentDirty(draft)) {
        const confirmed = await showCustomConfirm(
          "主题还有未保存的修改。放弃修改并返回主题管理吗？", "放弃主题修改",
        );
        if (!confirmed) return;
      }
      onClose();
    } finally {
      closingRef.current = false;
    }
  }, [draft, onClose, showCustomConfirm]);

  useMobileBackHandler(isOpen, () => {
    if (canGoBack) {
      goBack();
      return true;
    }
    void requestClose();
    return true;
  }, 850);

  const persistDraft = async (applyAfterSave: boolean) => {
    setSaveState("validating");
    const result = buildThemeDocumentCandidate(draft, customThemes);
    if (!result.success) {
      setSaveState("failed");
      await showCustomAlert(result.errors.join("\n"), "主题校验失败");
      return;
    }
    const navigationRisks = detectCriticalNavigationHiding(result.theme.customCss ?? "");
    if (navigationRisks.length > 0) {
      const confirmed = await showCustomConfirm(
        `检测到主题 CSS 可能隐藏${navigationRisks.join("、")}。这可能影响恢复主题，仍要保存吗？`,
        "导航恢复风险",
      );
      if (!confirmed) {
        setSaveState("editing");
        return;
      }
    }
    try {
      await onSave(result.theme, applyAfterSave);
      setDraft(current => markThemeDocumentSaved(current, result.theme));
      setSaveState("saved");
      if (applyAfterSave) onClose();
    } catch (error: unknown) {
      setSaveState("failed");
      const message = error instanceof Error ? error.message : String(error);
      await showCustomAlert(`保存主题失败：${message}`, "保存失败");
    }
  };

  const statusText = saveState === "validating" ? "正在验证"
    : saveState === "failed" ? "验证失败"
      : saveState === "saved" && !dirty ? "已保存" : dirty ? "未保存" : "已保存";
  const currentSectionTitle = section === "overview" ? "主题工作室"
    : section === "preview" ? "预览当前草稿"
      : SECTION_ITEMS.find(item => item.id === section)?.title ?? "主题工作室";

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) void requestClose(); }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-[999] bg-black/35"
        className="!inset-0 !left-0 !top-0 z-[999] flex !h-[100dvh] !max-h-none !w-screen !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden !rounded-none border-0 bg-background p-0 text-foreground ring-0"
      >
        <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 pt-[max(0px,var(--safe-area-top))] sm:px-5">
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => {
            if (canGoBack) goBack(); else void requestClose();
          }} aria-label={canGoBack ? "返回上一页" : "关闭主题工作室"}>
            {canGoBack ? <ArrowLeft className="size-4" /> : <X className="size-4" />}
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-bold">{currentSectionTitle}</DialogTitle>
            <DialogDescription className="mt-0.5 flex items-center gap-2 text-[11px]">
              <span className="truncate">{draft.theme.name || "未命名主题"}</span><span>·</span>
              <span className={saveState === "failed" ? "text-destructive" : dirty ? "text-primary" : "text-muted-foreground"}>{statusText}</span>
            </DialogDescription>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs lg:hidden" onClick={() => navigateToSection("preview")}>
            <Eye className="size-3.5" />预览
          </Button>
        </header>

        <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[15rem_minmax(22rem,1fr)_minmax(24rem,0.95fr)]">
          <aside className="hidden min-h-0 border-r border-border bg-card/35 p-3 lg:block">
            <ThemeStudioNavigation section={section} onSelect={navigateToSection} />
          </aside>
          <main className="h-full min-h-0 overflow-y-auto p-3.5 custom-scrollbar sm:p-5">
            {section === "overview" && (
              <StudioOverviewSection
                isNew={themeToEdit === null}
                startPointKind={startPointKind}
                customThemes={customThemes}
                onSelectStartPoint={applyStartPoint}
                onSelect={navigateToSection}
              />
            )}
            {section === "appearance" && (
              <AppearanceSection
                theme={draft.theme}
                updateTheme={updateTheme}
                updateVariable={updateVariable}
              />
            )}
            {section === "colors" && (
              <ColorsSection theme={draft.theme} updateVariable={updateVariable} />
            )}
            {section === "css" && (
              <CssSection
                value={draft.theme.customCss ?? ""}
                onChange={value => updateTheme(theme => ({ ...theme, customCss: value }))}
              />
            )}
            {section === "interactions" && (
              <InteractionsSection
                value={draft.interactionSource}
                onChange={value => {
                  setDraft(current => ({ ...current, interactionSource: value }));
                  setSaveState("editing");
                }}
                resourcePort={resourcePort}
                mediaPermissionEnabled={mediaPermissionEnabled}
              />
            )}
            {section === "preview" && (
              <div className="mx-auto flex h-full max-w-lg flex-col gap-2">
                <ThemePreviewSceneSwitcher scene={previewScene} onChange={setPreviewScene} />
                <div className="min-h-0 flex-1">
                  <ThemeDraftPreview
                    theme={draft.theme}
                    scene={previewScene}
                    stateTokens={previewStateTokens}
                  />
                </div>
              </div>
            )}
          </main>
          <aside className="hidden min-h-0 border-l border-border bg-muted/20 p-4 lg:flex lg:flex-col">
            <div className="mb-2 flex items-center justify-between">
              <div><p className="text-sm font-bold">当前草稿</p><p className="text-xs text-muted-foreground">隔离预览，不改变正式主题</p></div>
              <Eye className="size-4 text-primary" />
            </div>
            <ThemePreviewSceneSwitcher scene={previewScene} onChange={setPreviewScene} />
            <div className="mt-2 min-h-0 flex-1">
              <ThemeDraftPreview
                theme={draft.theme}
                scene={previewScene}
                stateTokens={previewStateTokens}
              />
            </div>
          </aside>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-background px-3 pt-2 pb-[max(0.5rem,var(--safe-area-bottom))] sm:px-5">
          <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" disabled={saveState === "validating"} onClick={() => void persistDraft(false)}>
            <Save className="size-3.5" />保存主题
          </Button>
          <Button type="button" size="sm" className="h-8 px-3 text-xs" disabled={saveState === "validating"} onClick={() => void persistDraft(true)}>
            <CheckCircle2 className="size-3.5" />保存并应用
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
