/**
 * 上下文来源的运行时服务（C1a 接线部分）。
 *
 * 只做一件事：持有一个 Scope 内的来源注册表，并把读取结果交给发送链路。
 * 未注册任何来源时 `readAll` 返回空数组，发送链路行为与接线前完全一致。
 */
import type { IKernel } from "../../kernel/types";
import type { ContextContribution, ContextSourceDefinition } from "../../domain/contextSources/contracts";
import {
  createContextSourceRegistry,
  type ContextReadRequest,
  type ContextSourceRegistry,
} from "../contextSources/contextSourceRegistry";
import { KernelServices, type IContextSourceService } from "../serviceContracts";

export class ContextSourceService implements IContextSourceService {
  readonly name = KernelServices.ContextSources;
  readonly isCritical = false;
  readonly dependencies = [] as const;

  private readonly registry: ContextSourceRegistry = createContextSourceRegistry();

  init(_kernel: IKernel): void {
    // 注册表随服务 Scope 存活；目前没有内建来源，来源由后续阶段接入。
  }

  async destroy(): Promise<void> {
    // 注册表是纯内存结构，随实例一起释放。
  }

  register(definition: ContextSourceDefinition): () => void {
    return this.registry.register(definition);
  }

  list(): readonly ContextSourceDefinition[] {
    return this.registry.list();
  }

  readAll(request: ContextReadRequest): Promise<readonly ContextContribution[]> {
    return this.registry.readAll(request);
  }
}
