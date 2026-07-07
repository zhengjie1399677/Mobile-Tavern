import React, { useContext, memo, useState } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { createMessageIframeSrcDoc, initTavernHelperMocks } from "../utils/tavernHelper";
import { parseStyleString, resolveExpressionUrl, convertMarkdownTablesToHtml } from "./formattedTextUtils";

const SafeIframe = React.memo((props: any) => {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const { srcDoc, ...rest } = props;
  const lastSrcDocRef = React.useRef("");

  if (import.meta.env.DEV) {
    console.log('[SafeIframe] render, srcDoc length:', srcDoc?.length);
  }

  React.useEffect(() => {
    if (iframeRef.current) {
      if (lastSrcDocRef.current !== srcDoc) {
        if (import.meta.env.DEV) {
          let diffIdx = -1;
          const maxLen = Math.max(lastSrcDocRef.current.length, srcDoc?.length || 0);
          for (let i = 0; i < maxLen; i++) {
            if (lastSrcDocRef.current[i] !== srcDoc[i]) {
              diffIdx = i;
              break;
            }
          }
          console.log('[SafeIframe] srcDoc changed! Diff index:', diffIdx);
        }
        iframeRef.current.srcdoc = srcDoc;
        lastSrcDocRef.current = srcDoc;
      }
    }
  }, [srcDoc]);

  return <iframe ref={iframeRef} {...rest} />;
}, (prevProps, nextProps) => {
  // 仅在 srcDoc 物理改变时允许 SafeIframe 重绘，防止 React 属性更新（如 style 重建）引发 iframe DOM 重新协调与重载
  return prevProps.srcDoc === nextProps.srcDoc;
});
SafeIframe.displayName = "SafeIframe";

interface FormattedTextProps {
  text: string;
  charName: string;
  userName?: string;
  className?: string;
  messageIndex?: number;
}

// Whitelist of allowed HTML tags for aesthetic card renderings
const ALLOWED_TAGS = new Set([
  "div",
  "span",
  "p",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "b",
  "i",
  "u",
  "strong",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "br",
  "hr",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "iframe",
]);

// Whitelist of safe tag attributes
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  global: new Set(["class", "classname", "style", "title", "id"]),
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  table: new Set(["border", "cellpadding", "cellspacing"]),
  iframe: new Set(["src", "srcdoc", "width", "height", "style", "class", "classname", "sandbox", "id", "name", "allowtransparency", "frameborder", "marginwidth", "marginheight"]),
};

function parseMarkdownToReact(
  str: string,
  enableAsteriskFormatting: boolean,
  keyPrefix: string = "md"
): React.ReactNode[] {
  if (!str) return [];

  const result: React.ReactNode[] = [];
  let i = 0;
  let childKeyIndex = 0;

  while (i < str.length) {
    const nextBold = str.indexOf("**", i);
    const nextItalic = str.indexOf("*", i);

    if (nextBold === -1 && nextItalic === -1) {
      result.push(str.slice(i));
      break;
    }

    // 决定是双星号粗体还是单星号斜体先开始
    let isBold = false;
    let startIdx = -1;

    if (nextBold !== -1 && (nextItalic === -1 || nextBold <= nextItalic)) {
      isBold = true;
      startIdx = nextBold;
    } else {
      isBold = false;
      startIdx = nextItalic;
    }

    // 将标记前的内容加入结果
    if (startIdx > i) {
      result.push(str.slice(i, startIdx));
    }

    if (isBold) {
      const closeIdx = str.indexOf("**", startIdx + 2);
      if (closeIdx !== -1) {
        const innerText = str.slice(startIdx + 2, closeIdx);
        const children = parseMarkdownToReact(innerText, enableAsteriskFormatting, `${keyPrefix}-b-${childKeyIndex}`);
        result.push(
          <strong key={`${keyPrefix}-bold-${childKeyIndex++}`} className="font-bold text-[inherit]">
            {children}
          </strong>
        );
        i = closeIdx + 2;
      } else {
        // 未闭合，退化为普通文本
        result.push("**");
        i = startIdx + 2;
      }
    } else {
      // 寻找配对的单星号
      let closeIdx = -1;
      let searchStart = startIdx + 1;
      while (true) {
        const found = str.indexOf("*", searchStart);
        if (found === -1) break;

        const prevIsStar = found > 0 && str[found - 1] === "*";
        const nextIsStar = found + 1 < str.length && str[found + 1] === "*";

        if (!prevIsStar && !nextIsStar) {
          closeIdx = found;
          break;
        }
        // 如果是双星号的一部分，跳过双星号
        searchStart = found + (nextIsStar ? 2 : 1);
      }

      if (closeIdx !== -1) {
        const innerText = str.slice(startIdx + 1, closeIdx);
        const children = parseMarkdownToReact(innerText, enableAsteriskFormatting, `${keyPrefix}-i-${childKeyIndex}`);
        result.push(
          <span
            key={`${keyPrefix}-italic-${childKeyIndex++}`}
            className={
              enableAsteriskFormatting
                ? "text-muted-foreground/80 italic font-light text-[13px] leading-relaxed mx-0.5"
                : "italic text-[inherit] mx-0.5"
            }
          >
            {children}
          </span>
        );
        i = closeIdx + 1;
      } else {
        // 未闭合，退化为普通文本
        result.push("*");
        i = startIdx + 1;
      }
    }
  }

  return result;
}

