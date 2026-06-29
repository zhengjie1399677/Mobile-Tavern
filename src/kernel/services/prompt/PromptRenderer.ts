import { PromptNode, RuntimeContext } from "./types";

export interface PromptRenderer {
  render(nodes: PromptNode[], context: RuntimeContext): string;
}

export class XMLRenderer implements PromptRenderer {
  render(nodes: PromptNode[], context: RuntimeContext): string {
    return nodes.map(node => {
      const attributes: string[] = [];
      attributes.push(`id="${node.id}"`);
      attributes.push(`phase="${node.phase}"`);
      attributes.push(`type="${node.type}"`);
      attributes.push(`priority="${node.priority}"`);
      attributes.push(`mutable="${node.mutable}"`);
      if (node.title) {
        attributes.push(`title="${node.title}"`);
      }

      let content = node.content.trim();
      
      // 智能防复读提示注入：仅在检测到复读倾向时，在对话例句中注入
      if (node.type === "Reference" && context.repetitionDetected && node.id === "dialogue_examples") {
        content = `[Notice: Do not copy the following examples verbatim. Imitate the style but write completely original dialogue.]\n${content}`;
      }

      return `<section ${attributes.join(" ")}>\n${content}\n</section>`;
    }).join("\n\n");
  }
}

export class MarkdownRenderer implements PromptRenderer {
  render(nodes: PromptNode[], context: RuntimeContext): string {
    return nodes.map(node => {
      const title = node.title || node.id;
      const header = `### ${title} (Phase: ${node.phase} | Type: ${node.type} | Priority: ${node.priority} | Mutable: ${node.mutable})`;
      let content = node.content.trim();

      if (node.type === "Reference" && context.repetitionDetected && node.id === "dialogue_examples") {
        content = `*Notice: Do not copy the examples verbatim.*\n${content}`;
      }

      return `${header}\n\n${content}`;
    }).join("\n\n");
  }
}
