/**
 * Kernel 通用校验扩展点。
 *
 * Kernel 只提供最小结构校验；具体服务方法与消息 topic 由应用组合根注入，
 * 避免内核认识任何产品业务名称。
 */
export const SAFE_PROXY_SYMBOL = Symbol("kernel.safeProxy");

export interface ValidationIssue {
  path: PropertyKey[];
  message: string;
}

export type ValidationResult =
  | { success: true }
  | {
      success: false;
      summary: string;
      error: { issues: ValidationIssue[] };
    };

export interface KernelValidators {
  validateService(name: string, service: unknown): ValidationResult;
  validateServiceRetrieval(name: string, service: unknown): ValidationResult;
  validateMessage(message: unknown): ValidationResult;
}

const success = (): ValidationResult => ({ success: true });

const failure = (summary: string, path: PropertyKey[], message: string): ValidationResult => ({
  success: false,
  summary,
  error: { issues: [{ path, message }] },
});

const defaultValidateService = (name: string, service: unknown): ValidationResult => {
  if (service === null || typeof service !== "object") {
    return failure(`Service "${name}" base structure validation failed`, [], "expected object");
  }
  const candidate = service as { name?: unknown; init?: unknown };
  if (candidate.name !== name) {
    return failure(`Service "${name}" base structure validation failed`, ["name"], "service name mismatch");
  }
  if (typeof candidate.init !== "function") {
    return failure(`Service "${name}" base structure validation failed`, ["init"], "expected function");
  }
  return success();
};

const defaultValidators: KernelValidators = {
  validateService: defaultValidateService,
  validateServiceRetrieval(name, service) {
    if (
      service !== null &&
      typeof service === "object" &&
      SAFE_PROXY_SYMBOL in service
    ) {
      return success();
    }
    return defaultValidateService(name, service);
  },
  validateMessage(message) {
    if (message === null || typeof message !== "object") {
      return failure("Message top-level structure invalid", [], "expected object");
    }
    const candidate = message as { topic?: unknown };
    if (typeof candidate.topic !== "string" || candidate.topic.length === 0) {
      return failure("Message top-level structure invalid", ["topic"], "expected non-empty string");
    }
    return success();
  },
};

let activeValidators: KernelValidators = defaultValidators;

export function configureKernelValidators(validators: KernelValidators): void {
  activeValidators = validators;
}

export function resetKernelValidators(): void {
  activeValidators = defaultValidators;
}

export function validateKernelService(name: string, service: unknown): ValidationResult {
  return activeValidators.validateService(name, service);
}

export function validateKernelServiceRetrieval(name: string, service: unknown): ValidationResult {
  return activeValidators.validateServiceRetrieval(name, service);
}

export function validateKernelMessage(message: unknown): ValidationResult {
  return activeValidators.validateMessage(message);
}