function renderTextNode(textVal: string, enableAsteriskFormatting: boolean, index: number): React.ReactNode {
  if (!/(\*\*|\*)/.test(textVal)) {
    return textVal;
  }
  return parseMarkdownToReact(textVal, enableAsteriskFormatting, `html-node-${index}`);
}

function domToReact(
  node: Node, 
  index: number, 
  enableAsteriskFormatting: boolean,
  enableScriptExecution: boolean,
  activeCharacter: any,
  messageIndex?: number,
  libsReady?: boolean,
  enableLoopProtection?: boolean
): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return renderTextNode(node.nodeValue || "", enableAsteriskFormatting, index);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();

  // If script execution is disabled, block iframes
  if (tagName === "iframe" && !enableScriptExecution) {
    return null;
  }

  // If not allowed, strip wrapper but try rendering children recursively (unless unsafe tag)
  if (!ALLOWED_TAGS.has(tagName)) {
    if (
      tagName === "script" ||
      tagName === "iframe" ||
      tagName === "object" ||
      tagName === "embed" ||
      tagName === "style" ||
      tagName === "link"
    ) {
      return null;
    }
    return Array.from(element.childNodes).map((child, i) => 
      domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex, libsReady, enableLoopProtection)
    );
  }

  const props: Record<string, any> = { key: index };
  const attrs = element.attributes;

  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    const name = attr.name.toLowerCase();
    const val = attr.value;

    if (name.startsWith("on")) continue;

    const isGlobal = ALLOWED_ATTRS.global.has(name) || name.startsWith("data-");
    const isTagSpecific = ALLOWED_ATTRS[tagName]?.has(name);

    if (isGlobal || isTagSpecific) {
      if (name === "style") {
        props.style = parseStyleString(val);
      } else if (name === "class") {
        props.className = val;
      } else if (name === "href") {
        if (/^(https?:\/\/|mailto:|#|\/)/i.test(val)) {
          props.href = val;
        }
      } else if (name === "src") {
        if (/^(https?:\/\/|data:|blob:|\/|expression:\/\/|avatar:\/\/)/i.test(val)) {
          props.src = resolveExpressionUrl(val, activeCharacter);
        }
      } else if (name === "srcdoc" && tagName === "iframe") {
        // Resolve expression:// and avatar:// inside iframe srcdoc HTML content
        let resolvedSrcdoc = val;
        if (activeCharacter?.avatar) {
          resolvedSrcdoc = resolvedSrcdoc.replace(/avatar:\/\/(current)?/gi, activeCharacter.avatar);
        }
        
        const exprMatches = resolvedSrcdoc.match(/expression:\/\/([a-zA-Z0-9_-]+)/gi);
        if (exprMatches && activeCharacter) {
          exprMatches.forEach((match) => {
            const exprName = match.slice("expression://".length).toLowerCase();
            const resolvedUrl = resolveExpressionUrl(match, activeCharacter);
            resolvedSrcdoc = resolvedSrcdoc.replace(match, resolvedUrl);
          });
        }

        // Apply bridge injection if it's a raw un-injected iframe
        if (enableScriptExecution && !resolvedSrcdoc.includes("window.__TH_MESSAGE_ID")) {
          if (libsReady) {
            resolvedSrcdoc = createMessageIframeSrcDoc(resolvedSrcdoc, messageIndex, enableLoopProtection !== false);
          } else {
            resolvedSrcdoc = `<html><body style="background:transparent;color:#a8a29e;font-family:sans-serif;font-size:11px;margin:0;padding:4px;display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border:1.5px solid #a8a29e;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span>
              正在载入脚本依赖...
              <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            </body></html>`;
          }
        }
        
        // Diagnostic: log the srcdoc length and whether it was processed by createMessageIframeSrcDoc
        if (import.meta.env.DEV) {
          const hasThBridgeInject = resolvedSrcdoc.includes('TavernHelper');
          const hasJQueryShim = resolvedSrcdoc.includes('makeResult') || resolvedSrcdoc.includes('realJQ');
          console.log('[FormattedText] srcdoc set on iframe:', {
            len: resolvedSrcdoc.length,
            hasThBridgeInject,
            hasJQueryShim,
            preview: resolvedSrcdoc.substring(0, 120),
          });
        }
        
        props.srcDoc = resolvedSrcdoc;
      } else {
        props[name] = val;
      }
    }
  }

  // Force strict sandboxing for iframe tags
  if (tagName === "iframe") {
    // allow-popups: 支持卡片内 target="_blank" 链接；allow-popups-to-escape-sandbox: 弹窗回归父级安全上下文
    props.sandbox = "allow-scripts allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox";
    if (!props.id && messageIndex !== undefined) {
      props.id = `TH-msg-iframe-${messageIndex}`;
      props.name = `TH-msg-iframe-${messageIndex}`;
    }
    // Force React to destroy and recreate the iframe element when the character or message context changes
    const charId = activeCharacter?.id || "default-char";
    props.key = `iframe-${charId}-${messageIndex !== undefined ? messageIndex : "temp"}-${index}`;

    // Force transparent background, full width, no border and GPU acceleration on message iframes
    props.style = {
      ...(props.style || {}),
      background: "transparent",
      backgroundColor: "transparent",
      border: "none",
      width: "100%",
      maxWidth: "100%",
      willChange: "transform",
      transform: "translate3d(0, 0, 0)",
    };
    
    // Normalize minHeight from 400px to 40px to support collapsed state
    if (props.style && (props.style.minHeight === "400px" || props.style.minHeight === 400)) {
      props.style.minHeight = "40px";
    }

    // Set transparency and borderless attributes for compatibility with older WebKit/WebView engines
    props.allowtransparency = "true";
    props.frameBorder = "0";
    props.marginWidth = "0";
    props.marginHeight = "0";
  }

  const children = Array.from(element.childNodes).map((child, i) => 
    domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex, libsReady, enableLoopProtection)
  );
  
  const reactElement = React.createElement(
    tagName === "iframe" ? SafeIframe : tagName,
    props,
    tagName === "iframe" ? null : (children.length > 0 ? children : null),
  );

  if (tagName === "table") {
    return (
      <div key={index} className="w-full overflow-x-auto my-2 border border-border/40 rounded-lg custom-scrollbar max-w-full">
        {reactElement}
      </div>
    );
  }

  return reactElement;
}

