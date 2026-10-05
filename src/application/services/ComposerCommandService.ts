/**
 * 输入框斜杠命令注册表。
 *
 * 唯一职责：持有命令定义、按 Profile 过滤、按名字执行。
 * 命令的产出只有一种去向——回填输入框草稿；是否发送由用户决定。
 */
import type { EffectDisposer, IKernel } from "../../kernel/types";
import {
  normalizeComposerCommandName,
  type ComposerCommandDefinition,
  type ComposerCommandDescriptor,
  type ComposerCommandRequest,
} from "../../domain/composer/contracts";
import { KernelServices, type IComposerCommandService } from "../serviceContracts";

export class ComposerCommandService implements IComposerCommandService {
  readonly name = KernelServices.ComposerCommands;
  readonly isCritical = false;
  readonly dependencies = [] as const;

  private readonly commands = new Map<string, ComposerCommandDefinition>();

  init(_kernel: IKernel): void {
    // 纯内存注册表；命令由 Tool Plugin、外部能力源与宿主内置三方按需注册。
  }

  async destroy(): Promise<void> {
    this.commands.clear();
  }

  register(definition: ComposerCommandDefinition): EffectDisposer {
    const name = normalizeComposerCommandName(definition.descriptor.name);
    if (!name) throw new Error("COMPOSER_COMMAND_NAME_INVALID");
    if (this.commands.has(name)) {
      throw new Error(`COMPOSER_COMMAND_ALREADY_REGISTERED:${name}`);
    }
    const stored: ComposerCommandDefinition = Object.freeze({
      ...definition,
      descriptor: Object.freeze({ ...definition.descriptor, name }),
      profileIds: Object.freeze([...definition.profileIds]),
    });
    this.commands.set(name, stored);
    return () => {
      if (this.commands.get(name) === stored) this.commands.delete(name);
    };
  }

  list(profileId: string): readonly ComposerCommandDescriptor[] {
    return [...this.commands.values()]
      .filter((item) => item.profileIds.includes("*") || item.profileIds.includes(profileId))
      .map((item) => item.descriptor)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async execute(name: string, request: ComposerCommandRequest): Promise<string> {
    const key = normalizeComposerCommandName(name);
    const definition = this.commands.get(key);
    if (!definition) throw new Error("COMPOSER_COMMAND_NOT_FOUND");
    if (!definition.profileIds.includes("*") && !definition.profileIds.includes(request.profileId)) {
      throw new Error("COMPOSER_COMMAND_PROFILE_UNAVAILABLE");
    }
    return definition.run({ ...request, argument: request.argument.trim() });
  }
}
