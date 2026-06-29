export type SectionType = "engine" | "character" | "context" | "style" | "output";

export interface PromptSection {
  id: string;
  type: SectionType;
  /** 在所属 type 内部的物理排序权重（升序） */
  order: number;
  enabled: boolean;
  /** 动态编译函数，根据模型能力输出最终文本 */
  compile: (capabilities: any) => string;
}
