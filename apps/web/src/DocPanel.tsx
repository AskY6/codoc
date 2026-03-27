import { useState, Suspense, Component, type ReactNode, type ComponentType } from "react";
import { CodataProvider, CodataValue } from "./codata-react.js";
import type { CodocRuntime } from "./runtime.js";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <strong>Error:</strong> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export function DocPanel({
  docId,
  runtime,
  rawSource,
  MDXContent,
  selected,
  onSelect,
}: {
  docId: string;
  runtime: CodocRuntime;
  rawSource: string;
  MDXContent: ComponentType<{ components: Record<string, ComponentType<{ path: string }>> }>;
  selected: boolean;
  onSelect: () => void;
}) {
  const [mode, setMode] = useState<"render" | "source">("render");

  return (
    <div
      className={`doc-panel${selected ? " doc-panel--selected" : ""}`}
      onClick={onSelect}
    >
      <div className="doc-panel-header">
        <span className="doc-label">{docId}</span>
        <div className="doc-tabs">
          <button
            className={`doc-tab${mode === "render" ? " doc-tab--active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setMode("render"); }}
          >
            Render
          </button>
          <button
            className={`doc-tab${mode === "source" ? " doc-tab--active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setMode("source"); }}
          >
            Source
          </button>
        </div>
      </div>

      {mode === "render" ? (
        <CodataProvider tree={runtime.tree} dag={runtime.dag}>
          <ErrorBoundary>
            <Suspense
              fallback={<div className="suspense-fallback">Loading...</div>}
            >
              <MDXContent components={{ CodataValue }} />
            </Suspense>
          </ErrorBoundary>
        </CodataProvider>
      ) : (
        <pre className="codoc-source">{rawSource}</pre>
      )}
    </div>
  );
}
