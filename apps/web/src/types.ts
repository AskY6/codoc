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
}

export interface ServiceErrorBody {
  readonly error: { readonly kind: string; readonly [k: string]: unknown };
}
