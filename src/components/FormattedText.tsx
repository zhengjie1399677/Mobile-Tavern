import React, { useContext } from "react";
import DOMPurify from "dompurify";
import { AppContext } from "../AppContext";

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
]);

// Whitelist of safe tag attributes
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  global: new Set(["class", "classname", "style", "title"]),
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  table: new Set(["border", "cellpadding", "cellspacing"]),
};

function renderTextNode(textVal: string): React.ReactNode {
  if (!/(\*\*|\*)/.test(textVal)) {
    return textVal;
  }
  const parts = textVal.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-bold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <span
          key={index}
          className="text-muted-foreground/85 italic font-light text-[13px] leading-relaxed mx-0.5"
        >
          {part.slice(1, -1)}
        </span>
      );
    }
    return part;
  });
}

function domToReact(node: Node, index: number): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return renderTextNode(node.nodeValue || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();

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
    return Array.from(element.childNodes).map((child, i) => domToReact(child, i));
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
        if (/^(https?:\/\/|data:|blob:|\/)/i.test(val)) {
          props.src = val;
        }
      } else {
        props[name] = val;
      }
    }
  }

  const children = Array.from(element.childNodes).map((child, i) => domToReact(child, i));
  return React.createElement(
    tagName,
    props,
    children.length > 0 ? children : null,
  );
}

function parseSafeHtmlToReact(html: string): React.ReactNode {
  try {
    // DOMPurify 消毒防止 XSS：移除 script/iframe/事件属性等危险内容
    const sanitized = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        "p", "br", "b", "i", "em", "strong", "u", "s", "del", "ins",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "dl", "dt", "dd",
        "blockquote", "pre", "code", "hr",
        "a", "span", "div", "font",
        "table", "thead", "tbody", "tr", "th", "td",
        "img", "sub", "sup", "small", "mark", "ruby", "rt", "rp",
      ],
      ALLOWED_ATTR: [
        "href", "title", "target", "rel",
        "src", "alt", "width", "height",
        "class", "id", "style",
        "colspan", "rowspan",
      ],
      ALLOW_DATA_ATTR: false,
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${sanitized}</div>`, "text/html");
    const container = doc.body.firstChild;
    if (!container) return html;

    return Array.from(container.childNodes).map((child, i) => domToReact(child, i));
  } catch (err) {
    console.error("Failed to parse HTML safely:", err);
    return html;
  }
}

export default function FormattedText({
  text,
  charName,
  userName = "你",
  className = "",
}: FormattedTextProps) {
  if (!text) return null;

  const context = useContext(AppContext);
  const enableHtml = context?.settings?.enableHtmlRendering ?? true;

  // Replace placeholders dynamically
  const processed = text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/<BOT>/gi, charName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<USER>/gi, userName);

  // Quick detection: if text contains tags and html rendering is active, use DOM parser
  const hasHtml = enableHtml && /<[a-z/][\s\S]*?>/i.test(processed);

  if (hasHtml) {
    return (
      <span className={`block whitespace-pre-wrap leading-relaxed ${className}`}>
        {parseSafeHtmlToReact(processed)}
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
            <strong key={index} className="font-bold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        } else if (part.startsWith("*") && part.endsWith("*")) {
          return (
            <span
              key={index}
              className="text-muted-foreground/80 italic font-light text-[13px] leading-relaxed mx-0.5"
            >
              {part.slice(1, -1)}
            </span>
          );
        }
        return (
          <span key={index} className="text-foreground font-normal">
            {part}
          </span>
        );
      })}
    </span>
  );
}
