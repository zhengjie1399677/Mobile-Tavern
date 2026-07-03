export function sanitizeCss(css: string): string {
  if (!css) return "";

  // 1. 移除 </style> 和 <script> 标签，防止 HTML 注入攻击
  let sanitized = css
    .replace(/<\/style>/gi, "")
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<script/gi, "");

  // 2. 过滤 @import 语句，防止加载不受信任的外部 CSS
  sanitized = sanitized.replace(/@import\b/gi, "/* import blocked */");

  // 3. 过滤 url(...) 引用，防止通过 CSS 键盘记录泄漏敏感信息
  sanitized = sanitized.replace(/url\s*\(([^)]*)\)/gi, "/* url blocked */");

  // 4. 过滤 position: fixed 属性，防止全局覆盖型点击劫持
  sanitized = sanitized.replace(/position\s*:\s*fixed\b/gi, "position: absolute /* fixed blocked */");

  // 5. 过滤动态表达式与绑定属性
  sanitized = sanitized.replace(/expression\s*\(([^)]*)\)/gi, "/* expr blocked */");
  sanitized = sanitized.replace(/-moz-binding/gi, "/* -moz-binding blocked */");
  sanitized = sanitized.replace(/behavior\s*:/gi, "/* behavior blocked */");

  return sanitized;
}
