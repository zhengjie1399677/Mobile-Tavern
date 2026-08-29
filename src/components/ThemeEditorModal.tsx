import React from "react";
import {
  ArrowLeft, CheckCircle2, Code, Eye, LayoutDashboard, Palette, Save,
  SlidersHorizontal, Workflow, X,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import {
  buildThemeDocumentCandidate, cloneThemeDocumentDraft, createThemeDocumentDraft,
  isThemeDocumentDirty, markThemeDocumentSaved, type ThemeDocumentDraft,
} from "../domain/themes/themeDocumentDraft";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { detectCriticalNavigationHiding, type CustomThemePackage } from "../utils/themePackage";
import ThemeDraftPreview from "./theme-studio/ThemeDraftPreview";

interface ThemeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  themeToEdit: CustomThemePackage | null;
  customThemes: CustomThemePackage[];
  onSave: (pkg: CustomThemePackage, applyAfterSave: boolean) => Promise<void>;
  showCustomAlert: (msg: string, title?: string) => Promise<void>;
  showCustomConfirm: (msg: string, title?: string) => Promise<boolean>;
}

type StudioSection = "overview" | "appearance" | "colors" | "css" | "interactions" | "preview";
type SaveState = "editing" | "validating" | "failed" | "saved";

const CORE_COLORS = [
  { key: "--background", label: "页面背景" },
  { key: "--card", label: "内容表面" },
  { key: "--foreground", label: "主要文字" },
  { key: "--primary", label: "强调色" },
  { key: "--border", label: "边框" },
] as const;

const ADVANCED_COLOR_GROUPS = [
  { title: "页面与表面", variables: ["--popover", "--input", "--muted"] },
  { title: "文字与操作", variables: [
    "--card-foreground", "--popover-foreground", "--primary-foreground", "--secondary",
    "--secondary-foreground", "--muted-foreground", "--accent", "--accent-foreground",
  ] },
  { title: "状态与长文本", variables: [
    "--ring", "--destructive", "--destructive-foreground", "--dialogue-color", "--prose-color",
  ] },
] as const;

const COLOR_LABELS: Record<string, string> = {
  "--popover": "弹出层", "--input": "输入框", "--muted": "弱化表面",
  "--card-foreground": "表面文字", "--popover-foreground": "弹出层文字",
  "--primary-foreground": "强调色文字", "--secondary": "次要操作",
  "--secondary-foreground": "次要操作文字", "--muted-foreground": "弱化文字",
  "--accent": "悬停强调", "--accent-foreground": "悬停强调文字", "--ring": "焦点环",
  "--destructive": "危险操作", "--destructive-foreground": "危险操作文字",
  "--dialogue-color": "对白文字", "--prose-color": "旁白文字",
};

const SECTION_ITEMS: Array<{
  id: Exclude<StudioSection, "overview" | "preview">;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "appearance", title: "外观", description: "明暗、圆角与主题信息", icon: SlidersHorizontal },
  { id: "colors", title: "颜色", description: "核心颜色与完整语义变量", icon: Palette },
  { id: "css", title: "自定义 CSS", description: "作用于现有 UI 的受控样式", icon: Code },
  { id: "interactions", title: "交互与媒体", description: "Theme 1.1 声明式配置", icon: Workflow },
];

const RADIUS_PRESETS = [
  { label: "直角", value: "0rem" }, { label: "轻微", value: "0.35rem" },
  { label: "标准", value: "0.6rem" }, { label: "柔和", value: "1rem" },
];

