import { useState, Suspense, Component, type ReactNode, type ComponentType } from "react";
import { CodataProvider } from "../runtime/codata-react.js";
import type { CodocRuntime } from "../runtime/runtime.js";
import type { DocOp } from "../App.js";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  mdxComponents,
  role,
  ops,
}: {
  docId: string;
  runtime: CodocRuntime;
  rawSource: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MDXContent: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdxComponents: Record<string, ComponentType<any>>;
  role: "provider" | "consumer";
  ops: DocOp[];
}) {
  const [mode, setMode] = useState<"render" | "source">("render");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold">{docId}</span>
          <Badge variant={role} className="text-[10px] px-1.5 py-0">{role}</Badge>
        </div>
        <TabsList className="h-6">
          <TabsTrigger active={mode === "render"} onClick={() => setMode("render")} className="px-2 py-0.5 text-[10px]">
            Render
          </TabsTrigger>
          <TabsTrigger active={mode === "source"} onClick={() => setMode("source")} className="px-2 py-0.5 text-[10px]">
            Source
          </TabsTrigger>
        </TabsList>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        {mode === "render" ? (
          <CodataProvider tree={runtime.tree} dag={runtime.dag}>
            <ErrorBoundary>
              <Suspense
                fallback={<div className="text-xs italic text-muted-foreground">Loading...</div>}
              >
                <div className="prose prose-xs max-w-none text-sm">
                  <MDXContent components={mdxComponents} />
                </div>
              </Suspense>
            </ErrorBoundary>
          </CodataProvider>
        ) : (
          <pre className="max-h-[400px] overflow-auto rounded-lg bg-muted p-2 font-mono text-[10px] leading-relaxed">
            {rawSource}
          </pre>
        )}
        {ops.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
            {ops.map((op) => (
              <Button
                key={op.label}
                variant="outline"
                size="sm"
                className="h-6 px-2 py-0"
                onClick={op.action}
              >
                <code className="text-[10px]">{op.label}</code>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
