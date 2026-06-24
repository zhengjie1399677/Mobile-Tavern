export function sanitizeCss(css: string): string {
  if (!css) return "";

  // 1. Remove </style> and <script> tags to prevent HTML injection
  let sanitized = css
    .replace(/<\/style>/gi, "")
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<script/gi, "");

  // 2. Filter @import statements to prevent loading untrusted CSS
  sanitized = sanitized.replace(/@import\b/gi, "/* import blocked */");

  // 3. Filter url(...) to prevent leaking info via CSS Keylogging
  sanitized = sanitized.replace(/url\s*\(([^)]*)\)/gi, "/* url blocked */");

  // 4. Filter position: fixed to prevent Global overlay clickjacking
  sanitized = sanitized.replace(/position\s*:\s*fixed\b/gi, "position: absolute /* fixed blocked */");

  // 5. Filter expression/binding properties
  sanitized = sanitized.replace(/expression\s*\(([^)]*)\)/gi, "/* expr blocked */");
  sanitized = sanitized.replace(/-moz-binding/gi, "/* -moz-binding blocked */");
  sanitized = sanitized.replace(/behavior\s*:/gi, "/* behavior blocked */");

  return sanitized;
}
