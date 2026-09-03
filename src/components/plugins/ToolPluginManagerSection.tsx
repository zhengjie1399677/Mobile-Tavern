import React from "react";
import {
  ChevronDown,
  ExternalLink,
  Key,
  Loader2,
  PackageCheck,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Wrench,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { toolPluginManagementUseCases } from "../../application/useCases/toolPluginManagementUseCases";
import type {
  InstalledToolPlugin,
  ToolPluginCredentialStatus,
  ToolPluginInspection,
  ToolPluginManifest,
  ToolPluginPermission,
  ToolPluginPermissionDeclaration,
  ToolPluginRuntimeDiagnostics,
} from "../../domain/toolPlugins";
import { KernelServices, type IToolPluginRuntimeService } from "../../application/serviceContracts";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";

export default function ToolPluginManagerSection(): React.JSX.Element {
  const { showCustomAlert, showCustomConfirm, showCustomPrompt, getKernelService } = useUnifiedApp((state) => ({
    showCustomAlert: state.showCustomAlert,
    showCustomConfirm: state.showCustomConfirm,
    showCustomPrompt: state.showCustomPrompt,
    getKernelService: state.getKernelService,
  }));
  const [plugins, setPlugins] = React.useState<InstalledToolPlugin[]>([]);
  const [officialPlugins, setOfficialPlugins] = React.useState<ToolPluginInspection[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [review, setReview] = React.useState<ToolPluginInspection | null>(null);
  const [credentialStatus, setCredentialStatus] = React.useState<Record<string, ToolPluginCredentialStatus[]>>({});
  const [runtimeDiagnostics, setRuntimeDiagnostics] = React.useState<ToolPluginRuntimeDiagnostics | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const reload = React.useCallback(async () => {
    const [next, official] = await Promise.all([
      toolPluginManagementUseCases.list(),
      toolPluginManagementUseCases.listOfficial(),
    ]);
    setPlugins(next);
    setOfficialPlugins(official);
    const statuses = await Promise.all(next.map(async (plugin) => [
      plugin.id,
      await toolPluginManagementUseCases.listCredentialStatus(plugin.id),
    ] as const));
    setCredentialStatus(Object.fromEntries(statuses));
    try {
      setRuntimeDiagnostics(getKernelService<IToolPluginRuntimeService>(KernelServices.ToolConnectors).getDiagnostics());
    } catch {
      setRuntimeDiagnostics(null);
    }
  }, [getKernelService]);

  React.useEffect(() => {
    void reload().catch((error) => showCustomAlert(normalizeError(error), "Tool Plugin 读取失败"));
  }, [reload, showCustomAlert]);

  const handleFile = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      setReview(await toolPluginManagementUseCases.inspectFile(file));
    } catch (error) {
      await showCustomAlert(describeError(error), "Manifest 未通过校验");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const installReviewed = async () => {
    if (!review || busy) return;
    setBusy(true);
    try {
      await toolPluginManagementUseCases.install(review);
      await reload();
      setExpandedId(review.manifest.id);
      setReview(null);
    } catch (error) {
      await showCustomAlert(describeError(error), "Tool Plugin 导入失败");
    } finally {
      setBusy(false);
    }
  };

  const runMutation = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      try {
        await getKernelService<IToolPluginRuntimeService>(KernelServices.ToolConnectors).reload();
      } catch {
        // 测试/降级启动阶段服务可能尚未装载；持久化操作仍保持成功。
      }
      await reload();
    } catch (error) {
      await showCustomAlert(describeError(error), "Tool Plugin 操作失败");
    } finally {
      setBusy(false);
    }
  };

  const installedIds = new Set(plugins.map((plugin) => plugin.id));

  // 官方插件与已安装插件无缝合并为单一列表，全部开箱即用，无需任何二次安装步骤
  const displayPlugins: InstalledToolPlugin[] = [
    ...plugins,
    ...officialPlugins
      .filter((o) => !installedIds.has(o.manifest.id))
      .map((o) => ({
        id: o.manifest.id,
        manifest: o.manifest,
        enabled: false,
        grantedPermissions: [],
        installedAt: 0,
        updatedAt: 0,
        history: [],
        sourceVerification: o.sourceVerification,
      })),
  ];

  const enabledCount = displayPlugins.filter((plugin) => plugin.enabled).length;
  const awaitingPermissionCount = displayPlugins.filter((plugin) => !hasRequiredPermissions(plugin)).length;

  // 搜索过滤
  const query = searchQuery.trim().toLowerCase();
  const filteredPlugins = displayPlugins.filter((p) => {
    if (!query) return true;
    return (
      p.manifest.name.toLowerCase().includes(query) ||
      p.manifest.description.toLowerCase().includes(query) ||
      p.manifest.tools.some((t) => t.id.toLowerCase().includes(query) || t.description.toLowerCase().includes(query))
    );
  });

  return (
    <section className="space-y-2.5 pb-2" data-ui="tool-plugin-manager">
      {/* 顶部标题、搜索与导入 */}
      <div className="surface-card rounded-2xl p-3 rim-light space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
              <Wrench className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-foreground truncate">Tool 插件扩展</h2>
              <p className="text-[11px] text-muted-foreground truncate">
                已启用 {enabledCount} / 共 {displayPlugins.length} 项
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex h-7.5 items-center gap-1 rounded-xl border border-border/70 bg-background/80 hover:bg-muted px-2.5 text-xs font-bold text-foreground transition-all active:scale-95 shadow-2xs shrink-0"
            aria-label="导入 .mttool / Manifest"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5 text-primary" />}
            <span>导入插件</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".mttool,.json,.mttool.json,application/json,application/zip"
            className="hidden"
            aria-label="选择 Tool Plugin Manifest"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </div>

        {/* 紧凑搜索框 */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground/60" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索插件或功能..."
            className="w-full h-7.5 rounded-lg border border-border/60 bg-background/60 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* 统计胶囊 */}
        <div className="grid grid-cols-3 gap-1.5 pt-0.5 border-t border-border/30 text-center">
          <div className="rounded-lg bg-muted/40 py-1 border border-border/20">
            <span className="text-xs font-bold text-foreground font-mono">{displayPlugins.length} </span>
            <span className="text-[10px] text-muted-foreground">总插件</span>
          </div>
          <div className="rounded-lg bg-cyan-500/10 py-1 border border-cyan-500/20">
            <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400 font-mono">{enabledCount} </span>
            <span className="text-[10px] text-cyan-700 dark:text-cyan-300">允许装载</span>
          </div>
          <div className="rounded-lg bg-amber-500/10 py-1 border border-amber-500/20">
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 font-mono">{awaitingPermissionCount} </span>
            <span className="text-[10px] text-amber-700 dark:text-amber-300">待授权</span>
          </div>
        </div>
      </div>

      {/* 唯一极简插件列表：开箱即用，纯粹开关 */}
      <div className="space-y-1.5">
        {filteredPlugins.length === 0 ? (
          <div className="surface-card flex flex-col items-center rounded-2xl border border-dashed border-border/70 p-5 text-center">
            <PackageCheck className="h-6 w-6 text-muted-foreground/60" />
            <p className="mt-1.5 text-xs font-bold text-foreground">尚未安装 Tool Plugin Manifest</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              点击上方“导入插件”即可快速添加。
            </p>
          </div>
        ) : (
          filteredPlugins.map((plugin) => {
            const isPersisted = installedIds.has(plugin.id);
            return (
              <ToolPluginCard
                key={plugin.id}
                plugin={plugin}
                expanded={expandedId === plugin.id}
                busy={busy}
                credentialStatus={credentialStatus[plugin.id] ?? []}
                runtimeFailure={runtimeDiagnostics?.failures[plugin.id]}
                registered={runtimeDiagnostics?.registeredPlugins.includes(plugin.id) ?? false}
                onToggleExpanded={() => setExpandedId((current) => current === plugin.id ? null : plugin.id)}
                onSetEnabled={async (enabled) => {
                  const required = plugin.manifest.permissions.map((p) => p.id);
                  const requiredCredentials = plugin.manifest.credentials?.filter((c) => c.required) ?? [];
                  return runMutation(async () => {
                    if (!isPersisted) {
                      const official = officialPlugins.find((o) => o.manifest.id === plugin.id);
                      if (official) await toolPluginManagementUseCases.install(official);
                    }
                    if (enabled && !hasRequiredPermissions(plugin)) {
                      await toolPluginManagementUseCases.setPermissions(plugin.id, required);
                    }
                    if (enabled && requiredCredentials.length > 0) {
                      const statuses = await toolPluginManagementUseCases.listCredentialStatus(plugin.id);
                      const configured = new Set(statuses.filter((s) => s.configured).map((s) => s.id));
                      for (const cred of requiredCredentials) {
                        if (!configured.has(cred.id)) {
                          const value = await showCustomPrompt(`请输入“${cred.label}”。凭据只会加密保存并由宿主注入请求。`, "", "配置 Tool Plugin 凭据", "password");
                          if (!value) return;
                          await toolPluginManagementUseCases.setCredential(plugin.id, cred.id, value);
                        }
                      }
                    }
                    await toolPluginManagementUseCases.setEnabled(plugin.id, enabled);
                  });
                }}
                onSetPermission={async (permission, granted) => {
                  return runMutation(async () => {
                    if (!isPersisted) {
                      const official = officialPlugins.find((o) => o.manifest.id === plugin.id);
                      if (official) await toolPluginManagementUseCases.install(official);
                    }
                    const next = granted
                      ? [...plugin.grantedPermissions, permission]
                      : plugin.grantedPermissions.filter((item) => item !== permission);
                    await toolPluginManagementUseCases.setPermissions(plugin.id, next);
                  });
                }}
                onSetCredential={async (credentialId, label) => {
                  const value = await showCustomPrompt(`请输入“${label}”。凭据只会加密保存并由宿主注入请求。`, "", "配置 Tool Plugin 凭据", "password");
                  if (value === null) return;
                  await runMutation(async () => {
                    if (!isPersisted) {
                      const official = officialPlugins.find((o) => o.manifest.id === plugin.id);
                      if (official) await toolPluginManagementUseCases.install(official);
                    }
                    await toolPluginManagementUseCases.setCredential(plugin.id, credentialId, value);
                  });
                }}
                onDeleteCredential={(credentialId) => runMutation(() => toolPluginManagementUseCases.deleteCredential(plugin.id, credentialId))}
                onRollback={async (hash, version) => {
                  if (!await showCustomConfirm(`回滚到 v${version}？回滚后插件会停用，全部权限需要重新授权。`)) return;
                  await runMutation(() => toolPluginManagementUseCases.rollback(plugin.id, hash));
                }}
                onUninstall={async () => {
                  if (!await showCustomConfirm(`卸载“${plugin.manifest.name}”并删除其全部版本记录和授权状态？`)) return;
                  await runMutation(() => toolPluginManagementUseCases.uninstall(plugin.id));
                }}
              />
            );
          })
        )}
      </div>

      <div role="note" className="text-[11px] text-muted-foreground/80 px-1 leading-relaxed">
        提示：来源标签只用于辨识发布来源，不代表 Mobile Tavern 已审核代码或保证安全；未验证来源仍可安装。Tool 插件由沙箱安全 Worker 隔离执行，凭据加密注入，不会暴露给外部代码。
      </div>

      <InstallReviewDialog
        inspection={review}
        busy={busy}
        onClose={() => setReview(null)}
        onInstall={() => void installReviewed()}
      />
    </section>
  );
}

function ToolPluginCard({
  plugin,
  expanded,
  busy,
  credentialStatus,
  runtimeFailure,
  registered,
  onToggleExpanded,
  onSetEnabled,
  onSetPermission,
  onSetCredential,
  onDeleteCredential,
  onRollback,
  onUninstall,
}: {
  plugin: InstalledToolPlugin;
  expanded: boolean;
  busy: boolean;
  credentialStatus: readonly ToolPluginCredentialStatus[];
  runtimeFailure?: string;
  registered: boolean;
  onToggleExpanded: () => void;
  onSetEnabled: (enabled: boolean) => Promise<void>;
  onSetPermission: (permission: ToolPluginPermission, granted: boolean) => Promise<void>;
  onSetCredential: (credentialId: string, label: string) => Promise<void>;
  onDeleteCredential: (credentialId: string) => Promise<void>;
  onRollback: (hash: string, version: string) => Promise<void>;
  onUninstall: () => Promise<void>;
}): React.JSX.Element {
  const ready = hasRequiredPermissions(plugin);
  const needsCredential = (plugin.manifest.credentials?.length ?? 0) > 0;

  return (
    <article className="surface-card rounded-xl border border-border/70 p-2.5 rim-light transition-all space-y-2">
      {/* 默认常态：单行极简，高度仅 36px，绝无多余废话 */}
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            plugin.enabled ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300" : "bg-muted text-muted-foreground"
          }`}>
            {ready ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
            <h3 className="text-xs font-bold text-foreground truncate">{plugin.manifest.name}</h3>
            <span className="text-[10px] font-mono text-muted-foreground bg-muted/60 px-1 py-0.2 rounded">v{plugin.manifest.version}</span>
            <span className="text-[10px] font-mono text-muted-foreground/80 bg-muted/40 px-1 py-0.2 rounded">{executionLabel(plugin.manifest)}</span>
            <StatusBadge plugin={plugin} registered={registered} runtimeFailure={runtimeFailure} />
          </div>
        </div>

        {/* 右侧操作：密钥配置 + 固定尺寸开关(56px*28px) + 详情箭头 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {needsCredential && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const cred = plugin.manifest.credentials?.[0];
                if (cred) void onSetCredential(cred.id, cred.label);
              }}
              className="p-1 rounded-lg border border-border/60 bg-background/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
              title="配置密钥"
            >
              <Key className="h-3.5 w-3.5 text-primary" />
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            aria-label={plugin.enabled ? `停用 ${plugin.manifest.name}` : `允许装载 ${plugin.manifest.name}`}
            onClick={() => void onSetEnabled(!plugin.enabled)}
            className={`w-14 h-7 rounded-lg text-xs font-bold transition-all active:scale-95 flex items-center justify-center shadow-2xs ${
              plugin.enabled
                ? "bg-cyan-500 hover:bg-cyan-600 text-white"
                : "border border-border/70 bg-background/80 hover:bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{plugin.enabled ? "启用" : "停用"}</span>
          </button>

          <button
            type="button"
            onClick={onToggleExpanded}
            aria-label="权限、Tool 与版本"
            className="p-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* 只有展开后才显示描述与高级技术设置 */}
      {expanded && (
        <div className="space-y-2 border-t border-border/40 pt-2 text-xs">
          <p className="text-xs text-muted-foreground leading-relaxed">{plugin.manifest.description}</p>

          {runtimeFailure && (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-2 text-xs leading-relaxed text-destructive">
              Runtime 未注册：{runtimeFailure}
            </div>
          )}

          <div>
            <h4 className="mb-1 text-[11px] font-bold text-foreground">权限授权</h4>
            <div className="space-y-1">
              {plugin.manifest.permissions.length === 0 ? (
                <p className="rounded-lg bg-muted/40 px-2 py-1 text-xs text-muted-foreground">此插件未请求宿主权限。</p>
              ) : plugin.manifest.permissions.map((permission) => (
                <PermissionRow
                  key={permission.id}
                  permission={permission}
                  granted={plugin.grantedPermissions.includes(permission.id)}
                  disabled={busy}
                  onChange={(granted) => void onSetPermission(permission.id, granted)}
                />
              ))}
            </div>
          </div>

          {(plugin.manifest.credentials?.length ?? 0) > 0 && (
            <div>
              <h4 className="mb-1 text-[11px] font-bold text-foreground">宿主凭据</h4>
              <div className="space-y-1">
                {plugin.manifest.credentials?.map((credential) => {
                  const configured = credentialStatus.find((item) => item.id === credential.id)?.configured ?? false;
                  return (
                    <div key={credential.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-foreground">{credential.label}</p>
                        <p className="text-[10px] text-muted-foreground">{credential.required ? "必需" : "可选"} · {configured ? "已加密配置" : "未配置"}</p>
                      </div>
                      <button type="button" disabled={busy} onClick={() => void onSetCredential(credential.id, credential.label)} className="h-6.5 rounded border border-border bg-background px-2 text-[11px] font-semibold text-foreground hover:bg-muted transition-all active:scale-95">{configured ? "更新" : "配置"}</button>
                      {configured && <button type="button" disabled={busy} onClick={() => void onDeleteCredential(credential.id)} className="h-6.5 rounded border border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/20 px-2 text-[11px] font-semibold transition-all active:scale-95">清除</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h4 className="mb-1 text-[11px] font-bold text-foreground">声明的 Tool</h4>
            <div className="space-y-1">
              {plugin.manifest.tools.map((tool) => (
                <div key={tool.id} className="rounded-lg border border-border/50 bg-card/60 p-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-foreground">{tool.id}</span>
                    <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">{riskLabel(tool.riskLevel)} · {effectLabel(tool.sideEffect)}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{tool.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/25 p-1.5">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-foreground">来源与版本</p>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="truncate">{plugin.manifest.source.label}</span>
                <span>· {sourceVerificationLabel(plugin.sourceVerification)}</span>
                {plugin.manifest.source.url && <a href={plugin.manifest.source.url} target="_blank" rel="noreferrer" aria-label="打开插件来源" className="text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              {plugin.history.map((version) => (
                <button key={version.manifest.contentHash} type="button" onClick={() => void onRollback(version.manifest.contentHash, version.manifest.version)} className="flex h-6.5 items-center gap-0.5 rounded border border-border bg-background px-1.5 text-[10px] font-semibold text-foreground hover:bg-muted transition-all active:scale-95">
                  <RotateCcw className="h-2.5 w-2.5" />v{version.manifest.version}
                </button>
              ))}
              <button type="button" onClick={() => void onUninstall()} aria-label={`卸载 ${plugin.manifest.name}`} className="flex h-6.5 w-6.5 items-center justify-center rounded border border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-all active:scale-95"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function PermissionRow({ permission, granted, disabled, onChange }: {
  permission: ToolPluginPermissionDeclaration;
  granted: boolean;
  disabled: boolean;
  onChange: (granted: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-1.5">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${granted ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
        {granted ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs font-bold text-foreground">{permission.id}</span>
          <span className="text-[10px] text-muted-foreground">{permission.optional ? "可选" : "必需"} · {riskLabel(permission.riskLevel)}</span>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{permission.reason}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={granted}
        aria-label={`${granted ? "撤销" : "授予"}权限 ${permission.id}`}
        disabled={disabled}
        onClick={() => onChange(!granted)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${granted ? "bg-emerald-500" : "bg-muted-foreground/25"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${granted ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

function InstallReviewDialog({ inspection, busy, onClose, onInstall }: {
  inspection: ToolPluginInspection | null;
  busy: boolean;
  onClose: () => void;
  onInstall: () => void;
}): React.JSX.Element {
  useMobileBackHandler(inspection !== null, () => {
    if (!busy) onClose();
    return true;
  }, 900);
  return (
    <Dialog open={inspection !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="top-auto bottom-0 left-1/2 max-h-[88dvh] w-full max-w-xl -translate-x-1/2 translate-y-0 overflow-y-auto rounded-b-none p-0">
        {inspection && (() => {
          const manifest = inspection.manifest;
          return (
          <>
            <DialogHeader className="border-b border-border px-4 pb-3 pt-4 pr-12">
              <DialogTitle className="text-base font-bold">导入插件 {manifest.name}</DialogTitle>
              <DialogDescription className="text-xs">核对来源、隔离位置、内容哈希和权限；导入后默认停用且不授予权限。</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <ReviewField label="版本" value={`v${manifest.version}`} />
                <ReviewField label="最低 Runtime" value={`v${manifest.runtime.minVersion}`} />
                <ReviewField label="执行位置" value={executionLabel(manifest)} />
                <ReviewField label="包能力" value={inspection.artifact?.entryCode ? "L2 受限 Worker" : manifest.tools.some((tool) => tool.handler?.kind === "http") ? "L1 HTTP 连接器" : manifest.tools.some((tool) => tool.handler?.kind === "host") ? "宿主 Capability 代理" : "仅清单"} />
                <ReviewField label="来源" value={manifest.source.label} />
                <ReviewField label="来源验证" value={sourceVerificationLabel(inspection.sourceVerification)} />
                <ReviewField label="目标 Profile" value={manifest.targetProfiles.join("、")} />
                <ReviewField
                  label="依赖"
                  value={manifest.dependencies.length > 0
                    ? manifest.dependencies.map((dependency) => `${dependency.id}@${dependency.version}`).join("、")
                    : "无"}
                />
              </div>
              <div role="note" className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-bold">来源风险提示</p>
                  <p className="mt-0.5">{sourceRiskNotice(inspection.sourceVerification)}</p>
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5">
                <p className="text-xs font-bold text-muted-foreground">SHA-256 内容哈希</p>
                <p className="mt-1 break-all font-mono text-[11px] text-foreground">{manifest.contentHash}</p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-bold text-foreground">请求权限（{manifest.permissions.length}）</p>
                <div className="space-y-1.5">
                  {manifest.permissions.map((permission) => (
                    <div key={permission.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs">
                      <span className="font-mono font-bold text-foreground">{permission.id}</span>
                      <span className="ml-2 text-muted-foreground">{permission.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button type="button" disabled={busy} onClick={onInstall} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 px-3 text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                <span>确认导入，稍后授权</span>
              </button>
            </div>
          </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

function ReviewField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="rounded-xl border border-border/60 bg-card/70 p-2"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-0.5 break-words font-semibold text-xs text-foreground">{value}</p></div>;
}

function StatusBadge({ plugin, registered, runtimeFailure }: { plugin: InstalledToolPlugin; registered: boolean; runtimeFailure?: string }): React.JSX.Element {
  if (runtimeFailure) return <span className="rounded-full bg-destructive/10 px-1.5 py-0.2 text-[10px] font-bold text-destructive">错误</span>;
  if (registered) return <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">已注册</span>;
  if (plugin.enabled) return <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.2 text-[10px] font-bold text-cyan-700 dark:text-cyan-300">允许装载</span>;
  if (hasRequiredPermissions(plugin)) return <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-bold text-muted-foreground">已授权 · 停用</span>;
  return <span className="rounded-full bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-bold text-amber-700 dark:text-amber-300">待授权</span>;
}

function hasRequiredPermissions(plugin: InstalledToolPlugin): boolean {
  const granted = new Set(plugin.grantedPermissions);
  return plugin.manifest.permissions.every((permission) => permission.optional || granted.has(permission.id));
}

function executionLabel(manifest: ToolPluginManifest): string {
  if (manifest.tools.some((tool) => tool.handler?.kind === "host")) return "宿主授权能力";
  return manifest.runtime.execution === "worker" ? "Worker 隔离" : "Sandbox 隔离";
}

function riskLabel(risk: "low" | "medium" | "high"): string {
  return risk === "high" ? "高风险" : risk === "medium" ? "中风险" : "低风险";
}

function effectLabel(effect: "none" | "local-write" | "external" | "irreversible"): string {
  if (effect === "local-write") return "本地写入";
  if (effect === "external") return "外部访问";
  if (effect === "irreversible") return "不可逆";
  return "无副作用";
}

function sourceVerificationLabel(
  verification: ToolPluginInspection["sourceVerification"] | InstalledToolPlugin["sourceVerification"],
): string {
  if (!verification || verification.trustLevel === "unverified") return "未验证来源";
  if (verification.trustLevel === "signed") return "签名有效 · 未受信";
  if (verification.trustLevel === "trusted") {
    return verification.signerLabel ? `可信签名 · ${verification.signerLabel}` : "可信签名";
  }
  return verification.verificationMethod === "bundled"
    ? "官方内置"
    : verification.signerLabel ? `官方签名 · ${verification.signerLabel}` : "官方签名";
}

function sourceRiskNotice(
  verification: ToolPluginInspection["sourceVerification"] | InstalledToolPlugin["sourceVerification"],
): string {
  if (!verification || verification.trustLevel === "unverified") {
    return "此插件没有可验证的签名，作者身份与文件来源无法确认。Mobile Tavern 不会阻止安装，但无法为其代码背书；启用后它会在受限环境运行，并可使用你随后授予的网络或数据权限。";
  }
  if (verification.trustLevel === "signed") {
    return "签名有效只证明此包与所示密钥一致，不代表签名者身份已获信任或代码已经安全审核；启用前仍需核对权限、网络目标和数据影响。";
  }
  if (verification.trustLevel === "trusted") {
    return "可信签名只确认当前包由宿主登记的密钥发布，不代表插件绝对安全；启用前仍需核对权限、网络目标和数据影响。";
  }
  return "官方来源只确认发布来源，不代表插件绝对安全或已经审查每项行为；启用前仍需核对权限、网络目标和数据影响。";
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeError(error: unknown): string {
  const message = normalizeError(error);
  if (message.includes("CONTENT_HASH_MISMATCH")) return "内容哈希不一致，文件可能已被修改。";
  if (message.includes("VERSION_HASH_CONFLICT")) return "同一版本对应了不同内容哈希，已拒绝覆盖。";
  if (message.includes("REQUIRED_PERMISSION_MISSING")) return "请先授予全部必需权限。";
  if (message.includes("REQUIRED_CREDENTIAL_MISSING")) return "请先配置全部必需凭据。";
  if (message.includes("PACKAGE_REQUIRED")) return "含 Worker 的 v2 插件必须以完整 .mttool 包导入，不能只导入 Manifest。";
  if (message.includes("FORBIDDEN_API")) return "Worker 入口使用了 L2 禁止的网络、动态代码、存储或子 Worker API。";
  if (message.includes("SOURCE_SIGNATURE_INVALID")) return "包签名无效，文件可能已被篡改。";
  if (message.includes("SOURCE_PROOF_IDENTITY_MISMATCH")) return "来源证明与插件 ID、版本或内容哈希不匹配。";
  if (message.includes("SOURCE_SIGNER_KEY_MISMATCH")) return "签名者 ID 使用了与宿主可信记录不一致的公钥。";
  if (message.includes("SOURCE_PUBLIC_KEY_INVALID")) return "来源证明中的公钥无效。";
  return message;
}
