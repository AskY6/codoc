import type { CodataField, ForceContext, LoaderFn } from "../types.js";

export const refLoader: LoaderFn = async (
  field: CodataField,
  context: ForceContext
): Promise<unknown> => {
  const decl = field.meta.loader;
  if (decl.type !== "ref") {
    throw new Error(`refLoader called on non-ref field: ${field.path}`);
  }
  const targetPath = decl.$ref;

  // Cycle detection: if targetPath is already in the force stack, we have a cycle
  if (context.forceStack.has(targetPath)) {
    const cycle = [...context.forceStack, targetPath];
    // Trim to just the cycle portion
    const cycleStart = cycle.indexOf(targetPath);
    const cyclePath = cycle.slice(cycleStart);
    throw {
      kind: "cyclic_ref" as const,
      message: `Cyclic reference detected: ${cyclePath.join(" → ")}`,
      path: field.path,
      cycle: cyclePath,
    };
  }

  return context.force(targetPath);
};
