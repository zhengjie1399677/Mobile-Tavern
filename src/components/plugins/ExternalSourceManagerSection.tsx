/**
 * 设置页「外部能力」入口：管理外部能力源（当前唯一实现为 MCP）。
 *
 * 组件只调用应用用例与运行时服务，不直接触碰 IndexedDB、协议 SDK 或存储实现。
 */
import * as React from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Switch } from "../../../components/ui/switch";
import { useUnifiedApp } from "../../UnifiedAppContext";
import {
  KernelServices,
  type IExternalSourceRuntimeService,
} from "../../application/serviceContracts";
import { externalSourceUseCases } from "../../application/externalSources/externalSourceUseCases";
import type {
  ExternalCapabilitySource,
  ExternalProtocolEra,
} from "../../domain/externalSources/contracts";
import type { StoredExternalSource } from "../../infrastructure/externalSources/externalSourceStorage";

const TRANSPORT = "streamable-http";

interface DraftState {
  id: string;
  displayName: string;
  endpoint: string;
  era: ExternalProtocolEra;
}

const EMPTY_DRAFT: DraftState = { id: "", displayName: "", endpoint: "", era: "auto" };

const ERA_LABEL: Record<ExternalProtocolEra, string> = {
  auto: "自动协商",
  legacy: "旧世代（initialize）",
  modern: "现代世代（2026-07-28）",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ExternalSourceManagerSection(): React.ReactElement {
  const { getKernelService } = useUnifiedApp((state) => ({
    getKernelService: state.getKernelService,
  }));
  const [sources, setSources] = React.useState<StoredExternalSource[]>([]);
  const [draft, setDraft] = React.useState<DraftState>(EMPTY_DRAFT);
  const [status, setStatus] = React.useState<string | null>(null);
  const [probeReport, setProbeReport] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const runtime = React.useCallback(
    () => getKernelService<IExternalSourceRuntimeService>(KernelServices.ExternalSources),
    [getKernelService],
  );

  const refresh = React.useCallback(async () => {
    setSources(await externalSourceUseCases.list());
  }, []);

  React.useEffect(() => {
    void refresh().catch((error: unknown) => setStatus(`读取失败：${errorText(error)}`));
  }, [refresh]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      setStatus(`操作失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () =>
    run(async () => {
      const input: ExternalCapabilitySource = {
        schemaVersion: 1,
        id: draft.id.trim(),
        kind: "mcp",
        displayName: draft.displayName.trim() || draft.id.trim(),
        endpoint: draft.endpoint.trim(),
        transport: TRANSPORT,
        era: draft.era,
        enabled: true,
      };
      await externalSourceUseCases.save(input);
      await runtime().reload();
      await refresh();
      setDraft(EMPTY_DRAFT);
      setStatus("已保存并重新加载能力");
    });

  const handleToggle = (source: StoredExternalSource, enabled: boolean) =>
    run(async () => {
      await externalSourceUseCases.setEnabled(source.id, enabled);
      await runtime().reload();
      await refresh();
    });

  const handleRemove = (source: StoredExternalSource) =>
    run(async () => {
      await externalSourceUseCases.remove(source.id);
      await runtime().reload();
      await refresh();
      setProbeReport(null);
    });

  const handleProbe = (source: StoredExternalSource) =>
    run(async () => {
      const snapshot = await runtime().probe(source.id);
      setProbeReport(
        [
          `${snapshot.serverName ?? source.id}/${snapshot.serverVersion ?? "?"}`,
          `协议 ${snapshot.negotiatedProtocolVersion ?? "未知"}`,
          `工具 ${snapshot.tools.length} · 资源 ${snapshot.resources.length} · 提示 ${snapshot.prompts.length}`,
          snapshot.unsupportedCapabilities.length > 0
            ? `未支持能力：${snapshot.unsupportedCapabilities.join("、")}`
            : "未支持能力：无",
          snapshot.warnings.length > 0 ? `降级：${snapshot.warnings.slice(0, 3).join("；")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });

  return (
    <div className="space-y-3 pb-2">
      <Card size="sm">
        <CardContent className="space-y-2 px-3">
          <p className="text-xs text-muted-foreground">
            外部能力源是远端服务，工具默认需要每次单独授权，调用与结果都会进入 Agent Journal。
            当前仅支持 Streamable HTTP 的 MCP 服务。
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              placeholder="标识（小写字母、数字、点、横线）"
              value={draft.id}
              onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            />
            <Input
              placeholder="显示名称"
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            />
            <Input
              className="sm:col-span-2"
              placeholder="MCP endpoint，例如 https://example.com/mcp"
              value={draft.endpoint}
              onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>协议世代</span>
              <select
                className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
                value={draft.era}
                onChange={(event) =>
                  setDraft({ ...draft, era: event.target.value as ExternalProtocolEra })
                }
              >
                {(Object.keys(ERA_LABEL) as ExternalProtocolEra[]).map((era) => (
                  <option key={era} value={era}>
                    {ERA_LABEL[era]}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" disabled={busy} onClick={() => void handleSave()}>
              添加来源
            </Button>
          </div>
          {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
        </CardContent>
      </Card>

      {sources.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">还没有配置任何外部能力源。</p>
      ) : (
        sources.map((source) => (
          <Card key={source.id} size="sm">
            <CardContent className="space-y-2 px-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{source.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {source.kind} · {source.transport} · {ERA_LABEL[source.era]}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{source.endpoint}</p>
                </div>
                <Switch
                  checked={source.enabled}
                  onCheckedChange={(checked: boolean) => void handleToggle(source, checked)}
                  disabled={busy}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleProbe(source)}>
                  探测能力
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void handleRemove(source)}
                >
                  删除
                </Button>
              </div>
              {probeReport && source.enabled ? (
                <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
                  {probeReport}
                </pre>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