function parseSafeHtmlToReact(
  html: string, 
  enableAsteriskFormatting: boolean,
  enableScriptExecution: boolean,
  activeCharacter: any,
  messageIndex?: number,
  libsReady?: boolean,
  enableLoopProtection?: boolean
): React.ReactNode {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const container = doc.body.firstChild;
    if (!container) return html;

    return Array.from(container.childNodes).map((child, i) => 
      domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex, libsReady, enableLoopProtection)
    );
  } catch (err) {
    console.error("Failed to parse HTML safely:", err);
    return html;
  }
}

function preprocessFormattedText(
  text: string,
  charName: string,
  userName: string,
  activeCharacter: any,
  enableScriptExecution: boolean,
  globalRegexScripts?: any[],
  presetRegexScripts?: any[],
  messageIndex?: number,
  enableLoopProtection?: boolean,
  isAiMessage?: boolean
): string {
  if (!text) return "";

  // 00. 剥离渲染层中的 <suggestions>、<UpdateVariable> 和 <initvar> 标签块（兼容未闭合的流式生成状态）
  let textToProcess = text;

  // 00a. 自动注入状态栏占位符：如果当前是 AI 的消息且角色包含 MVU/TavernHelper 脚本，但文本中未包含占位符时自动追加，以使正则能够替换并显示状态栏
  const hasThScripts = (() => {
    const ext = activeCharacter?.extensions || {};
    return (
      (Array.isArray(ext.tavern_helper?.scripts) && ext.tavern_helper.scripts.length > 0) ||
      !!(ext.mvu_settings || ext.mvu || ext.MVU)
    );
  })();
  if (enableScriptExecution && hasThScripts && isAiMessage && !/StatusPlaceHolderImpl/i.test(textToProcess)) {
    textToProcess += "\n<StatusPlaceHolderImpl/>";
  }
  
  // 0. Convert Markdown tables to HTML tables first
  const tableConvertedText = convertMarkdownTablesToHtml(textToProcess);

  // 1. Standard template placeholders
  let processed = tableConvertedText
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/<BOT>/gi, charName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<USER>/gi, userName);

  // 2. 合并全局、预设与角色局部已启用正则
  const mergedScripts: any[] = [];
  
  // 全局正则
  if (Array.isArray(globalRegexScripts)) {
    for (const script of globalRegexScripts) {
      if (!script.disabled) {
        mergedScripts.push(script);
      }
    }
  }

  // 预设正则
  if (Array.isArray(presetRegexScripts)) {
    for (const script of presetRegexScripts) {
      if (!script.disabled) {
        const exists = mergedScripts.some(
          (s) => (script.id && s.id && s.id === script.id) || (s.scriptName === script.scriptName && s.findRegex === script.findRegex)
        );
        if (!exists) {
          mergedScripts.push(script);
        }
      }
    }
  }
  
  // 角色局部正则
  const rawCharScripts = activeCharacter?.extensions?.regex_scripts;
  const charRegexScripts = Array.isArray(rawCharScripts)
    ? rawCharScripts
    : (rawCharScripts && typeof rawCharScripts === "object" ? Object.values(rawCharScripts) : []);

  if (import.meta.env.DEV) {
    console.log("[charRegexScripts Raw] for activeCharacter:", activeCharacter?.name, charRegexScripts);
  }

  if (charRegexScripts.length > 0) {
    for (const script of charRegexScripts) {
      if (script && !script.disabled) {
        const exists = mergedScripts.some(
          (s) => (script.id && s.id && s.id === script.id) || (s.scriptName === script.scriptName && s.findRegex === script.findRegex)
        );
        if (!exists) {
          mergedScripts.push(script);
        }
      }
    }
  }

  // 依次执行过滤清洗
  if (import.meta.env.DEV) {
    console.log("[RegexScripts List] for messageIndex:", messageIndex, mergedScripts.map(s => ({
      name: s.scriptName || s.id,
      findRegex: s.findRegex,
      replaceString: s.replaceString ? s.replaceString.substring(0, 60) + "..." : "",
      disabled: s.disabled,
      placement: s.placement
    })));
  }

  for (const script of mergedScripts) {
    if (script.promptOnly) continue;

    const placement = script.placement;
    let isAllowedPlacement = true;
    if (placement !== undefined && placement !== null) {
      if (Array.isArray(placement)) {
        if (placement.length > 0) {
          const targetPlacement = isAiMessage === true ? 2 : (isAiMessage === false ? 1 : null);
          if (targetPlacement !== null) {
            if (!placement.includes(targetPlacement)) {
              isAllowedPlacement = false;
            }
          } else {
            if (!placement.includes(1) && !placement.includes(2)) {
              isAllowedPlacement = false;
            }
          }
        }
      } else if (typeof placement === "number") {
        const targetPlacement = isAiMessage === true ? 2 : (isAiMessage === false ? 1 : null);
        if (targetPlacement !== null) {
          if (placement !== targetPlacement) {
            isAllowedPlacement = false;
          }
        } else {
          if (placement !== 1 && placement !== 2) {
            isAllowedPlacement = false;
          }
        }
      }
    }
    if (!isAllowedPlacement) {
      continue;
    }

    let findRegexStr = script.findRegex;
    const replaceString = script.replaceString || "";
    if (!findRegexStr) continue;

    // 关键功能实现：支持 SillyTavern 标准的 "Substitute (raw)" 宏替换功能。
    // 在编译正则表达式之前，必须将 findRegex 字符串中的宏占位符（如 {{char}} 或 {{user}}）替换为真实的名称。
    // 否则当文本中已经替换为真实姓名后，正则表达式将由于寻找 literal 的 "{{char}}" 字符串而匹配失败。
    findRegexStr = findRegexStr
      .replace(/\{\{char\}\}/gi, charName)
      .replace(/<BOT>/gi, charName)
      .replace(/\{\{user\}\}/gi, userName)
      .replace(/<USER>/gi, userName);

    try {
      let regex: RegExp;
      const match = findRegexStr.match(/^\/(.*)\/([gimsuy]*)$/);
      if (match) {
        regex = new RegExp(match[1], match[2]);
      } else {
        regex = new RegExp(findRegexStr, "gi");
      }
      const beforeLen = processed.length;
      processed = processed.replace(regex, replaceString);
      if (import.meta.env.DEV) {
        const tempRegex = new RegExp(regex.source, regex.flags.replace('g', ''));
        const hasMatch = tempRegex.test(processed);
        console.log(`[RegexScript] Applied: "${script.scriptName || script.id}", beforeLen: ${beforeLen}, afterLen: ${processed.length}, hasMatch: ${hasMatch}`);
        if (script.scriptName?.includes("变量更新") || script.scriptName?.includes("完整变量表") || beforeLen !== processed.length) {
          console.log(`[RegexScript DEBUG] scriptName: "${script.scriptName}", regexSource: "${regex.source}", flags: "${regex.flags}", text contains <UpdateVariable>: ${processed.includes("<UpdateVariable>") || processed.includes("UpdateVariable")}, text length: ${processed.length}, text sample:`, processed.substring(0, 500));
        }
      }
    } catch (err) {
      console.warn("Failed to apply regex script:", findRegexStr, err);
    }
  }

  // 3. Wrap code blocks in sandboxed iframes
  //    匹配两种格式：
  //    a) ```html ... ``` - 显式 HTML 代码块
  //    b) ``` ... ```      - 普通代码块，但内容以 HTML 标签（< 开头）时也作为 HTML 渲染
  //    角色卡正则的 replaceString 通常产出的是格式 b（SillyTavern 兼容格式）
  if (enableScriptExecution) {
    const loopGuard = enableLoopProtection !== false;
    // 先处理显式 ```html 块
    const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/gi;
    processed = processed.replace(htmlCodeBlockRegex, (_match, htmlContent) => {
      const compiledSrcdoc = createMessageIframeSrcDoc(htmlContent, messageIndex, loopGuard);
      const escapedHtml = compiledSrcdoc
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      const iframeId = messageIndex !== undefined ? `TH-msg-iframe-${messageIndex}` : `TH-msg-iframe-temp`;
      return `<iframe id="${iframeId}" name="${iframeId}" srcdoc="${escapedHtml}" style="width: 100%; min-height: 40px; border: none; display: block; background: transparent; background-color: transparent; will-change: transform; transform: translate3d(0, 0, 0);" allowtransparency="true" class="w-full mvu-message-iframe"></iframe>`;
    });

    // 再处理普通 ``` 块，但仅当内容以 HTML 标签开头时才转为 iframe
    const plainCodeBlockRegex = /```\s*([\s\S]*?)\s*```/g;
    processed = processed.replace(plainCodeBlockRegex, (_match, codeContent) => {
      const trimmedContent = codeContent.trim();
      // 内容以 < 开头（HTML 标签），当作 HTML 渲染
      if (trimmedContent.startsWith("<")) {
        const compiledSrcdoc = createMessageIframeSrcDoc(trimmedContent, messageIndex, loopGuard);
        const escapedHtml = compiledSrcdoc
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
        const iframeId = messageIndex !== undefined ? `TH-msg-iframe-${messageIndex}` : `TH-msg-iframe-temp`;
        return `<iframe id="${iframeId}" name="${iframeId}" srcdoc="${escapedHtml}" style="width: 100%; min-height: 40px; border: none; display: block; background: transparent; background-color: transparent; will-change: transform; transform: translate3d(0, 0, 0);" allowtransparency="true" class="w-full mvu-message-iframe"></iframe>`;
      }
      // 非 HTML 内容：保持原始代码块渲染
      return _match;
    });
  }

  // 4. 最终清洗：剥离所有未匹配或残留的 <suggestions>、<UpdateVariable> 和 <initvar> 标签块，防止其泄漏至渲染层展示为原始文本
  // 剥离 suggestions
  const suggestionsRegex = /<suggestions\s*>[\s\S]*?<\/suggestions\s*>/gi;
  processed = processed.replace(suggestionsRegex, "");
  processed = processed.replace(/<suggestions\s*>[\s\S]*$/gi, "");
  
  // 剥离 MVU 数据块（闭合与未闭合状态）
  const mvuTagsRegex = /<(UpdateVariable|initvar)\b[^>]*>[\s\S]*?<\/\1>/gi;
  processed = processed.replace(mvuTagsRegex, "");
  processed = processed.replace(/<(UpdateVariable|initvar)\b[^>]*>[\s\S]*$/gi, "");

  // 清理孤立残留的开闭标签本身，防止 DOM 结构紊乱导致 React 渲染崩溃及展示污染
  processed = processed.replace(/<\/?(?:UpdateVariable|initvar|JSONPatch|Analysis|suggestions|center)\b[^>]*>/gi, "");

  return processed;
}

