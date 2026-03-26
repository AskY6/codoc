import type {
  CodataDefinition,
  CodataField,
  CodataMeta,
  FieldError,
  ForceContext,
  LoaderDeclaration,
} from "./types.js";
import { getLoader } from "./loader/registry.js";
import { validate } from "./schema.js";

/**
 * Parse a JSON Pointer (RFC 6901) into path segments.
 * e.g. "/data/user/name" → ["data", "user", "name"]
 */
function parseJsonPointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer: "${pointer}" (must start with /)`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Determine the loader declaration for a data value.
 */
function resolveLoaderDeclaration(value: unknown): LoaderDeclaration {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "$ref" in value &&
    typeof (value as Record<string, unknown>)["$ref"] === "string"
  ) {
    return { type: "ref", $ref: (value as Record<string, unknown>)["$ref"] as string };
  }
  return { type: "literal", value };
}

/**
 * Extract the JSON Schema for a specific property path from a root schema.
 */
function extractPropertySchema(
  rootSchema: Record<string, unknown>,
  segments: string[]
): Record<string, unknown> | undefined {
  let current = rootSchema;
  for (const segment of segments) {
    const properties = current["properties"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!properties || !(segment in properties)) return undefined;
    current = properties[segment];
  }
  return current;
}

export class DataTree {
  private fields = new Map<string, CodataField>();
  private definition: CodataDefinition;

  constructor(definition: CodataDefinition) {
    this.definition = definition;
    this.buildFields(definition.data, definition.type, []);
  }

  /**
   * Recursively build CodataField entries from nested data.
   */
  private buildFields(
    data: Record<string, unknown>,
    schema: Record<string, unknown>,
    pathSegments: string[]
  ): void {
    for (const [key, value] of Object.entries(data)) {
      const segments = [...pathSegments, key];
      const path = "/" + segments.join("/");
      const fieldSchema = extractPropertySchema(schema, segments);
      const loaderDecl = resolveLoaderDeclaration(value);

      // If value is a plain object without $ref, recurse into it
      if (
        loaderDecl.type === "literal" &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        // Register this node as a literal with the object value
        const meta: CodataMeta = {
          schema: fieldSchema,
          loader: loaderDecl,
        };
        this.fields.set(path, { path, meta, state: { status: "idle" } });
        // Also recurse into nested properties
        this.buildFields(
          value as Record<string, unknown>,
          schema,
          segments
        );
      } else {
        const meta: CodataMeta = {
          schema: fieldSchema,
          loader: loaderDecl,
        };
        this.fields.set(path, { path, meta, state: { status: "idle" } });
      }
    }
  }

  /**
   * Get a field by its JSON Pointer path.
   */
  getField(path: string): CodataField | undefined {
    return this.fields.get(path);
  }

  /**
   * Get all registered field paths.
   */
  getAllPaths(): string[] {
    return [...this.fields.keys()];
  }

  /**
   * Observe a field: if idle, triggers force. Returns the resolved value.
   * This is the primary API for consumers.
   */
  async observe<T = unknown>(path: string): Promise<T> {
    return this.force(path, new Set()) as Promise<T>;
  }

  /**
   * Force a field to resolve its value. Handles state transitions and cycle detection.
   */
  async force(path: string, forceStack: Set<string>): Promise<unknown> {
    const field = this.fields.get(path);
    if (!field) {
      const error: FieldError = {
        kind: "ref_not_found",
        message: `Field not found: ${path}`,
        path,
      };
      throw error;
    }

    // Idempotent: if already resolved, return cached value
    if (field.state.status === "resolved") {
      return field.state.value;
    }

    // If already errored, re-throw
    if (field.state.status === "error") {
      throw field.state.error;
    }

    // Cycle detection
    if (forceStack.has(path)) {
      const cycle = [...forceStack, path];
      const cycleStart = cycle.indexOf(path);
      const cyclePath = cycle.slice(cycleStart);
      const error: FieldError = {
        kind: "cyclic_ref",
        message: `Cyclic reference detected: ${cyclePath.join(" → ")}`,
        path,
        cycle: cyclePath,
      };
      field.state = { status: "error", error };
      throw error;
    }

    // Mark pending
    field.state = { status: "pending" };
    const newStack = new Set(forceStack);
    newStack.add(path);

    const context: ForceContext = {
      force: (targetPath: string) => this.force(targetPath, newStack),
      forceStack: newStack,
    };

    try {
      const loader = getLoader(field.meta.loader);
      const rawValue = await loader(field, context);

      // Validate against schema if present
      if (field.meta.schema) {
        const result = validate(field.meta.schema, rawValue, path);
        if (!result.ok) {
          field.state = { status: "error", error: result.error };
          throw result.error;
        }
      }

      field.state = { status: "resolved", value: rawValue };
      return rawValue;
    } catch (err) {
      // If error is already a FieldError, preserve it
      if (
        typeof err === "object" &&
        err !== null &&
        "kind" in err
      ) {
        field.state = { status: "error", error: err as FieldError };
        throw err;
      }
      // Wrap unknown errors
      const error: FieldError = {
        kind: "loader",
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      };
      field.state = { status: "error", error };
      throw error;
    }
  }
}
