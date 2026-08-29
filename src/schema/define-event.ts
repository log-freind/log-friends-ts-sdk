import { BaseLogFriendsClient } from "../core/base-client.js";
import { isValidEventName } from "../core/event-sanitizer.js";
import type { TrackOptions } from "../core/types.js";
import { discoveredEventRegistry, type DiscoveredEventCandidate } from "../discovery/event-discovery.js";

export interface FieldDefinition {
  /**
   * Purpose / description of why this field was created.
   */
  description?: string;

  /**
   * Expected data type (e.g. 'string', 'number', 'boolean', 'object', 'array').
   */
  type?: "string" | "number" | "boolean" | "object" | "array" | string;

  /**
   * Whether this field is mandatory for the event.
   */
  required?: boolean;

  /**
   * Example value for Log Catalog documentation.
   */
  example?: unknown;
}

export interface EventSchemaSpec<T extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Name of the event in camelCase (e.g. 'orderCompleted').
   */
  name: string;

  /**
   * Comprehensive description of the event purpose and trigger conditions.
   */
  description?: string;

  /**
   * Schema of all parameters and why each was created.
   */
  fields: {
    [K in keyof T]: FieldDefinition;
  };
}

export interface EventDefinition<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  readonly description?: string;
  readonly fields: Record<string, FieldDefinition>;
  /**
   * Type marker for TypeScript inference.
   */
  readonly _payloadType?: T;
}

/**
 * Declares a typed client event with parameter descriptions and data types.
 * Automatically registers the schema in the Discovered Event Registry.
 */
export function defineEvent<T extends Record<string, unknown>>(
  spec: EventSchemaSpec<T>,
): EventDefinition<T> {
  if (!isValidEventName(spec.name)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[Log Friends] defineEvent: eventName "${spec.name}" must be camelCase (e.g. orderCompleted).`);
    }
  }

  const def: EventDefinition<T> = {
    name: spec.name,
    description: spec.description,
    fields: spec.fields as Record<string, FieldDefinition>,
  };

  // Automatically register in Discovered Event Registry
  const fieldHints = Object.entries(spec.fields).map(([name, fieldDef]) => ({
    name,
    description: (fieldDef as FieldDefinition).description,
    type: (fieldDef as FieldDefinition).type,
    required: (fieldDef as FieldDefinition).required !== false,
    example: (fieldDef as FieldDefinition).example,
  }));

  discoveredEventRegistry.registerCustom({
    eventName: spec.name,
    sourceClass: "ClientSchema",
    sourceMethod: "defineEvent",
    parameterNames: Object.keys(spec.fields),
    specHint: {
      description: spec.description,
      fields: fieldHints,
    },
  });

  return def;
}

/**
 * Tracks an event using a predefined EventDefinition schema with full type safety.
 * Defaults to immediate flush for client environments.
 */
export function trackEvent<T extends Record<string, unknown>>(
  client: BaseLogFriendsClient,
  definition: EventDefinition<T>,
  payload: T,
  options: TrackOptions = {},
): boolean {
  return client.track(definition.name, payload, { immediate: true, ...options });
}

/**
 * Converts a collection of EventDefinitions into a format suitable for Log Friends Console Log Catalog.
 */
export function exportEventCatalog(
  events: Array<EventDefinition<Record<string, unknown>>>,
): DiscoveredEventCandidate[] {
  return events.map((def) => ({
    eventName: def.name,
    sourceClass: "ClientSchema",
    sourceMethod: "defineEvent",
    parameterNames: Object.keys(def.fields),
    specHint: {
      description: def.description,
      fields: Object.entries(def.fields).map(([name, f]) => ({
        name,
        description: f.description,
        type: f.type,
        required: f.required !== false,
        example: f.example,
      })),
    },
  }));
}
