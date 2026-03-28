import { CodataValue } from "./CodataValue";

// MDX component registry for client-side MDX evaluation.
// Any component used in .codoc view templates must be registered here.

export function getMdxComponents() {
  return {
    CodataValue,
    // Custom display components
    Badge: ({ children }: { children: React.ReactNode }) => (
      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
        {children}
      </span>
    ),
    PriceDisplay: ({ children }: { children: React.ReactNode }) => (
      <span className="text-2xl font-bold">${children}</span>
    ),
    SourceBlock: ({ path, children }: { path?: string; children: React.ReactNode }) => (
      <div className="rounded-lg border bg-card p-4">
        {path && <div className="mb-1 text-xs text-muted-foreground font-mono">{path}</div>}
        <pre className="text-sm whitespace-pre-wrap">{children}</pre>
      </div>
    ),
    AIBlock: ({ label, children }: { label?: string; children: React.ReactNode }) => (
      <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-4">
        {label && <div className="mb-1 text-xs text-purple-600 font-medium">{label}</div>}
        <div className="text-sm">{children}</div>
      </div>
    ),
    Highlight: ({ variant, children }: { variant?: string; children: React.ReactNode }) => {
      const colors = variant === "warning"
        ? "border-amber-200 bg-amber-50/50 text-amber-900"
        : "border-blue-200 bg-blue-50/50 text-blue-900";
      return (
        <div className={`rounded-lg border p-4 text-sm ${colors}`}>
          {children}
        </div>
      );
    },
    InfoRow: ({ label, children }: { label: string; children: React.ReactNode }) => (
      <div className="flex items-baseline gap-2 py-1">
        <span className="text-sm text-muted-foreground min-w-[80px]">{label}</span>
        <span className="text-sm font-medium">{children}</span>
      </div>
    ),
  };
}
