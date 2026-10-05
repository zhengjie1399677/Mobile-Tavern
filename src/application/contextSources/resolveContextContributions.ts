/**
 * 发送链路的上下文贡献解析入口。
 *
 * 服务未装配（老会话、测试、精简组合根）时返回空数组，调用方行为与接线前一致。
 */
import type { IKernel } from "../../kernel/types";
import type { ContextContribution } from "../../domain/contextSources/contracts";
import { KernelServices, type IContextSourceService } from "../serviceContracts";
import type { ContextReadRequest } from "./contextSourceRegistry";

export async function resolveContextContributions(
  kernel: IKernel | null | undefined,
  request: ContextReadRequest,
): Promise<readonly ContextContribution[]> {
  try {
    // 精简组合根、测试替身与老会话可能只提供部分 Kernel 能力，这里逐项探测而不是断言。
    if (!kernel || typeof kernel.hasService !== "function") return [];
    if (!kernel.hasService(KernelServices.ContextSources)) return [];
    const service = kernel.getService<IContextSourceService>(KernelServices.ContextSources);
    if (!service || typeof service.readAll !== "function") return [];
    return await service.readAll(request);
  } catch {
    // 上下文是可选输入：来源自身的失败已在注册表内落成 status，真正的异常只可能来自
    // 装配问题，按设计降级为空贡献，绝不影响本轮发送。
    return [];
  }
}
