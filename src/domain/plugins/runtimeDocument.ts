import type { InstalledFullscreenPlugin } from "./types";

const TEXT_RESOURCE_PATTERN = /\.(?:css|js)$/i;

export interface PluginRuntimeDocument {
  url: string;
  revoke(): void;
}

export async function createPluginRuntimeDocument(
  plugin: InstalledFullscreenPlugin,
  channel: string
): Promise<PluginRuntimeDocument> {
  const createdUrls: string[] = [];
  const createUrl = (data: BlobPart[], type: string) => {
    const url = URL.createObjectURL(new Blob(data, { type }));
    createdUrls.push(url);
    return url;
  };

  try {
    const entryPath = plugin.manifest.entry;
    const entryText = decodeUtf8(plugin.files[entryPath], entryPath);

    // 先扫描入口与被引用 CSS，仅收集实际被引用的资源路径，避免对未引用素材（多套皮肤、未触发分支）做 base64 编码。
    const referenced = collectReferencedResources(entryText, entryPath, plugin.files);

    const embeddedResources = new Map<string, string>();
    for (const path of referenced.binary) {
      const data = plugin.files[path];
      if (data) embeddedResources.set(path, await dataUrl(data, mimeType(path)));
    }

    const textResources = new Map<string, string>();
    for (const path of referenced.text) {
      const raw = decodeUtf8(plugin.files[path], path);
      textResources.set(path, rewriteResourceReferences(raw, path, embeddedResources));
    }

    const rewritten = rewriteResourceReferences(entryText, entryPath, embeddedResources);
    const selfContained = inlineTextResources(rewritten, entryPath, textResources);
    const secured = injectRuntime(selfContained, plugin.id, channel);
    const url = createUrl([secured], "text/html;charset=utf-8");
    return {
      url,
      revoke() {
        for (const created of createdUrls.splice(0)) URL.revokeObjectURL(created);
      },
    };
  } catch (error) {
    for (const created of createdUrls) URL.revokeObjectURL(created);
    throw error;
  }
}

function injectRuntime(html: string, pluginId: string, channel: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  const bridge = `<script>${bridgeSource(JSON.stringify(pluginId), JSON.stringify(channel))}</script>`;
  const sanitized = html
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
  const injection = `${csp}${bridge}`;
  if (/<head\b[^>]*>/i.test(sanitized)) {
    return sanitized.replace(/<head\b[^>]*>/i, (head) => `${head}${injection}`);
  }
  return `<!doctype html><html><head>${injection}</head><body>${sanitized}</body></html>`;
}

function inlineTextResources(html: string, entryPath: string, resources: Map<string, string>): string {
  const withStyles = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = readAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = readAttribute(tag, "href");
    if (!href || !rel.includes("stylesheet")) return tag;
    const path = resolvePackageReference(entryPath, href);
    const css = path ? resources.get(path) : undefined;
    if (!css || !path.toLowerCase().endsWith(".css")) return tag;
    return `<style data-mobile-tavern-source="${escapeAttribute(path)}">${escapeInlineEndTag(css, "style")}</style>`;
  });

  return withStyles.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (tag) => {
    const src = readAttribute(tag, "src");
    if (!src) return tag;
    const path = resolvePackageReference(entryPath, src);
    const script = path ? resources.get(path) : undefined;
    if (!script || !path.toLowerCase().endsWith(".js")) return tag;
    return `<script data-mobile-tavern-source="${escapeAttribute(path)}">${escapeInlineEndTag(script, "script")}</script>`;
  });
}

function readAttribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function resolvePackageReference(sourcePath: string, reference: string): string | undefined {
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean || clean.startsWith("#") || clean.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(clean)) return undefined;
  const segments = clean.startsWith("/") ? [] : sourcePath.split("/").slice(0, -1);
  for (const segment of clean.replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeInlineEndTag(value: string, tag: "script" | "style"): string {
  return value.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_YIELD_BYTES = 256 * 1024;

async function encodeBase64(data: Uint8Array): Promise<string> {
  const length = data.byteLength;
  // 直接基于 Uint8Array 编码，消除 String.fromCharCode+btoa 的 binary string 中间层，内存由三份降为两份。
  const out: string[] = new Array(Math.ceil(length / 3) * 4);
  let outIdx = 0;
  let i = 0;
  let sinceYield = 0;
  const fullTriplets = length - (length % 3);
  while (i < fullTriplets) {
    const b0 = data[i];
    const b1 = data[i + 1];
    const b2 = data[i + 2];
    out[outIdx++] = BASE64_ALPHABET[b0 >> 2];
    out[outIdx++] = BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out[outIdx++] = BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)];
    out[outIdx++] = BASE64_ALPHABET[b2 & 63];
    i += 3;
    sinceYield += 3;
    if (sinceYield >= BASE64_YIELD_BYTES) {
      sinceYield = 0;
      await yieldToEventLoop();
    }
  }
  const remainder = length - i;
  if (remainder === 1) {
    const b0 = data[i];
    out[outIdx++] = BASE64_ALPHABET[b0 >> 2];
    out[outIdx++] = BASE64_ALPHABET[(b0 & 3) << 4];
    out[outIdx++] = "=";
    out[outIdx++] = "=";
  } else if (remainder === 2) {
    const b0 = data[i];
    const b1 = data[i + 1];
    out[outIdx++] = BASE64_ALPHABET[b0 >> 2];
    out[outIdx++] = BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out[outIdx++] = BASE64_ALPHABET[(b1 & 15) << 2];
    out[outIdx++] = "=";
  }
  return out.join("");
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function dataUrl(data: Uint8Array, type: string): Promise<string> {
  return `data:${type};base64,${await encodeBase64(data)}`;
}

function bridgeSource(pluginId: string, channel: string): string {
  return `(()=>{'use strict';const pluginId=${pluginId};const channel=${channel};let seq=0;const pending=new Map();const call=(method,params)=>new Promise((resolve,reject)=>{const requestId=String(++seq);pending.set(requestId,{resolve,reject});parent.postMessage({mtPlugin:1,channel,pluginId,requestId,method,params},'*');setTimeout(()=>{if(pending.delete(requestId))reject(new Error('HOST_TIMEOUT'))},10000)});addEventListener('message',event=>{const message=event.data;if(!message||message.mtPlugin!==1||message.channel!==channel)return;if(message.type==='response'){const item=pending.get(message.requestId);if(!item)return;pending.delete(message.requestId);message.ok?item.resolve(message.result):item.reject(new Error(message.error||'HOST_ERROR'))}else if(message.type==='lifecycle'){dispatchEvent(new CustomEvent('mobile-tavern:lifecycle',{detail:message.event}))}});addEventListener('click',event=>{const anchor=event.target&&event.target.closest?event.target.closest('a[href]'):null;if(anchor)event.preventDefault()},true);addEventListener('submit',event=>event.preventDefault(),true);Object.defineProperty(window,'MobileTavernPlugin',{value:Object.freeze({version:1,ready:()=>call('host.ready'),exit:()=>call('host.exit'),setOrientation:orientation=>call('host.orientation',{orientation}),save:(slot,data)=>call('storage.save',{slot,data}),load:slot=>call('storage.load',{slot}),deleteSave:slot=>call('storage.delete',{slot})}),writable:false,configurable:false});call('host.ready').catch(()=>{})})();`;
}

function rewriteResourceReferences(text: string, sourcePath: string, urls: Map<string, string>): string {
  if (urls.size === 0) return text;
  const pathToUrl = new Map<string, string>();
  for (const target of urls.keys()) {
    const url = urls.get(target)!;
    pathToUrl.set(target, url);
    pathToUrl.set(`/${target}`, url);
    const relative = relativePath(sourcePath, target);
    pathToUrl.set(relative, url);
    if (!relative.startsWith("../")) pathToUrl.set(`./${relative}`, url);
  }
  // 单次 alternation 正则替代 N 次 split/join 全文扫描，复杂度由 O(R×4×L) 降为 O(L)；
  // 按长度降序避免短路径误匹配长路径子串，转义正则元字符。保持全局替换语义以兼容 JS 字符串字面量引用。
  const alternation = [...pathToUrl.keys()]
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|");
  const pattern = new RegExp(alternation, "g");
  return text.replace(pattern, (matched) => pathToUrl.get(matched) ?? matched);
}

function relativePath(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.split("/");
  while (from.length > 0 && to.length > 0 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return `${"../".repeat(from.length)}${to.join("/")}` || "./";
}

function decodeUtf8(data: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new Error(`PLUGIN_TEXT_INVALID_UTF8:${path}`);
  }
}

function mimeType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html;charset=utf-8", htm: "text/html;charset=utf-8",
    css: "text/css;charset=utf-8", js: "text/javascript;charset=utf-8",
    json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
    mp4: "video/mp4", webm: "video/webm", woff: "font/woff", woff2: "font/woff2",
    ttf: "font/ttf", otf: "font/otf",
  };
  return types[extension ?? ""] ?? "application/octet-stream";
}

