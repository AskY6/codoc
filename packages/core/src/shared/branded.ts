// Helper for branded (nominal) types on top of primitives.
// Branded types let us distinguish e.g. CodocId from WorkspaceId at compile
// time without any runtime cost.

export type Brand<T, B extends string> = T & { readonly __brand: B };
