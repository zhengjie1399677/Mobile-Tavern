import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  ClipboardCopy,
  KeyRound,
  Loader2,
  Plug,
  Server,
  ShieldAlert,
  Terminal,
  Wand2,
} from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
import { Input } from "../../../../components/ui/input";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";
import type { HostBindingSettings } from "../../../types";
import {
  ALL_INTERFACES_HOST,
  DEFAULT_HEADLESS_PORT,
  LOOPBACK_HOSTS,
  buildHeadlessEnvText,
  evaluateHostBinding,
  generateAccessKey,
  isLoopbackHost,
  parseCorsOrigins,
  parsePortInput,
  type HostBindingIssueCode,
} from "../../../utils/hostBindingPolicy";
import {
  testHostConnection,
  type HostConnectionFailure,
  type HostConnectionResult,
} from "../../../application/useCases/hostServiceUseCases";
import { writeTextToClipboard } from "../../../infrastructure/platform/clipboard";

export type HostBindingSectionProps = Pick<
  UnifiedAppContextProps,
  "settings" | "updateSettings" | "showCustomConfirm" | "showCustomAlert"
>;

type TranslateFn = (key: string, variables?: Record<string, string | number>) => string;

/**
 * 逐 code 展开成字面量 `t()` 调用，而不是拼 `host_binding.issue_${code}`。
 *
 * 原因：`scripts/check-i18n.ts` 只静态识别字面量 key，模板拼接会让这 7 条文案被误报为死键；
 * 而 switch 在这里同时充当穷尽性检查 —— 以后给 `HostBindingIssueCode` 加成员，这里会编译报错。
 */
function resolveIssueText(t: TranslateFn, code: HostBindingIssueCode, detail: string): string {
  switch (code) {
    case "host_required":
      return t("host_binding.issue_host_required");
    case "port_invalid":
      return t("host_binding.issue_port_invalid", { detail });
    case "non_loopback_without_key":
      return t("host_binding.issue_non_loopback_without_key", { detail });
    case "weak_access_key":
      return t("host_binding.issue_weak_access_key", { detail });
    case "all_interfaces_exposed":
      return t("host_binding.issue_all_interfaces_exposed");
    case "lan_exposed_cleartext":
      return t("host_binding.issue_lan_exposed_cleartext");
    case "wildcard_cors":
      return t("host_binding.issue_wildcard_cors");
  }
}

/** 同理：连通性失败原因也要字面量展开，保持与 `HostConnectionFailure` 的穷尽对应。 */
function resolveFailureText(t: TranslateFn, failure: HostConnectionFailure | undefined): string {
  switch (failure) {
    case "invalid_url":
      return t("host_binding.remote_fail_invalid_url");
    case "unauthorized":
      return t("host_binding.remote_fail_unauthorized");
    case "not_a_host":
      return t("host_binding.remote_fail_not_a_host");
    case "unreachable":
    default:
      return t("host_binding.remote_fail_unreachable");
  }
}

const FALLBACK_BINDING: HostBindingSettings = {
  bindHost: LOOPBACK_HOSTS[0],
  bindPort: DEFAULT_HEADLESS_PORT,
  accessKey: "",
  corsOrigins: "",
  remoteUrl: "",
  remoteAccessKey: "",
};

