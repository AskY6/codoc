import type {
  CodataDefinition,
  CodataField,
  CodataMeta,
  FieldError,
  ForceContext,
  LoaderDeclaration,
} from "../model/types.js";
import { getLoader } from "../loader/registry.js";
import { validate } from "../validation/schema-validator.js";
import { isExternalRef, parseExternalRef } from "../model/resolver.js";

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
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;
    if ("$ref" in obj && typeof obj["$ref"] === "string") {
      const ref = obj["$ref"];
      if (isExternalRef(ref)) {
        const { docRef, fieldPath } = parseExternalRef(ref);
        return { type: "external", docRef, fieldPath };
      }
      return { type: "ref", $ref: ref };
    }
    if ("$source" in obj) {
      const raw = obj["$source"];
      // string → URL fetch; object with connector → connector dispatch
      if (typeof raw === "string" || (typeof raw === "object" && raw !== null && "connector" in (raw as Record<string, unknown>))) {
        return {
          type: "source",
          $source: raw as string | import("../model/types.js").SourceConnectorConfig,
          ttl: typeof obj["ttl"] === "number" ? obj["ttl"] : undefined,
          staleWhileRevalidate: typeof obj["staleWhileRevalidate"] === "boolean"
            ? obj["staleWhileRevalidate"]
            : undefined,
          refresh: obj["refresh"] === "eager" || obj["refresh"] === "lazy"
            ? obj["refresh"]
            : undefined,
        };
      }
    }
    if ("$prompt" in obj && typeof obj["$prompt"] === "object" && obj["$prompt"] !== null) {
      const prompt = obj["$prompt"] as Record<string, unknown>;
      if (typeof prompt["template"] === "string") {
        return {
          type: "prompt",
          $prompt: {
            template: prompt["template"],
            model: typeof prompt["model"] === "string" ? prompt["model"] : undefined,
          },
        };
      }
    }
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
  private fieldListeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();
  private pendingForces = new Map<string, Promise<unknown>>();

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
   * Subscribe to all field state changes. Returns an unsubscribe function.
   *
   * The callback fires when any field is marked dirty, resolved, or errored.
   * It does NOT auto-force — the consumer decides whether to re-observe.
   */
  subscribe(listener: () => void): () => void {
    this.globalListeners.add(listener);
    return () => { this.globalListeners.delete(listener); };
  }

  /**
   * Subscribe to state changes for a specific field. Returns an unsubscribe function.
   *
   * Callback fires when the field transitions state (dirty, resolved, error).
   * It does NOT auto-force — the consumer decides whether to re-observe.
   * Used by React (useSyncExternalStore) and cross-doc propagation.
   */
  subscribeField(path: string, listener: () => void): () => void {
    let set = this.fieldListeners.get(path);
    if (!set) {
      set = new Set();
      this.fieldListeners.set(path, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.fieldListeners.delete(path);
    };
  }

  private notify(path: string): void {
    const fieldSet = this.fieldListeners.get(path);
    if (fieldSet) {
      for (const fn of fieldSet) fn();
    }
    for (const fn of this.globalListeners) fn();
  }

  /**
   * Update a field's value externally (e.g., from console or user input).
   * Sets the field to resolved with the new value and notifies subscribers.
   */
  updateField(path: string, newValue: unknown): void {
    const field = this.fields.get(path);
    if (!field) throw new Error(`Field not found: ${path}`);
    field.meta.loader = { type: "literal", value: newValue };
    field.state = { status: "resolved", value: newValue };
    this.notify(path);
  }

  /**
   * Reset a field to idle so the next observe/force re-executes its original loader.
   * Unlike invalidateField (which only transitions resolved/error → dirty),
   * this also clears any pending force dedup.
   */
  refreshField(path: string): boolean {
    const field = this.fields.get(path);
    if (!field) return false;
    field.state = { status: "idle" };
    this.pendingForces.delete(path);
    this.notify(path);
    return true;
  }

  /**
   * Mark a field as dirty so it will be re-evaluated on next observe/force.
   */
  invalidateField(path: string): boolean {
    const field = this.fields.get(path);
    if (!field) return false;
    if (field.state.status === "resolved" || field.state.status === "error") {
      field.state = { status: "dirty" };
      this.notify(path);
      return true;
    }
    return false;
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

    // If already errored, re-throw (but not if dirty — dirty fields should re-evaluate)
    if (field.state.status === "error") {
      throw field.state.error;
    }

    // If already being forced, return the cached promise (dedup concurrent forces)
    if (field.state.status === "pending") {
      const pending = this.pendingForces.get(path);
      if (pending) return pending;
    }

    // Dirty fields are treated like idle — re-evaluate them

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
      this.notify(path);
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

    const promise = (async () => {
      try {
        const loader = getLoader(field.meta.loader);
        const rawValue = await loader(field, context);

        // Validate against schema if present
        if (field.meta.schema) {
          const result = validate(field.meta.schema, rawValue, path);
          if (!result.ok) {
            field.state = { status: "error", error: result.error };
            this.notify(path);
            throw result.error;
          }
        }

        field.state = { status: "resolved", value: rawValue };
        this.notify(path);
        return rawValue;
      } catch (err) {
        // If error is already a FieldError, preserve it
        if (
          typeof err === "object" &&
          err !== null &&
          "kind" in err
        ) {
          field.state = { status: "error", error: err as FieldError };
          this.notify(path);
          throw err;
        }
        // Wrap unknown errors
        const error: FieldError = {
          kind: "loader",
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        };
        field.state = { status: "error", error };
        this.notify(path);
        throw error;
      }
    })();

    this.pendingForces.set(path, promise);
    const cleanup = () => { this.pendingForces.delete(path); };
    promise.then(cleanup, cleanup);
    return promise;
  }
}
