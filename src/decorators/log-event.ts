import { BaseLogFriendsClient } from "../core/base-client.js";
import { isValidEventName, sanitizePayload } from "../core/event-sanitizer.js";
import { parameterMetadataStore, type ParameterMetadata } from "./log-field.js";
import { discoveredEventRegistry } from "../discovery/event-discovery.js";

export interface LogFieldDefinitionOption {
  name: string;
  description?: string;
  type?: string;
  required?: boolean;
  example?: unknown;
}

export interface LogEventOptions {
  /**
   * Name of the event to track in camelCase (e.g. 'orderCreated').
   * If omitted, falls back to the method name in camelCase.
   */
  name?: string;

  /**
   * Human-readable description of why this event exists.
   */
  description?: string;

  /**
   * Explicit field definitions describing the purpose and type of each parameter.
   */
  fields?: LogFieldDefinitionOption[];

  /**
   * Explicit client instance to use. If omitted, uses the global client.
   */
  client?: BaseLogFriendsClient;

  /**
   * Parameter names to map method arguments to payload keys.
   * e.g. ['orderId', 'amount'] -> { orderId: args[0], amount: args[1] }
   */
  paramNames?: string[];

  /**
   * Whether to include method arguments in the payload (default: true).
   */
  includeArgs?: boolean;

  /**
   * Whether to include method return value in the payload (default: false).
   */
  includeResult?: boolean;

  /**
   * Whether to measure and record execution duration in ms (default: true).
   */
  includeDuration?: boolean;

  /**
   * Custom payload builder function.
   */
  payload?: (
    args: unknown[],
    result?: unknown,
    error?: Error,
  ) => Record<string, unknown>;
}

let globalClient: BaseLogFriendsClient | null = null;

type DecoratedMethod = (this: unknown, ...args: unknown[]) => unknown;

interface LogEventDecorator {
  <This, Args extends unknown[], Result>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<(this: This, ...args: Args) => Result>,
  ): TypedPropertyDescriptor<(this: This, ...args: Args) => Result>;
  <This, Args extends unknown[], Result>(
    value: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): (this: This, ...args: Args) => Result;
}

function isLegacyMethodDescriptor(value: unknown): value is TypedPropertyDescriptor<DecoratedMethod> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof (value as { value?: unknown }).value === "function"
  );
}

function isStandardMethodContext(
  value: unknown,
): value is ClassMethodDecoratorContext<unknown, DecoratedMethod> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "method"
  );
}

/**
 * Sets the default global client instance for `@LogEvent` decorators.
 */
export function setGlobalClient(client: BaseLogFriendsClient | null): void {
  globalClient = client;
}

/**
 * Returns the currently active global client instance.
 */
export function getGlobalClient(): BaseLogFriendsClient | null {
  return globalClient;
}

/**
 * Universal method decorator supporting both TypeScript Stage 3 Standard Decorators
 * and Legacy Experimental Decorators (NestJS / Angular / TS experimentalDecorators).
 */
export function LogEvent(optionsOrName?: string | LogEventOptions): LogEventDecorator {
  const options: LogEventOptions =
    typeof optionsOrName === "string"
      ? { name: optionsOrName }
      : (optionsOrName ?? {});

  const decorator = (
    targetOrMethod: unknown,
    contextOrPropertyKey?: unknown,
    descriptor?: unknown,
  ): unknown => {
    if (isLegacyMethodDescriptor(descriptor)) {
      // Legacy experimental decorator: (target, propertyKey, descriptor)
      const target = targetOrMethod;
      const originalMethod = descriptor.value;
      if (typeof originalMethod !== "function") return descriptor;
      const propertyKey = String(contextOrPropertyKey);
      const wrapped = wrapMethod(originalMethod, options, propertyKey, target);
      registerDiscoveredEvent(target, propertyKey, options);
      descriptor.value = wrapped;
      return descriptor;
    } else if (
      typeof targetOrMethod === "function" &&
      isStandardMethodContext(contextOrPropertyKey)
    ) {
      // Stage 3 standard decorator: (method, context)
      const originalMethod = targetOrMethod as DecoratedMethod;
      const contextName = String(contextOrPropertyKey.name);
      const wrapped = wrapMethod(originalMethod, options, contextName, undefined);
      registerDiscoveredEvent(undefined, contextName, options);
      return wrapped;
    } else if (
      typeof targetOrMethod === "function" &&
      typeof contextOrPropertyKey === "string"
    ) {
      // Property descriptor shorthand
      const originalMethod = targetOrMethod as DecoratedMethod;
      const wrapped = wrapMethod(originalMethod, options, contextOrPropertyKey, undefined);
      registerDiscoveredEvent(undefined, contextOrPropertyKey, options);
      return wrapped;
    }

    return targetOrMethod;
  };

  return decorator as unknown as LogEventDecorator;
}

