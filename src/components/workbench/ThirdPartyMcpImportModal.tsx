import React, { useState } from "react";
import { Globe, X } from "lucide-react";
import {
  formValuesToCandidate,
  parseThirdPartyMcpConfig,
  presetToFormValues,
  THIRD_PARTY_MCP_PRESETS,
  THIRD_PARTY_MCP_PRESET_CATEGORY_LABEL,
  type ThirdPartyMcpPresetCategory,
  type McpSourceFormValues,
  type ParsedMcpSourceCandidate,
  type ThirdPartyMcpPreset,
} from "../../application/externalSources/thirdPartyMcpParser";

const EMPTY_MANUAL_FORM: McpSourceFormValues = {
  id: "",
  displayName: "",
  endpoint: "",
  era: "auto",
  token: "",
};

export interface ThirdPartyMcpImportModalProps {
  onClose: () => void;
  onSaveCandidates: (candidates: readonly ParsedMcpSourceCandidate[]) => Promise<void>;
  showAlert: (message: string, title?: string) => void;
}

export const ThirdPartyMcpImportModal: React.FC<ThirdPartyMcpImportModalProps> = ({
  onClose,
  onSaveCandidates,
  showAlert,
}) => {
  const [modalTab, setModalTab] = useState<"json" | "presets" | "manual">("json");
  const [importJsonText, setImportJsonText] = useState("");
  const [parseResult, setParseResult] = useState<{
    candidates: readonly ParsedMcpSourceCandidate[];
    skipped: readonly { key: string; reason: string }[];
    error?: string;
  } | null>(null);

  const [manualForm, setManualForm] = useState<McpSourceFormValues>(EMPTY_MANUAL_FORM);

  const handleParseJson = () => {
    const result = parseThirdPartyMcpConfig(importJsonText);
    setParseResult(result);
  };

  const handleApplyPreset = (preset: ThirdPartyMcpPreset) => {
    // 预置的鉴权头 / 方案必须一起带入，否则 Brave 这类「非 Authorization 头」的预置会 401。
    setManualForm(presetToFormValues(preset));
    setModalTab("manual");
  };

  const handleSaveManual = async () => {
    if (!manualForm.id.trim() || !manualForm.endpoint.trim()) {
      showAlert("请完整填写标识与 endpoint 端点", "提示");
      return;
    }
    await onSaveCandidates([formValuesToCandidate(manualForm)]);
  };

  const credentialHeader = manualForm.authHeader ?? "Authorization";
  const credentialHint =
    (manualForm.authScheme ?? "bearer") === "bearer"
      ? `${credentialHeader}: Bearer <Key>`
      : `${credentialHeader}: <Key>`;

  /** 单个预置模板行；分组渲染复用同一份 JSX。 */
  const renderPresetRow = (preset: ThirdPartyMcpPreset) => (
    <div
      key={preset.id}
      className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-white/5 p-2.5 hover:bg-white/8 transition-all"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-foreground">{preset.name}</span>
          {preset.tags.map((tag) => (
            <span key={tag} className="rounded bg-white/10 px-1 py-0.2 text-[8px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{preset.description}</p>
      </div>
      <button
        type="button"
        onClick={() => handleApplyPreset(preset)}
        aria-label={`选用预置 ${preset.name}`}
        className="shrink-0 rounded-md border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-1 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/25 active:scale-95"
      >
        选用
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-card p-4 shadow-2xl overflow-hidden">
        {/* 弹窗头部 */}
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-cyan-400" />
            <h4 className="text-sm font-bold text-foreground">接入第三方 MCP</h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 子选项卡 */}
        <div className="my-2.5 flex rounded-lg border border-white/10 bg-black/30 p-1 text-xs">
          <button
            type="button"
            onClick={() => setModalTab("json")}
            className={`flex-1 rounded-md py-1 font-medium transition-all ${
              modalTab === "json"
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            导入第三方配置
          </button>
          <button
            type="button"
            onClick={() => setModalTab("presets")}
            className={`flex-1 rounded-md py-1 font-medium transition-all ${
              modalTab === "presets"
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            推荐热门模板
          </button>
          <button
            type="button"
            onClick={() => setModalTab("manual")}
            className={`flex-1 rounded-md py-1 font-medium transition-all ${
              modalTab === "manual"
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            手动添加
          </button>
        </div>

        {/* 弹窗主体内容区 */}
        <div className="flex-1 overflow-y-auto space-y-3 py-1">
          {/* Tab A: JSON 解析导入 */}
          {modalTab === "json" && (
            <div className="space-y-2.5">
              <p className="text-[11px] text-muted-foreground">
                支持直接粘贴 Claude Desktop (<code>claude_desktop_config.json</code>) 或 Cursor 的{" "}
                <code>mcpServers</code> 配置，或直接粘贴一个 HTTP/HTTPS URL：
              </p>
              <textarea
                rows={6}
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder='粘贴示例：&#10;{&#10;  "mcpServers": {&#10;    "deepwiki": {&#10;      "url": "https://mcp.deepwiki.com/mcp"&#10;    }&#10;  }&#10;}'
                className="w-full rounded-xl border border-white/10 bg-black/40 p-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-cyan-500/50 focus:outline-none"
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleParseJson}
                  className="rounded-lg border border-cyan-500/30 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 active:scale-95"
                >
                  识别配置
                </button>
              </div>

              {/* 解析结果预览 */}
              {parseResult && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-2 text-xs">
                  {parseResult.error && (
                    <p className="text-rose-300">{parseResult.error}</p>
                  )}
                  {parseResult.candidates.length > 0 && (
                    <div>
                      <p className="font-semibold text-emerald-400 mb-1">
                        识别到 {parseResult.candidates.length} 个可用远程服务：
                      </p>
                      <div className="space-y-1">
                        {parseResult.candidates.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between rounded bg-black/30 px-2 py-1 text-[11px]"
                          >
                            <span className="font-semibold text-foreground">
                              {c.displayName}
                            </span>
                            <span className="truncate max-w-[180px] text-muted-foreground font-mono">
                              {c.endpoint}
                            </span>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => void onSaveCandidates(parseResult.candidates)}
                        className="mt-2.5 w-full rounded-lg bg-emerald-500/20 border border-emerald-500/30 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 active:scale-95"
                      >
                        全部保存并启用
                      </button>
                    </div>
                  )}
                  {parseResult.skipped.length > 0 && (
                    <div className="pt-1 text-[10px] text-muted-foreground">
                      <p className="font-medium text-amber-300/80 mb-0.5">跳过的项：</p>
                      {parseResult.skipped.map((s) => (
                        <p key={s.key}>
                          · {s.key}: {s.reason}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab B: 预置热门模板 */}
          {modalTab === "presets" && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                经过实测的公网 MCP 模版，按用途分组；带「免鉴权」标签的无需申请 Key，选用后直接保存即可试用。
              </p>

              {(["roleplay", "general"] as const).map((category) => {
                const presets = THIRD_PARTY_MCP_PRESETS.filter((preset) => preset.category === category);
                if (presets.length === 0) return null;
                return (
                  <div key={category} className="space-y-1.5">
                    <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300/90">
                      {THIRD_PARTY_MCP_PRESET_CATEGORY_LABEL[category]}
                    </p>
                    {category === "roleplay" && (
                      <p className="rounded-lg border border-white/8 bg-black/25 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                        角色扮演侧的多数需求已内置，不必依赖 MCP：骰子 / 随机 / 抽选 / 字数（`/dice` 等命令）、
                        记忆写入、联网搜索（需 Key）。MCP 生态目前仍以开发向服务为主，这里只收录实测可用的。
                      </p>
                    )}
                    {presets.map(renderPresetRow)}
                  </div>
                );
              })}

            </div>
          )}

          {/* Tab C: 手动添加 */}
          {modalTab === "manual" && (
            <div className="space-y-2 text-xs">
              <div>
                <label className="text-[10px] text-muted-foreground">服务标识 (ID)</label>
                <input
                  type="text"
                  value={manualForm.id}
                  onChange={(e) => setManualForm({ ...manualForm, id: e.target.value })}
                  placeholder="如 deepwiki"
                  className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">显示名称</label>
                <input
                  type="text"
                  value={manualForm.displayName}
                  onChange={(e) =>
                    setManualForm({ ...manualForm, displayName: e.target.value })
                  }
                  placeholder="如 DeepWiki 知识库"
                  className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">MCP Endpoint (URL)</label>
                <input
                  type="text"
                  value={manualForm.endpoint}
                  onChange={(e) =>
                    setManualForm({ ...manualForm, endpoint: e.target.value })
                  }
                  placeholder="https://example.com/mcp"
                  className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">API Token / Key (可选)</label>
                <input
                  type="password"
                  value={manualForm.token}
                  onChange={(e) => setManualForm({ ...manualForm, token: e.target.value })}
                  placeholder={manualForm.authPlaceholder ?? "留空则无鉴权"}
                  className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-cyan-500/50"
                />
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  凭据写入请求头：<span className="font-mono">{credentialHint}</span>
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void handleSaveManual()}
                  className="w-full rounded-lg bg-cyan-500/20 border border-cyan-500/30 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/30 active:scale-95"
                >
                  保存并连接
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThirdPartyMcpImportModal;
