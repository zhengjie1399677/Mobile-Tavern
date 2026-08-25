import React from "react";
import { publicEnvironment } from "../../config";
import { parseStyleString, resolveExpressionUrl, convertMarkdownTablesToHtml } from "../formattedTextUtils";
import { readFormattedTextSrcdoc, storeFormattedTextSrcdoc } from "./srcdocStore";
import type { CompatibilityRendererDefinition } from "../../application/compatibility/contracts";
import type { CompatibilityScriptSecurityMode } from "../../types";

interface RegexScript {
  id?: string;
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  disabled?: boolean;
  promptOnly?: boolean;
  placement?: number | number[];
}

export interface FormattedCharacterLike {
  id?: string;
  name?: string;
  avatar?: string;
  extensions?: {
    regex_scripts?: RegexScript[] | Record<string, RegexScript>;
    tavern_helper?: { scripts?: unknown[] };
    mvu_settings?: unknown;
    mvu?: unknown;
    MVU?: unknown;
  };
}

type SafeIframeProps = Omit<
  React.IframeHTMLAttributes<HTMLIFrameElement>,
  "srcDoc"
> & {
  srcDoc?: string;
};

type RenderElementProps = Record<string, unknown> & {
  key: React.Key;
  id?: string;
  name?: string;
  srcDoc?: string;
  style?: React.CSSProperties;
  sandbox?: string;
  allowtransparency?: string;
  frameBorder?: string;
  marginWidth?: string;
  marginHeight?: string;
};

// ─── Srcdoc Store ─────────────────────────────────────────────────────────────
// Android WebView 的 DOMParser 在解析超长 HTML attribute 值时，遇到 attribute
// 内的 `<` 字符会提前终止属性解析，导致 iframe 的 srcdoc 被截断或丢失（PC
// Chrome 可以容忍此行为，Android WebView 不行）。
// 解决方案：将 srcdoc 内容存入模块级 Map，iframe 只携带短 ID；domToReact
// 从 Map 中取出完整 srcdoc 赋值，彻底绕开 DOMParser 对属性值大小的限制。
const SafeIframe = React.memo((props: SafeIframeProps) => {
  const { srcDoc, ...rest } = props;
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // 关键修复：Android WebView 对超长 srcdoc attribute（50KB+）有硬性截断限制，
  // 通过 React prop（setAttribute）设置时会静默失败导致 iframe 白屏。
  // 改用 useLayoutEffect 直接赋值 DOM property（element.srcdoc = ...），
  // DOM property 赋值无大小限制，在所有 Android WebView 版本上均可靠工作。
  React.useLayoutEffect(() => {
    if (iframeRef.current && srcDoc !== undefined && srcDoc !== null) {
      try {
        if (iframeRef.current.srcdoc !== srcDoc) {
          if (publicEnvironment.isDevelopment) {
            console.log('[SafeIframe] setting srcdoc via DOM property, length:', srcDoc.length);
          }
          iframeRef.current.srcdoc = srcDoc;
        }
      } catch (e) {
        console.error('[SafeIframe] srcdoc DOM property assignment failed:', e);
      }
    }
  }, [srcDoc]);

  // 不通过 React prop 传递 srcDoc，由 useLayoutEffect 直接写入 DOM property
  return <iframe ref={iframeRef} {...rest} />;
}, (prevProps, nextProps) => {
  // srcDoc 变化时必须允许重新渲染，否则 useLayoutEffect 不会触发，切换分支时会白屏。
  if (prevProps.srcDoc !== nextProps.srcDoc) {
    return false;
  }
  // srcDoc 未变化时跳过渲染，保持 iframe 存活，避免不必要的脚本重新执行
  return true;
});
SafeIframe.displayName = "SafeIframe";

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

