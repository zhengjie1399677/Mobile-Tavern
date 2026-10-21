/**
 * Tool 执行结果的展示格式化。
 *
 * 目的：用户点「插入输入框」时只应拿到数据本身，而不是 Host 的执行信封。
 * 当前 Tool Plugin 的 HTTP handler 返回 `{ status, contentType, body }`，
 * 直接字符串化会把 `200`、`application/json` 一起塞进对话 —— 这里统一剥掉。
 *
 * 未知结构保持原样可见（pretty JSON），不做猜测性裁剪；失败状态单独成行，
 * 避免把 4xx 响应伪装成正常数据。
 */
export interface HttpEnvelopeLike {
  readonly status?: unknown;
  readonly contentType?: unknown;
  readonly body?: unknown;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 字符串若是 JSON 文本则展开，否则原样返回。 */
function expandJsonText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return pretty(JSON.parse(trimmed));
  } catch {
    return text;
  }
}

function formatHttpBody(body: unknown): string {
  if (typeof body === "string") return expandJsonText(body);
  if (body === undefined || body === null) return "";
  return pretty(body);
}

export function formatAgentToolResult(result: unknown): string {
  if (typeof result === "string") return expandJsonText(result);
  if (Array.isArray(result)) return pretty(result);
  if (!result || typeof result !== "object") return String(result);

  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;

  // MCP 风格内容块
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((block) => (
        block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text
          : ""
      ))
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  // Host 的 HTTP 执行信封
  if ("body" in record) {
    const body = formatHttpBody(record.body);
    const status = typeof record.status === "number" ? record.status : undefined;
    if (status !== undefined && status >= 400) {
      return `请求失败（HTTP ${status}）${body ? `\n\n${body}` : ""}`;
    }
    return body;
  }

  if ("data" in record) return formatAgentToolResult(record.data);
  return pretty(result);
}

/**
 * 从结果文本里提取可继续处理的 URL（用于「搜索 → 抓取」接力）。
 * 去重、去掉尾部标点，最多返回 `max` 条。
 */
export function extractResultUrls(text: string, max = 3): string[] {
  const matches = text.match(/https?:\/\/[^\s"'`<>）)】\]，。；、]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= max) break;
  }
  return urls;
}
