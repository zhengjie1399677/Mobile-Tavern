import React, { useState } from "react";
import { Check, Copy, Sparkles, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/src/components/ui/dialog";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";

interface ThemeCssAiPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AI_CSS_PROMPT_CONTENT = `你现在是移动端酒馆 Mobile Tavern 的专属 CSS 主题专家。请为我编写一套用于「主题工作室自定义 CSS」的纯 CSS 代码。

### 一、安全沙箱硬约束（禁止违规，否则会被系统清洗阻断）
1. 严禁 @import，严禁任何外部网络 url("https://...") 或 data:/blob: 协议。
2. 本地图片/壁纸必须使用短变量：\`var(--res-5位短ID, none)\` 或 \`var(--tavern-resource-r_5位短ID, none)\`。
3. 严禁 position: fixed（移动端会被强转为 absolute）。
4. 严禁篡改 --safe-area-*。
5. 动画 @keyframes 必须加独特前缀防冲突。无需手动加主题 ID 前缀，系统会自动加作用域。

### 二、核心稳定选择器与页面容器速查
- 聊天主背景：.chat-shell、[data-ui="chat-surface"]、.chat-bg-mask（立绘遮罩）
- 消息气泡：
  - AI 角色气泡：.chat-message-assistant（或 .bubble-ai）
  - 用户发送气泡：.chat-message-user（或 .bubble-user）
  - 气泡文字容器：.chat-message-bubble（内含 table, blockquote, pre）
  - 深度思考折叠块：.reasoning-block
  - 生图卡片容器：.generated-image-block
  - 头像光环：.chat-message-avatar、.chat-header-avatar
- 底部输入区：
  - 输入框整体行卡片：.chat-composer-row（聚焦高亮状态：.chat-composer-row:focus-within）
  - 快捷操作栏（重发/继续/token预估）：.chat-composer-popover
  - 发送按钮：.chat-send-button
- 全局主底栏：
  - 底栏容器：[data-ui="main-tab-bar"]
  - 当前激活选中的 Tab：[data-ui="main-tab"][aria-selected="true"]
- 设置页胶囊与世界书列表（消除灰色半透明框与阴影割裂感）：
  - 世界书卡片与条目：.rounded-2xl、.bg-muted\\/20、.bg-muted\\/30
  - 设置项胶囊调节条（字号/行距/密度）：.bg-muted\\/20、.bg-muted
  - 阴影深度定制：[class*="shadow"] 或 box-shadow，可消除或替换为主题光晕

### 三、完整设计变量表（可用 :root { --xxx: ... } 覆盖）
- 文字颜色系统（支持修改各类字体颜色）：
  - --foreground：全局主要标题与正文文字（如标题、主要正文）
  - --muted-foreground：弱化说明文字（设置项说明小字、标签、时间戳、字数统计）
  - --card-foreground：卡片与气泡内主要文字
  - --primary-foreground：强调色按键与高亮块上的反色文字
  - --dialogue-color：角色台词/引号包裹文字专属颜色
  - --prose-color：旁白/描写叙述文字专属颜色
- 表面与容器底色：
  - --background：全局页面底色
  - --card：卡片表面与弹窗背景
  - --muted：次级弱化表面（世界书卡片底色、设置项胶囊条底座，浅色主题建议配置为浅粉/浅亮色）
  - --popover：悬浮弹出层与快捷操作栏底色
- 主色与轮廓：
  - --primary：主题强调主色
  - --border：标准边框颜色
  - --input：输入框底色与边框
  - --ring：聚焦外发光环

### 四、阴影与半透明底框美化技巧（浅色/明亮主题必备）
1. 消除所有默认灰色阴影：\`* { box-shadow: none !important; }\`
2. 转换为柔和彩色弥散发光：\`[class*="shadow"] { box-shadow: 0 4px 16px -2px rgba(244, 114, 182, 0.25) !important; }\`
3. 美化设置页与世界书半透明卡片：
   \`\`\`css
   .bg-muted\\/20, .bg-muted\\/30, .bg-muted\\/50 {
     background-color: rgba(255, 235, 245, 0.6) !important;
     border-color: rgba(244, 114, 182, 0.25) !important;
   }
   \`\`\`

### 五、主题 1.1 FSM 交互状态机联动规范（免 JS 纯声明式）
宿主会把激活的状态 Token 实时同步到 <html> 根节点的 data-theme-state 属性中，CSS 通过 \`:root[data-theme-state~="<token>"]\` 即可实现完全动态联动！

1. 状态 Token 生成规则：
   - 布尔状态：\`<key>-true\` / \`<key>-false\`（如 visited-true）
   - 枚举状态：\`<key>-<value>\`（如 mood-dream、bg-night）
   - 计数器：\`<key>-<count>\`（如 pulses-0、pulses-3）
   - 显式样式标记：通过 theme.state.add 注入的纯 Token（如 ambient-active、chat-glow、tab-pulse）

2. 状态机支持的 9 种触发事件 (when)：
   - theme.activate / theme.deactivate（主题激活/切走）
   - tab.enter / tab.leave（切入/离开主要 Tab：characters / chat / workbench / settings）
   - app.pause / app.resume（应用息屏切后台 / 恢复可见）
   - orientation.change（手机横竖屏切换，orientation: portrait | landscape）
   - ui.tap（轻点界面语义元素，target: main-tab | character-card | chat-composer 等）
   - media.ended（媒体播放自然结束）

3. 状态机支持的 5 种前置条件 (if，需同时满足)：
   - state.equals（逻辑状态比对）
   - tab.is（当前处于特定 Tab）
   - orientation.is（当前横竖屏）
   - media.enabled（用户是否允许播放媒体）
   - accessibility.reducedMotion（用户系统是否开启了减弱动效）

4. 状态机支持的 13 种动作 (do，均支持 delayMs 延时)：
   - 驱动样式：theme.state.add（加Token）、theme.state.remove（删Token）、theme.state.replace（分组替换Token）
   - 逻辑状态：state.set、state.toggle、state.increment
   - 媒体控制：media.play、media.pause、media.stop、media.setVolume、media.setMuted
   - 背景视频：surface.show（在 main.background / characters.background / chat.background 显示视频）、surface.hide

5. 状态机与 CSS 联动实战范例：
   \`\`\`css
   /* 当进入聊天 Tab 激活动态光晕标记时，气泡呼吸流光 */
   :root[data-theme-state~="chat-glow"] .chat-message-assistant {
     box-shadow: 0 0 24px rgba(168, 85, 247, 0.45) !important;
     border-color: #a855f7 !important;
     transition: all 0.4s ease;
   }
   /* 当用户点击底栏触发瞬态 tab-pulse 时，底栏微亮 */
   :root[data-theme-state~="tab-pulse"] [data-ui="main-tab-bar"] {
     border-top-color: var(--primary) !important;
     box-shadow: 0 -4px 16px rgba(168, 85, 247, 0.35) !important;
   }
   \`\`\`

### 六、输出格式要求
只返回带有清晰注释的纯 CSS 代码块（用 \`\`\`css 包裹），无需多余客套话。
【在此描述你的设计风格需求，例如：赛博朋克深紫霓虹 / 二次元可爱马卡龙 / 羊皮纸复古奇幻】`;

export function ThemeCssAiPromptModal({ isOpen, onClose }: ThemeCssAiPromptModalProps) {
  const [copied, setCopied] = useState(false);

  // 移动端实体/手势返回键拦截，避免直接退出整个主题工作室
  useMobileBackHandler(isOpen, () => {
    onClose();
    return true;
  }, 80);

  const handleCopy = async () => {
    let succeeded = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(AI_CSS_PROMPT_CONTENT);
        succeeded = true;
      }
    } catch {}

    // WebView 剪贴板降级支持
    if (!succeeded) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = AI_CSS_PROMPT_CONTENT;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        succeeded = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {}
    }

    if (succeeded) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="z-[1050] bg-black/75"
        className="z-[1050] w-[94vw] max-w-xl max-h-[85dvh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold">AI 编写提示词 · 快速复制</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                直接复制发给 AI（ChatGPT / Claude / DeepSeek）即可生成规范 CSS
              </DialogDescription>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="关闭提示词弹窗">
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <pre className="select-text whitespace-pre-wrap rounded-xl border border-border/80 bg-input/70 p-3.5 font-mono text-xs leading-relaxed text-foreground/90">
            {AI_CSS_PROMPT_CONTENT}
          </pre>
        </div>

        <footer className="flex items-center justify-between border-t border-border px-4 py-2.5 bg-muted/20">
          <span className="text-[11px] text-muted-foreground">
            提示词已针对 Mobile Tavern 规则和选择器高度精简
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-xs gap-1.5"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-400" />
                  已复制到剪贴板
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  复制
                </>
              )}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
