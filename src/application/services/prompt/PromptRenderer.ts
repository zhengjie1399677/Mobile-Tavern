import { PromptNode, RuntimeContext } from "./types";

export interface PromptRenderer {
  render(nodes: PromptNode[], context: RuntimeContext): string;
}

export class XMLRenderer implements PromptRenderer {
  render(nodes: PromptNode[], context: RuntimeContext): string {
    return nodes.map(node => {
      const title = node.title || node.id;
      let content = node.content.trim();
      
      // 智能防复读提示注入：仅在检测到复读倾向时，在对话例句中注入
      if (node.type === "Reference" && context.repetitionDetected && node.id === "dialogue_examples") {
        content = `[Notice: Do not copy the following examples verbatim. Imitate the style but write completely original dialogue.]\n${content}`;
      }

      return `<${node.id}>\n### ${title}\n\n${content}\n</${node.id}>`;
    }).join("\n\n");
  }
}

export class MarkdownRenderer implements PromptRenderer {
  render(nodes: PromptNode[], context: RuntimeContext): string {
    return nodes.map(node => {
      const title = node.title || node.id;
      let content = node.content.trim();

      if (node.type === "Reference" && context.repetitionDetected && node.id === "dialogue_examples") {
        content = `*Notice: Do not copy the examples verbatim.*\n${content}`;
      }

      return `### ${title}\n\n${content}`;
    }).join("\n\n");
  }
}
