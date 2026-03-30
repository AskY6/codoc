import type {
  CodataField,
  CodataMeta,
  LoaderDeclaration,
} from "../model/data.js";
import type { CodataDefinition } from "../model/codoc.js";
import { isExternalRef, parseExternalRef } from "../model/resolver.js";
import { resolveLoaderDeclaration } from "./node.js";
import { SubscriptionManager } from "../runtime/subscribe.js";
import { executeForce } from "../runtime/runtime.js";

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

/**
 * Resolve loader declaration, handling external refs.
 */
function resolveDeclaration(value: unknown): LoaderDeclaration {
  const decl = resolveLoaderDeclaration(value);
  if (decl.type === "ref" && isExternalRef(decl.$ref)) {
    const { docRef, fieldPath } = parseExternalRef(decl.$ref);
    return { type: "external", docRef, fieldPath };
  }
  return decl;
}

export class DataTree {
  private fields = new Map<string, CodataField>();
  private definition: CodataDefinition;
  private subs = new SubscriptionManager();
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
      const loaderDecl = resolveDeclaration(value);

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
   */
  subscribe(listener: () => void): () => void {
    return this.subs.subscribe(listener);
  }

  /**
   * Subscribe to state changes for a specific field. Returns an unsubscribe function.
   */
  subscribeField(path: string, listener: () => void): () => void {
    return this.subs.subscribeField(path, listener);
  }

  /**
   * Update a field's value externally (e.g., from console or user input).
   */
  updateField(path: string, newValue: unknown): void {
    const field = this.fields.get(path);
    if (!field) throw new Error(`Field not found: ${path}`);
    field.meta.loader = { type: "literal", value: newValue };
    field.state = { status: "resolved", value: newValue };
    this.subs.notify(path);
  }

  /**
   * Reset a field to idle so the next observe/force re-executes its original loader.
   */
  refreshField(path: string): boolean {
    const field = this.fields.get(path);
    if (!field) return false;
    field.state = { status: "idle" };
    this.pendingForces.delete(path);
    this.subs.notify(path);
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
      this.subs.notify(path);
      return true;
    }
    return false;
  }

  /**
   * Observe a field: if idle, triggers force. Returns the resolved value.
   */
  async observe<T = unknown>(path: string): Promise<T> {
    return this.force(path, new Set()) as Promise<T>;
  }

  /**
   * Force a field to resolve its value. Handles state transitions and cycle detection.
   */
  async force(path: string, forceStack: Set<string>): Promise<unknown> {
    return executeForce(
      path,
      this.fields,
      this.pendingForces,
      forceStack,
      this.subs,
      (p, s) => this.force(p, s),
    );
  }
}
