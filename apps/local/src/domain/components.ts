// Custom component types — pure type declarations shared by the runtime
// scanner (`runtime/components.ts`) and the Workspace type.

export interface CustomComponent {
  /** PascalCase component name derived from filename (e.g. "ScoreCard") */
  readonly name: string;
  /** Compiled CJS JavaScript (react externalized) */
  readonly code: string;
}

export interface CustomComponentError {
  readonly name: string;
  readonly error: string;
}

export type CustomComponentEntry =
  | { readonly kind: "ok"; readonly component: CustomComponent }
  | { readonly kind: "error"; readonly error: CustomComponentError };
