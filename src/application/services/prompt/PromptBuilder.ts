import { PromptSection } from "./types";

export class PromptBuilder {
  private sections: PromptSection[] = [];

  registerSection(section: PromptSection): void {
    const index = this.sections.findIndex(s => s.id === section.id);
    if (index !== -1) {
      this.sections[index] = section;
    } else {
      this.sections.push(section);
    }
  }

  unregisterSection(id: string): void {
    this.sections = this.sections.filter(s => s.id !== id);
  }

  getSections(): PromptSection[] {
    return [...this.sections];
  }

  clear(): void {
    this.sections = [];
  }
}
