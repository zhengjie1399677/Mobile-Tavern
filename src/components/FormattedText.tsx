import React, { useContext, memo, useState } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { createMessageIframeSrcDoc } from "../utils/tavernHelperBridge";
import { parseStyleString, resolveExpressionUrl, convertMarkdownTablesToHtml } from "./formattedTextUtils";

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
  global: new Set(["class", "classname", "style", "title"]),
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  table: new Set(["border", "cellpadding", "cellspacing"]),
  iframe: new Set(["src", "srcdoc", "width", "height", "style", "class", "classname", "sandbox", "id", "name"]),
};

function renderTextNode(textVal: string, enableAsteriskFormatting: boolean): React.ReactNode {
  if (!/(\*\*|\*)/.test(textVal)) {
    return textVal;
  }
  const parts = textVal.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-bold text-[inherit]">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <span
          key={index}
          className={
            enableAsteriskFormatting
              ? "text-muted-foreground/85 italic font-light text-[13px] leading-relaxed mx-0.5"
              : "italic text-[inherit] mx-0.5"
          }
        >
          {part.slice(1, -1)}
        </span>
      );
    }
    return part;
  });
}

function domToReact(
  node: Node, 
  index: number, 
  enableAsteriskFormatting: boolean,
  enableScriptExecution: boolean,
  activeCharacter: any,
  messageIndex?: number
): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return renderTextNode(node.nodeValue || "", enableAsteriskFormatting);
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
      domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex)
    );
  }

  const props: Record<string, any> = { key: index };
  const attrs = element.attributes;

  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    const name = attr.name.toLowerCase();
    const val = attr.value;

    if (name.startsWith("on")) continue;

    const isGlobal = ALLOWED_ATTRS.global.has(name);
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
          resolvedSrcdoc = createMessageIframeSrcDoc(resolvedSrcdoc, messageIndex);
        }
        
        // Diagnostic: log the srcdoc length and whether it was processed by createMessageIframeSrcDoc
        const hasThBridgeInject = resolvedSrcdoc.includes('TavernHelper');
        const hasJQueryShim = resolvedSrcdoc.includes('makeResult') || resolvedSrcdoc.includes('realJQ');
        console.log('[FormattedText] srcdoc set on iframe:', {
          len: resolvedSrcdoc.length,
          hasThBridgeInject,
          hasJQueryShim,
          preview: resolvedSrcdoc.substring(0, 120),
        });
        
        props.srcDoc = resolvedSrcdoc;
      } else {
        props[name] = val;
      }
    }
  }

  // Force strict sandboxing for iframe tags
  if (tagName === "iframe") {
    props.sandbox = "allow-scripts allow-modals";
    if (!props.id && messageIndex !== undefined) {
      props.id = `TH-msg-iframe-${messageIndex}`;
      props.name = `TH-msg-iframe-${messageIndex}`;
    }
    // Force React to destroy and recreate the iframe element when the character or message context changes
    const charId = activeCharacter?.id || "default-char";
    props.key = `iframe-${charId}-${messageIndex !== undefined ? messageIndex : "temp"}-${index}`;
  }

  const children = Array.from(element.childNodes).map((child, i) => 
    domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex)
  );
  
  const reactElement = React.createElement(
    tagName,
    props,
    children.length > 0 ? children : null,
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
  messageIndex?: number
): React.ReactNode {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const container = doc.body.firstChild;
    if (!container) return html;

    return Array.from(container.childNodes).map((child, i) => 
      domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex)
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
  messageIndex?: number
): string {
  if (!text) return "";

  // 00. 剥离渲染层中的 <suggestions>...</suggestions> 标签块（兼容未闭合的流式生成状态）
  const suggestionsRegex = /<suggestions\s*>[\s\S]*?<\/suggestions\s*>/gi;
  let textToProcess = text.replace(suggestionsRegex, "");
  textToProcess = textToProcess.replace(/<suggestions\s*>[\s\S]*$/gi, "");

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
          (s) => s.id === script.id || (s.scriptName === script.scriptName && s.findRegex === script.findRegex)
        );
        if (!exists) {
          mergedScripts.push(script);
        }
      }
    }
  }
  
  // 角色局部正则
  if (activeCharacter?.extensions?.regex_scripts && Array.isArray(activeCharacter.extensions.regex_scripts)) {
    for (const script of activeCharacter.extensions.regex_scripts) {
      if (!script.disabled) {
        const exists = mergedScripts.some(
          (s) => s.id === script.id || (s.scriptName === script.scriptName && s.findRegex === script.findRegex)
        );
        if (!exists) {
          mergedScripts.push(script);
        }
      }
    }
  }

  // 依次执行过滤清洗
  for (const script of mergedScripts) {
    if (script.promptOnly) continue;

    const placement = script.placement;
    if (Array.isArray(placement) && !placement.includes(2)) {
      continue;
    }

    const findRegex = script.findRegex;
    const replaceString = script.replaceString || "";
    if (!findRegex) continue;

    // ReDoS pattern protection: block patterns with nested/repeated quantifiers
    const trimmed = findRegex.trim();
    if (/(\([^\)]*[\+\*]\)[^\)]*[\+\*])/.test(trimmed) || /(\[[^\]]*[\+\*]\][^\]]*[\+\*])/.test(trimmed)) {
      console.warn("Potential ReDoS pattern skipped in FormattedText regex script:", trimmed);
      continue;
    }

    try {
      let regex: RegExp;
      const match = findRegex.match(/^\/(.*)\/([gimsuy]*)$/);
      if (match) {
        regex = new RegExp(match[1], match[2]);
      } else {
        regex = new RegExp(findRegex, "gi");
      }
      processed = processed.replace(regex, replaceString);
    } catch (err) {
      console.warn("Failed to apply regex script:", findRegex, err);
    }
  }

  // 3. Wrap ```html ... ``` blocks in sandboxed iframes
  if (enableScriptExecution) {
    const codeBlockRegex = /```html\s*([\s\S]*?)\s*```/gi;
    processed = processed.replace(codeBlockRegex, (match, htmlContent) => {
      // Compile into standard message iframe wrapper
      const compiledSrcdoc = createMessageIframeSrcDoc(htmlContent, messageIndex);
      const escapedHtml = compiledSrcdoc
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      const iframeId = messageIndex !== undefined ? `TH-msg-iframe-${messageIndex}` : `TH-msg-iframe-temp`;
      return `<iframe id="${iframeId}" name="${iframeId}" srcdoc="${escapedHtml}" style="width: 100%; min-height: 400px; border: none; display: block;" class="w-full mvu-message-iframe"></iframe>`;
    });
  }

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
  const MAX_SAFE_LENGTH = 15000;
  const isTooLong = text.length > MAX_SAFE_LENGTH;
  const shouldTruncate = isTooLong && !isExpanded;

  const displayText = shouldTruncate
    ? text.substring(0, 12000) + `\n\n*... [ 此处已自动折叠超长内容，当前共 ${text.length} 字 ] ...*`
    : text;

  const context = useUnifiedApp();
  const enableHtml = context.settings.enableHtmlRendering ?? true;
  const enableScriptExecution = !!context.settings.enableScriptExecution;
  const activeCharacter = context.activeCharacter;
  const enableAsteriskFormatting = !!activeCharacter?.visualSettings?.enableAsteriskFormatting;
  const globalRegexScripts = context.settings.globalRegexScripts;
  const presetRegexScripts = context.settings.presetRegexScripts;

  const processed = preprocessFormattedText(
    displayText,
    charName,
    userName,
    activeCharacter,
    enableScriptExecution,
    globalRegexScripts,
    presetRegexScripts,
    messageIndex
  );

  // Quick detection: if text contains tags and html rendering is active, use DOM parser
  const hasHtml = enableHtml && /<[a-z/][\s\S]*?>/i.test(processed);

  let renderedContent: React.ReactNode;
  if (hasHtml) {
    renderedContent = (
      <span className={`block whitespace-pre-wrap leading-relaxed ${className}`}>
        {parseSafeHtmlToReact(processed, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex)}
      </span>
    );
  } else {
    // Fast-path Markdown parsing for pure text messages
    const parts = processed.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    renderedContent = (
      <span className={`whitespace-pre-wrap leading-relaxed ${className}`}>
        {parts.map((part, index) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <strong key={index} className="font-bold text-[inherit]">
                {part.slice(2, -2)}
              </strong>
            );
          } else if (part.startsWith("*") && part.endsWith("*")) {
            return (
              <span
                key={index}
                className={
                  enableAsteriskFormatting
                    ? "text-muted-foreground/80 italic font-light text-[13px] leading-relaxed mx-0.5"
                    : "italic text-[inherit] mx-0.5"
                }
              >
                {part.slice(1, -1)}
              </span>
            );
          }
          return (
            <span key={index} className="text-[inherit] font-normal">
              {part}
            </span>
          );
        })}
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
      {isTooLong ? element : renderedContent}
    </LocalErrorBoundary>
  );
});

export default FormattedText;
