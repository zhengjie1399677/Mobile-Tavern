import React from "react";
import {
  ChevronDown,
  ExternalLink,
  Globe2,
  Loader2,
  PackageCheck,
  Power,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Wrench,
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
      await showCustomAlert(describeError(error), "Tool Plugin 安装失败");
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

  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;
  const awaitingPermissionCount = plugins.filter((plugin) => !hasRequiredPermissions(plugin)).length;
  const installedIds = new Set(plugins.map((plugin) => plugin.id));

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-500/25 bg-card/75 shadow-sm" data-ui="tool-plugin-manager">
      <div className="border-b border-border/50 bg-gradient-to-br from-cyan-500/10 via-primary/5 to-transparent p-3.5">
        <header className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-300"><Wrench className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-xs font-bold text-foreground">Agent Tool 插件</h2>
              <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[8px] font-bold text-cyan-700 dark:text-cyan-300">受控清单</span>
            </div>
            <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">安装声明式连接器或受限 Worker 包，逐项授权、停用或回滚；外部代码不会进入 App 主进程。</p>
          </div>
        </header>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <SummaryStat label="已安装" value={plugins.length} />
          <SummaryStat label="允许装载" value={enabledCount} tone="cyan" />
          <SummaryStat label="待授权" value={awaitingPermissionCount} tone="amber" />
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-[9px] leading-relaxed text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>L2 仅开放宿主代理网络与一次性 Worker：域名、方法、流量、超时和调用次数均受 Manifest 配额约束，凭据不会暴露给 Worker。</p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".mttool,.json,.mttool.json,application/json,application/zip"
          className="hidden"
          aria-label="选择 Tool Plugin Manifest"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 text-[10px] font-bold text-cyan-700 transition active:scale-[0.99] disabled:opacity-50 dark:text-cyan-300"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          导入 .mttool / Manifest
        </button>
      </div>

      <div className="space-y-2.5 p-3">
        {officialPlugins.length > 0 && (
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
              <div className="min-w-0 flex-1">
                <h3 className="text-[10px] font-bold text-foreground">官方能力积木</h3>
                <p className="mt-0.5 text-[8px] leading-relaxed text-muted-foreground">固定来源与权限边界，安装后仍需单独配置所需凭据、授权并启用。</p>
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {officialPlugins.map((inspection) => {
                const installed = installedIds.has(inspection.manifest.id);
                return (
                  <div key={inspection.manifest.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/70 p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold text-foreground">{inspection.manifest.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-[8px] leading-relaxed text-muted-foreground">{inspection.manifest.description}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || installed}
                      aria-label={`${installed ? "已安装" : "查看并安装"} ${inspection.manifest.name}`}
                      onClick={() => setReview(inspection)}
                      className="min-h-9 shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 text-[8px] font-bold text-cyan-700 disabled:border-border disabled:bg-muted disabled:text-muted-foreground dark:text-cyan-300"
                    >
                      {installed ? "已安装" : "查看并安装"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {plugins.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-4 py-7 text-center">
            <PackageCheck className="h-7 w-7 text-muted-foreground/60" />
            <p className="mt-2 text-[10px] font-semibold text-foreground">尚未安装 Tool Plugin Manifest</p>
            <p className="mt-1 max-w-xs text-[8.5px] leading-relaxed text-muted-foreground">导入后会先展示来源、内容哈希、Tool 和权限，再由你确认安装。</p>
          </div>
        ) : plugins.map((plugin) => (
          <ToolPluginCard
            key={plugin.id}
            plugin={plugin}
            expanded={expandedId === plugin.id}
            busy={busy}
            credentialStatus={credentialStatus[plugin.id] ?? []}
            runtimeFailure={runtimeDiagnostics?.failures[plugin.id]}
            registered={runtimeDiagnostics?.registeredPlugins.includes(plugin.id) ?? false}
            onToggleExpanded={() => setExpandedId((current) => current === plugin.id ? null : plugin.id)}
            onSetEnabled={(enabled) => runMutation(() => toolPluginManagementUseCases.setEnabled(plugin.id, enabled))}
            onSetPermission={(permission, granted) => {
              const next = granted
                ? [...plugin.grantedPermissions, permission]
                : plugin.grantedPermissions.filter((item) => item !== permission);
              return runMutation(() => toolPluginManagementUseCases.setPermissions(plugin.id, next));
            }}
            onSetCredential={async (credentialId, label) => {
              const value = await showCustomPrompt(`请输入“${label}”。凭据只会加密保存并由宿主注入请求。`, "", "配置 Tool Plugin 凭据", "password");
              if (value === null) return;
              await runMutation(() => toolPluginManagementUseCases.setCredential(plugin.id, credentialId, value));
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
        ))}
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
  return (
    <article className="rounded-2xl border border-border/70 bg-background/75 p-3">
      <div className="flex items-start gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${plugin.enabled ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300" : "bg-muted text-muted-foreground"}`}>
          {ready ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[11px] font-bold text-foreground">{plugin.manifest.name}</h3>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[8px] text-muted-foreground">v{plugin.manifest.version}</span>
            <StatusBadge plugin={plugin} registered={registered} runtimeFailure={runtimeFailure} />
          </div>
          <p className="mt-1 line-clamp-2 text-[8.5px] leading-relaxed text-muted-foreground">{plugin.manifest.description}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[8px] text-muted-foreground">
            <span>{plugin.manifest.author}</span>
            <span>{executionLabel(plugin.manifest)}</span>
            <span>{plugin.manifest.tools.length} 个 Tool</span>
            <span className="font-mono">{plugin.manifest.contentHash.slice(7, 17)}…</span>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || (!ready && !plugin.enabled)}
          aria-label={plugin.enabled ? `停用 ${plugin.manifest.name}` : `允许装载 ${plugin.manifest.name}`}
          onClick={() => void onSetEnabled(!plugin.enabled)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition active:scale-95 disabled:opacity-35 ${plugin.enabled ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300" : "border-border bg-muted/50 text-muted-foreground"}`}
        >
          <Power className="h-4 w-4" />
        </button>
      </div>

      <button type="button" onClick={onToggleExpanded} className="mt-2.5 flex min-h-9 w-full items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-3 text-[9px] font-semibold text-foreground">
        <span>权限、Tool 与版本</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-3 border-t border-border/50 pt-3">
          {runtimeFailure && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-2.5 text-[8.5px] leading-relaxed text-destructive">
              Runtime 未注册：{runtimeFailure}
            </div>
          )}
          <div>
            <h4 className="mb-1.5 text-[9px] font-bold text-foreground">权限授权</h4>
            <div className="space-y-1.5">
              {plugin.manifest.permissions.length === 0 ? (
                <p className="rounded-lg bg-muted/40 px-2.5 py-2 text-[8.5px] text-muted-foreground">此插件未请求宿主权限。</p>
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
              <h4 className="mb-1.5 text-[9px] font-bold text-foreground">宿主凭据</h4>
              <div className="space-y-1.5">
                {plugin.manifest.credentials?.map((credential) => {
                  const configured = credentialStatus.find((item) => item.id === credential.id)?.configured ?? false;
                  return (
                    <div key={credential.id} className="flex items-center gap-2 rounded-xl border border-border/50 bg-card/60 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[8.5px] font-bold text-foreground">{credential.label}</p>
                        <p className="mt-0.5 text-[8px] text-muted-foreground">{credential.required ? "必需" : "可选"} · {configured ? "已加密配置" : "未配置"}</p>
                      </div>
                      <button type="button" disabled={busy} onClick={() => void onSetCredential(credential.id, credential.label)} className="min-h-8 rounded-lg border border-border bg-background px-2 text-[8px] font-semibold text-foreground">{configured ? "更新" : "配置"}</button>
                      {configured && <button type="button" disabled={busy} onClick={() => void onDeleteCredential(credential.id)} className="min-h-8 rounded-lg border border-destructive/25 bg-destructive/5 px-2 text-[8px] font-semibold text-destructive">清除</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h4 className="mb-1.5 text-[9px] font-bold text-foreground">声明的 Tool</h4>
            <div className="space-y-1.5">
              {plugin.manifest.tools.map((tool) => (
                <div key={tool.id} className="rounded-xl border border-border/50 bg-card/60 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[8.5px] font-bold text-foreground">{tool.id}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[7.5px] text-muted-foreground">{riskLabel(tool.riskLevel)} · {effectLabel(tool.sideEffect)}</span>
                  </div>
                  <p className="mt-1 text-[8px] leading-relaxed text-muted-foreground">{tool.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/25 p-2.5">
            <div className="min-w-0">
              <p className="text-[8.5px] font-bold text-foreground">来源与版本</p>
              <div className="mt-0.5 flex items-center gap-1.5 text-[8px] text-muted-foreground">
                <span className="truncate">{plugin.manifest.source.label}</span>
                {plugin.manifest.source.url && <a href={plugin.manifest.source.url} target="_blank" rel="noreferrer" aria-label="打开插件来源" className="text-primary"><ExternalLink className="h-3 w-3" /></a>}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {plugin.history.map((version) => (
                <button key={version.manifest.contentHash} type="button" onClick={() => void onRollback(version.manifest.contentHash, version.manifest.version)} className="flex min-h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[8px] font-semibold text-foreground">
                  <RotateCcw className="h-3 w-3" />v{version.manifest.version}
                </button>
              ))}
              <button type="button" onClick={() => void onUninstall()} aria-label={`卸载 ${plugin.manifest.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/5 text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
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
    <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card/60 p-2.5">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${granted ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
        {granted ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[8.5px] font-bold text-foreground">{permission.id}</span>
          <span className="text-[7.5px] text-muted-foreground">{permission.optional ? "可选" : "必需"} · {riskLabel(permission.riskLevel)}</span>
        </div>
        <p className="mt-0.5 text-[8px] leading-relaxed text-muted-foreground">{permission.reason}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={granted}
        aria-label={`${granted ? "撤销" : "授予"}权限 ${permission.id}`}
        disabled={disabled}
        onClick={() => onChange(!granted)}
        className={`relative h-6 w-10 shrink-0 rounded-full transition ${granted ? "bg-emerald-500" : "bg-muted-foreground/25"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${granted ? "translate-x-[18px]" : "translate-x-0.5"}`} />
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
              <DialogTitle>确认安装 {manifest.name}</DialogTitle>
              <DialogDescription>核对来源、隔离位置、内容哈希和权限；安装后默认停用且不授予权限。</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                <ReviewField label="版本" value={`v${manifest.version}`} />
                <ReviewField label="最低 Runtime" value={`v${manifest.runtime.minVersion}`} />
                <ReviewField label="执行位置" value={executionLabel(manifest)} />
                <ReviewField label="包能力" value={inspection.artifact?.entryCode ? "L2 受限 Worker" : manifest.tools.some((tool) => tool.handler?.kind === "http") ? "L1 HTTP 连接器" : manifest.tools.some((tool) => tool.handler?.kind === "host") ? "宿主 Capability 代理" : "仅清单"} />
                <ReviewField label="来源" value={manifest.source.label} />
                <ReviewField label="目标 Profile" value={manifest.targetProfiles.join("、")} />
                <ReviewField
                  label="依赖"
                  value={manifest.dependencies.length > 0
                    ? manifest.dependencies.map((dependency) => `${dependency.id}@${dependency.version}`).join("、")
                    : "无"}
                />
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5">
                <p className="text-[8px] font-bold text-muted-foreground">SHA-256 内容哈希</p>
                <p className="mt-1 break-all font-mono text-[8px] text-foreground">{manifest.contentHash}</p>
              </div>
              <div>
                <p className="mb-1.5 text-[9px] font-bold text-foreground">请求权限（{manifest.permissions.length}）</p>
                <div className="space-y-1.5">
                  {manifest.permissions.map((permission) => (
                    <div key={permission.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[8.5px]">
                      <span className="font-mono font-bold text-foreground">{permission.id}</span>
                      <span className="ml-2 text-muted-foreground">{permission.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button type="button" disabled={busy} onClick={onInstall} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-3 text-[10px] font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}确认安装，稍后授权
              </button>
            </div>
          </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "cyan" | "amber" }): React.JSX.Element {
  const color = tone === "cyan" ? "text-cyan-600 dark:text-cyan-300" : tone === "amber" ? "text-amber-600 dark:text-amber-300" : "text-foreground";
  return <div className="rounded-xl border border-border/50 bg-background/55 px-2.5 py-2"><p className={`text-sm font-black ${color}`}>{value}</p><p className="text-[8px] text-muted-foreground">{label}</p></div>;
}

function ReviewField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="rounded-xl border border-border/60 bg-card/70 p-2.5"><p className="text-[8px] text-muted-foreground">{label}</p><p className="mt-0.5 break-words font-semibold text-foreground">{value}</p></div>;
}

function StatusBadge({ plugin, registered, runtimeFailure }: { plugin: InstalledToolPlugin; registered: boolean; runtimeFailure?: string }): React.JSX.Element {
  if (runtimeFailure) return <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[7.5px] font-bold text-destructive">Runtime 错误</span>;
  if (registered) return <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[7.5px] font-bold text-emerald-700 dark:text-emerald-300">已注册</span>;
  if (plugin.enabled) return <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[7.5px] font-bold text-cyan-700 dark:text-cyan-300">允许装载</span>;
  if (hasRequiredPermissions(plugin)) return <span className="rounded-full bg-muted px-2 py-0.5 text-[7.5px] font-bold text-muted-foreground">已授权 · 停用</span>;
  return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[7.5px] font-bold text-amber-700 dark:text-amber-300">待授权</span>;
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
  return message;
}