class LocalErrorBoundary extends React.Component<any, any> {
  state: any = { hasError: false };
  props: any;

  constructor(props: any) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("[LocalErrorBoundary] Message render error caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const FormattedText = memo(function FormattedText({
  text,
  charName,
  userName = "user",
  className = "",
  messageIndex,
}: FormattedTextProps) {
  if (!text) return null;

  const [isExpanded, setIsExpanded] = useState(false);
  const MAX_SAFE_LENGTH = 50000;
  const isTooLong = text.length > MAX_SAFE_LENGTH;
  
  // 核心优化：如果是 HTML/Iframe 交互式挂件消息，绝对不能执行截断折叠，否则会切断代码导致语法损坏和面板崩溃
  const isWidget = /```html\b|<iframe\b|<StatusPlaceHolder/i.test(text);
  const shouldTruncate = isTooLong && !isExpanded && !isWidget;

  const displayText = shouldTruncate
    ? text.substring(0, 45000) + `\n\n*... [ 此处已自动折叠超长内容，当前共 ${text.length} 字 ] ...*`
    : text;

  const context = useUnifiedApp();
  const enableHtml = context.settings.enableHtmlRendering ?? true;
  const enableScriptExecution = !!context.settings.enableScriptExecution;
  const enableLoopProtection = context.settings.enableLoopProtection !== false;
  const activeCharacter = context.activeCharacter;

  if (enableScriptExecution) {
    // 关键：在渲染时立即触发全局 Mock 注册，防止 iframe 比 useEffect 提前加载导致 window.parent.TavernHelper 缺失而退出
    initTavernHelperMocks();
  }

  const [libsReady, setLibsReady] = useState(false);

  React.useEffect(() => {
    if (!enableScriptExecution) {
      setLibsReady(true);
      return;
    }
    let isMounted = true;
    const checkLibs = () => {
      const w = window as any;
      if (w.TavernHelperMvuLibs?.defineStore && w._) {
        if (isMounted) setLibsReady(true);
      } else {
        setTimeout(checkLibs, 50);
      }
    };
    checkLibs();
    return () => {
      isMounted = false;
    };
  }, [enableScriptExecution]);
  // 优先取角色卡 visualSettings 中的显式声明（true/false）；
  // 若角色卡未配置（undefined），则回退到全局 settings.enableAsteriskFormatting。
  const enableAsteriskFormatting = activeCharacter?.visualSettings?.enableAsteriskFormatting !== undefined
    ? !!activeCharacter.visualSettings.enableAsteriskFormatting
    : !!(context.settings.enableAsteriskFormatting);
  const globalRegexScripts = context.settings.globalRegexScripts;
  const presetRegexScripts = context.settings.presetRegexScripts;

  const isAiMessage = (() => {
    if (messageIndex === undefined) return false;
    const session = context.activeSession;
    if (!session || !session.messages) return false;
    const msg = session.messages[messageIndex];
    return msg ? msg.sender === "assistant" : false;
  })();

  const processed = preprocessFormattedText(
    displayText,
    charName,
    userName,
    activeCharacter,
    enableScriptExecution,
    globalRegexScripts,
    presetRegexScripts,
    messageIndex,
    enableLoopProtection,
    isAiMessage
  );

  // Quick detection: if text contains tags and html rendering is active, use DOM parser
  const hasHtml = enableHtml && /<[a-z/][\s\S]*?>/i.test(processed);

  let renderedContent: React.ReactNode;
  if (hasHtml) {
    renderedContent = (
      <span className={`block whitespace-pre-wrap leading-relaxed ${className}`}>
        {parseSafeHtmlToReact(processed, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex, libsReady, enableLoopProtection)}
      </span>
    );
  } else {
    // Fast-path Markdown parsing for pure text messages
    renderedContent = (
      <span className={`whitespace-pre-wrap leading-relaxed ${className}`}>
        {parseMarkdownToReact(processed, enableAsteriskFormatting, "text-node")}
      </span>
    );
  }

  const element = (
    <div className="relative w-full">
      <div 
        className={shouldTruncate ? "max-h-[600px] overflow-hidden relative transition-all duration-300" : "relative"}
        style={shouldTruncate ? { maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)' } : {}}
      >
        {renderedContent}
      </div>
      <div className={`flex justify-center w-full mt-3 ${shouldTruncate ? "absolute bottom-0 left-0 py-4 bg-gradient-to-t from-background/95 to-transparent pt-16" : ""}`}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full border border-primary/20 bg-background/90 text-primary shadow-sm active:scale-95 transition-all hover:bg-accent backdrop-blur-sm"
        >
          {isExpanded ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7" />
              </svg>
              收起超长台词 (共 {text.length} 字)
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
              </svg>
              展开超长台词 (共 {text.length} 字)
            </>
          )}
        </button>
      </div>
      {shouldTruncate && <div className="h-8" />} {/* 占位符，防止按钮挡住底部内容 */}
    </div>
  );

  const fallbackMarkup = (
    <span className={`block whitespace-pre-wrap leading-relaxed ${className}`}>
      {text}
    </span>
  );

  return (
    <LocalErrorBoundary fallback={fallbackMarkup}>
      {shouldTruncate || (isTooLong && !isWidget && isExpanded) ? element : renderedContent}
    </LocalErrorBoundary>
  );
});

export default FormattedText;
