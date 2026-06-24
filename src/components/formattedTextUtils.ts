/**
 * FormattedText 纯函数工具集
 *
 * 从 FormattedText.tsx 抽取的纯函数，不依赖 React 渲染，
 * 可在 Node / Vitest 环境下直接 import 并进行单元测试。
 */

/**
 * 解析 CSS 内联样式字符串为对象
 *
 * 安全过滤：自动拦截 `javascript:` / `expression` / `behaviour` 等恶意值。
 */
export function parseStyleString(styleStr: string): Record<string, string> {
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
      if (!/javascript:|expression|behaviour/i.test(val)) {
        styles[key] = val;
      }
    }
  });
  return styles;
}

/**
 * 解析角色卡专用的自定义协议 URL
 *
 * 支持协议：
 * - `avatar://` → 解析为角色卡主头像
 * - `expression://<name>` → 解析为角色卡扩展字段中的表情图片
 * - 其它 → 原样返回
 */
export function resolveExpressionUrl(srcVal: string, activeCharacter: any): string {
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

    // 兜底降级到主头像
    return activeCharacter.avatar || "";
  }

  return srcVal;
}

/**
 * 将 GFM（GitHub Flavored Markdown）表格语法转换为 HTML table 标签
 *
 * 转换规则：
 * - 表头行 + 分隔行（含 | 和 -）触发表格解析
 * - 分隔行支持对齐标记（:--- / :---: / ---:）
 * - 数据行数与表头列数对齐，缺失单元格留空
 * - 非 `|` 行或非表格结构行原样保留
 */
export function convertMarkdownTablesToHtml(text: string): string {
  if (!text.includes("|")) return text;

  const lines = text.split("\n");
  const processedLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.includes("|") && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const isSeparator = nextLine.includes("|") && nextLine.includes("-") && /^[|:\-\s]+$/.test(nextLine);

      if (isSeparator) {
        const splitRow = (rowText: string) => {
          let t = rowText.trim();
          if (t.startsWith("|")) t = t.slice(1);
          if (t.endsWith("|")) t = t.slice(0, -1);
          return t.split("|").map(cell => cell.trim());
        };

        const headers = splitRow(trimmedLine);
        const separators = splitRow(nextLine);

        const alignments = separators.map(s => {
          const left = s.startsWith(":");
          const right = s.endsWith(":");
          if (left && right) return "center";
          if (right) return "right";
          return "left";
        });

        let tableHtml = `<table class="mvu-markdown-table"><thead><tr>`;
        headers.forEach((h, idx) => {
          const align = alignments[idx] || "left";
          tableHtml += `<th style="text-align: ${align}">${h}</th>`;
        });
        tableHtml += `</tr></thead><tbody>`;

        i += 2;

        while (i < lines.length) {
          const dataLine = lines[i].trim();
          if (dataLine.includes("|")) {
            const cells = splitRow(dataLine);
            tableHtml += `<tr>`;
            for (let cIdx = 0; cIdx < headers.length; cIdx++) {
              const cellVal = cells[cIdx] || "";
              const align = alignments[cIdx] || "left";
              tableHtml += `<td style="text-align: ${align}">${cellVal}</td>`;
            }
            tableHtml += `</tr>`;
            i++;
          } else {
            break;
          }
        }

        tableHtml += `</tbody></table>`;
        processedLines.push(tableHtml);
        continue;
      }
    }

    processedLines.push(line);
    i++;
  }

  return processedLines.join("\n");
}
