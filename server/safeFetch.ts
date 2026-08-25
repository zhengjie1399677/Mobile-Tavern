import { validateBaseUrlSecurity } from "./security";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = ["authorization", "proxy-authorization", "cookie"];

export interface SafeFetchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly validateUrl?: (url: string) => Promise<void>;
  readonly maxRedirects?: number;
}

function redirectedRequestInit(
  response: Response,
  currentUrl: URL,
  nextUrl: URL,
  currentInit: RequestInit,
): RequestInit {
  const headers = new Headers(currentInit.headers);
  if (currentUrl.origin !== nextUrl.origin) {
    for (const name of SENSITIVE_HEADERS) headers.delete(name);
  }

  const method = (currentInit.method || "GET").toUpperCase();
  const switchToGet = response.status === 303
    || ((response.status === 301 || response.status === 302) && method === "POST");
  if (switchToGet) {
    headers.delete("content-type");
    headers.delete("content-length");
    return { ...currentInit, method: "GET", headers, body: undefined };
  }
  return { ...currentInit, headers };
}

/**
 * Node 代理专用 fetch：关闭自动重定向，并在每一跳发出请求前重新执行 SSRF 校验。
 */
export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const validateUrl = options.validateUrl ?? validateBaseUrlSecurity;
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = new URL(input);
  let currentInit: RequestInit = { ...init, redirect: "manual" };

  for (let redirectCount = 0; ; redirectCount += 1) {
    await validateUrl(currentUrl.href);
    const response = await fetchImpl(currentUrl, currentInit);
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    await response.body?.cancel().catch(() => undefined);
    if (redirectCount >= maxRedirects) throw new Error("TOO_MANY_REDIRECTS");
    const nextUrl = new URL(location, currentUrl);
    currentInit = {
      ...redirectedRequestInit(response, currentUrl, nextUrl, currentInit),
      redirect: "manual",
    };
    currentUrl = nextUrl;
  }
}
