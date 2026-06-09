import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { createMessageIframeSrcDoc } from "../utils/tavernHelperBridge";

interface FormattedTextProps {
  text: string;
  charName: string;
  userName?: string;
  className?: string;
}

function parseStyleString(styleStr: string): React.CSSProperties {
  const styles: Record<string, string> = {};
  if (!styleStr) return styles;

  styleStr.split(";").forEach((rule) => {
    const idx = rule.indexOf(":");
    if (idx !== -1) {
      const key = rule
        .slice(0, idx)
        .trim()
        .replace(/-([a-z])/g, (g) => g[1].toUpperCase());
      const val = rule.slice(idx + 1).trim();
      // Ensure no css expression or javascript protocols in style values
      if (!/javascript:|expression|behaviour/i.test(val)) {
        styles[key] = val;
      }
    }
  });
  return styles as React.CSSProperties;
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

function resolveExpressionUrl(srcVal: string, activeCharacter: any): string {
  if (!srcVal || !activeCharacter) return srcVal;
  
  if (srcVal.toLowerCase().startsWith("avatar://")) {
    return activeCharacter.avatar || "";
  }
  
  if (srcVal.toLowerCase().startsWith("expression://")) {
    const exprName = srcVal.slice("expression://".length).trim().toLowerCase();
    
    const ext = activeCharacter.extensions || {};
    const rawStyle = ext.style || ext.character_style || {};
    const expressions = activeCharacter.visualSettings?.expressions || rawStyle.expressions || ext.expressions || {};
    
    if (Array.isArray(expressions)) {
      const match = expressions.find((e: any) => e && e.name && e.name.toLowerCase() === exprName);
      if (match && match.image) return match.image;
    } else if (expressions && typeof expressions === "object") {
      const match = Object.entries(expressions).find(([k]) => k.toLowerCase() === exprName);
      if (match) return match[1] as string;
    }
    
    // Fallback to default avatar
    return activeCharacter.avatar || "";
  }
  
  return srcVal;
}

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
  activeCharacter: any
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
      domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter)
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
    props.sandbox = "allow-scripts allow-same-origin allow-modals";
  }

  const children = Array.from(element.childNodes).map((child, i) => 
    domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter)
  );
  return React.createElement(
    tagName,
    props,
    children.length > 0 ? children : null,
  );
}

function parseSafeHtmlToReact(
  html: string, 
  enableAsteriskFormatting: boolean,
  enableScriptExecution: boolean,
  activeCharacter: any
): React.ReactNode {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const container = doc.body.firstChild;
    if (!container) return html;

    return Array.from(container.childNodes).map((child, i) => 
      domToReact(child, i, enableAsteriskFormatting, enableScriptExecution, activeCharacter)
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
  enableScriptExecution: boolean
): string {
  if (!text) return "";

  // 1. Standard template placeholders
  let processed = text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/<BOT>/gi, charName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<USER>/gi, userName);

  // 2. SillyTavern Regex Script Extensions matching
  if (enableScriptExecution && activeCharacter?.extensions?.regex_scripts) {
    const scripts = activeCharacter.extensions.regex_scripts;
    for (const script of scripts) {
      if (script.disabled) continue;
      if (script.promptOnly) continue;

      const placement = script.placement;
      if (Array.isArray(placement) && !placement.includes(1) && !placement.includes(2)) {
        continue;
      }

      const findRegex = script.findRegex;
      const replaceString = script.replaceString || "";
      if (!findRegex) continue;

      try {
        let regex: RegExp;
        const match = findRegex.match(/^\/(.*)\/([gimsuy]*)$/);
        if (match) {
          regex = new RegExp(match[1], match[2]);
        } else {
          // SillyTavern Regex scripts are always regular expressions.
          // If they don't start with slashes, they should be compiled as RegExp directly without escaping.
          // We default to global 'g' and case-insensitive 'i' for compatibility.
          regex = new RegExp(findRegex, "gi");
        }
        processed = processed.replace(regex, replaceString);
      } catch (err) {
        console.warn("Failed to apply regex script:", findRegex, err);
      }
    }
  }

  // 3. Wrap ```html ... ``` blocks in sandboxed iframes
  if (enableScriptExecution) {
    const codeBlockRegex = /```html\s*([\s\S]*?)\s*```/gi;
    processed = processed.replace(codeBlockRegex, (match, htmlContent) => {
      // Compile into standard message iframe wrapper
      const compiledSrcdoc = createMessageIframeSrcDoc(htmlContent);
      const escapedHtml = compiledSrcdoc
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      // CRITICAL: Do NOT set a fixed height here.
      // React re-renders on every streaming token (~60ms) and would override
      // any height set by the iframe's auto-height script via window.frameElement.
      // By only setting min-height (not height), React won't touch the actual
      // rendered height, so the iframe can grow freely via the internal script.
      return `<iframe srcdoc="${escapedHtml}" style="width: 100%; min-height: 400px; border: none; display: block;" class="w-full mvu-message-iframe"></iframe>`;
    });
  }

  return processed;
}

export default function FormattedText({
  text,
  charName,
  userName = "user",
  className = "",
}: FormattedTextProps) {
  if (!text) return null;

  const context = useContext(AppContext);
  const enableHtml = context?.settings?.enableHtmlRendering ?? true;
  const enableScriptExecution = !!context?.settings?.enableScriptExecution;
  const activeCharacter = context?.activeCharacter;
  const enableAsteriskFormatting = !!activeCharacter?.visualSettings?.enableAsteriskFormatting;

  const processed = preprocessFormattedText(
    text,
    charName,
    userName,
    activeCharacter,
    enableScriptExecution
  );

  // Quick detection: if text contains tags and html rendering is active, use DOM parser
  const hasHtml = enableHtml && /<[a-z/][\s\S]*?>/i.test(processed);

  if (hasHtml) {
    return (
      <span className={`block whitespace-pre-wrap leading-relaxed ${className}`}>
        {parseSafeHtmlToReact(processed, enableAsteriskFormatting, enableScriptExecution, activeCharacter)}
      </span>
    );
  }

  // Fast-path Markdown parsing for pure text messages
  const parts = processed.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);

  return (
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
