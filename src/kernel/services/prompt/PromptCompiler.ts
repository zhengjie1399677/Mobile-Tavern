import { PromptSection, SectionType } from "./types";

export class PromptCompiler {
  private static readonly CATEGORY_ORDER: SectionType[] = [
    "engine",
    "character",
    "context",
    "style",
    "output"
  ];

  private static readonly CATEGORY_HEADERS: Record<SectionType, string> = {
    engine: "==================================================\nENGINE\n==================================================",
    character: "==================================================\nCHARACTER\n==================================================",
    context: "==================================================\nCONTEXT\n==================================================",
    style: "==================================================\nSTYLE\n==================================================",
    output: "==================================================\nOUTPUT PROTOCOL\n=================================================="
  };

  compile(sections: PromptSection[], capabilities: any): string {
    const activeSections = sections.filter(s => s.enabled);
    const compiledBlocks: string[] = [];

    for (const type of PromptCompiler.CATEGORY_ORDER) {
      const typeSections = activeSections
        .filter(s => s.type === type)
        .sort((a, b) => a.order - b.order);

      const sectionTexts: string[] = [];
      for (const section of typeSections) {
        try {
          const text = section.compile(capabilities).trim();
          if (text) {
            sectionTexts.push(text);
          }
        } catch (err) {
          console.error(`[PromptCompiler] Error compiling section ${section.id}:`, err);
        }
      }

      if (sectionTexts.length > 0) {
        const header = PromptCompiler.CATEGORY_HEADERS[type];
        const content = sectionTexts.join("\n\n");
        compiledBlocks.push(`${header}\n\n${content}`);
      }
    }

    return compiledBlocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }
}