export default function HostBindingSection({
  settings,
  updateSettings,
  showCustomConfirm,
  showCustomAlert,
}: HostBindingSectionProps) {
  const { t } = useTranslation();
  // 旧版本设置里没有 hostBinding，逐字段回落，避免出现 undefined 输入框。
  const binding = useMemo<HostBindingSettings>(
    () => ({ ...FALLBACK_BINDING, ...(settings.hostBinding ?? {}) }),
    [settings.hostBinding],
  );

  const [portDraft, setPortDraft] = useState<string>(String(binding.bindPort));
  const [remoteResult, setRemoteResult] = useState<HostConnectionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [copiedField, setCopiedField] = useState<"accessKey" | "env" | null>(null);

  const patchBinding = (patch: Partial<HostBindingSettings>) => {
    updateSettings((prev) => ({
      ...prev,
      hostBinding: { ...FALLBACK_BINDING, ...(prev.hostBinding ?? {}), ...patch },
    }));
  };

  const corsOrigins = useMemo(() => parseCorsOrigins(binding.corsOrigins), [binding.corsOrigins]);
  const assessment = useMemo(
    () =>
      evaluateHostBinding({
        bindHost: binding.bindHost,
        bindPort: binding.bindPort,
        accessKey: binding.accessKey,
        corsOrigins,
      }),
    [binding.bindHost, binding.bindPort, binding.accessKey, corsOrigins],
  );

  const isLoopback = isLoopbackHost(binding.bindHost);
  const portInvalid = parsePortInput(portDraft) === null;

  const handleCopy = async (field: "accessKey" | "env", text: string) => {
    try {
      await writeTextToClipboard(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1600);
    } catch {
      await showCustomAlert(t("host_binding.copy_failed"), t("host_binding.env_title"));
    }
  };

  /**
   * 放开局域网监听是「默认禁止、显式解锁」：从仅本机换成任何外部地址时先确认，
   * 用户拒绝就保持原值，不写入设置。这是界面侧放开 0.0.0.0 / 局域网地址的唯一入口。
   */
  const handleBindHostChange = async (next: string) => {
    const trimmed = next.trim();
    if (trimmed && !isLoopbackHost(trimmed) && isLoopback) {
      const confirmed = await showCustomConfirm(
        t("host_binding.lan_confirm_message", { host: trimmed }),
        t("host_binding.lan_confirm_title"),
      );
      if (!confirmed) return;
    }
    patchBinding({ bindHost: trimmed });
  };

  const handlePortChange = (raw: string) => {
    setPortDraft(raw);
    const parsed = parsePortInput(raw);
    // 非法输入只提示、不回写：否则用户删到一半就会被回退成默认端口。
    if (parsed !== null) patchBinding({ bindPort: parsed });
  };

  const handleGenerateKey = () => {
    try {
      patchBinding({ accessKey: generateAccessKey() });
    } catch {
      // generateAccessKey 在缺少安全随机源时抛错，用户需要知道而不是静默不改。
      void showCustomAlert(t("host_binding.access_key_unsupported"), t("host_binding.access_key"));
    }
  };

  const handleCopyEnv = async () => {
    if (!assessment.allowed) {
      await showCustomAlert(
        t("host_binding.lan_blocked_message"),
        t("host_binding.lan_blocked_title"),
      );
      return;
    }
    await handleCopy(
      "env",
      buildHeadlessEnvText({
        bindHost: binding.bindHost,
        bindPort: binding.bindPort,
        accessKey: binding.accessKey,
        corsOrigins,
      }),
    );
  };

  const handleTestRemote = async () => {
    if (isTesting) return;
    setIsTesting(true);
    setRemoteResult(null);
    try {
      setRemoteResult(
        await testHostConnection({
          baseUrl: binding.remoteUrl,
          accessKey: binding.remoteAccessKey,
        }),
      );
    } finally {
      setIsTesting(false);
    }
  };

  const envText = buildHeadlessEnvText({
    bindHost: binding.bindHost,
    bindPort: binding.bindPort,
    accessKey: binding.accessKey,
    corsOrigins,
  });

  const assessmentTone = assessment.level === "ok"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : assessment.level === "warning"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";

  const AssessmentIcon = assessment.level === "ok"
    ? CheckCircle2
    : assessment.level === "warning"
      ? AlertTriangle
      : ShieldAlert;

  const assessmentText = assessment.level === "ok"
    ? t("host_binding.assessment_ok")
    : assessment.level === "warning"
      ? t("host_binding.assessment_warning")
      : t("host_binding.assessment_error");

  return (
    <div data-ui="host-binding-section" className="space-y-3">
      {/* ── 角色一：本机作为宿主 ───────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 bg-card/35 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Server className="h-3.5 w-3.5" />
              </span>
              <h4 className="text-xs font-bold text-foreground">{t("host_binding.host_role_title")}</h4>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
              {t("host_binding.host_role_desc")}
            </p>
          </div>
          <span
            data-testid="host-binding-scope-badge"
            className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
              isLoopback
                ? "border-border/40 bg-muted/40 text-muted-foreground"
                : "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
            }`}
          >
            {isLoopback ? t("host_binding.bind_host_loopback") : t("host_binding.bind_host_all")}
          </span>
        </div>

        {/* 监听地址 */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="host-binding-address">
            {t("host_binding.bind_host")}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="host-binding-address"
              value={binding.bindHost}
              onChange={(event) => void handleBindHostChange(event.target.value)}
              placeholder={LOOPBACK_HOSTS[0]}
              spellCheck={false}
              className="h-8.5 flex-1 rounded-xl border-border/70 bg-background/80 font-mono text-xs"
            />
            <div className="flex shrink-0 gap-1">
              {[LOOPBACK_HOSTS[0], ALL_INTERFACES_HOST].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => void handleBindHostChange(preset)}
                  data-active={binding.bindHost.trim() === preset ? "true" : "false"}
                  className={`h-8.5 rounded-lg border px-2 font-mono text-[10px] font-bold transition-colors active:scale-95 ${
                    binding.bindHost.trim() === preset
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[9.5px] leading-relaxed text-muted-foreground/75">
            {t("host_binding.bind_host_hint")}
          </p>
        </div>

        {/* 端口 + 访问凭据 */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="host-binding-port">
              {t("host_binding.bind_port")}
            </label>
            <Input
              id="host-binding-port"
              inputMode="numeric"
              value={portDraft}
              onChange={(event) => handlePortChange(event.target.value)}
              placeholder={String(DEFAULT_HEADLESS_PORT)}
              aria-invalid={portInvalid}
              spellCheck={false}
              className="h-8.5 rounded-xl border-border/70 bg-background/80 font-mono text-xs"
            />
            {portInvalid && (
              <p className="text-[9.5px] font-medium text-rose-600 dark:text-rose-400">
                {t("host_binding.port_invalid")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="host-binding-key">
              {t("host_binding.access_key")}
            </label>
            {/* 凭据是 48 位十六进制，和两个按钮挤在一行时会被截断，所以输入独占一行、按钮另起一行。 */}
            <Input
              id="host-binding-key"
              value={binding.accessKey}
              onChange={(event) => patchBinding({ accessKey: event.target.value })}
              placeholder={t("host_binding.access_key_placeholder")}
              spellCheck={false}
              className="h-8.5 w-full rounded-xl border-border/70 bg-background/80 font-mono text-[11px]"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={handleGenerateKey}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-[10px] font-bold text-primary active:scale-95"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {t("host_binding.access_key_generate")}
              </button>
              <button
                type="button"
                onClick={() => void handleCopy("accessKey", binding.accessKey)}
                disabled={!binding.accessKey}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 text-[10px] font-bold text-muted-foreground active:scale-95 disabled:opacity-40"
              >
                {copiedField === "accessKey"
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  : <KeyRound className="h-3.5 w-3.5" />}
                {t("host_binding.access_key_copy")}
              </button>
            </div>
            <p className="text-[9.5px] leading-relaxed text-muted-foreground/75">
              {copiedField === "accessKey"
                ? t("host_binding.access_key_copied")
                : t("host_binding.access_key_hint")}
            </p>
          </div>
        </div>

        {/* 跨域白名单 */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="host-binding-cors">
            {t("host_binding.cors_origins")}
          </label>
          <Input
            id="host-binding-cors"
            value={binding.corsOrigins}
            onChange={(event) => patchBinding({ corsOrigins: event.target.value })}
            placeholder={t("host_binding.cors_placeholder")}
            spellCheck={false}
            className="h-8.5 rounded-xl border-border/70 bg-background/80 font-mono text-xs"
          />
          <p className="text-[9.5px] leading-relaxed text-muted-foreground/75">
            {t("host_binding.cors_origins_hint")}
          </p>
        </div>

        {/* 实时校验：文案与 headless 启动闸门同源，不允许界面说「能启动」而进程拒绝启动 */}
        <div
          data-testid="host-binding-assessment"
          data-level={assessment.level}
          className={`rounded-lg border p-2.5 ${assessmentTone}`}
        >
          <div className="flex items-start gap-2">
            <AssessmentIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-[11px] font-bold">{assessmentText}</p>
              {assessment.issues.length > 0 && (
                <ul className="space-y-0.5">
                  {assessment.issues.map((issue) => (
                    <li key={issue.code} className="flex gap-1.5 text-[9.5px] leading-relaxed opacity-90">
                      <span aria-hidden="true">·</span>
                      <span>{resolveIssueText(t, issue.code, issue.detail ?? "")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* 启动配置：无头宿主只吃环境变量，界面负责把它生成出来 */}
        <div className="space-y-2 rounded-lg border border-dashed border-border/60 bg-muted/20 p-2.5">
          <div className="flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-bold text-foreground">{t("host_binding.env_title")}</span>
          </div>
          <pre className="custom-scrollbar max-h-32 overflow-auto rounded-lg border border-border/50 bg-background/70 p-2 font-mono text-[9.5px] leading-relaxed text-muted-foreground">
            {envText}
          </pre>
          <p className="text-[9.5px] leading-relaxed text-muted-foreground/75">
            {t("host_binding.env_desc")}
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleCopyEnv()}
              disabled={!assessment.allowed}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-[10px] font-bold text-primary active:scale-95 disabled:opacity-40"
            >
              {copiedField === "env"
                ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <ClipboardCopy className="h-3.5 w-3.5" />}
              {copiedField === "env" ? t("host_binding.env_copied") : t("host_binding.env_copy")}
            </button>
          </div>
        </div>
      </section>

      {/* ── 角色二：连接到远程宿主 ─────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 bg-card/35 p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Cable className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-foreground">{t("host_binding.remote_role_title")}</h4>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              {t("host_binding.remote_role_desc")}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="host-remote-url">
              {t("host_binding.remote_url")}
            </label>
            <Input
              id="host-remote-url"
              value={binding.remoteUrl}
              onChange={(event) => patchBinding({ remoteUrl: event.target.value })}
              placeholder={t("host_binding.remote_url_placeholder")}
              spellCheck={false}
              className="h-8.5 rounded-xl border-border/70 bg-background/80 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="host-remote-key">
              {t("host_binding.remote_access_key")}
            </label>
            <Input
              id="host-remote-key"
              type="password"
              value={binding.remoteAccessKey}
              onChange={(event) => patchBinding({ remoteAccessKey: event.target.value })}
              spellCheck={false}
              className="h-8.5 rounded-xl border-border/70 bg-background/80 font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleTestRemote()}
            disabled={isTesting || !binding.remoteUrl.trim()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-[10px] font-bold text-primary active:scale-95 disabled:opacity-40"
          >
            {isTesting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Plug className="h-3.5 w-3.5" />}
            {isTesting ? t("host_binding.remote_testing") : t("host_binding.remote_test")}
          </button>
        </div>

        {/* 阶段说明独立成行：这是本分区最重要的一句实话，不跟按钮抢宽度。 */}
        <p className="text-[9.5px] leading-relaxed text-muted-foreground/75">
          {t("host_binding.stage0_notice")}
        </p>

        {remoteResult && (
          <div
            data-testid="host-remote-result"
            data-ok={remoteResult.ok ? "true" : "false"}
            className={`rounded-lg border p-2.5 text-[10px] leading-relaxed ${
              remoteResult.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            }`}
          >
            {remoteResult.ok ? (
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("host_binding.remote_ok", { ms: remoteResult.latencyMs })}
                </p>
                {remoteResult.summary && (
                  <p className="font-mono opacity-90">
                    {t("host_binding.remote_summary", {
                      characters: remoteResult.summary.charactersCount,
                      sessions: remoteResult.summary.sessionsCount,
                      mode: remoteResult.summary.mode,
                    })}
                  </p>
                )}
              </div>
            ) : (
              <p className="flex items-start gap-1.5 font-bold">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {resolveFailureText(t, remoteResult.failure)}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
