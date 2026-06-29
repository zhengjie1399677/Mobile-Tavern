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

  compile(sections: PromptSection[], context: RuntimeContext): string {
    // Phase 1 & 2: Collect & Filter
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

    // Helper to sort a list of nodes by Phase and then by Priority
    const sortNodes = (nodesList: PromptNode[]): PromptNode[] => {
      const sorted: PromptNode[] = [];
      for (const phase of PromptCompiler.PHASE_ORDER) {
        const phaseNodes = nodesList.filter(n => n.phase === phase);
        phaseNodes.sort((a, b) => {
          const weightA = PromptCompiler.PRIORITY_WEIGHTS[a.priority] || 2;
          const weightB = PromptCompiler.PRIORITY_WEIGHTS[b.priority] || 2;
          if (weightB !== weightA) {
            return weightB - weightA;
          }
          return a.id.localeCompare(b.id);
        });
        sorted.push(...phaseNodes);
      }
      return sorted;
    };

    // Phase 3: Sort & Pack (Cache-Optimized Layout: Static first, then Dynamic)
    const staticNodes = nodes.filter(n => !n.mutable);
    const dynamicNodes = nodes.filter(n => n.mutable);

    const sortedStatic = sortNodes(staticNodes);
    const sortedDynamic = sortNodes(dynamicNodes);

    const finalNodes = [...sortedStatic, ...sortedDynamic];

    // Phase 4: Render
    const modelName = (context.settings.api?.modelName || "").toLowerCase();
    const useMarkdown = modelName.includes("gpt-3.5") || modelName.includes("llama-2");
    const renderer: PromptRenderer = useMarkdown ? new MarkdownRenderer() : new XMLRenderer();

    let compiledText = renderer.render(finalNodes, context);

    // Token Budget Defense (Trimming)
    let estimatedTokens = this.estimateTokens(compiledText);
    if (estimatedTokens > PromptCompiler.SAFE_CONTEXT_LIMIT) {
      console.warn(`[PromptCompiler] Compiled prompt tokens (${estimatedTokens}) exceeds limit (${PromptCompiler.SAFE_CONTEXT_LIMIT}). Trimming...`);
      
      const trimmableNodes = finalNodes.filter(n => n.type !== "Instruction");
      trimmableNodes.sort((a, b) => {
        const weightA = PromptCompiler.PRIORITY_WEIGHTS[a.priority] || 2;
        const weightB = PromptCompiler.PRIORITY_WEIGHTS[b.priority] || 2;
        return weightA - weightB; // Ascending priority (Low -> Normal -> High)
      });

      const nodesToKeep = new Set<string>(finalNodes.map(n => n.id));

      for (const nodeToTrim of trimmableNodes) {
        nodesToKeep.delete(nodeToTrim.id);
        const filteredNodes = finalNodes.filter(n => nodesToKeep.has(n.id));
        compiledText = renderer.render(filteredNodes, context);
        estimatedTokens = this.estimateTokens(compiledText);
        if (estimatedTokens <= PromptCompiler.SAFE_CONTEXT_LIMIT) {
          break;
        }
      }
    }

    return compiledText.replace(/\n{3,}/g, "\n\n").trim();
  }
}
