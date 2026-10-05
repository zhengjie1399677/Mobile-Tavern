/**
 * 组装本轮上下文贡献：调用方贡献（记忆召回）+ 注册来源贡献。
 *
 * 两者走同一通道、同一类型；记忆放在最前，保证它的宏由记忆自己提供。
 * 注册来源解析失败已在其内部降级为空，这里不额外抛出。
 */
import type { IKernel } from "../../kernel/types";
import type { ContextContribution } from "../../domain/contextSources/contracts";
import type { RecalledMessage } from "../services/memory/types";
import type { ContextReadRequest } from "./contextSourceRegistry";
import { buildMemoryContextContribution } from "./memoryContextContribution";
import { resolveContextContributions } from "./resolveContextContributions";

export async function resolveTurnContextContributions(
  kernel: IKernel | null | undefined,
  recalled: readonly RecalledMessage[],
  request: ContextReadRequest,
): Promise<readonly ContextContribution[]> {
  const registered = await resolveContextContributions(kernel, request);
  return [buildMemoryContextContribution(recalled), ...registered];
}
