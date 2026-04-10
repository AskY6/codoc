import { useEffect, useState, Component, type ReactNode } from "react";
import { compileMdx } from "@/lib/mdx-runtime.js";
import { codocComponents, CodocActionsProvider } from "./index.js";
import type { ComponentType } from "react";
import type { ViewAction } from "@/types.js";

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  error: Error | null;
}

class MdxErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <h4 className="text-sm font-medium text-destructive mb-1">
            MDX Render Error
          </h4>
          <pre className="text-xs text-destructive/80 whitespace-pre-wrap overflow-auto max-h-40">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// MdxRenderer
// ---------------------------------------------------------------------------

interface MdxRendererProps {
  source: string;
  data: Record<string, unknown>;
  components?: Record<string, ComponentType<any>>;
  onAction?: ((action: ViewAction) => void) | undefined;
}

export function MdxRenderer({ source, data, components, onAction }: MdxRendererProps) {
  const [Content, setContent] = useState<React.ComponentType<{
    components?: Record<string, React.ComponentType<any>>;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    compileMdx(source, data)
      .then((result) => {
        if (!cancelled) {
          setContent(() => result.Content);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setContent(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source, data]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <h4 className="text-sm font-medium text-destructive mb-1">
          MDX Compilation Error
        </h4>
        <pre className="text-xs text-destructive/80 whitespace-pre-wrap overflow-auto max-h-40">
          {error}
        </pre>
      </div>
    );
  }

  if (!Content) {
    return (
      <div className="text-sm text-muted-foreground animate-pulse">
        Compiling…
      </div>
    );
  }

  return (
    <CodocActionsProvider onAction={onAction}>
      <MdxErrorBoundary>
        <div className="prose prose-sm max-w-none text-foreground">
          <Content components={components ?? codocComponents} />
        </div>
      </MdxErrorBoundary>
    </CodocActionsProvider>
  );
}
