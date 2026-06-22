import { ILLMService, IKernel } from "../types";
import { universalFetch } from "../../utils/apiClient";

export class LLMService implements ILLMService {
  name = "llm";
  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  async universalFetch(
    type: string,
    config: {
      baseUrl: string;
      apiKey: string;
      chatPath?: string;
      bypassProxy?: boolean;
      reqBody: any;
    },
    signal?: AbortSignal
  ): Promise<Response> {
    return universalFetch(type, config, signal);
  }
}