function registerDiscoveredEvent(
  target: unknown,
  propertyKey: string,
  options: LogEventOptions,
): void {
  const resolvedName = (options.name ?? propertyKey).trim();
  if (!isValidEventName(resolvedName)) {
    return;
  }

  const className = getSourceClassName(target);

  const paramMetas = target ? parameterMetadataStore.getParameters(target, propertyKey) : [];

  let fields: ParameterMetadata[] = [];
  if (options.fields && options.fields.length > 0) {
    fields = options.fields.map((f, idx) => ({
      index: idx,
      name: f.name,
      description: f.description,
      type: f.type,
      required: f.required !== false,
      masked: false,
      example: f.example,
    }));
  } else if (paramMetas.length > 0) {
    fields = paramMetas;
  } else if (options.paramNames && options.paramNames.length > 0) {
    fields = options.paramNames.map((name, idx) => ({
      index: idx,
      name,
      required: true,
      masked: false,
    }));
  }

  discoveredEventRegistry.register({
    eventName: resolvedName,
    description: options.description,
    sourceClass: className,
    sourceMethod: propertyKey,
    parameterNames: fields.map((f) => f.name),
    fields,
  });
}

function getSourceClassName(target: unknown): string {
  if (typeof target !== "object" || target === null) return "Service";
  const constructor = (target as { constructor?: unknown }).constructor;
  return typeof constructor === "function" && constructor.name.length > 0
    ? constructor.name
    : "Service";
}

function wrapMethod(
  originalMethod: (...args: unknown[]) => unknown,
  options: LogEventOptions,
  methodNameFallback: string,
  targetContext?: unknown,
): DecoratedMethod {
  return function (this: unknown, ...args: unknown[]): unknown {
    const client = options.client ?? globalClient;

    // Resolve eventName: options.name or fallback to method name
    let resolvedName = (options.name ?? methodNameFallback).trim();
    if (!resolvedName && methodNameFallback) {
      resolvedName = methodNameFallback;
    }

    if (!isValidEventName(resolvedName)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[Log Friends] @LogEvent skipped: eventName "${resolvedName}" must be camelCase (e.g. orderCreated).`,
        );
      }
      return originalMethod.apply(this, args);
    }

    const startTs = Date.now();

    const dispatchEvent = (
      result?: unknown,
      error?: Error,
    ): void => {
      if (!client) {
        return;
      }

      try {
        const durationMs = options.includeDuration !== false ? Date.now() - startTs : undefined;
        let eventPayload: Record<string, unknown> = {};

        if (options.payload) {
          eventPayload = options.payload(args, result, error);
        } else {
          if (options.includeArgs !== false && args.length > 0) {
            // Retrieve decorated parameter metadata
            const target = targetContext ?? this;
            const paramMetas = target ? parameterMetadataStore.getParameters(target, methodNameFallback) : [];

            if (paramMetas.length > 0) {
              paramMetas.forEach((meta) => {
                if (meta.index < args.length) {
                  const val = args[meta.index];
                  eventPayload[meta.name] = meta.masked ? "[REDACTED]" : val;
                }
              });
            } else if (options.fields && options.fields.length > 0) {
              options.fields.forEach((field, idx) => {
                if (idx < args.length) {
                  eventPayload[field.name] = args[idx];
                }
              });
            } else if (options.paramNames && options.paramNames.length > 0) {
              options.paramNames.forEach((paramName, idx) => {
                if (idx < args.length) {
                  eventPayload[paramName] = args[idx];
                }
              });
            } else if (args.length === 1 && typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0])) {
              // Single DTO object argument -> flatten fields
              Object.assign(eventPayload, args[0]);
            } else {
              args.forEach((arg, idx) => {
                eventPayload[`arg${String(idx)}`] = arg;
              });
            }
          }

          if (options.includeResult && result !== undefined) {
            eventPayload._result = result;
          }

          if (error) {
            eventPayload._error = {
              message: error.message,
              name: error.name,
            };
          }
        }

        if (durationMs !== undefined && eventPayload._durationMs === undefined) {
          eventPayload._durationMs = durationMs;
        }

        client.track(resolvedName, sanitizePayload(eventPayload));
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[Log Friends] Error dispatching @LogEvent:", err);
        }
      }
    };

    let result: unknown;
    try {
      result = originalMethod.apply(this, args);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dispatchEvent(undefined, error);
      throw err;
    }

    // Check if returned result is a Promise (async method)
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>)
        .then((res) => {
          dispatchEvent(res, undefined);
          return res;
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          dispatchEvent(undefined, error);
          throw err;
        });
    }

    // Synchronous execution
    dispatchEvent(result, undefined);
    return result;
  };
}
