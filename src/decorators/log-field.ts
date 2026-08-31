export interface LogFieldOptions {
  /**
   * Field or parameter name (e.g. 'orderId', 'amount').
   */
  name?: string;

  /**
   * Purpose / description of why this parameter was created (e.g. '주문 고유 식별자').
   */
  description?: string;

  /**
   * Data type of the field ('string' | 'number' | 'boolean' | 'object' | 'array').
   */
  type?: string;

  /**
   * Whether this field is required (default: true).
   */
  required?: boolean;

  /**
   * Whether this field should be masked as [REDACTED].
   */
  masked?: boolean;

  /**
   * Example value for documentation / Log Catalog.
   */
  example?: unknown;
}

export interface ParameterMetadata {
  index: number;
  name: string;
  description?: string;
  type?: string;
  required: boolean;
  masked: boolean;
  example?: unknown;
}

export interface DiscoveredEventSpec {
  eventName: string;
  description?: string;
  apiMethod?: string;
  apiPath?: string;
  apiDescription?: string;
  sourceClass: string;
  sourceMethod: string;
  parameterNames: string[];
  fields: ParameterMetadata[];
}

/**
 * Global registry storing parameter metadata collected from @LogField and @LogMasked decorators.
 */
class ParameterMetadataStore {
  private readonly store = new Map<unknown, Map<string, Map<number, ParameterMetadata>>>();

  public registerField(
    target: unknown,
    propertyKey: string | symbol,
    parameterIndex: number,
    options: LogFieldOptions,
  ): void {
    const key = String(propertyKey);
    const methodMap = this.getOrCreateMethodMap(target, key);
    const existing = methodMap.get(parameterIndex) ?? {
      index: parameterIndex,
      name: options.name ?? `arg${String(parameterIndex)}`,
      required: options.required ?? true,
      masked: options.masked ?? false,
    };

    if (options.name) existing.name = options.name;
    if (options.description) existing.description = options.description;
    if (options.type) existing.type = options.type;
    if (options.required !== undefined) existing.required = options.required;
    if (options.masked !== undefined) existing.masked = options.masked;
    if (options.example !== undefined) existing.example = options.example;

    methodMap.set(parameterIndex, existing);
  }

  public registerMasked(
    target: unknown,
    propertyKey: string | symbol,
    parameterIndex: number,
    name?: string,
  ): void {
    const key = String(propertyKey);
    const methodMap = this.getOrCreateMethodMap(target, key);
    const existing = methodMap.get(parameterIndex) ?? {
      index: parameterIndex,
      name: name ?? `arg${String(parameterIndex)}`,
      required: true,
      masked: true,
    };

    if (name) existing.name = name;
    existing.masked = true;
    methodMap.set(parameterIndex, existing);
  }

  public getParameters(target: unknown, propertyKey: string | symbol): ParameterMetadata[] {
    const key = String(propertyKey);
    const targetMap = this.store.get(target);
    if (!targetMap) return [];
    const methodMap = targetMap.get(key);
    if (!methodMap) return [];
    return Array.from(methodMap.values()).sort((a, b) => a.index - b.index);
  }

  private getOrCreateMethodMap(
    target: unknown,
    propertyKey: string,
  ): Map<number, ParameterMetadata> {
    let targetMap = this.store.get(target);
    if (!targetMap) {
      targetMap = new Map();
      this.store.set(target, targetMap);
    }
    let methodMap = targetMap.get(propertyKey);
    if (!methodMap) {
      methodMap = new Map();
      targetMap.set(propertyKey, methodMap);
    }
    return methodMap;
  }
}

export const parameterMetadataStore = new ParameterMetadataStore();

/**
 * Parameter decorator defining field name, description (purpose), type and requirements.
 * Matches Kotlin SDK's `@LogField(description = "...", type = "...")`.
 */
export function LogField(optionsOrDescription?: string | LogFieldOptions): ParameterDecorator {
  const options: LogFieldOptions =
    typeof optionsOrDescription === "string"
      ? { description: optionsOrDescription }
      : (optionsOrDescription ?? {});

  return function (target: object, propertyKey: string | symbol | undefined, parameterIndex: number): void {
    if (propertyKey !== undefined) {
      parameterMetadataStore.registerField(target, propertyKey, parameterIndex, options);
    }
  };
}

/**
 * Parameter decorator marking a sensitive argument for automatic [REDACTED] masking.
 * Matches Kotlin SDK's `@LogMasked`.
 */
export function LogMasked(name?: string): ParameterDecorator {
  return function (target: object, propertyKey: string | symbol | undefined, parameterIndex: number): void {
    if (propertyKey !== undefined) {
      parameterMetadataStore.registerMasked(target, propertyKey, parameterIndex, name);
    }
  };
}