export function parseMarkdownToReact(
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
      while (searchStart < str.length) {
        const found = str.indexOf("*", searchStart);
        if (found === -1) break;

        let len = 0;
        while (found + len < str.length && str[found + len] === "*") {
          len++;
        }

        if (len % 2 === 1) {
          closeIdx = found + len - 1;
          break;
        }
        searchStart = found + len;
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
  activeCharacter: FormattedCharacterLike | null | undefined,
  messageIndex?: number,
  libsReady?: boolean,
  enableLoopProtection?: boolean,
  swipeId?: number,
  compatibilityRenderer?: CompatibilityRendererDefinition | null,
  scriptSecurityMode: CompatibilityScriptSecurityMode = "isolated",
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
      domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex, libsReady, enableLoopProtection, swipeId, compatibilityRenderer, scriptSecurityMode)
    );
  }

  const props: RenderElementProps = { key: index };
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
      } else if (name === "data-th-srcdoc-id" && tagName === "iframe") {
        // 新策略：从模块级 _srcdocStore 中取出完整 srcdoc，完全绕开 DOMParser
        // 对超长 attribute 值的截断限制（Android WebView 对含 < 的属性值处理有 bug）
        const stored = readFormattedTextSrcdoc(val);
        if (stored) {
          let resolvedSrcdoc = stored;
          // 原始角色卡 iframe 统一交给可选 Compatibility Renderer 准备运行环境。
          if (enableScriptExecution && compatibilityRenderer) {
            if (libsReady) {
              try {
                resolvedSrcdoc = compatibilityRenderer?.createMessageIframeSrcDoc(
                  resolvedSrcdoc,
                  messageIndex,
                  enableLoopProtection !== false,
                  scriptSecurityMode,
                ) ?? resolvedSrcdoc;
                if (publicEnvironment.isDevelopment) {
                  console.log('[FormattedText] bridge injected for card srcdoc, len:', resolvedSrcdoc.length);
                }
              } catch (e) {
                console.error('[FormattedText] createMessageIframeSrcDoc failed:', e);
              }
            } else {
              // libsReady=false：显示加载占位符
              resolvedSrcdoc = `<html><body style="background:transparent;color:#a8a29e;font-family:sans-serif;font-size:11px;margin:0;padding:4px;display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border:1.5px solid #a8a29e;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span>
              正在载入脚本依赖...
              <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            </body></html>`;
            }
          }
          props.srcDoc = resolvedSrcdoc;
          if (publicEnvironment.isDevelopment) {
            console.log('[FormattedText] srcdoc retrieved from store, id:', val, 'len:', resolvedSrcdoc.length);
          } else {
            console.error('[FormattedText][PROD] srcdoc-id found:', val.slice(0, 40), 'len:', resolvedSrcdoc.length);
          }
        } else {
          console.error('[FormattedText] srcdoc store MISS for id:', val);
        }
      } else if ((name === "srcdoc" || name === "data-srcdoc") && tagName === "iframe") {
        // 兼容：角色卡直接输出 <iframe srcdoc="..."> 的老格式
        // Resolve expression:// and avatar:// inside iframe srcdoc HTML content
        let resolvedSrcdoc = val;
        if (activeCharacter?.avatar) {
          resolvedSrcdoc = resolvedSrcdoc.replace(/avatar:\/\/(current)?/gi, activeCharacter.avatar);
        }
        
        const exprMatches = resolvedSrcdoc.match(/expression:\/\/([a-zA-Z0-9_-]+)/gi);
        if (exprMatches && activeCharacter) {
          exprMatches.forEach((match) => {
            const resolvedUrl = resolveExpressionUrl(match, activeCharacter);
            resolvedSrcdoc = resolvedSrcdoc.replace(match, resolvedUrl);
          });
        }

        // 原始 iframe 统一交给可选 Compatibility Renderer 准备运行环境。
        if (enableScriptExecution && compatibilityRenderer) {
          if (libsReady) {
            resolvedSrcdoc = compatibilityRenderer?.createMessageIframeSrcDoc(
              resolvedSrcdoc,
              messageIndex,
              enableLoopProtection !== false,
              scriptSecurityMode,
            ) ?? resolvedSrcdoc;
          } else {
            resolvedSrcdoc = `<html><body style="background:transparent;color:#a8a29e;font-family:sans-serif;font-size:11px;margin:0;padding:4px;display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border:1.5px solid #a8a29e;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span>
              正在载入脚本依赖...
              <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            </body></html>`;
          }
        }
        
        props.srcDoc = resolvedSrcdoc;
      } else {
        props[name] = val;
      }
    }
  }

  // 为 iframe 统一设置 SillyTavern 兼容执行权限。
  if (tagName === "iframe") {
    // 安全缺省为 opaque-origin iframe；只有用户显式选择 trusted 兼容模式时，
    // Compatibility Runtime 才恢复 allow-same-origin 与弹窗能力。
    const iframePolicy = compatibilityRenderer?.getIframePolicy(scriptSecurityMode)
      ?? { isolated: true, sandbox: "allow-scripts" };
    props.sandbox = iframePolicy.sandbox;
    if (iframePolicy.isolated) props["data-mt-compat-isolated"] = "true";
    if (!props.id && messageIndex !== undefined) {
      props.id = `TH-msg-iframe-${messageIndex}`;
      props.name = `TH-msg-iframe-${messageIndex}`;
    }
    // Force React to destroy and recreate the iframe element when content changes
    // 使用 srcDoc 内容哈希作为 key 的一部分，确保内容变化时 iframe 被销毁重建，
    // 避免 WebView 中仅更新 srcdoc 属性导致的白屏/不刷新问题。
    const charId = activeCharacter?.id || "default-char";
    const sId = swipeId !== undefined ? swipeId : 0;
    const srcDocForHash = typeof props.srcDoc === "string" ? props.srcDoc : "";
    let contentHash = 0;
    for (let hi = 0; hi < Math.min(srcDocForHash.length, 2000); hi++) {
      contentHash = ((contentHash << 5) - contentHash + srcDocForHash.charCodeAt(hi)) | 0;
    }
    props.key = `iframe-${charId}-${messageIndex !== undefined ? messageIndex : "temp"}-${sId}-${index}-${contentHash}`;

    // Force transparent background, full width, no border and GPU acceleration on message iframes
    props.style = {
      ...(props.style || {}),
      background: "transparent",
      backgroundColor: "transparent",
      border: "none",
      outline: "none",
      width: "100%",
      maxWidth: "100%",
      // 强制 block 布局并清零 margin，消除 inline iframe 的 baseline gap 白边
      display: "block",
      margin: "0",
      willChange: "transform",
      transform: "translate3d(0, 0, 0)",
      // 强制 minHeight 为 0，避免空白内容时显示白色占位框
      minHeight: "0",
      height: "auto",
    };

    // Set transparency and borderless attributes for compatibility with older WebKit/WebView engines
    // 注意：React 中必须使用驼峰式命名，否则属性不会被正确设置到 DOM 上
    // React 19 forwards this legacy custom attribute without warnings only in lowercase form.
    props.allowtransparency = "true";
    props.frameBorder = "0";
    props.marginWidth = "0";
    props.marginHeight = "0";
  }

  const children = Array.from(element.childNodes).map((child, i) => 
    domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex, libsReady, enableLoopProtection, swipeId, compatibilityRenderer, scriptSecurityMode)
  );
  
  const reactElement =
    tagName === "iframe"
      ? React.createElement(SafeIframe, props as SafeIframeProps)
      : React.createElement(
          tagName,
          props as React.HTMLAttributes<HTMLElement>,
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

// 在 DOMParser 解析前，将 srcdoc/data-srcdoc 属性内容提取到 _srcdocStore，
// 替换为短 ID（data-th-srcdoc-id），防止 Android WebView 的 DOMParser 遇到
// attribute 值中的 `<` 字符时提前终止属性解析，导致卡片内容泄漏到外层 DOM。
// 这覆盖了两种来源：
//   1. 我们的 preprocessFormattedText 已经生成 data-th-srcdoc-id（不受影响）
//   2. 角色卡正则直接输出 <iframe srcdoc="RAW_HTML">（需要此处预处理）
function extractSrcdocAttrs(html: string): string {
  let extractCount = 0;
  const result = html.replace(
    /(^|[\s<])((?:data-)?srcdoc)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (_match, prefix, _attrName, _quotedVal, doubleContent, singleContent) => {
      const rawContent = doubleContent !== undefined ? doubleContent : (singleContent ?? "");
      // 解码 HTML 实体，还原原始 srcdoc 内容
      const decoded = rawContent
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      const storeKey = `th-srcdoc-card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      storeFormattedTextSrcdoc(storeKey, decoded);
      extractCount++;
      if (publicEnvironment.isDevelopment) {
        console.log('[parseSafeHtml] extracted srcdoc to store, key:', storeKey, 'len:', decoded.length);
      } else {
        console.error('[parseSafeHtml][PROD] extracted srcdoc, key:', storeKey.slice(0, 40), 'len:', decoded.length, 'hasHtml:', decoded.includes('<html'));
      }
      return `${prefix}data-th-srcdoc-id="${storeKey}"`;
    }
  );
  // 仅把标签开头或空白后的 srcdoc/data-srcdoc= 视为真实属性，
  // 避免内部 data-th-srcdoc-id 中的单词片段触发误诊。
  if (extractCount === 0 && /(?:^|[\s<])(?:data-)?srcdoc\s*=/i.test(html)) {
    // srcdoc 出现了但正则没有匹配上，输出诊断信息
    console.error('[parseSafeHtml][PROD] srcdoc present but regex MISSED. html snippet:', html.slice(0, 300));
  }
  return result;
}

export function parseSafeHtmlToReact(
  html: string, 
  enableAsteriskFormatting: boolean,
  enableScriptExecution: boolean,
  activeCharacter: FormattedCharacterLike | null | undefined,
  messageIndex?: number,
  libsReady?: boolean,
  enableLoopProtection?: boolean,
  swipeId?: number,
  compatibilityRenderer?: CompatibilityRendererDefinition | null,
  scriptSecurityMode: CompatibilityScriptSecurityMode = "isolated",
): React.ReactNode {
  try {
    const parser = new DOMParser();
    // 关键：先把所有 srcdoc 属性提取到 Map，再传给 DOMParser
    // 防止 Android WebView 对含 < 的超长属性值的错误解析
    const safeHtml = extractSrcdocAttrs(html);
    const doc = parser.parseFromString(`<div>${safeHtml}</div>`, "text/html");
    const container = doc.body.firstChild;
    if (!container) return html;

    return Array.from(container.childNodes).map((child, i) => 
      domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter, messageIndex, libsReady, enableLoopProtection, swipeId, compatibilityRenderer, scriptSecurityMode)
    );
  } catch (err) {
    console.error("Failed to parse HTML safely:", err);
    return html;
  }
}

export function preprocessFormattedText(
  text: string,
  charName: string,
  userName: string,
  activeCharacter: FormattedCharacterLike | null | undefined,
  enableScriptExecution: boolean,
  globalRegexScripts?: RegexScript[],
  presetRegexScripts?: RegexScript[],
  messageIndex?: number,
  enableLoopProtection?: boolean,
  isAiMessage?: boolean,
  isStreamingLastMsg?: boolean,
  compatibilityRenderer?: CompatibilityRendererDefinition | null,
  scriptSecurityMode: CompatibilityScriptSecurityMode = "isolated",
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
  const mergedScripts: RegexScript[] = [];
  
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

  if (publicEnvironment.isDevelopment) {
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
  if (publicEnvironment.isDevelopment) {
    console.log("[RegexScripts List] for messageIndex:", messageIndex, mergedScripts.map(s => ({
      name: s.scriptName || s.id,
      findRegex: s.findRegex,
      replaceString: s.replaceString ? s.replaceString.substring(0, 60) + "..." : "",
      disabled: s.disabled,
      placement: s.placement
    })));
  }

  for (const script of mergedScripts) {
    if (!script || script.disabled || script.promptOnly) continue;

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
      if (publicEnvironment.isDevelopment) {
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
    // 辅助函数：剥离角色卡常见的 <Gui> 包装标签，防止其出现在 <!DOCTYPE html> 之前导致 HTML 解析器进入 quirks 模式
    const stripGuiWrapper = (html: string) => html.replace(/^\s*<Gui>\s*/i, "").replace(/\s*<\/Gui>\s*$/i, "");

    // 降级策略：流式生成中，如果是最后一条 AI 消息（isStreamingLastMsg===true），
    // 暂不渲染真实的 Iframe 编译和挂载，避免高频重载和数据不同步。
    console.log(`[FT-DIAG-GUARD] enableScript=${enableScriptExecution}, isStreamLast=${isStreamingLastMsg}, msgIdx=${messageIndex}`);
    // 关键修复：为同一条消息内的多个 iframe 代码块生成唯一 ID
    // 旧实现所有 iframe 共享 `TH-msg-iframe-${messageIndex}`，导致：
    //   1. DOM id 冲突（getElementById 只返回第一个）
    //   2. 第二个及之后的 iframe 的 bridge 通信失败（postMessage target 命中第一个）
    //   3. 表现为"第二句话/第二个挂件前端丢失"
    // 现在使用递增子序号 `TH-msg-iframe-${messageIndex}-${subIdx}` 确保唯一
    const baseMsgId = messageIndex !== undefined ? `TH-msg-iframe-${messageIndex}` : `TH-msg-iframe-temp`;
    let iframeSubIdx = 0;
    const nextIframeId = () => `${baseMsgId}-${iframeSubIdx++}`;

    if (isStreamingLastMsg) {
      const getLoadingPlaceholder = (iframeId: string) => {
        return `<div id="${iframeId}-placeholder" class="mvu-loading-placeholder" style="padding:12px;border:1px dashed rgba(168,162,158,0.3);border-radius:8px;color:#a8a29e;font-size:12px;display:flex;align-items:center;gap:8px;margin:8px 0;font-family:sans-serif;background:transparent;">
          <span style="width:12px;height:12px;border:2px solid #a8a29e;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;"></span>
          正在生成交互界面...
          <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        </div>`;
      };

      // 先处理显式 ```html 块
      const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/gi;
      processed = processed.replace(htmlCodeBlockRegex, () => {
        return getLoadingPlaceholder(nextIframeId());
      });

      // 再处理普通 ``` 块，且以 < 开头
      const plainCodeBlockRegex = /```\s*([\s\S]*?)\s*```/g;
      processed = processed.replace(plainCodeBlockRegex, (_match, codeContent) => {
        const trimmedContent = codeContent.trim();
        if (trimmedContent.startsWith("<")) {
          return getLoadingPlaceholder(nextIframeId());
        }
        return _match;
      });
    } else {
      // 先处理显式 ```html 块
      const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/gi;
      processed = processed.replace(htmlCodeBlockRegex, (_match, htmlContent) => {
        const cleanedHtml = stripGuiWrapper(htmlContent);
        const compiledSrcdoc = compatibilityRenderer?.createMessageIframeSrcDoc(
          cleanedHtml,
          messageIndex,
          loopGuard,
          scriptSecurityMode,
        ) ?? cleanedHtml;
        const iframeId = nextIframeId();
        // 关键：用 store 策略替代 data-srcdoc 属性，彻底绕开 Android WebView
        // DOMParser 对含 < 字符的超长 attribute 值的截断 bug。
        const storeKey = `th-srcdoc-${iframeId}-${Date.now()}`;
        storeFormattedTextSrcdoc(storeKey, compiledSrcdoc);
        return `<iframe id="${iframeId}" name="${iframeId}" data-th-srcdoc-id="${storeKey}" style="width: 100%; min-height: 0; border: none; display: block; background: transparent; background-color: transparent; will-change: transform; transform: translate3d(0, 0, 0);" allowtransparency="true" class="w-full mvu-message-iframe"></iframe>`;
      });

      // 再处理普通 ``` 块，但仅当内容以 HTML 标签开头时才转为 iframe
      const plainCodeBlockRegex = /```\s*([\s\S]*?)\s*```/g;
      processed = processed.replace(plainCodeBlockRegex, (_match, codeContent) => {
        const trimmedContent = codeContent.trim();
        // 内容以 < 开头（HTML 标签），当作 HTML 渲染
        if (trimmedContent.startsWith("<")) {
          const cleanedHtml = stripGuiWrapper(trimmedContent);
          const compiledSrcdoc = compatibilityRenderer?.createMessageIframeSrcDoc(
            cleanedHtml,
            messageIndex,
            loopGuard,
            scriptSecurityMode,
          ) ?? cleanedHtml;
          const iframeId = nextIframeId();
          const storeKey = `th-srcdoc-${iframeId}-${Date.now()}`;
          storeFormattedTextSrcdoc(storeKey, compiledSrcdoc);
          return `<iframe id="${iframeId}" name="${iframeId}" data-th-srcdoc-id="${storeKey}" style="width: 100%; min-height: 0; border: none; display: block; background: transparent; background-color: transparent; will-change: transform; transform: translate3d(0, 0, 0);" allowtransparency="true" class="w-full mvu-message-iframe"></iframe>`;
        }
        // 非 HTML 内容：保持原始代码块渲染
        return _match;
      });
    }
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

interface LocalErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface LocalErrorBoundaryState {
  hasError: boolean;
}

export class LocalErrorBoundary extends React.Component<LocalErrorBoundaryProps, LocalErrorBoundaryState> {
  state: LocalErrorBoundaryState = { hasError: false };

  constructor(props: LocalErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(): LocalErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[LocalErrorBoundary] Message render error caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

