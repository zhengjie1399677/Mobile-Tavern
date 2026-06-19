import { IPromptService, IKernel } from "../types";
import { CharacterCard, ChatSession, UserSettings, LorebookEntry } from "../../types";
import { assemblePromptContext } from "../../utils/promptBuilder";

export class PromptService implements IPromptService {
  name = "prompt";
  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  assemblePrompt(params: {
    character: CharacterCard;
    chat: ChatSession;
    userInput: string;
    settings: UserSettings;
    globalLorebook: LorebookEntry[];
  }): {
    systemInstruction: string;
    history: Array<{ role: "model" | "user" | "assistant"; content: string }>;
    dynamicInstruction: string;
  } {
    return assemblePromptContext(params);
  }
}
