import { PromptSection, PromptNode, RuntimeContext, SectionPriority, SectionPhase } from "./types";
import { PromptRenderer, XMLRenderer, MarkdownRenderer } from "./PromptRenderer";

export class PromptCompiler {
  private static readonly PHASE_ORDER: SectionPhase[] = [
    "Engine",
    "Context",
    "Generation",
    "Protocol"
  ];

  private static readonly PRIORITY_WEIGHTS: Record<SectionPriority, number> = {
    Highest: 4,
    High: 3,
    Normal: 2,
    Low: 1
  };

  private static readonly SAFE_CONTEXT_LIMIT = 12000;

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
  }

  private renderWithChineseHierarchy(nodes: PromptNode[], renderer: PromptRenderer, context: RuntimeContext): string {
    const engineNodes: PromptNode[] = [];
    const contextNodes: PromptNode[] = [];
    const generationNodes: PromptNode[] = [];
    const outputExampleNodes: PromptNode[] = [];

    const getLayer = (node: PromptNode): "Engine" | "Context" | "Generation" | "OutputExample" => {
      if (node.id === "output_example") {
        return "OutputExample";
      }
      if (node.phase === "Engine" || node.phase === "Protocol") {
        return "Engine";
      }
      if (node.phase === "Context") {
        return "Context";
      }
      if (node.phase === "Generation") {
        return "Generation";
      }
      return "Engine";
    };

    for (const node of nodes) {
      const layer = getLayer(node);
      if (layer === "Engine") engineNodes.push(node);
      else if (layer === "Context") contextNodes.push(node);
      else if (layer === "Generation") generationNodes.push(node);
      else if (layer === "OutputExample") outputExampleNodes.push(node);
    }

    const sortLayerNodes = (nodesList: PromptNode[]): PromptNode[] => {
      const staticNodes = nodesList.filter(n => !n.mutable);
      const dynamicNodes = nodesList.filter(n => n.mutable);

      const sortByPriorityAndId = (list: PromptNode[]): PromptNode[] => {
        return [...list].sort((a, b) => {
          const weightA = PromptCompiler.PRIORITY_WEIGHTS[a.priority] || 2;
          const weightB = PromptCompiler.PRIORITY_WEIGHTS[b.priority] || 2;
          if (weightB !== weightA) {
            return weightB - weightA;
          }
          return a.id.localeCompare(b.id);
        });
      };

      return [...sortByPriorityAndId(staticNodes), ...sortByPriorityAndId(dynamicNodes)];
    };

    const renderedEngine = renderer.render(sortLayerNodes(engineNodes), context);
    const renderedContext = renderer.render(sortLayerNodes(contextNodes), context);
    const renderedGeneration = renderer.render(sortLayerNodes(generationNodes), context);
    const renderedOutputExample = renderer.render(sortLayerNodes(outputExampleNodes), context);

    const hierarchyHeader = `# 提示词执行层级规范

本提示词采用固定的四层执行架构。

规则层（Engine）
最高优先级。
定义核心规则、行为边界及输出协议。
后续任何层级均不得覆盖本层。

输出示例层（OutputExample）
定义AI最终生成的XML和标签嵌套格式。
你必须严格遵循此格式规范与输出顺序。

事实层（Context）
提供世界观、角色设定、记忆等事实。
不得修改规则层。

生成层（Generation）
规定叙事风格、生成方式及写作偏好。
不得修改规则层或事实层。

优先级：

规则层（Engine）＞
输出示例层（OutputExample）＞
事实层（Context）＞
生成层（Generation）

整个回复过程中，必须始终遵循上述层级。`;

    let compiledText = hierarchyHeader + "\n\n";

    const separator = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

    if (renderedEngine.trim()) {
      compiledText += `${separator}\n规则层（Engine）: 最高优先级。定义核心规则、行为边界及输出协议。后续任何层级均不得覆盖本层。\n${separator}\n\n` + renderedEngine + "\n\n";
    }

    if (renderedOutputExample.trim()) {
      compiledText += `${separator}\n输出示例层（OutputExample）: 定义AI最终生成的XML和标签嵌套格式。每次回复必须严格遵循以下格式进行输出。\n${separator}\n\n` + renderedOutputExample + "\n\n";
    }

    if (renderedContext.trim()) {
      compiledText += `${separator}\n事实层（Context）: 提供世界观、角色设定、记忆等事实。不得修改规则层。\n${separator}\n\n` + renderedContext + "\n\n";
    }

    if (renderedGeneration.trim()) {
      compiledText += `${separator}\n生成层（Generation）: 规定叙事风格、生成方式及写作偏好。不得修改规则层或事实层。\n${separator}\n\n` + renderedGeneration + "\n\n";
    }

    return compiledText.trim();
  }

  compile(sections: PromptSection[], context: RuntimeContext): string {
    const activeSections = sections.filter(s => s.enabled);
    const nodes: PromptNode[] = [];

    for (const section of activeSections) {
      try {
        const node = section.compile(context);
        if (node && node.content.trim()) {
          nodes.push(node);
        }
      } catch (err) {
        console.error(`[PromptCompiler] Error compiling section ${section.id}:`, err);
      }
    }

    const modelName = (context.settings.api?.modelName || "").toLowerCase();
    const useMarkdown = modelName.includes("gpt-3.5") || modelName.includes("llama-2");
    const renderer: PromptRenderer = useMarkdown ? new MarkdownRenderer() : new XMLRenderer();

    let compiledText = this.renderWithChineseHierarchy(nodes, renderer, context);

    // Token Budget Defense (Trimming)
    let estimatedTokens = this.estimateTokens(compiledText);
    if (estimatedTokens > PromptCompiler.SAFE_CONTEXT_LIMIT) {
      console.warn(`[PromptCompiler] Compiled prompt tokens (${estimatedTokens}) exceeds limit (${PromptCompiler.SAFE_CONTEXT_LIMIT}). Trimming...`);

      const trimmableNodes = nodes.filter(n => n.type !== "Instruction");
      trimmableNodes.sort((a, b) => {
        const weightA = PromptCompiler.PRIORITY_WEIGHTS[a.priority] || 2;
        const weightB = PromptCompiler.PRIORITY_WEIGHTS[b.priority] || 2;
        return weightA - weightB; // Ascending priority (Low -> Normal -> High)
      });

      const nodesToKeep = new Set<string>(nodes.map(n => n.id));

      for (const nodeToTrim of trimmableNodes) {
        nodesToKeep.delete(nodeToTrim.id);
        const filteredNodes = nodes.filter(n => nodesToKeep.has(n.id));
        compiledText = this.renderWithChineseHierarchy(filteredNodes, renderer, context);
        estimatedTokens = this.estimateTokens(compiledText);
        if (estimatedTokens <= PromptCompiler.SAFE_CONTEXT_LIMIT) {
          break;
        }
      }
    }

    return compiledText.replace(/\n{3,}/g, "\n\n").trim();
  }
}