interface ReferencedResources {
  text: Set<string>;
  binary: Set<string>;
}

function collectReferencedResources(
  entryText: string,
  entryPath: string,
  files: Record<string, Uint8Array>
): ReferencedResources {
  const text = new Set<string>();
  const binary = new Set<string>();
  const visitedText = new Set<string>();
  const queue: string[] = [];

  scanHtmlForReferences(entryText, entryPath, text, binary, queue);

  // 递归扫描被引用的 CSS 内部 url()/@import；JS 不递归，与现有 CSP 下动态加载非 data: URL 必败的行为一致。
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (visitedText.has(path)) continue;
    visitedText.add(path);
    const data = files[path];
    if (!data) continue;
    if (path.toLowerCase().endsWith(".css")) {
      scanCssForReferences(decodeUtf8(data, path), path, text, binary, queue);
    }
  }

  return { text, binary };
}

const HTML_REF_PATTERN = /\b(?:href|src|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function scanHtmlForReferences(
  html: string,
  sourcePath: string,
  text: Set<string>,
  binary: Set<string>,
  queue: string[]
): void {
  // 剥离 <script>...</script> 的内部 JS 内容，但保留开标签（含 src 属性），避免误判 JS 字符串为引用、同时不漏掉 script[src]。
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (match) => {
    const openTag = match.match(/<script\b[^>]*>/i);
    return openTag ? openTag[0] : "";
  });
  for (const match of stripped.matchAll(HTML_REF_PATTERN)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    // srcset 可含逗号分隔与描述符，取首段 URL。
    const cleaned = raw.split(",")[0].trim().split(/\s+/)[0];
    const resolved = resolvePackageReference(sourcePath, cleaned);
    if (!resolved) continue;
    classifyReference(resolved, text, binary, queue);
  }
}

const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+))\s*\)/gi;
const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi;

function scanCssForReferences(
  css: string,
  sourcePath: string,
  text: Set<string>,
  binary: Set<string>,
  queue: string[]
): void {
  for (const match of css.matchAll(CSS_URL_PATTERN)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    const cleaned = raw.split("?")[0].split("#")[0].trim();
    const resolved = resolvePackageReference(sourcePath, cleaned);
    if (!resolved) continue;
    classifyReference(resolved, text, binary, queue);
  }
  for (const match of css.matchAll(CSS_IMPORT_PATTERN)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    const resolved = resolvePackageReference(sourcePath, raw);
    if (!resolved) continue;
    classifyReference(resolved, text, binary, queue);
  }
}

function classifyReference(
  path: string,
  text: Set<string>,
  binary: Set<string>,
  queue: string[]
): void {
  if (TEXT_RESOURCE_PATTERN.test(path)) {
    if (!text.has(path)) {
      text.add(path);
      queue.push(path);
    }
  } else {
    binary.add(path);
  }
}
