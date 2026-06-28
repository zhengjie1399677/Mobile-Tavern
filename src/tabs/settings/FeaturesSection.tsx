import { FlaskConical } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../../components/ui/card";
import { Switch } from "../../../components/ui/switch";
import { Input } from "../../../components/ui/input";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";

export type FeaturesSectionProps = Pick<UnifiedAppContextProps, "settings" | "updateSettings">;

export default function FeaturesSection({
  settings,
  updateSettings,
}: FeaturesSectionProps) {
  return (
    <>
      {/* 功能 (Features) */}
      <Card className="glass-panel shadow-sm mt-4">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary animate-pulse" />
            <span>功能</span>
          </CardTitle>
          <CardDescription className="text-[11px]">
            前沿交互与渲染特性，部分实验性功能可能会根据体验反馈进行优化
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-[13px] font-semibold text-foreground">
                开启富文本 HTML 渲染
              </label>
              <p className="text-[10px] text-muted-foreground">
                允许角色卡通过 HTML/CSS 标签控制输出文本的独立样式，可能会影响部分对话气泡的排版。
              </p>
            </div>
            <Switch
              checked={settings.enableHtmlRendering || false}
              onCheckedChange={(val) =>
                updateSettings({ ...settings, enableHtmlRendering: val })
              }
              className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div className="space-y-0.5">
              <label className="text-[13px] font-semibold text-foreground">
                开启卡片 JavaScript 脚本执行（TavernHelper 兼容模式）
              </label>
              <p className="text-[10px] text-muted-foreground">
                允许角色卡通过 Iframe 与内置的 TavernHelper 接口交互执行自定义 JS 脚本，用于动态状态卡展示。运行未知来源脚本具有一定安全风险。
              </p>
            </div>
            <Switch
              checked={settings.enableScriptExecution || false}
              onCheckedChange={(val) =>
                updateSettings({ ...settings, enableScriptExecution: val })
              }
              className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div className="space-y-0.5">
              <label className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <span>环境光感应联动 (Emotion Ambient Glow)</span>
                <span className="text-[9px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">实验性</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                自动根据角色当前的情绪和表情，为聊天界面背景渲染出流动交融的色温光晕，大幅度提升沉浸感。
              </p>
            </div>
            <Switch
              checked={settings.enableEmotionAmbientGlow || false}
              onCheckedChange={(val) =>
                updateSettings({ ...settings, enableEmotionAmbientGlow: val })
              }
              className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div className="space-y-0.5">
              <label className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <span>思维链显示 (Reasoning Content Display)</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                显示或隐藏 AI 回复中的思考过程（思维链 / reasoning_content）。关闭后不再渲染思考卡片，但模型仍可能生成思维链内容。
              </p>
            </div>
            <Switch
              checked={settings.enableReasoningContentDisplay !== false}
              onCheckedChange={(val) =>
                updateSettings({ ...settings, enableReasoningContentDisplay: val })
              }
              className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div className="space-y-0.5">
              <label className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <span>AI 回复走向推荐 (AI Reply Suggestions)</span>
                <span className="text-[9px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">实验性</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                在生成每轮回复尾部附带输出 4 个后续行动选项，用户点击可快速决策或写入。
              </p>
            </div>
            <Switch
              checked={settings.enableReplySuggestions || false}
              onCheckedChange={(val) =>
                updateSettings({ ...settings, enableReplySuggestions: val })
              }
              className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
            />
          </div>
          {settings.enableReplySuggestions && (
            <div className="space-y-2 mt-2 bg-muted/15 p-2.5 rounded-lg border border-border/40">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-muted-foreground font-semibold">
                  推荐选项默认点击行为
                </span>
                <select
                  value={settings.replySuggestionsClickMode || "fill"}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      replySuggestionsClickMode: e.target.value as any,
                    })
                  }
                  className="bg-muted border border-border rounded px-1.5 py-1 text-xs outline-none focus:border-primary font-bold text-foreground"
                >
                  <option value="fill">填入输入框</option>
                  <option value="send">直接发送</option>
                </select>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div className="space-y-0.5">
              <label className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <span>野牛模式 (Bison Mode)</span>
                <span className="text-[9px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">实验性</span>
                <span className="text-[9px] text-red-500 bg-red-500/10 px-1 py-0.2 rounded font-normal scale-90">Token 消耗增加</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                开启后，AI 将根据自身性格与当前情绪，有概率锁定输入框并连续输出 2-3 次内容。连续输出时，单次生成最大限制为 100 Token。
              </p>
              <p className="text-[9.5px] text-red-400 font-medium">
                ⚠️ 开启后将产生连续 API 请求，可能会显著增加 Token 消耗。
              </p>
            </div>
            <Switch
              checked={settings.enableBisonMode || false}
              onCheckedChange={(val) =>
                updateSettings({ ...settings, enableBisonMode: val })
              }
              className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
            />
          </div>

          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div className="space-y-0.5">
              <label className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <span>多消息排队合并发送 (Multi-Message Queue)</span>
                <span className="text-[9px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">插件</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                开启后，点击发送按钮仅排队消息而不触发 AI 回复；长按发送按钮 (500ms 以上) 会将已排队的消息合并一次性发送并触发 AI 回复。
              </p>
            </div>
            <Switch
              checked={settings.enableMultiMessageQueue || false}
              onCheckedChange={(val) =>
                updateSettings({ ...settings, enableMultiMessageQueue: val })
              }
              className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
            />
          </div>

          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div className="space-y-0.5">
              <label className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <span>星号动作分色渲染 (Asterisk Formatting)</span>
              </label>
              <p className="text-[10px] text-muted-foreground">
                将 *斜体动作描述* 渲染为柔和的灰色斜体，突出对白与旁白的视觉层次。角色卡内的 visualSettings 配置优先于此全局开关。
              </p>
            </div>
            <Switch
              checked={settings.enableAsteriskFormatting || false}
              onCheckedChange={(val) =>
                updateSettings({ ...settings, enableAsteriskFormatting: val })
              }
              className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
            />
          </div>

        </CardContent>
      </Card>

      <Card className="glass-panel shadow-sm mt-4">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>全局表情情绪匹配正则词典</span>
            <button
              type="button"
              onClick={() => {
                updateSettings({
                  ...settings,
                  expressionTriggers: {
                    joy: "笑了|微笑|开心|😊|smile|joy|happy",
                    happy: "笑了|微笑|开心|😊|smile|joy|happy",
                    smile: "笑了|微笑|开心|😊|smile|joy|happy",
                    sadness: "哭|流泪|伤心|😢|cry|sad",
                    sad: "哭|流泪|伤心|😢|cry|sad",
                    cry: "哭|流泪|伤心|😢|cry|sad",
                    anger: "生气|愤怒|😡|angry|rage",
                    angry: "生气|愤怒|😡|angry|rage",
                    rage: "生气|愤怒|😡|angry|rage",
                    blush: "脸红|害羞|😳|blush|shy",
                    shy: "脸红|害羞|😳|blush|shy",
                  }
                });
              }}
              className="text-[10px] text-primary font-bold hover:underline"
            >
              重置词典
            </button>
          </CardTitle>
          <CardDescription className="text-[11px]">
            当导入的角色卡未配置具体的 triggers 规则时，系统将使用本正则表达式规则进行情绪表情切换匹配检测（可编辑或清空以关闭检测）
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-3 text-xs">
          {[
            { k: "joy", n: "狂喜 (Joy)" },
            { k: "happy", n: "开心 (Happy)" },
            { k: "smile", n: "微笑 (Smile)" },
            { k: "sadness", n: "悲伤 (Sadness)" },
            { k: "sad", n: "伤心 (Sad)" },
            { k: "cry", n: "流泪 (Cry)" },
            { k: "anger", n: "发怒 (Anger)" },
            { k: "angry", n: "生气 (Angry)" },
            { k: "rage", n: "暴怒 (Rage)" },
            { k: "blush", n: "羞涩 (Blush)" },
            { k: "shy", n: "害羞 (Shy)" },
          ].map((item) => (
            <div key={item.k} className="flex items-center gap-3">
              <span className="font-semibold text-muted-foreground w-24 shrink-0">{item.n}</span>
              <Input
                value={settings.expressionTriggers?.[item.k] ?? ""}
                onChange={(e) => {
                  const nextTriggers = {
                    ...(settings.expressionTriggers || {}),
                    [item.k]: e.target.value,
                  };
                  updateSettings({
                    ...settings,
                    expressionTriggers: nextTriggers,
                  });
                }}
                className="h-8 text-xs font-mono bg-input/50 flex-1"
                placeholder="表达式正则匹配串..."
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
