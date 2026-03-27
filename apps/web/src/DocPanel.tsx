import { useState, Suspense, Component, type ReactNode, type ComponentType } from "react";
import { CodataProvider, CodataValue } from "./codata-react.js";
import type { CodocRuntime } from "./runtime.js";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

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
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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
  role,
}: {
  docId: string;
  runtime: CodocRuntime;
  rawSource: string;
  MDXContent: ComponentType<{ components: Record<string, ComponentType<{ path: string }>> }>;
  role: "provider" | "consumer";
}) {
  const [mode, setMode] = useState<"render" | "source">("render");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{docId}</span>
          <Badge variant={role}>{role}</Badge>
        </div>
        <TabsList>
          <TabsTrigger active={mode === "render"} onClick={() => setMode("render")}>
            Render
          </TabsTrigger>
          <TabsTrigger active={mode === "source"} onClick={() => setMode("source")}>
            Source
          </TabsTrigger>
        </TabsList>
      </CardHeader>
      <CardContent>
        {mode === "render" ? (
          <CodataProvider tree={runtime.tree} dag={runtime.dag}>
            <ErrorBoundary>
              <Suspense
                fallback={<div className="text-sm italic text-muted-foreground">Loading...</div>}
              >
                <div className="prose prose-sm max-w-none">
                  <MDXContent components={{ CodataValue }} />
                </div>
              </Suspense>
            </ErrorBoundary>
          </CodataProvider>
        ) : (
          <pre className="max-h-[400px] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
            {rawSource}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
