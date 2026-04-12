// Wire-level DTO mirrors. Brands are stripped — over the network
// `WorkspaceId` is just `string`. We don't import from `@cobook/core`
// because the web app deliberately keeps zero coupling to the
// backend type system; the wire is the only contract.

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface WorkspaceListItem {
  readonly workspace: Workspace;
  readonly updatedAt: number;
  // Opaque optimistic-concurrency token. Echo back in `expectedRev`
  // on update; never parse or compare beyond equality.
  readonly rev: string;
  readonly codocCount: number;
}

// Flattened on the wire (unlike WorkspaceListItem) because the
// backend's canonical Codoc type holds `ReadonlyMap`s that JSON
// serialise to `{}` — nesting would silently lose data. See the
// backend's packages/service/src/types/codoc.ts for the rationale.
export interface CodocListItem {
  readonly id: string;
  readonly path: string;
  readonly title: string | null;
  readonly updatedAt: number;
  readonly rev: string;
}

// Detail DTO returned by GET /api/codocs/:id. Adds raw `content` on
// top of the list item; the ast is deliberately server-side only.
export interface CodocDetail {
  readonly id: string;
  readonly path: string;
  readonly title: string | null;
  readonly content: string;
  readonly updatedAt: number;
  readonly rev: string;
}

export interface ServiceErrorBody {
  readonly error: { readonly kind: string; readonly [k: string]: unknown };
}
