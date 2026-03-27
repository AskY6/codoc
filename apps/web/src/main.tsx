import { StrictMode, Suspense, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { setLLMClient } from "@codoc/core";
import { CodataProvider, CodataValue } from "./codata-react.js";
import { CodocRuntime } from "./runtime.js";
import { mockLLMClient } from "./mock-llm.js";
import m3Source from "./m3-demo.codoc?raw";

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
  // 1. Configure mock LLM client for $prompt loader
  setLLMClient(mockLLMClient);

  // 2. Create runtime from M3 .codoc source
  const codocRuntime = new CodocRuntime(m3Source);

  // 3. Expose to console for interactive testing
  (window as unknown as Record<string, unknown>).codoc = codocRuntime;

  // 4. Force all fields in parallel via scheduler (M3 feature)
  const t0 = performance.now();
  const result = await codocRuntime.forceAll();
  const elapsed = (performance.now() - t0).toFixed(0);
  console.log(
    `[scheduler] forceAll completed in ${elapsed}ms — ` +
    `${result.resolved.length} resolved, ${result.errors.length} errors`,
  );
  if (result.errors.length > 0) {
    console.warn("[scheduler] errors:", result.errors);
  }

  // 5. Pre-process view and compile MDX
  const processedView = codocRuntime.preprocessView();
  const { default: MDXContent } = await evaluate(processedView, {
    ...runtime,
    development: false,
  });

  // 6. Mount React app
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
