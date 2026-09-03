import React, { useEffect, useState } from "react";
import { Wrench, Check, Power, ShieldCheck, Sparkles } from "lucide-react";
import { toolPluginManagementUseCases } from "../../application/useCases/toolPluginManagementUseCases";
import type { InstalledToolPlugin } from "../../domain/toolPlugins";
import { useUnifiedApp } from "../../UnifiedAppContext";

interface ToolCapabilitiesWidgetProps {
  className?: string;
}

export const ToolCapabilitiesWidget: React.FC<ToolCapabilitiesWidgetProps> = ({
  className = "",
}) => {
  const { showCustomAlert } = useUnifiedApp((state) => ({
    showCustomAlert: state.showCustomAlert,
  }));

  const [plugins, setPlugins] = useState<InstalledToolPlugin[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPlugins = async () => {
    try {
      setLoading(true);
      const list = await toolPluginManagementUseCases.list();
      setPlugins(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlugins();
  }, []);

  const handleToggle = async (plugin: InstalledToolPlugin) => {
    try {
      const nextEnabled = !plugin.enabled;
      await toolPluginManagementUseCases.setEnabled(plugin.id, nextEnabled);
      setPlugins((prev) =>
        prev.map((p) => (p.id === plugin.id ? { ...p, enabled: nextEnabled } : p))
      );
    } catch (e) {
      showCustomAlert(e instanceof Error ? e.message : String(e), "切换插件状态失败");
    }
  };

  return (
    <div
      data-ui="tool-capabilities-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-purple-400/30 to-transparent" />

      {/* 头部标题 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/15 text-purple-400">
            <Wrench className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">宿主 Tool 插件生态</h3>
            <p className="text-[10px] text-muted-foreground">已注册外部能力实例</p>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
          <span>{plugins.filter((p) => p.enabled).length} / {plugins.length} 已启用</span>
        </div>
      </div>

      {/* 插件列表 */}
      {plugins.length === 0 ? (
        <div className="flex min-h-16 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-3 text-center text-xs text-muted-foreground">
          <Sparkles className="mb-1 h-4 w-4 text-muted-foreground/60" />
          <span>{loading ? "正在读取插件状态..." : "暂无已注册的 Tool 插件"}</span>
        </div>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 p-2.5 transition-all hover:bg-white/8"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-bold text-foreground">
                    {plugin.manifest.name}
                  </span>
                  <span className="rounded bg-white/10 px-1 py-0.2 text-[9px] font-mono text-muted-foreground">
                    v{plugin.manifest.version}
                  </span>
                  {plugin.sourceVerification?.trustLevel === "official" && (
                    <span className="flex items-center gap-0.5 rounded-full bg-cyan-500/10 px-1.5 py-0.2 text-[9px] font-medium text-cyan-400 border border-cyan-500/20">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      官方
                    </span>
                  )}
                </div>
                <p className="truncate text-[10px] text-muted-foreground mt-0.5">
                  {plugin.manifest.description || "无描述"}
                </p>
              </div>

              {/* 启用/停用按钮 */}
              <button
                type="button"
                onClick={() => handleToggle(plugin)}
                className={`flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-bold transition-all active:scale-95 ${
                  plugin.enabled
                    ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)] hover:bg-emerald-500/25"
                    : "border border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                }`}
              >
                {plugin.enabled ? (
                  <>
                    <Check className="h-3 w-3" />
                    已启用
                  </>
                ) : (
                  <>
                    <Power className="h-3 w-3" />
                    停用
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ToolCapabilitiesWidget;
