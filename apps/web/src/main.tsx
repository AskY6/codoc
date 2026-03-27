import { StrictMode, Suspense, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { CodataProvider, CodataValue } from "./codata-react.js";
import { CodocRuntime } from "./runtime.js";
import codocSource from "./example.codoc?raw";

// --- Error Boundary ---

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

// --- Boot ---

async function boot() {
  // 1. Create runtime from .codoc source
  const codocRuntime = new CodocRuntime(codocSource);

  // 2. Expose to console for interactive testing
  (window as unknown as Record<string, unknown>).codoc = codocRuntime;

  // 3. Pre-process view and compile MDX
  const processedView = codocRuntime.preprocessView();
  const { default: MDXContent } = await evaluate(processedView, {
    ...runtime,
    development: false,
  });

  // 4. Mount React app
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <CodataProvider tree={codocRuntime.tree} dag={codocRuntime.dag}>
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="suspense-fallback">Loading document...</div>
            }
          >
            <MDXContent components={{ CodataValue }} />
          </Suspense>
        </ErrorBoundary>
      </CodataProvider>
    </StrictMode>,
  );
}

boot().catch((err) => {
  document.getElementById("root")!.innerHTML = `
    <div class="error-boundary">
      <strong>Boot failed:</strong> ${err.message}
    </div>
  `;
  console.error(err);
});
