import type { IKernel } from "../../kernel/types";
import type {
  CompatibilityCodecDefinition,
  CompatibilityContextSourceDefinition,
  CompatibilityPromptSectionDefinition,
  CompatibilityPromptSectionRequest,
  CompatibilityRendererDefinition,
  CompatibilityRuntimeDiagnostics,
  CompatibilityStateReducerDefinition,
  CompatibilityTransformDefinition,
  CompatibilityTransformRequest,
  ICompatibilityRuntimeService,
} from "../compatibility/contracts";
import type { CharacterCard, ChatSession } from "../../types";

const CONTRIBUTION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

/** 常驻的空 Compatibility Host；具体生态语义只由 Runtime Plugin 贡献。 */
export class CompatibilityRuntimeService implements ICompatibilityRuntimeService {
  readonly name = "compatibilityRuntime";
  readonly isCritical = false;
  readonly dependencies = [] as const;

  private readonly codecs = new Map<string, CompatibilityCodecDefinition>();
  private readonly promptSections = new Map<string, CompatibilityPromptSectionDefinition>();
  private readonly contextSources = new Map<string, CompatibilityContextSourceDefinition>();
  private readonly transforms = new Map<string, CompatibilityTransformDefinition>();
  private readonly stateReducers = new Map<string, CompatibilityStateReducerDefinition>();
  private readonly renderers = new Map<string, CompatibilityRendererDefinition>();
  private active = false;

  init(_kernel: IKernel): void {
    this.active = true;
  }

  destroy(): void {
    this.active = false;
    this.renderers.clear();
    this.stateReducers.clear();
    this.transforms.clear();
    this.contextSources.clear();
    this.promptSections.clear();
    this.codecs.clear();
  }

  registerCodec(definition: CompatibilityCodecDefinition) {
    return this.register(this.codecs, definition.id, definition);
  }

  registerPromptSection(definition: CompatibilityPromptSectionDefinition) {
    return this.register(this.promptSections, definition.id, definition);
  }

  registerContextSource(definition: CompatibilityContextSourceDefinition) {
    return this.register(this.contextSources, definition.id, definition);
  }

  registerTransform(definition: CompatibilityTransformDefinition) {
    return this.register(this.transforms, definition.id, definition);
  }

  registerStateReducer(definition: CompatibilityStateReducerDefinition) {
    return this.register(this.stateReducers, definition.id, definition);
  }

  registerRenderer(definition: CompatibilityRendererDefinition) {
    const dispose = this.register(this.renderers, definition.id, definition);
    try {
      definition.initializeGlobals();
    } catch (error: unknown) {
      dispose();
      throw error;
    }
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      let cleanupError: unknown;
      try {
        definition.cleanBridge();
      } catch (error: unknown) {
        cleanupError = error;
      } finally {
        await dispose();
      }
      if (cleanupError !== undefined) throw cleanupError;
    };
  }

  transformText(request: CompatibilityTransformRequest): string {
    let text = request.text;
    for (const definition of sorted(this.transforms)) {
      text = definition.transform({ ...request, text });
    }
    return text;
  }

  initializeState(character: CharacterCard | null): Record<string, unknown> {
    let state: Record<string, unknown> = {};
    for (const definition of sorted(this.stateReducers)) {
      state = { ...state, ...definition.initialize(character) };
    }
    return structuredClone(state);
  }

  reduceState(
    text: string,
    currentState: Record<string, unknown>,
    signal?: AbortSignal,
  ): Record<string, unknown> {
    let state = structuredClone(currentState);
    for (const definition of sorted(this.stateReducers)) {
      state = definition.reduce({ text, currentState: state, signal });
    }
    return structuredClone(state);
  }

  notifyStateChanged(session: ChatSession, messageId?: number): void {
    for (const definition of sorted(this.stateReducers)) definition.notify(session, messageId);
  }

  buildPromptSections(request: CompatibilityPromptSectionRequest) {
    return sorted(this.promptSections).flatMap((definition) => definition.build(request));
  }

  readContextSources(session: ChatSession): Readonly<Record<string, unknown>> {
    return Object.freeze(Object.fromEntries(sorted(this.contextSources)
      .map((definition) => [definition.id, structuredClone(definition.read(session))])));
  }

  getCodec(format: string): CompatibilityCodecDefinition | null {
    return sorted(this.codecs).find((definition) => definition.format === format) ?? null;
  }

  getRenderer(): CompatibilityRendererDefinition | null {
    return sorted(this.renderers)[0] ?? null;
  }

  getDiagnostics(): CompatibilityRuntimeDiagnostics {
    return {
      codecs: ids(this.codecs),
      promptSections: ids(this.promptSections),
      contextSources: ids(this.contextSources),
      transforms: ids(this.transforms),
      stateReducers: ids(this.stateReducers),
      renderers: ids(this.renderers),
    };
  }

  isEnabled(): boolean {
    const diagnostics = this.getDiagnostics();
    return Object.values(diagnostics).some((contributions) => contributions.length > 0);
  }

  private register<TValue extends { readonly version: string }>(
    registry: Map<string, TValue>,
    id: string,
    definition: TValue,
  ) {
    if (!this.active) throw new Error("COMPATIBILITY_RUNTIME_NOT_ACTIVE");
    if (!CONTRIBUTION_ID_PATTERN.test(id)) throw new Error(`COMPATIBILITY_CONTRIBUTION_ID_INVALID: ${id}`);
    if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(definition.version)) {
      throw new Error(`COMPATIBILITY_CONTRIBUTION_VERSION_INVALID: ${id}`);
    }
    if (registry.has(id)) throw new Error(`COMPATIBILITY_CONTRIBUTION_DUPLICATE: ${id}`);
    registry.set(id, definition);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (registry.get(id) === definition) registry.delete(id);
    };
  }
}

function sorted<TValue>(registry: ReadonlyMap<string, TValue>): TValue[] {
  return [...registry.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function ids(registry: ReadonlyMap<string, unknown>): string[] {
  return [...registry.keys()].sort((left, right) => left.localeCompare(right));
}
