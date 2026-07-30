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
    return e.message;
  }
  if (typeof e === "string") {
    return e;
  }
  return String(e);
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
