import type { InstalledFullscreenPlugin } from "./types";

const TEXT_RESOURCE_PATTERN = /\.(?:css|js)$/i;

export interface PluginRuntimeDocument {
  url: string;
  revoke(): void;
}

export function createPluginRuntimeDocument(
  plugin: InstalledFullscreenPlugin,
  channel: string
): PluginRuntimeDocument {
  const embeddedResources = new Map<string, string>();
  const textResources = new Map<string, string>();
  const createdUrls: string[] = [];
  const createUrl = (data: BlobPart[], type: string) => {
    const url = URL.createObjectURL(new Blob(data, { type }));
    createdUrls.push(url);
    return url;
  };

  try {
    for (const [path, data] of Object.entries(plugin.files)) {
      if (path === plugin.manifest.entry || path === "manifest.json" || TEXT_RESOURCE_PATTERN.test(path)) continue;
      embeddedResources.set(path, dataUrl(data, mimeType(path)));
    }
    for (const [path, data] of Object.entries(plugin.files)) {
      if (path === plugin.manifest.entry || !TEXT_RESOURCE_PATTERN.test(path)) continue;
      const text = decodeUtf8(data, path);
      textResources.set(path, rewriteResourceReferences(text, path, embeddedResources));
    }

    const entry = decodeUtf8(plugin.files[plugin.manifest.entry], plugin.manifest.entry);
    const rewritten = rewriteResourceReferences(entry, plugin.manifest.entry, embeddedResources);
    const selfContained = inlineTextResources(rewritten, plugin.manifest.entry, textResources);
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

function dataUrl(data: Uint8Array, type: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function bridgeSource(pluginId: string, channel: string): string {
  return `(()=>{'use strict';const pluginId=${pluginId};const channel=${channel};let seq=0;const pending=new Map();const call=(method,params)=>new Promise((resolve,reject)=>{const requestId=String(++seq);pending.set(requestId,{resolve,reject});parent.postMessage({mtPlugin:1,channel,pluginId,requestId,method,params},'*');setTimeout(()=>{if(pending.delete(requestId))reject(new Error('HOST_TIMEOUT'))},10000)});addEventListener('message',event=>{const message=event.data;if(!message||message.mtPlugin!==1||message.channel!==channel)return;if(message.type==='response'){const item=pending.get(message.requestId);if(!item)return;pending.delete(message.requestId);message.ok?item.resolve(message.result):item.reject(new Error(message.error||'HOST_ERROR'))}else if(message.type==='lifecycle'){dispatchEvent(new CustomEvent('mobile-tavern:lifecycle',{detail:message.event}))}});addEventListener('click',event=>{const anchor=event.target&&event.target.closest?event.target.closest('a[href]'):null;if(anchor)event.preventDefault()},true);addEventListener('submit',event=>event.preventDefault(),true);Object.defineProperty(window,'MobileTavernPlugin',{value:Object.freeze({version:1,ready:()=>call('host.ready'),exit:()=>call('host.exit'),setOrientation:orientation=>call('host.orientation',{orientation}),save:(slot,data)=>call('storage.save',{slot,data}),load:slot=>call('storage.load',{slot}),deleteSave:slot=>call('storage.delete',{slot})}),writable:false,configurable:false});call('host.ready').catch(()=>{})})();`;
}

function rewriteResourceReferences(text: string, sourcePath: string, urls: Map<string, string>): string {
  let result = text;
  for (const [targetPath, url] of urls) {
    const relative = relativePath(sourcePath, targetPath);
    const candidates = [...new Set([targetPath, `/${targetPath}`, relative, relative.startsWith("../") ? relative : `./${relative}`])]
      .sort((left, right) => right.length - left.length);
    for (const candidate of candidates) {
      result = result.split(candidate).join(url);
    }
  }
  return result;
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
