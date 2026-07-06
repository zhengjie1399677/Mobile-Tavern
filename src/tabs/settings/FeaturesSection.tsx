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
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../../components/ui/accordion";
import { Textarea } from "../../../components/ui/textarea";
import { DEFAULT_SETTINGS } from "../../hooks/useSettings";
import type { UnifiedAppContextProps } from "../../UnifiedAppContext";

export type FeaturesSectionProps = Pick<UnifiedAppContextProps, "settings" | "updateSettings">;

export default function FeaturesSection({
  settings,
  updateSettings,
}: FeaturesSectionProps) {
  return (
    <>
      {/* 功能 (Features) */}
      <Card className="glass-panel shadow-sm mt-2">
        <CardContent className="p-3 space-y-3">
          {/* 父标题：功能设置 (紧凑布局) */}
          <div className="flex items-center gap-2 pb-1.5 border-b border-border/50 mb-1.5">
            <FlaskConical className="w-4 h-4 text-primary" />
            <span className="text-[13.5px] font-black text-foreground tracking-wide">功能设置</span>
          </div>

          {/* 子分类 1：界面渲染与交互特性 */}
          <div className="space-y-2">
            {/* 子分类标题 1 (指示条小节栏，层级明晰) */}
            <div className="flex items-center gap-1.5 pb-1 border-b border-border/60 mt-0.5 mb-2 select-none">
              <span className="w-1.2 h-3 bg-primary rounded-full" />
              <span className="text-[11.5px] font-black text-foreground tracking-wide">
                界面渲染与交互特性
              </span>
            </div>

            {/* 子分类下功能 (带缩进展现从属层级，紧凑排版) */}
            <div className="space-y-3 pl-1">
              {/* 开启富文本 HTML 渲染 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0">
                  <label className="text-[11px] font-bold text-foreground">
                    开启富文本 HTML 渲染
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
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

              {/* 开启卡片 JavaScript 脚本执行 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0">
                  <label className="text-[11px] font-bold text-foreground">
                    开启卡片 JavaScript 脚本执行（TavernHelper 兼容模式）
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
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

              {settings.enableScriptExecution && (
                <div className="flex items-center justify-between pl-4 border-l-2 border-primary/30 mt-1 animate-in slide-in-from-top-1 duration-200">
                  <div className="space-y-0">
                    <label className="text-[11px] font-bold text-foreground">
                      开启脚本循环安全监视器 (Loop Protection)
                    </label>
                    <p className="text-[9px] text-muted-foreground/80 leading-normal">
                      自动为卡片脚本中的循环体（for/while）织入时间监视器，防止劣质或死循环脚本锁死 WebView 导致界面卡死。单次循环执行上限 1000ms。
                    </p>
                  </div>
                  <Switch
                    checked={settings.enableLoopProtection !== false}
                    onCheckedChange={(val) =>
                      updateSettings({ ...settings, enableLoopProtection: val })
                    }
                    className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"
                  />
                </div>
              )}

              {/* 环境光感应联动 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <span>环境光感应联动 (Emotion Ambient Glow)</span>
                    <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">实验性</span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
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

              {/* 思维链显示 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <span>思维链显示 (Reasoning Content Display)</span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
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

              {/* 多消息排队合并发送 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <span>多消息排队合并发送 (Multi-Message Queue)</span>
                    <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">插件</span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
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

              {/* 星号动作分色渲染 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <span>星号动作分色渲染 (Asterisk Formatting)</span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
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

              {/* 野牛模式 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <span>野牛模式 (Bison Mode)</span>
                    <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">实验性</span>
                    <span className="text-[8.5px] text-red-500 bg-red-500/10 px-1 py-0.2 rounded font-normal scale-90">Token 消耗增加</span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
                    开启后，AI 将根据自身性格与当前情绪，有概率锁定输入框并连续输出 2-3 次内容。连续输出时，单次生成最大限制为 100 Token。
                  </p>
                  <p className="text-[9px] text-red-400 font-medium leading-normal">
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

              {settings.enableBisonMode && (
                <div className="mt-1.5 bg-muted/15 p-2 rounded-lg border border-border/30 space-y-1.5 animate-in fade-in duration-300">
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="bison-prompt-accordion" className="border-none">
                      <AccordionTrigger className="py-0.5 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          自定义野牛提示词指令 (Bison Mode Prompt)
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-1.5 pb-0 space-y-1.5">
                        <Textarea
                          value={settings.bisonModePrompt || ""}
                          onChange={(e) =>
                            updateSettings({ ...settings, bisonModePrompt: e.target.value })
                          }
                          className="text-xs bg-input/50 min-h-[100px] leading-relaxed font-sans"
                          placeholder="输入野牛模式指示词..."
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              updateSettings({
                                ...settings,
                                bisonModePrompt: DEFAULT_SETTINGS.bisonModePrompt || "",
                              });
                            }}
                            className="text-[9px] text-primary font-bold hover:underline"
                          >
                            重置为系统默认
                          </button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}
            </div>
          </div>

          {/* 子分类 2：提示词注入与生成协议 */}
          <div className="space-y-2 pt-1">
            {/* 子分类标题 2 (指示条小节栏，层级明晰) */}
            <div className="flex items-center gap-1.5 pb-1 border-b border-border/60 mt-2 mb-2 select-none">
              <span className="w-1.2 h-3 bg-primary rounded-full" />
              <span className="text-[11.5px] font-black text-foreground tracking-wide">
                提示词注入与生成协议
              </span>
            </div>

            {/* 子分类下功能 (带缩进展现从属层级，紧凑排版) */}
            <div className="space-y-3 pl-1">
              {/* AI 回复走向推荐 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0">
                  <label className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <span>【叙事分支生成器】 (AI Reply Suggestions)</span>
                    <span className="text-[8.5px] text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded font-normal scale-90">实验性</span>
                  </label>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
                    在生成每轮回复尾部附带输出 4 个剧情延续选项，用户点击可快速决策或写入。
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
                <div className="space-y-1.5 mt-1.5 bg-muted/15 p-2 rounded-lg border border-border/30 animate-in fade-in duration-300">
                  <div className="flex justify-between items-center pb-1.5 border-b border-border/20">
                    <span className="text-[10px] text-muted-foreground font-semibold">
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
                      className="bg-muted border border-border rounded px-1 py-0.5 text-xs outline-none focus:border-primary font-bold text-foreground"
                    >
                      <option value="fill">填入输入框</option>
                      <option value="send">直接发送</option>
                    </select>
                  </div>

                  {/* Collapsible Suggestions Prompt */}
                  <Accordion type="single" collapsible className="w-full pt-0.5">
                    <AccordionItem value="suggestions-prompt-accordion" className="border-none">
                      <AccordionTrigger className="py-0.5 hover:no-underline hover:opacity-80 transition justify-between flex w-full">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          自定义分支生成引导指令 (Reply Suggestions Prompt)
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-1.5 pb-0 space-y-1.5">
                        <Textarea
                          value={settings.replySuggestionsPrompt || ""}
                          onChange={(e) =>
                            updateSettings({ ...settings, replySuggestionsPrompt: e.target.value })
                          }
                          className="text-xs bg-input/50 min-h-[110px] leading-relaxed font-sans"
                          placeholder="输入剧情分支生成指示词..."
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              updateSettings({
                                ...settings,
                                replySuggestionsPrompt: DEFAULT_SETTINGS.replySuggestionsPrompt || "",
                              });
                            }}
                            className="text-[9px] text-primary font-bold hover:underline"
                          >
                            重置为系统默认
                          </button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-panel shadow-sm mt-2">
        <CardHeader className="pb-2 pt-2.5 px-3 border-b border-border/40">
          <CardTitle className="text-xs flex items-center justify-between font-bold text-foreground">
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
              className="text-[9px] text-primary font-bold hover:underline"
            >
              重置词典
            </button>
          </CardTitle>
          <CardDescription className="text-[10px] mt-0.5">
            当导入的角色卡未配置具体的 triggers 规则时，系统将使用本正则表达式规则进行情绪表情切换匹配检测（可编辑或清空以关闭检测）
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2 px-3 pb-3 space-y-2 text-xs">
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
            <div key={item.k} className="flex items-center gap-2">
              <span className="font-semibold text-muted-foreground w-20 shrink-0 text-[10.5px]">{item.n}</span>
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
