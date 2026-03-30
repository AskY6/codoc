import type { CodataField, FieldError } from "../model/data.js";
import type { ForceContext } from "../model/codoc.js";
import type { SubscriptionManager } from "./subscribe.js";
import { forceField, wrapError } from "./force.js";

/**
 * Core execution loop: manages the force lifecycle for a field map.
 */
export async function executeForce(
  path: string,
  fields: Map<string, CodataField>,
  pendingForces: Map<string, Promise<unknown>>,
  forceStack: Set<string>,
  subs: SubscriptionManager,
  forceRecursive: (path: string, stack: Set<string>) => Promise<unknown>,
): Promise<unknown> {
  const field = fields.get(path);
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

  // If already being forced, return the cached promise (dedup concurrent forces)
  if (field.state.status === "pending") {
    const pending = pendingForces.get(path);
    if (pending) return pending;
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
    subs.notify(path);
    throw error;
  }

  // Mark pending
  field.state = { status: "pending" };
  const newStack = new Set(forceStack);
  newStack.add(path);

  const context: ForceContext = {
    force: (targetPath: string) => forceRecursive(targetPath, newStack),
    forceStack: newStack,
  };

  const promise = (async () => {
    try {
      const rawValue = await forceField(field, context);
      field.state = { status: "resolved", value: rawValue };
      subs.notify(path);
      return rawValue;
    } catch (err) {
      const error = wrapError(err);
      field.state = { status: "error", error };
      subs.notify(path);
      throw err;
    }
  })();

  pendingForces.set(path, promise);
  const cleanup = () => { pendingForces.delete(path); };
  promise.then(cleanup, cleanup);
  return promise;
}
