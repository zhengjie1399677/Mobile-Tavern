/**
 * 错误对象工具：用于配合 `catch (e: unknown)` 的 narrowing。
 *
 * 设计动机：见 AGENTS.md "核心行为准则十二"。`catch (e: unknown)` 全面替换为
 * `catch (e: unknown)` 后，原先直接访问 `e.message` / `e.name` 的位置需要
 * 类型安全的辅助函数，避免在每个 catch 块重复写 `e instanceof Error ? e.message : String(e)`。
 */

/**
 * 安全提取错误信息字符串。
 *
 * 与 `e.message` 的差异：
 * - 当 e 不是 Error 实例（如 throw "字符串" / throw 42 / throw {}）时，返回 String(e)
 * - 当 e 为 Error 实例但 message 为空时，返回 "[object Object]" 等兜底字符串
 *
 * 使用场景：
 * ```ts
 * try { ... } catch (e: unknown) {
 *   showCustomAlert(t("chat.save_session_failed", { error: getErrorMessage(e) }));
 * }
 * ```
 */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.message && e.message.trim().length > 0) {
      return e.message;
    }
    return e.name || "Error";
  }
  if (typeof e === "string") {
    return e;
  }
  if (e === null) {
    return "null";
  }
  if (e === undefined) {
    return "undefined";
  }
  if (typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.trim().length > 0) {
      return obj.message;
    }
    if (typeof obj.error === "string" && obj.error.trim().length > 0) {
      return obj.error;
    }
    if (
      typeof obj.error === "object" &&
      obj.error !== null &&
      "message" in (obj.error as Record<string, unknown>) &&
      typeof (obj.error as Record<string, unknown>).message === "string" &&
      ((obj.error as Record<string, unknown>).message as string).trim().length > 0
    ) {
      return ((obj.error as Record<string, unknown>).message as string);
    }
    if (typeof obj.reason === "string" && obj.reason.trim().length > 0) {
      return obj.reason;
    }
    if (typeof obj.status === "number") {
      const statusText = typeof obj.statusText === "string" && obj.statusText.trim().length > 0 ? ` ${obj.statusText}` : "";
      return `HTTP ${obj.status}${statusText}`;
    }
    try {
      const serialized = JSON.stringify(e);
      if (serialized && serialized !== "{}") {
        return serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
      }
    } catch {
      // 循环引用等序列化失败兜底
    }
    const keys = Object.keys(obj);
    if (keys.length > 0) {
      return `[Object with keys: ${keys.slice(0, 10).join(", ")}]`;
    }
  }
  return String(e);
}

/**
 * 安全提取错误的详细诊断信息（包含 message 与 stack 等调试线索）。
 */
export function getErrorDetail(e: unknown): string {
  const msg = getErrorMessage(e);
  let stack = "";
  if (e instanceof Error && typeof e.stack === "string") {
    stack = e.stack;
  } else if (typeof e === "object" && e !== null && "stack" in e && typeof (e as Record<string, unknown>).stack === "string") {
    stack = (e as Record<string, unknown>).stack as string;
  }
  if (!stack || stack.includes(msg)) {
    return stack || msg;
  }
  return `${msg}\nStack: ${stack}`;
}

/**
 * 安全提取错误名称（如 "AbortError" / "TypeError" 等）。
 *
 * 使用场景：
 * ```ts
 * try { ... } catch (e: unknown) {
 *   if (getErrorName(e) === "AbortError") { ... }
 * }
 * ```
 */
export function getErrorName(e: unknown): string {
  if (e instanceof Error) {
    return e.name;
  }
  return "";
}

/**
 * 判断错误是否为指定名称（如 "AbortError" / "DOMException"）。
 *
 * 与 `e.name === "X"` 的差异：自动处理 e 非 Error 实例的情况，避免运行时访问 undefined。
 */
export function isErrorNamed(e: unknown, name: string): boolean {
  return e instanceof Error && e.name === name;
}