function normalizeColorPickerValue(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed.slice(1).split("").map(part => `${part}${part}`).join("")}`;
  }
  return "#ffffff";
}

export default function ThemeEditorModal({
  isOpen, onClose, themeToEdit, customThemes, onSave, showCustomAlert, showCustomConfirm,
}: ThemeEditorModalProps) {
  const [draft, setDraft] = React.useState<ThemeDocumentDraft>(() => createThemeDocumentDraft(themeToEdit));
  const [section, setSection] = React.useState<StudioSection>("overview");
  const [saveState, setSaveState] = React.useState<SaveState>("editing");
  const closingRef = React.useRef(false);
  const dirty = isThemeDocumentDirty(draft);

  React.useEffect(() => {
    if (!isOpen) return;
    setDraft(createThemeDocumentDraft(themeToEdit));
    setSection("overview");
    setSaveState("editing");
    closingRef.current = false;
  }, [isOpen, themeToEdit]);

  const updateTheme = React.useCallback((updater: (theme: CustomThemePackage) => CustomThemePackage) => {
    setDraft(current => {
      const next = cloneThemeDocumentDraft(current);
      next.theme = updater(next.theme);
      return next;
    });
    setSaveState("editing");
  }, []);

  const updateVariable = React.useCallback((key: string, value: string) => {
    updateTheme(theme => ({ ...theme, variables: { ...theme.variables, [key]: value } }));
  }, [updateTheme]);

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
    if (section !== "overview") {
      setSection("overview");
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
            if (section === "overview") void requestClose(); else setSection("overview");
          }} aria-label={section === "overview" ? "关闭主题工作室" : "返回主题工作室"}>
            {section === "overview" ? <X className="size-4" /> : <ArrowLeft className="size-4" />}
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-bold">{currentSectionTitle}</DialogTitle>
            <DialogDescription className="mt-0.5 flex items-center gap-2 text-[11px]">
              <span className="truncate">{draft.theme.name || "未命名主题"}</span><span>·</span>
              <span className={saveState === "failed" ? "text-destructive" : dirty ? "text-primary" : "text-muted-foreground"}>{statusText}</span>
            </DialogDescription>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs lg:hidden" onClick={() => setSection("preview")}>
            <Eye className="size-3.5" />预览
          </Button>
        </header>

        <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[15rem_minmax(22rem,1fr)_minmax(24rem,0.95fr)]">
          <aside className="hidden min-h-0 border-r border-border bg-card/35 p-3 lg:block">
            <StudioNavigation section={section} onSelect={setSection} />
          </aside>
          <main className="h-full min-h-0 overflow-y-auto p-3.5 custom-scrollbar sm:p-5">
            {section === "overview" && <OverviewSection onSelect={setSection} />}
            {section === "appearance" && <AppearanceSection theme={draft.theme} updateTheme={updateTheme} updateVariable={updateVariable} />}
            {section === "colors" && <ColorsSection theme={draft.theme} updateVariable={updateVariable} />}
            {section === "css" && <CssSection value={draft.theme.customCss ?? ""} onChange={value => updateTheme(theme => ({ ...theme, customCss: value }))} />}
            {section === "interactions" && <InteractionsSection value={draft.interactionSource} onChange={value => {
              setDraft(current => ({ ...current, interactionSource: value }));
              setSaveState("editing");
            }} />}
            {section === "preview" && <div className="mx-auto h-full max-w-lg"><ThemeDraftPreview theme={draft.theme} /></div>}
          </main>
          <aside className="hidden min-h-0 border-l border-border bg-muted/20 p-4 lg:block">
            <div className="mb-3 flex items-center justify-between">
              <div><p className="text-sm font-bold">当前草稿</p><p className="text-xs text-muted-foreground">隔离预览，不改变正式主题</p></div>
              <Eye className="size-4 text-primary" />
            </div>
            <div className="h-[calc(100%-3.25rem)]"><ThemeDraftPreview theme={draft.theme} /></div>
          </aside>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-background px-3 py-2 sm:px-5">
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

function StudioNavigation({ section, onSelect }: { section: StudioSection; onSelect: (section: StudioSection) => void }) {
  const items = [
    { id: "overview" as const, title: "工作室首页", icon: LayoutDashboard },
    ...SECTION_ITEMS.map(item => ({ id: item.id, title: item.title, icon: item.icon })),
  ];
  return <nav aria-label="主题工作室分区" className="space-y-1">{items.map(item => {
    const Icon = item.icon;
    const active = item.id === section;
    return <Button key={item.id} type="button" size="sm" variant={active ? "secondary" : "ghost"} className="h-8 w-full justify-start text-xs" aria-current={active ? "page" : undefined} onClick={() => onSelect(item.id)}>
      <Icon className="size-3.5" />{item.title}
    </Button>;
  })}</nav>;
}

function OverviewSection({ onSelect }: { onSelect: (section: StudioSection) => void }) {
  return <div className="mx-auto max-w-2xl space-y-4">
    <div><h2 className="text-sm font-bold">编辑主题草稿</h2><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">草稿只影响预览区域。保存主题不会改变当前外观，只有“保存并应用”才会切换正式主题。</p></div>
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{SECTION_ITEMS.map(item => {
      const Icon = item.icon;
      return <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1"><span className="block text-xs font-bold">{item.title}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{item.description}</span></span>
        <span aria-hidden="true" className="text-xs text-muted-foreground">›</span>
      </button>;
    })}</div>
  </div>;
}

function AppearanceSection({ theme, updateTheme, updateVariable }: {
  theme: CustomThemePackage;
  updateTheme: (updater: (theme: CustomThemePackage) => CustomThemePackage) => void;
  updateVariable: (key: string, value: string) => void;
}) {
  return <div className="mx-auto max-w-2xl space-y-4">
    <EditorField label="主题名称" required><input value={theme.name} maxLength={40} onChange={event => updateTheme(current => ({ ...current, name: event.target.value }))} className="h-8.5 w-full rounded-lg border border-border bg-input px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring" /></EditorField>
    <EditorField label="主题说明"><textarea value={theme.description ?? ""} rows={2} onChange={event => updateTheme(current => ({ ...current, description: event.target.value }))} className="min-h-16 w-full resize-y rounded-lg border border-border bg-input p-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring" /></EditorField>
    <div className="flex min-h-12 items-center justify-between gap-3 border-y border-border py-2">
      <div><p className="text-xs font-bold">基础模式</p><p className="mt-0.5 text-[10px] text-muted-foreground">同步浏览器配色和原生状态栏图标明暗。</p></div>
      <div className="flex rounded-lg border border-border bg-muted p-0.5">{[false, true].map(isDark => <Button key={String(isDark)} type="button" size="sm" className="h-7 px-2.5 text-xs" variant={theme.isDark === isDark ? "default" : "ghost"} onClick={() => updateTheme(current => ({ ...current, isDark }))}>{isDark ? "深色" : "浅色"}</Button>)}</div>
    </div>
    <EditorField label="圆角">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{RADIUS_PRESETS.map(preset => <Button key={preset.value} type="button" size="sm" className="h-7.5 text-xs" variant={theme.variables["--radius"] === preset.value ? "default" : "outline"} onClick={() => updateVariable("--radius", preset.value)}>{preset.label}</Button>)}</div>
      <input aria-label="高级圆角值" value={theme.variables["--radius"] ?? ""} onChange={event => updateVariable("--radius", event.target.value)} placeholder="高级值，例如 0.75rem" className="mt-2 h-8 w-full rounded-lg border border-border bg-input px-2.5 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring" />
    </EditorField>
    <details className="rounded-xl border border-border bg-card p-3"><summary className="cursor-pointer text-xs font-bold">高级信息</summary>
      <div className="mt-3"><EditorField label="主题包版本"><input value={theme.version} onChange={event => updateTheme(current => ({ ...current, version: event.target.value }))} className="h-8 w-full rounded-lg border border-border bg-input px-2.5 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring" /></EditorField></div>
      <p className="mt-2 text-[10px] text-muted-foreground">Schema 会根据是否使用交互与媒体自动选择 1.0 或 1.1。</p>
    </details>
  </div>;
}

function ColorsSection({ theme, updateVariable }: { theme: CustomThemePackage; updateVariable: (key: string, value: string) => void }) {
  return <div className="mx-auto max-w-3xl space-y-4">
    <div><h2 className="text-sm font-bold">核心颜色</h2><p className="mt-0.5 text-xs text-muted-foreground">颜色选择器使用 Hex；文本框仍可保留其他合法 CSS 颜色值。</p></div>
    <div className="divide-y divide-border rounded-xl border border-border bg-card px-3">{CORE_COLORS.map(item => <ColorRow key={item.key} label={item.label} variable={item.key} value={theme.variables[item.key] ?? ""} onChange={updateVariable} />)}</div>
    <details className="rounded-xl border border-border bg-card p-3"><summary className="cursor-pointer text-xs font-bold">高级语义颜色</summary>
      <div className="mt-3 space-y-4">{ADVANCED_COLOR_GROUPS.map(group => <section key={group.title}><h3 className="mb-1.5 text-[11px] font-bold text-muted-foreground">{group.title}</h3><div className="divide-y divide-border">{group.variables.map(variable => <ColorRow key={variable} label={COLOR_LABELS[variable] ?? variable} variable={variable} value={theme.variables[variable] ?? ""} onChange={updateVariable} />)}</div></section>)}</div>
    </details>
  </div>;
}

function ColorRow({ label, variable, value, onChange }: { label: string; variable: string; value: string; onChange: (key: string, value: string) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground">{label}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{variable}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="color"
          aria-label={`${label}颜色选择器`}
          value={normalizeColorPickerValue(value)}
          onChange={event => onChange(variable, event.target.value)}
          className="size-8 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
        />
        <input
          value={value}
          onChange={event => onChange(variable, event.target.value)}
          className="h-8 w-28 rounded-lg border border-border bg-input px-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </div>
  );
}

function CssSection({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-2.5">
    <div><h2 className="text-sm font-bold">自定义 CSS</h2><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">预览和保存都会执行安全清洗与主题作用域。远程 URL、@import、脚本、固定定位和 Safe Area 覆盖不可用。</p></div>
    <div className="flex min-h-[22rem] flex-1 overflow-hidden rounded-xl border border-border bg-input">
      <pre aria-hidden="true" className="select-none border-r border-border bg-muted/60 px-2 py-2.5 text-right font-mono text-xs leading-5 text-muted-foreground">{Array.from({ length: Math.max(1, value.split("\n").length) }, (_, index) => index + 1).join("\n")}</pre>
      <textarea aria-label="自定义 CSS 文档" value={value} onChange={event => onChange(event.target.value)} spellCheck={false} className="min-h-[22rem] flex-1 resize-none bg-transparent p-2.5 font-mono text-xs leading-5 text-foreground outline-none" placeholder={'[data-ui="main-tab-bar"] {\n  border-color: var(--primary);\n}'} />
    </div>
    <p className="text-[10px] text-muted-foreground">当前共 {value.split("\n").length} 行。行列级语法诊断和片段库将在下一阶段接入。</p>
  </div>;
}

function InteractionsSection({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-2.5">
    <div><h2 className="text-sm font-bold">交互与媒体</h2><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">当前保留完整 Theme 1.1 JSON 编辑能力，不执行 JavaScript，也不允许网络或业务数据访问。</p></div>
    <textarea aria-label="主题受限交互 JSON" value={value} onChange={event => onChange(event.target.value)} spellCheck={false} className="min-h-[24rem] flex-1 resize-y rounded-xl border border-border bg-input p-3 font-mono text-xs leading-5 text-foreground outline-none focus:ring-2 focus:ring-ring" />
    <p className="text-[10px] text-muted-foreground">保存时严格校验媒体、状态、规则、引用与数量上限。可视化规则构建器将在后续阶段替换默认 JSON 输入。</p>
  </div>;
}

function EditorField({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold text-foreground">{label}{required ? " *" : ""}</span>{children}</label>;
}
