import { KeySquare } from "lucide-react";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../../components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { Switch } from "../../../../components/ui/switch";
import { Input } from "../../../../components/ui/input";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";

export type SaveState = "idle" | "saving" | "saved";

export interface ApiConfigSectionProps
  extends Pick<UnifiedAppContextProps,
    | "settings"
    | "updateSettings"
    | "availableModels"
    | "isFetchingModels"
    | "handleFetchModels"
    | "testApiConnection"
    | "connectionStatus"
    | "showCustomPrompt"
    | "showCustomConfirm"
  > {
  saveState: SaveState;
  freeCount: number;
}

export default function ApiConfigSection({
  settings,
  updateSettings,
  availableModels,
  isFetchingModels,
  handleFetchModels,
  testApiConnection,
  connectionStatus,
  showCustomPrompt,
  showCustomConfirm,
  saveState,
  freeCount,
}: ApiConfigSectionProps) {
  return (
    <AccordionItem value="api-config" className="glass-panel shadow-sm rounded-xl overflow-hidden">
      <AccordionTrigger className="px-3.5 py-2.5 hover:no-underline hover:bg-muted/30 transition">
        <div className="flex items-center gap-2">
          <KeySquare className="w-4 h-4 text-primary" />
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">API 服务端点配置</span>
              {saveState === "saving" && (
                <span className="text-[10px] text-sky-500 flex items-center gap-1 font-semibold animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
                  正在自动保存...
                </span>
              )}
              {saveState === "saved" && (
                <span className="text-[10px] text-emerald-500 flex items-center gap-1 font-semibold animate-in fade-in duration-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  修改已自动保存
                </span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground font-normal">配置大语言模型接口地址与授权凭证</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="p-3 pt-1 border-t border-border/50 space-y-3">
        {/* API 通道配置档案选择与切换 */}
        <div className="space-y-1.5 pb-2.5 mb-1 border-b border-border/30">
          <label className="text-[11px] font-semibold text-muted-foreground block">
            选择 API 配置通道 / 凭证档案
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Select
                aria-label="API 预设配置方案"
                value={settings.currentApiProfileId || "temp"}
                onValueChange={(val) => {
                  if (val === "temp") {
                    updateSettings((prev) => ({
                      ...prev,
                      currentApiProfileId: "",
                    }));
                  } else {
                    const target = (settings.savedApiProfiles || []).find((p) => p.id === val);
                    if (target) {
                      updateSettings((prev) => ({
                        ...prev,
                        currentApiProfileId: val,
                        api: {
                          ...prev.api,
                          type: target.type,
                          baseUrl: target.baseUrl,
                          apiKey: target.apiKey,
                          modelName: target.modelName,
                          chatPath: target.chatPath,
                          modelsPath: target.modelsPath,
                          bypassProxy: target.bypassProxy,
                          disableReasoning: target.disableReasoning,
                          forceBasicParams: target.forceBasicParams,
                        },
                      }));
                    }
                  }
                }}
              >
                <SelectTrigger className="h-9 bg-input/50 text-xs flex-1 truncate">
                  <SelectValue placeholder="选择通道...">
                    {(() => {
                      if (!settings.currentApiProfileId) return "💡 临时调试配置";
                      const currentProf = (settings.savedApiProfiles || []).find(
                        (p) => p.id === settings.currentApiProfileId
                      );
                      return currentProf ? `🔌 ${currentProf.name}` : "💡 临时调试配置";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="temp" className="text-xs">
                    💡 临时调试配置
                  </SelectItem>
                  {(settings.savedApiProfiles || []).map((prof) => (
                    <SelectItem key={prof.id} value={prof.id} className="text-xs font-mono">
                      🔌 {prof.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <button
                type="button"
                onClick={async () => {
                  const name = await showCustomPrompt(
                    "请输入新 API 通道的别名（例如：DeepSeek官方、硅基流动）:",
                    ""
                  );
                  if (name && name.trim()) {
                    const newId = "profile_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
                    const newProfile = {
                      id: newId,
                      name: name.trim(),
                      type: settings.api.type,
                      baseUrl: settings.api.baseUrl,
                      apiKey: settings.api.apiKey,
                      modelName: settings.api.modelName,
                      chatPath: settings.api.chatPath,
                      modelsPath: settings.api.modelsPath,
                      bypassProxy: settings.api.bypassProxy,
                      disableReasoning: settings.api.disableReasoning,
                      forceBasicParams: settings.api.forceBasicParams,
                    };
                    updateSettings((prev) => ({
                      ...prev,
                      savedApiProfiles: [...(prev.savedApiProfiles || []), newProfile],
                      currentApiProfileId: newId,
                    }));
                  }
                }}
                className="h-9 px-3 bg-primary/10 border border-primary/25 text-primary text-xs font-medium rounded-md hover:bg-primary/20 transition shrink-0 tap-scale"
              >
                另存当前配置为通道
              </button>
            </div>

            {settings.currentApiProfileId && (
              <div className="flex gap-3 justify-end pt-0.5">
                <button
                  type="button"
                  onClick={async () => {
                    const activeId = settings.currentApiProfileId;
                    const currentProf = (settings.savedApiProfiles || []).find((p) => p.id === activeId);
                    if (!currentProf) return;
                    const newName = await showCustomPrompt(
                      "重命名通道别名:",
                      currentProf.name
                    );
                    if (newName && newName.trim()) {
                      updateSettings((prev) => ({
                        ...prev,
                        savedApiProfiles: (prev.savedApiProfiles || []).map((p) =>
                          p.id === activeId ? { ...p, name: newName.trim() } : p
                        ),
                      }));
                    }
                  }}
                  className="text-[10px] text-muted-foreground hover:text-primary transition flex items-center gap-1 font-medium"
                >
                  ✏️ 重命名
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const activeId = settings.currentApiProfileId;
                    const currentProf = (settings.savedApiProfiles || []).find((p) => p.id === activeId);
                    if (!currentProf) return;
                    const ok = await showCustomConfirm(
                      `确定要删除通道【${currentProf.name}】吗？这不会影响当前已输入的连接配置。`
                    );
                    if (ok) {
                      updateSettings((prev) => ({
                        ...prev,
                        savedApiProfiles: (prev.savedApiProfiles || []).filter((p) => p.id !== activeId),
                        currentApiProfileId: "",
                      }));
                    }
                  }}
                  className="text-[10px] text-rose-500 hover:text-rose-700 transition flex items-center gap-1 font-medium"
                >
                  🗑️ 删除此通道
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between items-center">
            <span>接口代理地址 (Base URL)</span>
            <span className="text-[9px] text-primary/70">提示：支持多组常用 API 历史地址自动记录</span>
          </label>
          <Input
            list="saved-api-urls"
            value={settings.api.baseUrl || ""}
            onBlur={() => {
              // CR-URLFIX：失焦时 trim 首尾空格，规范化存储，避免多余空格导致请求失败
              const trimmedUrl = settings.api.baseUrl?.trim();
              if (trimmedUrl && trimmedUrl !== settings.api.baseUrl) {
                updateSettings((prev) => ({
                  ...prev,
                  api: { ...prev.api, baseUrl: trimmedUrl }
                }));
              }
              if (trimmedUrl && !settings.api.savedUrls?.includes(trimmedUrl)) {
                updateSettings((prev) => ({
                  ...prev,
                  api: {
                    ...prev.api,
                    savedUrls: [...(prev.api.savedUrls || []), trimmedUrl]
                  }
                }));
              }
            }}
            onChange={(e) => {
              const val = e.target.value;
              updateSettings((prev) => ({
                ...prev,
                currentApiProfileId: "", // 修改时自动脱离通道绑定
                api: { ...prev.api, baseUrl: val },
              }));
            }}
            className="h-9 text-xs font-mono bg-input/50"
            placeholder="https://api.openai.com/v1"
          />
          <datalist id="saved-api-urls">
            {settings.api.savedUrls?.map((url, idx) => (
              <option key={idx} value={url} />
            ))}
          </datalist>
          <div className="flex gap-1 flex-wrap pt-1">
            {[
              { n: "Gemini", u: "https://generativelanguage.googleapis.com/v1beta/openai/" },
              { n: "DeepSeek", u: "https://api.deepseek.com/v1" },
              { n: "OpenAI", u: "https://api.openai.com/v1" },
              { n: "Together", u: "https://api.together.xyz/v1" },
              { n: "Groq", u: "https://api.groq.com/openai/v1" },
            ].map((preset) => (
              <button
                key={preset.n}
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({
                    ...prev,
                    currentApiProfileId: "", // 快捷填入时自动脱离通道绑定
                    api: { ...prev.api, baseUrl: preset.u },
                  }))
                }
                className="text-[9px] bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border"
              >
                {preset.n}
              </button>
            ))}
            {settings.api.savedUrls && settings.api.savedUrls.length > 0 && (
              <button
                type="button"
                onClick={() => updateSettings((prev) => ({ ...prev, api: { ...prev.api, savedUrls: [] } }))}
                className="text-[9px] bg-destructive/10 hover:bg-destructive/20 text-destructive px-1.5 py-0.5 rounded border border-destructive/20 ml-auto"
              >
                清空记录
              </button>
            )}
          </div>
        </div>

        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
            <span>API 密钥 (API Key)</span>
            <button
              aria-label="测试 API 连接"
              onClick={testApiConnection}
              className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-bold"
            >
              ⚡ 连通性测试
            </button>
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              className="font-mono text-xs h-9 bg-input/50 flex-1"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              value={settings.api.apiKey || ""}
              onChange={(e) => {
                const val = e.target.value;
                updateSettings((prev) => ({
                  ...prev,
                  currentApiProfileId: "", // 修改时自动脱离通道绑定
                  api: { ...prev.api, apiKey: val },
                }));
              }}
              placeholder="sk-..."
            />
            <button
              onClick={handleFetchModels}
              disabled={isFetchingModels}
              className="h-9 px-3 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
            >
              {isFetchingModels ? "获取中..." : "拉取模型列表"}
            </button>
          </div>
          {!settings.api.apiKey || !settings.api.apiKey.trim() ? (
            <p key="free-tier-warning" className="text-[10px] text-primary/80 flex items-center gap-1 font-medium bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
              💡 处于公共免 Key 体验渠道（已使用 {freeCount}/10 次）。清空 API Key 时自动启用此渠道。
            </p>
          ) : (
            <p key="custom-key-info" className="text-[10px] text-muted-foreground">
              已配置自定义 API 密钥，优先使用您的专属渠道。
            </p>
          )}
          {connectionStatus?.message && (
            <div className={`mt-2 text-[11px] p-2 rounded-md ${connectionStatus.success ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"}`}>
              {connectionStatus.message}
            </div>
          )}
        </div>

        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
            <span>所选模型标识 (Model ID)</span>
          </label>
          {availableModels.length > 0 ? (
            <Select
              aria-label="模型名称"
              value={settings.api.modelName || ""}
              onValueChange={(val) =>
                updateSettings((prev) => ({
                  ...prev,
                  currentApiProfileId: "", // 修改时自动脱离通道绑定
                  api: { ...prev.api, modelName: val },
                }))
              }
            >
              <SelectTrigger className="w-full text-xs h-9 bg-input/50 font-mono">
                <SelectValue placeholder="选择已获取的模型" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {availableModels.map((m) => (
                  <SelectItem
                    key={m}
                    value={m}
                    className="text-xs font-mono"
                  >
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={settings.api.modelName || ""}
              onChange={(e) => {
                const val = e.target.value;
                updateSettings((prev) => ({
                  ...prev,
                  currentApiProfileId: "", // 修改时自动脱离通道绑定
                  api: { ...prev.api, modelName: val },
                }));
              }}
              className="h-9 text-xs font-mono bg-input/50"
              placeholder="gpt-4o"
            />
          )}
        </div>

        {/* contextLimit Input */}
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
            <span>最大上下文限制 (Tokens)</span>
            <span className="text-[9px] text-muted-foreground/80">留空则自动匹配大模型默认容量限制</span>
          </label>
          <Input
            type="number"
            value={settings.api.contextLimit ?? ""}
            onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value) : undefined;
              updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, contextLimit: val },
              }));
            }}
            className="h-9 text-xs font-mono bg-input/50"
            placeholder="例如 1000000 (1M)"
          />
        </div>

        {/* renderingFormat Select */}
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="text-[11px] font-semibold text-muted-foreground flex justify-between">
            <span>提示词渲染格式</span>
            <span className="text-[9px] text-muted-foreground/80">定义系统/设定集的排版结构</span>
          </label>
          <Select
            aria-label="排版结构格式"
            value={settings.promptConfig?.renderingFormat || "auto"}
            onValueChange={(val: 'auto' | 'xml' | 'markdown') =>
              updateSettings((prev) => ({
                ...prev,
                promptConfig: { ...prev.promptConfig, renderingFormat: val },
              }))
            }
          >
            <SelectTrigger className="w-full text-xs h-9 bg-input/50">
              <SelectValue placeholder="自动选择" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-xs">自动选择 (Auto)</SelectItem>
              <SelectItem value="xml" className="text-xs">XML 标签格式 (XML)</SelectItem>
              <SelectItem value="markdown" className="text-xs">Markdown 文本格式 (Markdown)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* forceBasicParams Switch */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-0.5">
            <label className="text-[12.5px] font-semibold text-foreground">
              API 极简降级模式 (Conservative Fallback)
            </label>
            <p className="text-[9.5px] text-muted-foreground/80 max-w-[450px]">
              开启后，无论使用什么模型，发送请求时都将强制只携带 5 个最基础的参数（model, messages, stream, temperature, top_p）。推荐在第三方中转站 API 报参数错误（HTTP 400）时开启。
            </p>
          </div>
          <Switch
            aria-label="强制基础参数"
            checked={settings.api.forceBasicParams || false}
            onCheckedChange={(checked) =>
              updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, forceBasicParams: checked },
              }))
            }
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

        {/* sendNames Switch */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-0.5">
            <label className="text-[12.5px] font-semibold text-foreground">
              在请求中包含角色名称 (Send Names)
            </label>
            <p className="text-[9.5px] text-muted-foreground/80 max-w-[450px]">
              在消息中携带 "name" 属性（如 "LinaSchneider"、"user"）。
              注意：部分第三方中转、Claude 或 Gemini 接口可能不支持此属性并返回 400 错误，如果遇到请求失败请关闭此选项。
            </p>
          </div>
          <Switch
            aria-label="发送角色名称"
            checked={settings.api.sendNames || false}
            onCheckedChange={(checked) =>
              updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, sendNames: checked },
              }))
            }
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

        {/* disableReasoning Switch */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-0.5">
            <label className="text-[12.5px] font-semibold text-foreground">
              关闭推理模式 (Disable Reasoning)
            </label>
            <p className="text-[9.5px] text-muted-foreground/80 max-w-[450px]">
              对于支持深度思考推理的模型（如 Claude 3.7 或 DeepSeek R1），开启后将在 API 层面直接关闭或削弱其推理，避免消耗多余的思考 Token。
            </p>
          </div>
          <Switch
            aria-label="强制关闭思维链"
            checked={settings.api.disableReasoning || false}
            onCheckedChange={(checked) =>
              updateSettings((prev) => ({
                ...prev,
                api: { ...prev.api, disableReasoning: checked },
              }))
            }
            className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
          />
        </div>

      </AccordionContent>
    </AccordionItem>
  );
}
