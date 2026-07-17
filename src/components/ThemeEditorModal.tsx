import React, { useState, useEffect, useRef } from "react";
import { X, Save, Eye, Palette, Code, Info, FileText } from "lucide-react";
import {
  type CustomThemePackage,
  applyThemePackage,
  removeThemePackageStyle,
  generateThemeId
} from "../utils/themePackage";
import { sanitizeCss } from "../utils/security";

interface ThemeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  themeToEdit: CustomThemePackage | null; // null for creating a new theme
  customThemes: CustomThemePackage[];
  onSave: (pkg: CustomThemePackage) => Promise<void>;
  handleThemeChange: (themeId: string) => void;
  originalThemeId: string;
  showCustomAlert: (msg: string, title?: string) => Promise<void>;
}

const VARIABLE_GROUPS = [
  {
    title: "基础配色",
    variables: [
      { key: "--background", label: "页面背景色", desc: "主背景色，影响整个应用背景" },
      { key: "--foreground", label: "前景色/主文字", desc: "主要文字与标签色彩" },
      { key: "--border", label: "边框色", desc: "卡片、分割线、输入框的边框" },
      { key: "--input", label: "输入框背景", desc: "文本域、选择框等输入控件的底色" },
      { key: "--ring", label: "聚焦光环色", desc: "输入控件聚焦时的描边颜色" },
    ],
  },
  {
    title: "主色与强调",
    variables: [
      { key: "--primary", label: "主题主色", desc: "主要按钮、激活选项卡和强调文字" },
      { key: "--primary-foreground", label: "主色前景色", desc: "在主色背景上显示的文字颜色" },
      { key: "--secondary", label: "次要色/辅助背景", desc: "辅助按钮或暗背景" },
      { key: "--secondary-foreground", label: "次要色前景色", desc: "在次要色背景上显示的文字颜色" },
      { key: "--accent", label: "强调背景色", desc: "悬停状态或次要强调区域" },
      { key: "--accent-foreground", label: "强调前景色", desc: "在强调背景色上显示的文字" },
      { key: "--muted", label: "静音/低对比底色", desc: "用于非关键的静音卡片背景" },
      { key: "--muted-foreground", label: "静音文字色", desc: "低对比度次要描述文本" },
    ],
  },
  {
    title: "卡片与对话",
    variables: [
      { key: "--card", label: "卡片背景色", desc: "聊天泡、控制面板卡片的背景底色" },
      { key: "--card-foreground", label: "卡片文字色", desc: "卡片内的文本颜色" },
      { key: "--popover", label: "弹出层背景", desc: "下拉菜单、对话框的背景" },
      { key: "--popover-foreground", label: "弹出层文字", desc: "弹出层内的文字颜色" },
      { key: "--dialogue-color", label: "对话框文本", desc: "聊天气泡中角色的对白文字颜色" },
      { key: "--prose-color", label: "正文排版/旁白", desc: "聊天气泡中旁白或格式化文本颜色" },
    ],
  },
  {
    title: "状态配置",
    variables: [
      { key: "--destructive", label: "破坏性背景", desc: "危险操作、删除按钮的背景色" },
      { key: "--destructive-foreground", label: "破坏性前景色", desc: "破坏性背景上的文字颜色" },
    ],
  },
];

export default function ThemeEditorModal({
  isOpen,
  onClose,
  themeToEdit,
  customThemes,
  onSave,
  handleThemeChange,
  originalThemeId,
  showCustomAlert,
}: ThemeEditorModalProps) {
  const [activeTab, setActiveTab] = useState<"basic" | "colors" | "css">("basic");
  
  // 初始化主题对象状态
  const [theme, setTheme] = useState<CustomThemePackage>(() => {
    if (themeToEdit) {
      return JSON.parse(JSON.stringify(themeToEdit));
    }
    return {
      schemaVersion: "1.0",
      name: "新自定义主题",
      version: "1.0.0",
      description: "",
      isDark: true,
      variables: {
        "--background": "#0d0f17",
        "--foreground": "#e2e8f0",
        "--card": "#161925",
        "--card-foreground": "#e2e8f0",
        "--popover": "#161925",
        "--popover-foreground": "#e2e8f0",
        "--primary": "#8b5cf6",
        "--primary-foreground": "#ffffff",
        "--secondary": "#1e293b",
        "--secondary-foreground": "#e2e8f0",
        "--muted": "#1f2937",
        "--muted-foreground": "#9ca3af",
        "--accent": "#2d1b54",
        "--accent-foreground": "#c084fc",
        "--destructive": "#ef4444",
        "--destructive-foreground": "#ffffff",
        "--border": "#1e293b",
        "--input": "#1e293b",
        "--ring": "#8b5cf6",
        "--radius": "0.6rem",
        "--dialogue-color": "#f1f5f9",
        "--prose-color": "#a78bfa",
      },
      customCss: "",
    };
  });

  // 侦听变化实时预览
  useEffect(() => {
    if (!isOpen) return;

    const previewPkg: CustomThemePackage = {
      ...theme,
      id: "custom_theme_preview",
    };

    // 注入预览 CSS
    applyThemePackage(previewPkg);

    // 临时同步暗色标记
    localStorage.setItem("mobile_tavern_custom_is_dark", String(theme.isDark));
    handleThemeChange("custom_theme_preview");

    // 修改文档的 class 属性进行实时反馈
    if (theme.isDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
    }
  }, [theme, isOpen]);

  if (!isOpen) return null;

  // 辅助检测合法 Hex
  const isHexColor = (val: string) => {
    const clean = val.trim();
    return /^#[0-9A-Fa-f]{3}$|^#[0-9A-Fa-f]{6}$/.test(clean);
  };

  // 规范化 Hex 格式以适配原生 color picker
  const normalizeHex = (val: string) => {
    const clean = val.trim();
    if (/^#[0-9A-Fa-f]{3}$/.test(clean)) {
      return "#" + clean[1] + clean[1] + clean[2] + clean[2] + clean[3] + clean[3];
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(clean)) {
      return clean;
    }
    return "#ffffff";
  };

  const updateVariable = (key: string, value: string) => {
    setTheme(prev => ({
      ...prev,
      variables: {
        ...prev.variables,
        [key]: value,
      },
    }));
  };

  const handleSaveClick = async () => {
    const trimmedName = theme.name.trim();
    if (!trimmedName) {
      await showCustomAlert("主题名称不能为空", "校验失败");
      return;
    }
    if (trimmedName.length > 40) {
      await showCustomAlert("主题名称不能超过 40 字符", "校验失败");
      return;
    }
    if (!theme.version.trim()) {
      await showCustomAlert("版本号不能为空", "校验失败");
      return;
    }

    // 校验同名冲突
    const editingThemeId = themeToEdit?.id;
    const isDuplicate = customThemes.some(
      t => t.name.trim().toLowerCase() === trimmedName.toLowerCase() && t.id !== editingThemeId
    );
    if (isDuplicate) {
      await showCustomAlert(`已存在同名主题「${trimmedName}」，请使用其他名称。`, "校验失败");
      return;
    }

    const finalTheme: CustomThemePackage = {
      ...theme,
      name: trimmedName,
      version: theme.version.trim(),
      description: theme.description?.trim() || undefined,
      id: editingThemeId && themeToEdit?.name === trimmedName ? editingThemeId : generateThemeId(trimmedName),
      importedAt: theme.importedAt || Date.now(),
    };

    // 移除预览样式并返回
    removeThemePackageStyle("custom_theme_preview");
    await onSave(finalTheme);
  };

  const handleCancelClick = () => {
    // 还原原始主题
    if (originalThemeId.startsWith("custom_")) {
      const origThemePkg = customThemes.find(t => t.id === originalThemeId);
      if (origThemePkg) {
        localStorage.setItem("mobile_tavern_custom_is_dark", String(origThemePkg.isDark));
        applyThemePackage(origThemePkg);
      }
    }
    handleThemeChange(originalThemeId);

    // 移除预览样式
    removeThemePackageStyle("custom_theme_preview");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[999] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4 text-foreground">
      <div className="bg-background border-t sm:border border-border max-h-[95vh] sm:max-h-[90vh] w-full sm:max-w-2xl overflow-hidden rounded-t-2xl sm:rounded-2xl flex flex-col shadow-2xl">
        
        {/* 顶部标题与关闭 */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <p className="font-bold text-sm text-foreground flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-primary animate-pulse" />
              {themeToEdit ? `编辑主题: ${themeToEdit.name}` : "新建自定义主题"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              编辑时颜色修改将实时反映至整个应用背景与气泡样式。
            </p>
          </div>
          <button
            onClick={handleCancelClick}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition"
            title="关闭并放弃"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 选项卡切换 */}
        <div className="flex border-b border-border/80 bg-input/50 px-3 shrink-0">
          {[
            { id: "basic", label: "基本元数据", icon: FileText },
            { id: "colors", label: "颜色调色板", icon: Palette },
            { id: "css", label: "自定义 CSS", icon: Code },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-2 px-3 text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  active
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 主内容滚动区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar text-xs">
          
          {/* TAB 1: 基本元数据 */}
          {activeTab === "basic" && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-muted-foreground mb-1 font-bold">
                    主题名称 *
                  </label>
                  <input
                    type="text"
                    placeholder="如: 樱花暮雪"
                    value={theme.name}
                    onChange={e => setTheme(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
                  />
                </div>
                <div>
                  <label className="block text-muted-foreground mb-1 font-bold">
                    版本号 *
                  </label>
                  <input
                    type="text"
                    placeholder="如: 1.0.0"
                    value={theme.version}
                    onChange={e => setTheme(prev => ({ ...prev, version: e.target.value }))}
                    className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-muted-foreground mb-1">
                  主题描述
                </label>
                <input
                  type="text"
                  placeholder="简单描述一下您的设计基调..."
                  value={theme.description || ""}
                  onChange={e => setTheme(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 p-3 bg-muted/30 border border-border/50 rounded-xl justify-between items-start sm:items-center">
                <div className="space-y-0.5">
                  <label className="block text-foreground font-bold text-xs">
                    是否为暗色主题
                  </label>
                  <p className="text-[10px] text-muted-foreground">
                    影响应用默认配色、加载遮罩与原生状态栏字体颜色。
                  </p>
                </div>
                <label className="checkBox-container">
                  <input
                    type="checkbox"
                    checked={theme.isDark}
                    onChange={e => setTheme(prev => ({ ...prev, isDark: e.target.checked }))}
                  />
                  <div className="checkBox-transition" />
                </label>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-muted-foreground font-bold">
                    圆角尺寸配置 (`--radius`)
                  </label>
                  <span className="text-[10px] text-muted-foreground">默认值: 0.6rem</span>
                </div>
                <input
                  type="text"
                  placeholder="如: 0.6rem 或 8px"
                  value={theme.variables["--radius"] || ""}
                  onChange={e => updateVariable("--radius", e.target.value)}
                  className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs font-mono"
                />
              </div>

              <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl flex gap-2">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-[10.5px] text-muted-foreground leading-relaxed">
                  在右侧“颜色调色板”标签中，您可以进一步调整应用内所有的主要与辅助配色；在“自定义 CSS”中您可以添加任意的高级样式覆写（如毛玻璃或特定字体）。
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: 颜色调色板 */}
          {activeTab === "colors" && (
            <div className="space-y-6">
              {VARIABLE_GROUPS.map((group, gIdx) => (
                <div key={gIdx} className="space-y-3">
                  <h3 className="font-bold text-xs text-primary border-b border-border/50 pb-1 flex items-center justify-between">
                    <span>{group.title}</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {group.variables.map(item => {
                      const val = theme.variables[item.key] || "";
                      const isHex = isHexColor(val);
                      return (
                        <div key={item.key} className="flex flex-col p-2 bg-muted/15 border border-border/30 rounded-lg space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-[11px] text-foreground">{item.label}</span>
                            <span className="text-[9px] font-mono text-muted-foreground/60">{item.key}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="relative w-8 h-8 rounded border border-border overflow-hidden shrink-0">
                              <input
                                type="color"
                                value={isHex ? normalizeHex(val) : "#ffffff"}
                                onChange={e => updateVariable(item.key, e.target.value)}
                                className="absolute inset-[-4px] w-[calc(100%+8px)] h-[calc(100%+8px)] cursor-pointer bg-transparent border-none p-0"
                              />
                            </div>
                            <input
                              type="text"
                              placeholder="#ffffff 或 rgb(...)"
                              value={val}
                              onChange={e => updateVariable(item.key, e.target.value)}
                              className="flex-1 min-w-0 bg-input border border-border rounded p-1.5 text-foreground outline-none text-[11px] font-mono"
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground/75 leading-tight">{item.desc}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: 自定义 CSS */}
          {activeTab === "css" && (
            <div className="space-y-3.5">
              <div className="flex justify-between items-center">
                <label className="block text-muted-foreground font-bold">
                  额外 CSS 样式覆写 (附加样式)
                </label>
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded font-semibold">
                  安全受控沙盒已启用
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                此部分 CSS 会附加在变量声明后面。支持利用 CSS 选择器微调特定界面样式。严禁使用 <code>@import</code>、<code>url()</code> 及 <code>position:fixed</code> 以避免安全风险。
              </p>
              <textarea
                placeholder="/* 如: */\n.glass-panel {\n  background: rgba(255, 255, 255, 0.15);\n  backdrop-filter: blur(10px);\n}"
                rows={14}
                value={theme.customCss || ""}
                onChange={e => {
                  const val = e.target.value;
                  // 实时进行安全过滤与保存
                  setTheme(prev => ({ ...prev, customCss: val }));
                }}
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs font-mono leading-relaxed resize-y"
              />
            </div>
          )}

        </div>

        {/* 底部保存与取消 */}
        <div
          className="p-4 bg-input/80 border-t border-border flex items-center justify-between shrink-0"
        >
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground max-w-[50%]">
            <Info className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate">修改将立即作为预览注入系统。</span>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleCancelClick}
              className="bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground px-4 py-2 rounded-lg text-xs font-semibold transition"
            >
              放弃修改
            </button>
            <button
              onClick={handleSaveClick}
              className="bg-primary hover:opacity-90 text-primary-foreground px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition"
            >
              <Save className="w-3.5 h-3.5" />
              保存主题
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
